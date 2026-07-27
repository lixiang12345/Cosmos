import { describe, expect, it, vi } from 'vitest'
import type { OutboxDeliveryClaim } from './outbox-delivery-repository.js'
import { HttpOutboxReceiverClient, outboxDeliveryId } from './outbox-receiver-client.js'

const claim: OutboxDeliveryClaim = {
  stream: 'session',
  organizationId: 'organization-a',
  spaceId: 'space-a',
  sourceId: 'event-a',
  eventType: 'session.created',
  occurredAt: '2026-07-27T06:00:00.000Z',
  attempt: 1,
  leaseOwner: 'worker-a',
  version: 2,
}

describe('HttpOutboxReceiverClient', () => {
  it('sends a fixed metadata-only envelope with a stable opaque idempotency key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    const client = new HttpOutboxReceiverClient({
      url: 'https://receiver.example/outbox',
      bearerToken: 'outbox-receiver-token',
      requestTimeoutMs: 1_000,
      fetch,
    })

    await expect(client.deliver(claim, new AbortController().signal)).resolves.toEqual({
      status: 'succeeded', statusCode: 202,
    })
    const [, request] = fetch.mock.calls[0]!
    const headers = new Headers(request?.headers)
    const deliveryId = outboxDeliveryId(claim)
    expect(headers.get('authorization')).toBe('Bearer outbox-receiver-token')
    expect(headers.get('idempotency-key')).toBe(deliveryId)
    expect(JSON.parse(String(request?.body))).toEqual({
      schemaVersion: 1,
      deliveryId,
      stream: 'session',
      sourceId: 'event-a',
      eventType: 'session.created',
      organizationId: 'organization-a',
      spaceId: 'space-a',
      occurredAt: '2026-07-27T06:00:00.000Z',
    })
    expect(String(request?.body)).not.toContain('outbox-receiver-token')
  })

  it.each([
    [302, { status: 'retryable', statusCode: 302, errorCode: 'receiver_redirect' }],
    [409, { status: 'rejected', statusCode: 409, errorCode: 'receiver_rejected' }],
    [503, { status: 'retryable', statusCode: 503, errorCode: 'receiver_server_error' }],
  ] as const)('classifies HTTP %s without reading the response body', async (status, expected) => {
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('upstream-secret')); controller.close() },
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { status }))
    const client = new HttpOutboxReceiverClient({
      url: 'https://receiver.example/outbox', bearerToken: 'outbox-receiver-token',
      requestTimeoutMs: 1_000, fetch,
    })
    await expect(client.deliver(claim, new AbortController().signal)).resolves.toEqual(expected)
  })

  it('classifies timeout, network failure, and caller interruption without leaking errors', async () => {
    const timeoutFetch = vi.fn<typeof globalThis.fetch>((_url, request) => new Promise((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(new Error('receiver-secret-timeout')), { once: true })
    }))
    const timeoutClient = new HttpOutboxReceiverClient({
      url: 'https://receiver.example/outbox', bearerToken: 'outbox-receiver-token',
      requestTimeoutMs: 5, fetch: timeoutFetch,
    })
    await expect(timeoutClient.deliver(claim, new AbortController().signal)).resolves.toEqual({
      status: 'retryable', statusCode: null, errorCode: 'receiver_timeout',
    })

    const networkClient = new HttpOutboxReceiverClient({
      url: 'https://receiver.example/outbox', bearerToken: 'outbox-receiver-token',
      requestTimeoutMs: 1_000,
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('receiver-secret-network')),
    })
    await expect(networkClient.deliver(claim, new AbortController().signal)).resolves.toEqual({
      status: 'retryable', statusCode: null, errorCode: 'receiver_network_error',
    })

    const interrupted = new AbortController()
    interrupted.abort()
    await expect(networkClient.deliver(claim, interrupted.signal)).resolves.toEqual({
      status: 'retryable', statusCode: null, errorCode: 'receiver_interrupted',
    })
  })
})
