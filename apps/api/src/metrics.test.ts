import { describe, expect, it } from 'vitest'
import { CosmosMetrics } from './metrics.js'

describe('CosmosMetrics', () => {
  it('renders bounded HTTP series and a nonnegative SSE gauge', () => {
    const metrics = new CosmosMetrics()
    metrics.recordRequest('get', '/api/v1/sessions/:sessionId', 200, 125)
    metrics.recordRequest('get', '/api/v1/sessions/:sessionId', 503, 2_000)
    metrics.setSseConnectionLimit(10)
    metrics.setExecutionState(true, true)
    metrics.sseConnectionOpened()

    const active = metrics.renderPrometheus()
    expect(active).toContain('status_class="2xx"} 1')
    expect(active).toContain('status_class="5xx"} 1')
    expect(active).toContain('le="100"} 0')
    expect(active).toContain('le="250"} 1')
    expect(active).toContain('le="2500"} 2')
    expect(active).toContain('cosmos_sse_connections_active 1')
    expect(active).toContain('cosmos_sse_connections_limit 10')
    expect(active).toContain('cosmos_execution_enabled 1')
    expect(active).toContain('cosmos_worker_execution_ready 1')

    metrics.sseConnectionClosed()
    metrics.sseConnectionClosed()
    metrics.setExecutionState(false, true)
    expect(metrics.renderPrometheus()).toContain('cosmos_sse_connections_active 0')
    expect(metrics.renderPrometheus()).toContain('cosmos_worker_execution_ready 0')
  })

  it('escapes route labels instead of emitting arbitrary exposition lines', () => {
    const metrics = new CosmosMetrics()
    metrics.recordRequest('GET', '/route/"quoted"\nnext', 404, 1)

    const rendered = metrics.renderPrometheus()
    expect(rendered).toContain('route="/route/\\"quoted\\"\\nnext"')
    expect(rendered).not.toContain('\nnext",status_class')
  })
})
