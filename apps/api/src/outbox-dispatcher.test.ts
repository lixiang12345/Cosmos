import { describe, expect, it, vi } from 'vitest'
import { OutboxDispatcher } from './outbox-dispatcher.js'
import type {
  OutboxDeliveryClaim,
  OutboxDeliveryRepository,
} from './outbox-delivery-repository.js'
import type { OutboxReceiverClient } from './outbox-receiver-client.js'

const claim = (attempt = 1): OutboxDeliveryClaim => ({
  stream: 'session', organizationId: 'org-a', spaceId: 'space-a', sourceId: 'event-a',
  eventType: 'session.created', occurredAt: '2026-07-27T06:00:00.000Z', attempt,
  leaseOwner: 'worker-a', version: 2,
})

function repository(delivery = claim()): OutboxDeliveryRepository {
  return {
    claimNext: vi.fn().mockResolvedValue(delivery),
    markDelivered: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue('retrying'),
    listDeadLetters: vi.fn(),
    replayDeadLetter: vi.fn(),
  }
}

function dispatcher(repo: OutboxDeliveryRepository, client: OutboxReceiverClient) {
  return new OutboxDispatcher({
    repository: repo,
    client,
    workerId: 'worker-a',
    leaseDurationMs: 30_000,
    pollIntervalMs: 10,
    maxAttempts: 3,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 5_000,
    now: () => new Date('2026-07-27T06:00:00.000Z'),
  })
}

describe('OutboxDispatcher', () => {
  it('marks a successful delivery published behind the exact claim fence', async () => {
    const repo = repository()
    const client: OutboxReceiverClient = {
      deliver: vi.fn().mockResolvedValue({ status: 'succeeded', statusCode: 202 }),
    }
    await expect(dispatcher(repo, client).runOnce()).resolves.toBe(true)
    expect(repo.claimNext).toHaveBeenCalledWith({ leaseOwner: 'worker-a', leaseDurationMs: 30_000 })
    expect(repo.markDelivered).toHaveBeenCalledWith(claim())
    expect(repo.markFailed).not.toHaveBeenCalled()
  })

  it('schedules bounded exponential retry for an uncertain receiver outcome', async () => {
    const repo = repository(claim(2))
    const client: OutboxReceiverClient = {
      deliver: vi.fn().mockResolvedValue({
        status: 'retryable', statusCode: 503, errorCode: 'receiver_server_error',
      }),
    }
    await dispatcher(repo, client).runOnce()
    expect(repo.markFailed).toHaveBeenCalledWith({
      claim: claim(2),
      errorCode: 'receiver_server_error',
      retryAt: new Date('2026-07-27T06:00:02.000Z'),
    })
  })

  it.each([
    [{ status: 'rejected', statusCode: 409, errorCode: 'receiver_rejected' } as const, 1],
    [{ status: 'retryable', statusCode: null, errorCode: 'receiver_timeout' } as const, 3],
  ])('dead-letters deterministic rejection or the final uncertain attempt', async (result, attempt) => {
    const repo = repository(claim(attempt))
    vi.mocked(repo.markFailed).mockResolvedValue('dead_letter')
    const client: OutboxReceiverClient = { deliver: vi.fn().mockResolvedValue(result) }
    await dispatcher(repo, client).runOnce()
    expect(repo.markFailed).toHaveBeenCalledWith({
      claim: claim(attempt), errorCode: result.errorCode,
    })
  })

  it('does nothing when there is no due delivery or shutdown already started', async () => {
    const repo = repository()
    vi.mocked(repo.claimNext).mockResolvedValue(null)
    const client: OutboxReceiverClient = { deliver: vi.fn() }
    await expect(dispatcher(repo, client).runOnce()).resolves.toBe(false)
    const aborted = new AbortController(); aborted.abort()
    await expect(dispatcher(repo, client).runOnce(aborted.signal)).resolves.toBe(false)
    expect(client.deliver).not.toHaveBeenCalled()
  })
})
