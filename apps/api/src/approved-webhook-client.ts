export type ApprovedWebhookDeliveryResult = Readonly<{
  status: 'succeeded' | 'failed' | 'unknown'
  statusCode: number | null
}>

export type ApprovedWebhookDelivery = Readonly<{
  label: string
  idempotencyKey: string
  signal: AbortSignal
}>

export interface ApprovedWebhookClient {
  deliver(input: ApprovedWebhookDelivery): Promise<ApprovedWebhookDeliveryResult>
}

export type HttpApprovedWebhookClientOptions = Readonly<{
  url: string
  bearerToken: string
  requestTimeoutMs: number
  fetch?: typeof fetch
}>

export class HttpApprovedWebhookClient implements ApprovedWebhookClient {
  private readonly fetch: typeof fetch

  constructor(private readonly options: HttpApprovedWebhookClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async deliver(input: ApprovedWebhookDelivery): Promise<ApprovedWebhookDeliveryResult> {
    if (input.signal.aborted) return { status: 'failed', statusCode: null }
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs)
    const signal = AbortSignal.any([input.signal, timeout])
    try {
      const response = await this.fetch(this.options.url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.bearerToken}`,
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
          'x-cosmos-event': 'approved_webhook_delivery',
        },
        body: JSON.stringify({
          type: 'cosmos.approved_webhook_delivery',
          label: input.label,
        }),
        signal,
      })
      await response.body?.cancel().catch(() => {})
      if (response.status >= 200 && response.status < 300) {
        return { status: 'succeeded', statusCode: response.status }
      }
      if (response.status >= 400 && response.status < 500) {
        return { status: 'failed', statusCode: response.status }
      }
      return { status: 'unknown', statusCode: response.status }
    } catch {
      return { status: 'unknown', statusCode: null }
    }
  }
}
