function integer(value, name, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

export function loadHttpSmokeConfig(env) {
  const rawUrl = env.LOAD_URL?.trim() || 'http://127.0.0.1:8787/api/v1/me'
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('LOAD_URL must be a valid HTTP(S) URL.')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('LOAD_URL must use HTTP or HTTPS.')
  }
  if (!loopback && (env.LOAD_ALLOW_REMOTE !== 'true' || url.protocol !== 'https:')) {
    throw new Error('Remote load requires LOAD_ALLOW_REMOTE=true and an HTTPS LOAD_URL.')
  }
  const requests = integer(env.LOAD_REQUESTS, 'LOAD_REQUESTS', 200, 1, 10_000)
  const concurrency = integer(env.LOAD_CONCURRENCY, 'LOAD_CONCURRENCY', 20, 1, 100)
  const timeoutMs = integer(env.LOAD_TIMEOUT_MS, 'LOAD_TIMEOUT_MS', 5_000, 100, 60_000)
  const maxP95Ms = integer(env.LOAD_MAX_P95_MS, 'LOAD_MAX_P95_MS', 500, 1, 60_000)
  const maxErrorPercent = integer(
    env.LOAD_MAX_ERROR_PERCENT,
    'LOAD_MAX_ERROR_PERCENT',
    0,
    0,
    100,
  )
  return {
    url: url.toString(),
    requests,
    concurrency: Math.min(concurrency, requests),
    timeoutMs,
    maxP95Ms,
    maxErrorPercent,
    authToken: env.LOAD_AUTH_TOKEN?.trim() || undefined,
  }
}

export function percentile(values, quantile) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return sorted[Math.min(index, sorted.length - 1)]
}

export function summarizeHttpLoad(samples, config) {
  const durations = samples.map((sample) => sample.durationMs)
  const failed = samples.filter((sample) => !sample.ok).length
  const errorPercent = samples.length === 0 ? 100 : (failed / samples.length) * 100
  const summary = {
    requests: samples.length,
    concurrency: config.concurrency,
    succeeded: samples.length - failed,
    failed,
    errorPercent: Number(errorPercent.toFixed(2)),
    latencyMs: {
      p50: Number(percentile(durations, 0.5).toFixed(2)),
      p95: Number(percentile(durations, 0.95).toFixed(2)),
      p99: Number(percentile(durations, 0.99).toFixed(2)),
      max: Number(Math.max(0, ...durations).toFixed(2)),
    },
    statusCounts: Object.fromEntries([...samples.reduce((counts, sample) => {
      const key = String(sample.statusCode)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return counts
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
  const failures = []
  if (summary.errorPercent > config.maxErrorPercent) {
    failures.push(`error percent ${summary.errorPercent} exceeded ${config.maxErrorPercent}`)
  }
  if (summary.latencyMs.p95 > config.maxP95Ms) {
    failures.push(`p95 ${summary.latencyMs.p95}ms exceeded ${config.maxP95Ms}ms`)
  }
  return { summary, failures }
}

export async function runHttpLoad(config, fetchImpl = fetch) {
  const samples = []
  let nextRequest = 0
  const headers = { Accept: 'application/json' }
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`

  await Promise.all(Array.from({ length: config.concurrency }, async () => {
    while (nextRequest < config.requests) {
      nextRequest += 1
      const startedAt = performance.now()
      let statusCode = 0
      let ok = false
      try {
        const response = await fetchImpl(config.url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(config.timeoutMs),
          redirect: 'error',
        })
        statusCode = response.status
        ok = response.ok
        await response.body?.cancel().catch(() => undefined)
      } catch {
        // Network failures are counted without serializing provider or credential details.
      }
      samples.push({ ok, statusCode, durationMs: performance.now() - startedAt })
    }
  }))

  return summarizeHttpLoad(samples, config)
}
