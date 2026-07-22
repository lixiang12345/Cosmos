import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderDatabaseMetrics } from './database-metrics-lib.mjs'

describe('database observer metrics', () => {
  it('renders only fixed low-cardinality labels and aggregate values', async () => {
    const results = [
      { rows: [{ status: 'queued', count: '3', oldest_age_seconds: '12.5', heartbeat_age_seconds: '0', expired_leases: '0' }] },
      { rows: [{ status: 'running', count: '1', oldest_age_seconds: '4.25', expired_leases: '1' }] },
      { rows: [{ fresh_count: '2', stale_count: '1', newest_age_seconds: '3.5' }] },
      { rows: [{ stream: 'session', count: '5', oldest_age_seconds: '7.75' }] },
    ]
    let index = 0
    const rendered = await renderDatabaseMetrics({ query: async () => results[index++] })

    assert.match(rendered, /relay_observer_commands_total\{status="queued"\} 3/)
    assert.match(rendered, /relay_observer_environment_jobs_total\{status="running"\} 1/)
    assert.match(rendered, /relay_observer_environment_jobs_expired_leases_total\{status="running"\} 1/)
    assert.match(rendered, /relay_observer_workers_total\{state="fresh"\} 2/)
    assert.match(rendered, /relay_observer_workers_total\{state="stale"\} 1/)
    assert.match(rendered, /relay_observer_outbox_pending_total\{stream="session"\} 5/)
    assert.equal(rendered.includes('organization'), false)
    assert.equal(rendered.includes('payload'), false)
  })
})
