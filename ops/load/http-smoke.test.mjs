import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadHttpSmokeConfig,
  percentile,
  runHttpLoad,
  summarizeHttpLoad,
} from './http-smoke-lib.mjs'

describe('HTTP load smoke', () => {
  it('uses bounded loopback defaults and rejects accidental remote load', () => {
    assert.deepEqual(loadHttpSmokeConfig({}), {
      url: 'http://127.0.0.1:8787/api/v1/me',
      requests: 200,
      concurrency: 20,
      timeoutMs: 5_000,
      maxP95Ms: 500,
      maxErrorPercent: 0,
      authToken: undefined,
    })
    assert.throws(
      () => loadHttpSmokeConfig({ LOAD_URL: 'https://relay.example/api/v1/me' }),
      /LOAD_ALLOW_REMOTE/,
    )
    assert.equal(loadHttpSmokeConfig({
      LOAD_URL: 'https://relay.example/api/v1/me',
      LOAD_ALLOW_REMOTE: 'true',
    }).url, 'https://relay.example/api/v1/me')
  })

  it('computes nearest-rank percentiles and threshold failures', () => {
    assert.equal(percentile([40, 10, 30, 20], 0.95), 40)
    const result = summarizeHttpLoad([
      { ok: true, statusCode: 200, durationMs: 10 },
      { ok: false, statusCode: 503, durationMs: 100 },
    ], { concurrency: 2, maxErrorPercent: 10, maxP95Ms: 50 })
    assert.equal(result.summary.failed, 1)
    assert.deepEqual(result.summary.statusCounts, { 200: 1, 503: 1 })
    assert.equal(result.failures.length, 2)
  })

  it('runs bounded concurrent requests without exposing the auth token in results', async () => {
    const config = loadHttpSmokeConfig({
      LOAD_REQUESTS: '4', LOAD_CONCURRENCY: '2', LOAD_AUTH_TOKEN: 'test-only-token',
    })
    const observed = []
    const result = await runHttpLoad(config, async (_url, init) => {
      observed.push(init.headers.Authorization)
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    assert.equal(result.summary.succeeded, 4)
    assert.equal(result.failures.length, 0)
    assert.deepEqual(observed, Array(4).fill('Bearer test-only-token'))
    assert.equal(JSON.stringify(result).includes('test-only-token'), false)
  })
})
