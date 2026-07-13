import {
  AgentProviderError,
  type ConversationAgentExecutionResult,
  type ConversationAgentProvider,
  type ConversationAgentToolExchange,
} from './conversation-agent-provider.js'
import type { ConversationToolBroker } from './conversation-tool-broker.js'
import type { ExecutionClaim, ExecutionRepository } from './execution-repository.js'

export type ExecutionWorkerLogger = {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void
  error(event: string, fields?: Readonly<Record<string, unknown>>): void
}

export type ExecutionWorkerOptions = {
  repository: ExecutionRepository
  provider: ConversationAgentProvider
  workerId: string
  leaseDurationMs: number
  heartbeatIntervalMs: number
  pollIntervalMs: number
  recoveryBatchSize: number
  retryDelayMs?: number
  toolBroker?: ConversationToolBroker
  maxToolIterations?: number
  logger?: ExecutionWorkerLogger
}

const noOpLogger: ExecutionWorkerLogger = {
  info() {},
  error() {},
}

function abortableDelay(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export class ExecutionWorker {
  private readonly repository: ExecutionRepository
  private readonly provider: ConversationAgentProvider
  private readonly workerId: string
  private readonly leaseDurationMs: number
  private readonly heartbeatIntervalMs: number
  private readonly pollIntervalMs: number
  private readonly recoveryBatchSize: number
  private readonly retryDelayMs: number
  private readonly toolBroker?: ConversationToolBroker
  private readonly maxToolIterations: number
  private readonly logger: ExecutionWorkerLogger

  constructor(options: ExecutionWorkerOptions) {
    this.repository = options.repository
    this.provider = options.provider
    this.workerId = options.workerId
    this.leaseDurationMs = options.leaseDurationMs
    this.heartbeatIntervalMs = options.heartbeatIntervalMs
    this.pollIntervalMs = options.pollIntervalMs
    this.recoveryBatchSize = options.recoveryBatchSize
    this.retryDelayMs = options.retryDelayMs ?? 1_000
    this.toolBroker = options.toolBroker
    this.maxToolIterations = options.maxToolIterations ?? 8
    if (!Number.isSafeInteger(this.maxToolIterations) || this.maxToolIterations < 1 || this.maxToolIterations > 8) {
      throw new Error('Maximum tool iterations must be an integer between 1 and 8.')
    }
    this.logger = options.logger ?? noOpLogger
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const claimed = await this.runOnce(signal)
        if (!claimed) await abortableDelay(this.pollIntervalMs, signal)
      } catch {
        this.logger.error('execution_worker_iteration_failed')
        await abortableDelay(this.pollIntervalMs, signal)
      }
    }
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<boolean> {
    if (signal.aborted) return false
    const recovered = await this.repository.reapExpired({
      limit: this.recoveryBatchSize,
      retryDelayMs: this.retryDelayMs,
    })
    if (recovered.requeued || recovered.failed || recovered.canceled) {
      this.logger.info('execution_leases_recovered', recovered)
    }
    if (signal.aborted) return false

    const claim = await this.repository.claimNext({
      leaseOwner: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
    })
    if (!claim) return false
    await this.executeClaim(claim, signal)
    return true
  }

  private async executeClaim(claim: ExecutionClaim, shutdownSignal: AbortSignal) {
    const providerAbort = new AbortController()
    const heartbeatStop = new AbortController()
    const providerSignal = AbortSignal.any([shutdownSignal, providerAbort.signal])
    let leaseLost = false
    const heartbeat = this.maintainHeartbeat(
      claim,
      heartbeatStop.signal,
      () => {
        leaseLost = true
        providerAbort.abort()
      },
    )

    try {
      const toolExchanges: ConversationAgentToolExchange[] = []
      let result: ConversationAgentExecutionResult
      while (true) {
        result = await this.provider.execute({
          model: claim.model,
          systemPrompt: claim.systemPrompt.trim()
            || 'You are a software engineering assistant. Complete the requested task accurately.',
          taskContext: claim.taskContext,
          ...(this.toolBroker ? {
            tools: this.toolBroker.definitions,
            toolExchanges,
          } : {}),
          signal: providerSignal,
        })
        if (result.finishReason !== 'tool_calls') break
        if (!this.toolBroker || !result.toolCall) {
          heartbeatStop.abort()
          await heartbeat
          if (shutdownSignal.aborted || leaseLost) return
          await this.repository.fail({
            claim,
            classification: 'terminal',
            code: 'provider_response_invalid',
            message: 'Provider returned an invalid tool request.',
            providerModel: result.providerModel,
          })
          return
        }
        if (toolExchanges.length >= this.maxToolIterations) {
          heartbeatStop.abort()
          await heartbeat
          if (shutdownSignal.aborted || leaseLost) return
          await this.repository.fail({
            claim,
            classification: 'terminal',
            code: 'tool_iteration_limit',
            message: 'Agent exceeded the configured tool-call iteration limit.',
            providerModel: result.providerModel,
          })
          return
        }
        const toolResult = await this.toolBroker.execute({
          organizationId: claim.organizationId,
          spaceId: claim.spaceId,
          sessionId: claim.sessionId,
          turnId: claim.turnId,
          attemptId: claim.attemptId,
          workerId: claim.leaseOwner,
          requestedBy: claim.requestedBy,
          requestedByKind: claim.requestedByKind,
          requestId: claim.requestId,
        }, result.toolCall, toolExchanges.length + 1)
        toolExchanges.push({
          call: result.toolCall,
          assistantText: result.text,
          result: toolResult.content,
        })
      }
      heartbeatStop.abort()
      await heartbeat
      if (shutdownSignal.aborted || leaseLost) return

      if (!result.text.trim()) {
        await this.repository.fail({
          claim,
          classification: 'terminal',
          code: 'provider_empty_output',
          message: 'Provider returned no conversational output.',
          providerModel: result.providerModel,
        })
        return
      }
      if (result.finishReason !== 'stop') {
        await this.repository.fail({
          claim,
          classification: 'terminal',
          code: result.finishReason === 'length'
            ? 'provider_output_truncated'
            : 'provider_content_filtered',
          message: result.finishReason === 'length'
            ? 'Provider output reached the configured limit.'
            : 'Provider output was filtered.',
          providerModel: result.providerModel,
        })
        return
      }

      const completed = await this.repository.complete({
        claim,
        output: result.text,
        providerModel: result.providerModel,
      })
      if (!completed) this.logger.info('execution_completion_fence_lost', { commandId: claim.commandId })
    } catch (error) {
      heartbeatStop.abort()
      await heartbeat
      if (shutdownSignal.aborted || leaseLost) return

      if (error instanceof AgentProviderError) {
        if (error.code === 'execution_cancelled') return
        await this.repository.fail({
          claim,
          classification: error.classification,
          code: error.code,
          message: error.message,
          retryDelayMs: this.retryDelayMs,
        })
        return
      }
      await this.repository.fail({
        claim,
        classification: 'terminal',
        code: 'worker_internal_error',
        message: 'Execution worker encountered an internal error.',
      })
    } finally {
      heartbeatStop.abort()
    }
  }

  private async maintainHeartbeat(
    claim: ExecutionClaim,
    stopSignal: AbortSignal,
    onLost: () => void,
  ) {
    while (!stopSignal.aborted) {
      await abortableDelay(this.heartbeatIntervalMs, stopSignal)
      if (stopSignal.aborted) return
      try {
        const maintained = await this.repository.heartbeat({
          claim,
          leaseDurationMs: this.leaseDurationMs,
        })
        if (!maintained) {
          onLost()
          return
        }
      } catch {
        this.logger.error('execution_heartbeat_failed', { commandId: claim.commandId })
        onLost()
        return
      }
    }
  }
}
