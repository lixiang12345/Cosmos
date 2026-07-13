import type { WorkerReadinessRepository } from './worker-readiness-repository.js'

export type WorkerReadinessHeartbeatLogger = {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void
  error(event: string, fields?: Readonly<Record<string, unknown>>): void
}

type WorkerReadinessHeartbeatOptions = Readonly<{
  repository: WorkerReadinessRepository
  workerId: string
  intervalMs: number
  logger: WorkerReadinessHeartbeatLogger
}>

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

export async function maintainWorkerReadiness(
  options: WorkerReadinessHeartbeatOptions,
  signal: AbortSignal,
) {
  let registered = false
  try {
    while (!signal.aborted) {
      try {
        await options.repository.recordHeartbeat(options.workerId)
        registered = true
      } catch {
        options.logger.error('worker_readiness_heartbeat_failed', { workerId: options.workerId })
      }
      await abortableDelay(options.intervalMs, signal)
    }
  } finally {
    if (registered) {
      try {
        await options.repository.removeHeartbeat(options.workerId)
        options.logger.info('worker_readiness_removed', { workerId: options.workerId })
      } catch {
        options.logger.error('worker_readiness_removal_failed', { workerId: options.workerId })
      }
    }
  }
}
