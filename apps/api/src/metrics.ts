const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000]

type DurationSeries = {
  count: number
  sumMs: number
  buckets: number[]
}

function label(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
}

function statusClass(statusCode: number) {
  if (statusCode >= 100 && statusCode < 200) return '1xx'
  if (statusCode >= 200 && statusCode < 300) return '2xx'
  if (statusCode >= 300 && statusCode < 400) return '3xx'
  if (statusCode >= 400 && statusCode < 500) return '4xx'
  return '5xx'
}

function key(method: string, route: string, status: string) {
  return `${method}\u0000${route}\u0000${status}`
}

export class RelayMetrics {
  private readonly requests = new Map<string, number>()
  private readonly durations = new Map<string, DurationSeries>()
  private activeSseConnections = 0
  private sseConnectionLimit = 0
  private executionEnabled = false
  private workerExecutionReady = false

  recordRequest(method: string, route: string, statusCode: number, durationMs: number) {
    const normalizedMethod = method.toUpperCase()
    const normalizedRoute = route || '<unknown>'
    const status = statusClass(statusCode)
    const requestKey = key(normalizedMethod, normalizedRoute, status)
    this.requests.set(requestKey, (this.requests.get(requestKey) ?? 0) + 1)

    const durationKey = key(normalizedMethod, normalizedRoute, '')
    const series = this.durations.get(durationKey) ?? {
      count: 0,
      sumMs: 0,
      buckets: DURATION_BUCKETS_MS.map(() => 0),
    }
    const boundedDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
    series.count += 1
    series.sumMs += boundedDuration
    for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
      if (boundedDuration <= DURATION_BUCKETS_MS[index]!) series.buckets[index] += 1
    }
    this.durations.set(durationKey, series)
  }

  sseConnectionOpened() {
    this.activeSseConnections += 1
  }

  setSseConnectionLimit(limit: number) {
    if (Number.isSafeInteger(limit) && limit > 0) this.sseConnectionLimit = limit
  }

  setExecutionState(enabled: boolean, workerReady: boolean) {
    this.executionEnabled = enabled
    this.workerExecutionReady = enabled && workerReady
  }

  sseConnectionClosed() {
    this.activeSseConnections = Math.max(0, this.activeSseConnections - 1)
  }

  renderPrometheus() {
    const lines = [
      '# HELP relay_http_requests_total HTTP requests completed by route template and status class.',
      '# TYPE relay_http_requests_total counter',
    ]
    for (const [requestKey, count] of [...this.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, status] = requestKey.split('\u0000')
      lines.push(`relay_http_requests_total{method="${label(method ?? '')}",route="${label(route ?? '')}",status_class="${label(status ?? '')}"} ${count}`)
    }

    lines.push(
      '# HELP relay_http_request_duration_ms HTTP request duration in milliseconds.',
      '# TYPE relay_http_request_duration_ms histogram',
    )
    for (const [durationKey, series] of [...this.durations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route] = durationKey.split('\u0000')
      for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
        lines.push(`relay_http_request_duration_ms_bucket{method="${label(method ?? '')}",route="${label(route ?? '')}",le="${DURATION_BUCKETS_MS[index]}"} ${series.buckets[index]}`)
      }
      lines.push(`relay_http_request_duration_ms_bucket{method="${label(method ?? '')}",route="${label(route ?? '')}",le="+Inf"} ${series.count}`)
      lines.push(`relay_http_request_duration_ms_sum{method="${label(method ?? '')}",route="${label(route ?? '')}"} ${series.sumMs}`)
      lines.push(`relay_http_request_duration_ms_count{method="${label(method ?? '')}",route="${label(route ?? '')}"} ${series.count}`)
    }

    lines.push(
      '# HELP relay_sse_connections_active Current active Session event streams.',
      '# TYPE relay_sse_connections_active gauge',
      `relay_sse_connections_active ${this.activeSseConnections}`,
      '# HELP relay_sse_connections_limit Configured per-instance Session event stream limit.',
      '# TYPE relay_sse_connections_limit gauge',
      `relay_sse_connections_limit ${this.sseConnectionLimit}`,
      '# HELP relay_execution_enabled Whether Agent execution is enabled for this API instance.',
      '# TYPE relay_execution_enabled gauge',
      `relay_execution_enabled ${this.executionEnabled ? 1 : 0}`,
      '# HELP relay_worker_execution_ready Whether a recent Worker heartbeat permits new execution.',
      '# TYPE relay_worker_execution_ready gauge',
      `relay_worker_execution_ready ${this.workerExecutionReady ? 1 : 0}`,
      '',
    )
    return `${lines.join('\n')}\n`
  }
}
