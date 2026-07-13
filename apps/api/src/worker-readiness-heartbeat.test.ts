import { describe, expect, it, vi } from 'vitest'
import { maintainWorkerReadiness } from './worker-readiness-heartbeat.js'
import type { WorkerReadinessRepository } from './worker-readiness-repository.js'

function repository(overrides: Partial<WorkerReadinessRepository> = {}): WorkerReadinessRepository {
  return {
    recordHeartbeat: vi.fn().mockResolvedValue(undefined),
    removeHeartbeat: vi.fn().mockResolvedValue(undefined),
    hasRecentHeartbeat: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('Worker readiness heartbeat', () => {
  it('registers immediately and removes its row during graceful shutdown', async () => {
    const shutdown = new AbortController()
    const repo = repository({
      recordHeartbeat: vi.fn(async () => shutdown.abort()),
    })
    const logger = { info: vi.fn(), error: vi.fn() }

    await maintainWorkerReadiness({
      repository: repo,
      workerId: 'worker-a',
      intervalMs: 1_000,
      logger,
    }, shutdown.signal)

    expect(repo.recordHeartbeat).toHaveBeenCalledOnce()
    expect(repo.removeHeartbeat).toHaveBeenCalledWith('worker-a')
    expect(logger.info).toHaveBeenCalledWith('worker_readiness_removed', { workerId: 'worker-a' })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs a failed initial heartbeat without publishing or removing readiness', async () => {
    const shutdown = new AbortController()
    const repo = repository({
      recordHeartbeat: vi.fn(async () => {
        shutdown.abort()
        throw new Error('database unavailable')
      }),
    })
    const logger = { info: vi.fn(), error: vi.fn() }

    await maintainWorkerReadiness({
      repository: repo,
      workerId: 'worker-a',
      intervalMs: 1_000,
      logger,
    }, shutdown.signal)

    expect(repo.removeHeartbeat).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'worker_readiness_heartbeat_failed',
      { workerId: 'worker-a' },
    )
  })
})
