import { createHash } from 'node:crypto'
import type { OutboxDeliveryClaim, OutboxDeliveryErrorCode } from './outbox-delivery-repository.js'

export type OutboxReceiverResult =
  | Readonly<{ status: 'succeeded'; statusCode: number }>
  | Readonly<{ status: 'rejected'; statusCode: number; errorCode: 'receiver_rejected' }>
  | Readonly<{ status: 'retryable'; statusCode: number | null; errorCode: Exclude<
    OutboxDeliveryErrorCode,
    'receiver_rejected'
  > }>

export interface OutboxReceiverClient {
  deliver(claim: OutboxDeliveryClaim, signal: AbortSignal): Promise<OutboxReceiverResult>
}

export type HttpOutboxReceiverClientOptions = Readonly<{
  url: string
  bearerToken: string
  requestTimeoutMs: number
  fetch?: typeof fetch
}>

export function outboxDeliveryId(claim: Pick<
  OutboxDeliveryClaim,
  'stream' | 'organizationId' | 'spaceId' | 'sourceId'
>) {
  return createHash('sha256')
    .update(`cosmos-outbox-v1\0${claim.stream}\0${claim.organizationId}\0${claim.spaceId}\0${claim.sourceId}`)
    .digest('hex')
}

export class HttpOutboxReceiverClient implements OutboxReceiverClient {
  private readonly fetch: typeof fetch

  constructor(private readonly options: HttpOutboxReceiverClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async deliver(claim: OutboxDeliveryClaim, inputSignal: AbortSignal): Promise<OutboxReceiverResult> {
    if (inputSignal.aborted) {
      return { status: 'retryable', statusCode: null, errorCode: 'receiver_interrupted' }
    }
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs)
    const signal = AbortSignal.any([inputSignal, timeout])
    const deliveryId = outboxDeliveryId(claim)
    try {
      const response = await this.fetch(this.options.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.bearerToken}`,
          'content-type': 'application/json',
          'idempotency-key': deliveryId,
          'x-cosmos-event': 'outbox.delivery',
        },
        body: JSON.stringify({
          schemaVersion: 1,
          deliveryId,
          stream: claim.stream,
          sourceId: claim.sourceId,
          eventType: claim.eventType,
          organizationId: claim.organizationId,
          spaceId: claim.spaceId,
          occurredAt: claim.occurredAt,
        }),
        signal,
      })
      await response.body?.cancel().catch(() => {})
      if (response.status >= 200 && response.status < 300) {
        return { status: 'succeeded', statusCode: response.status }
      }
      if (response.status >= 300 && response.status < 400) {
        return { status: 'retryable', statusCode: response.status, errorCode: 'receiver_redirect' }
      }
      if (response.status >= 400 && response.status < 500) {
        return { status: 'rejected', statusCode: response.status, errorCode: 'receiver_rejected' }
      }
      return { status: 'retryable', statusCode: response.status, errorCode: 'receiver_server_error' }
    } catch {
      if (inputSignal.aborted) {
        return { status: 'retryable', statusCode: null, errorCode: 'receiver_interrupted' }
      }
      return {
        status: 'retryable',
        statusCode: null,
        errorCode: timeout.aborted ? 'receiver_timeout' : 'receiver_network_error',
      }
    }
  }
}
