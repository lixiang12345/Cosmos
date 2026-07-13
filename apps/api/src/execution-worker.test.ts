import { describe, expect, it, vi } from 'vitest'
import {
  AgentProviderError,
  DeterministicConversationAgentProvider,
  type ConversationAgentExecutionInput,
  type ConversationAgentExecutionResult,
  type ConversationAgentProvider,
} from './conversation-agent-provider.js'
import type { ConversationToolBroker } from './conversation-tool-broker.js'
import type { ExecutionClaim, ExecutionRepository } from './execution-repository.js'
import { ExecutionWorker } from './execution-worker.js'

const claim: ExecutionClaim = {
  organizationId: 'organization-a',
  spaceId: 'space-a',
  sessionId: 'session-a',
  turnId: 'turn-a',
  commandId: 'command-a',
  attemptId: 'attempt-a',
  attemptNumber: 1,
  leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-07-13T08:00:30.000Z',
  requestId: 'request-a',
  requestedBy: 'user-a',
  requestedByKind: 'user',
  model: 'model-a',
  systemPrompt: 'Follow the task.',
  taskContext: 'Implement the requested change.',
}

function repository(overrides: Partial<ExecutionRepository> = {}): ExecutionRepository {
  return {
    claimNext: vi.fn().mockResolvedValue(claim),
    heartbeat: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue('failed'),
    reapExpired: vi.fn().mockResolvedValue({ requeued: 0, failed: 0, canceled: 0 }),
    ...overrides,
  }
}

function worker(
  repo: ExecutionRepository,
  provider: ConversationAgentProvider,
  heartbeatIntervalMs = 5,
  toolBroker?: ConversationToolBroker,
  maxToolIterations?: number,
) {
  return new ExecutionWorker({
    repository: repo,
    provider,
    workerId: 'worker-a',
    leaseDurationMs: 30_000,
    heartbeatIntervalMs,
    pollIntervalMs: 5,
    recoveryBatchSize: 20,
    ...(toolBroker ? { toolBroker } : {}),
    ...(maxToolIterations ? { maxToolIterations } : {}),
  })
}

function toolBroker(): ConversationToolBroker {
  return {
    definitions: [{
      name: 'workspace_files_list',
      description: 'List workspace files.',
      inputSchema: { type: 'object', additionalProperties: false },
    }],
    execute: vi.fn().mockResolvedValue({
      content: '{"ok":true,"files":[],"hasMore":false}',
    }),
  }
}

describe('ExecutionWorker', () => {
  it('completes a fenced conversational execution', async () => {
    const repo = repository()
    const provider = new DeterministicConversationAgentProvider('Completed output.')

    await expect(worker(repo, provider).runOnce()).resolves.toBe(true)

    expect(provider.calls).toEqual([expect.objectContaining({
      model: claim.model,
      systemPrompt: claim.systemPrompt,
      taskContext: claim.taskContext,
    })])
    expect(repo.complete).toHaveBeenCalledWith({
      claim,
      output: 'Completed output.',
      providerModel: claim.model,
    })
    expect(repo.fail).not.toHaveBeenCalled()
  })

  it('maps provider classifications into retry policy without leaking a cause', async () => {
    const repo = repository()
    const provider: ConversationAgentProvider = {
      execute: vi.fn().mockRejectedValue(new AgentProviderError({
        classification: 'transient',
        code: 'provider_rate_limited',
        message: 'Provider rate limit was reached.',
        statusCode: 429,
      })),
    }

    await worker(repo, provider).runOnce()

    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      claim,
      classification: 'transient',
      code: 'provider_rate_limited',
    }))
    expect(repo.complete).not.toHaveBeenCalled()
  })

  it('executes a governed tool and continues the Provider conversation before completion', async () => {
    const repo = repository()
    const broker = toolBroker()
    const provider = new DeterministicConversationAgentProvider((input, invocation) => (
      invocation === 1
        ? {
            text: '',
            finishReason: 'tool_calls',
            toolCall: {
              providerToolCallId: 'provider-tool-1',
              name: 'workspace_files_list',
              input: {},
            },
          }
        : {
            text: `Found ${input.toolExchanges?.length ?? 0} tool result.`,
            finishReason: 'stop',
          }
    ))

    await worker(repo, provider, 5, broker).runOnce()

    expect(broker.execute).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: claim.organizationId,
      sessionId: claim.sessionId,
      requestedBy: claim.requestedBy,
      requestedByKind: claim.requestedByKind,
    }), expect.objectContaining({ name: 'workspace_files_list' }), 1)
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]?.toolExchanges).toEqual([{
      call: {
        providerToolCallId: 'provider-tool-1',
        name: 'workspace_files_list',
        input: {},
      },
      assistantText: '',
      result: '{"ok":true,"files":[],"hasMore":false}',
    }])
    expect(repo.complete).toHaveBeenCalledWith({
      claim,
      output: 'Found 1 tool result.',
      providerModel: claim.model,
    })
  })

  it('fails the Attempt when the Provider exceeds the bounded tool iteration limit', async () => {
    const repo = repository()
    const broker = toolBroker()
    const provider = new DeterministicConversationAgentProvider((_input, invocation) => ({
      text: '',
      finishReason: 'tool_calls',
      toolCall: {
        providerToolCallId: `provider-tool-${invocation}`,
        name: 'workspace_files_list',
        input: {},
      },
    }))

    await worker(repo, provider, 5, broker, 1).runOnce()

    expect(broker.execute).toHaveBeenCalledOnce()
    expect(provider.calls).toHaveLength(2)
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      claim,
      classification: 'terminal',
      code: 'tool_iteration_limit',
    }))
    expect(repo.complete).not.toHaveBeenCalled()
  })

  it.each([
    ['length', 'provider_output_truncated'],
    ['content_filter', 'provider_content_filtered'],
  ] as const)('records provider model provenance when %s terminates output', async (finishReason, code) => {
    const repo = repository()
    const provider: ConversationAgentProvider = {
      execute: vi.fn().mockResolvedValue({
        providerResponseId: 'provider-response-1',
        providerModel: 'provider-model-20260701',
        text: 'Partial output.',
        finishReason,
      }),
    }

    await worker(repo, provider).runOnce()

    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      claim,
      classification: 'terminal',
      code,
      providerModel: 'provider-model-20260701',
    }))
    expect(repo.complete).not.toHaveBeenCalled()
  })

  it('aborts the provider and performs no terminal write after a lost heartbeat fence', async () => {
    const repo = repository({ heartbeat: vi.fn().mockResolvedValue(false) })
    const provider: ConversationAgentProvider = {
      execute: vi.fn(async ({ signal }: ConversationAgentExecutionInput) => new Promise<ConversationAgentExecutionResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new AgentProviderError({
          classification: 'terminal',
          code: 'execution_cancelled',
          message: 'Agent execution was cancelled.',
        })), { once: true })
      })),
    }

    await worker(repo, provider).runOnce()

    expect(repo.heartbeat).toHaveBeenCalled()
    expect(repo.complete).not.toHaveBeenCalled()
    expect(repo.fail).not.toHaveBeenCalled()
  })

  it('does not convert graceful shutdown into an execution failure', async () => {
    const shutdown = new AbortController()
    const repo = repository()
    const provider: ConversationAgentProvider = {
      execute: vi.fn(async ({ signal }: ConversationAgentExecutionInput) => new Promise<ConversationAgentExecutionResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new AgentProviderError({
          classification: 'terminal',
          code: 'execution_cancelled',
          message: 'Agent execution was cancelled.',
        })), { once: true })
        shutdown.abort()
      })),
    }

    await worker(repo, provider).runOnce(shutdown.signal)

    expect(repo.complete).not.toHaveBeenCalled()
    expect(repo.fail).not.toHaveBeenCalled()
  })
})
