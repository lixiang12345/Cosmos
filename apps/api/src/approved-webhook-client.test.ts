import { describe, expect, it, vi } from 'vitest'
import { HttpApprovedWebhookClient } from './approved-webhook-client.js'

const signal = new AbortController().signal

describe('HttpApprovedWebhookClient', () => {
  it('sends one bounded event to the configured URL without exposing configuration', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    const client = new HttpApprovedWebhookClient({
      url: 'https://receiver.example/cosmos',
      bearerToken: 'receiver-secret-token',
      requestTimeoutMs: 1_000,
      fetch,
    })

    await expect(client.deliver({
      label: 'staging-smoke-20260727',
      idempotencyKey: 'attempt-a:provider-tool-a',
      signal,
    })).resolves.toEqual({ status: 'succeeded', statusCode: 202 })

    expect(fetch).toHaveBeenCalledWith('https://receiver.example/cosmos', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.objectContaining({
        authorization: 'Bearer receiver-secret-token',
        'idempotency-key': 'attempt-a:provider-tool-a',
      }),
      body: JSON.stringify({
        type: 'cosmos.approved_webhook_delivery',
        label: 'staging-smoke-20260727',
      }),
    }))
  })

  it.each([
    [400, 'failed'],
    [429, 'failed'],
    [500, 'unknown'],
    [302, 'unknown'],
  ] as const)('classifies HTTP %s without reading the response body', async (statusCode, status) => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      status: statusCode,
      body: { cancel },
    } as unknown as Response)
    const client = new HttpApprovedWebhookClient({
      url: 'https://receiver.example/cosmos',
      bearerToken: 'receiver-secret-token',
      requestTimeoutMs: 1_000,
      fetch,
    })

    await expect(client.deliver({ label: 'smoke', idempotencyKey: 'key', signal }))
      .resolves.toEqual({ status, statusCode })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('treats network and timeout failures as an unknown side effect', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('secret upstream failure'))
    const client = new HttpApprovedWebhookClient({
      url: 'https://receiver.example/cosmos',
      bearerToken: 'receiver-secret-token',
      requestTimeoutMs: 1_000,
      fetch,
    })

    await expect(client.deliver({ label: 'smoke', idempotencyKey: 'key', signal }))
      .resolves.toEqual({ status: 'unknown', statusCode: null })
  })

  it('does not send after execution cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = new HttpApprovedWebhookClient({
      url: 'https://receiver.example/cosmos',
      bearerToken: 'receiver-secret-token',
      requestTimeoutMs: 1_000,
      fetch,
    })

    await expect(client.deliver({ label: 'smoke', idempotencyKey: 'key', signal: controller.signal }))
      .resolves.toEqual({ status: 'failed', statusCode: null })
    expect(fetch).not.toHaveBeenCalled()
  })
})
