import type { ExecutionWorkerLogger } from './execution-worker.js'
import type { OutboxDeliveryRepository } from './outbox-delivery-repository.js'
import type { OutboxReceiverClient } from './outbox-receiver-client.js'

export type OutboxDispatcherOptions = Readonly<{
  repository: OutboxDeliveryRepository
  client: OutboxReceiverClient
  workerId: string
  leaseDurationMs: number
  pollIntervalMs: number
  maxAttempts: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
  now?: () => Date
  logger?: ExecutionWorkerLogger
}>

const noOpLogger: ExecutionWorkerLogger = { info() {}, error() {} }

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

export class OutboxDispatcher {
  private readonly logger: ExecutionWorkerLogger

  constructor(private readonly options: OutboxDispatcherOptions) {
    this.logger = options.logger ?? noOpLogger
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const claimed = await this.runOnce(signal)
        if (!claimed) await abortableDelay(this.options.pollIntervalMs, signal)
      } catch {
        this.logger.error('outbox_delivery_iteration_failed')
        await abortableDelay(this.options.pollIntervalMs, signal)
      }
    }
  }

  async runOnce(signal: AbortSignal = new AbortController().signal) {
    if (signal.aborted) return false
    const claim = await this.options.repository.claimNext({
      leaseOwner: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    })
    if (!claim) return false

    const result = await this.options.client.deliver(claim, signal)
    if (result.status === 'succeeded') {
      if (!await this.options.repository.markDelivered(claim)) {
        this.logger.info('outbox_delivery_fence_lost', {
          stream: claim.stream,
          attempt: claim.attempt,
        })
      }
      return true
    }

    const terminal = result.status === 'rejected' || claim.attempt >= this.options.maxAttempts
    const retryAt = terminal ? undefined : new Date(
      (this.options.now?.() ?? new Date()).getTime() + this.retryDelay(claim.attempt),
    )
    const state = await this.options.repository.markFailed({
      claim,
      errorCode: result.errorCode,
      ...(retryAt ? { retryAt } : {}),
    })
    if (state === 'dead_letter') {
      this.logger.error('outbox_delivery_dead_lettered', {
        stream: claim.stream,
        attempt: claim.attempt,
        errorCode: result.errorCode,
      })
    } else if (state === 'fence_lost') {
      this.logger.info('outbox_delivery_fence_lost', {
        stream: claim.stream,
        attempt: claim.attempt,
      })
    }
    return true
  }

  private retryDelay(attempt: number) {
    const exponent = Math.max(0, Math.min(attempt - 1, 30))
    return Math.min(this.options.retryMaxDelayMs, this.options.retryBaseDelayMs * (2 ** exponent))
  }
}
