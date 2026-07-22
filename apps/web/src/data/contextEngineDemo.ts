import type {
  ContextEngineHit,
  ContextEngineStatus,
  ContextPackRequestInput,
  ContextPackResponse,
  ContextSearchRequestInput,
  ContextSearchResponse,
} from '@cosmos/contracts'

const demoHits: ContextEngineHit[] = [
  {
    path: 'src/retry/policy.ts',
    startLine: 18,
    endLine: 62,
    symbol: 'createRetryPolicy',
    language: 'typescript',
    content: `export function createRetryPolicy(options: RetryPolicyOptions) {
  const retryable = new Set(['ETIMEDOUT', 'ECONNRESET', 'HTTP_429', 'HTTP_503'])
  return {
    maxAttempts: options.maxAttempts ?? 4,
    shouldRetry: (error: ServiceError) => retryable.has(error.code),
    delayMs: (attempt: number) => Math.min(250 * 2 ** attempt, 8_000),
  }
}`,
    preview: 'Central retry policy with bounded exponential backoff and an explicit retryable error allowlist.',
    score: 0.9621,
    source: 'hybrid',
    intent: 'symbol',
    channels: ['fts', 'symbol', 'semantic'],
  },
  {
    path: 'src/clients/payment-client.ts',
    startLine: 74,
    endLine: 128,
    symbol: 'requestPayment',
    language: 'typescript',
    content: `export async function requestPayment(input: PaymentRequest, signal?: AbortSignal) {
  return executeWithRetry(
    () => transport.post('/payments', input, { signal }),
    paymentRetryPolicy,
  )
}`,
    preview: 'Payment requests delegate retry behavior to the shared policy and forward cancellation signals.',
    score: 0.9214,
    source: 'graph',
    intent: 'concept',
    channels: ['imports', 'semantic'],
  },
  {
    path: 'test/retry/policy.test.ts',
    startLine: 11,
    endLine: 96,
    symbol: 'createRetryPolicy',
    language: 'typescript',
    content: `it('never retries terminal payment failures', async () => {
  const operation = vi.fn().mockRejectedValue(new ServiceError('PAYMENT_DECLINED'))
  await expect(executeWithRetry(operation, policy)).rejects.toMatchObject({ code: 'PAYMENT_DECLINED' })
  expect(operation).toHaveBeenCalledTimes(1)
})`,
    preview: 'Regression coverage distinguishes retryable transport failures from terminal payment declines.',
    score: 0.884,
    source: 'hybrid',
    intent: 'concept',
    channels: ['fts', 'path', 'semantic'],
  },
  {
    path: 'docs/runbooks/payment-recovery.md',
    startLine: 31,
    endLine: 78,
    symbol: null,
    language: 'markdown',
    content: `## Retry safety

- Never retry a request after the provider has returned a terminal business outcome.
- Preserve the idempotency key across transport retries.
- Emit one exhausted-retry event with the correlation id and attempt count.
- Keep total retry time below the upstream 10 second request budget.`,
    preview: 'Operational constraints for safe retries, idempotency, observability, and the total request budget.',
    score: 0.8417,
    source: 'semantic',
    intent: 'concept',
    channels: ['semantic', 'path'],
  },
  {
    path: 'src/observability/payment-events.ts',
    startLine: 42,
    endLine: 73,
    symbol: 'recordRetryExhausted',
    language: 'typescript',
    content: `export function recordRetryExhausted(input: RetryExhaustedEvent) {
  metrics.increment('payment.retry.exhausted', { service: input.service })
  logger.warn({ correlationId: input.correlationId, attempts: input.attempts }, 'Payment retry exhausted')
}`,
    preview: 'Existing metric and structured log helper for exhausted payment retries.',
    score: 0.7952,
    source: 'graph',
    intent: 'symbol',
    channels: ['symbol', 'imports'],
  },
]

export function createDemoContextStatus(repository: string): ContextEngineStatus {
  return {
    provider: 'contextengine-plugin',
    repository,
    available: true,
    indexed: true,
    revision: 128,
    updatedAt: new Date(Date.now() - 82_000).toISOString(),
    retrievalMode: 'hybrid',
    stats: { files: 4_862, chunks: 31_407, symbols: 18_924, embeddedChunks: 31_407 },
  }
}
export function searchDemoContext(input: ContextSearchRequestInput): ContextSearchResponse {
  const pathPrefix = input.pathPrefix?.replace(/^\.\//, '')
  const hits = demoHits
    .filter((hit) => !pathPrefix || hit.path.startsWith(pathPrefix))
    .slice(0, input.topK ?? 10)
  return {
    provider: 'contextengine-plugin',
    repository: input.repository,
    query: input.query,
    mode: input.mode ?? 'auto',
    durationMs: 47,
    hits,
  }
}

export function packDemoContext(input: ContextPackRequestInput): ContextPackResponse {
  const hits = searchDemoContext({
    repository: input.repository,
    query: input.task,
    topK: input.topK ?? 14,
    pathPrefix: input.pathPrefix,
    mode: 'hybrid',
    expandGraph: true,
  }).hits
  const packedText = hits.map((hit) => (
    `### ${hit.path}:${hit.startLine}-${hit.endLine}${hit.symbol ? ` · ${hit.symbol}` : ''}\n${hit.content}`
  )).join('\n\n')
  return {
    provider: 'contextengine-plugin',
    repository: input.repository,
    task: input.task,
    packedText,
    estimatedTokens: Math.ceil(packedText.length / 3.6),
    truncated: false,
    durationMs: 61,
    hits,
  }
}
