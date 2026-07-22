import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadSessionJourneyConfig, runSessionJourneys } from './session-journey-lib.mjs'

describe('Session journey harness', () => {
  it('requires explicit writes and bounds loopback defaults', () => {
    assert.throws(() => loadSessionJourneyConfig({}), /JOURNEY_ALLOW_WRITES/)
    assert.deepEqual(loadSessionJourneyConfig({ JOURNEY_ALLOW_WRITES: 'true' }), {
      baseUrl: 'http://127.0.0.1:8787',
      organizationId: 'relay',
      spaceId: 'space-platform',
      expertId: 'expert-space-platform',
      authToken: undefined,
      journeys: 1,
      concurrency: 1,
      timeoutMs: 5_000,
    })
  })

  it('rejects remote writes without HTTPS, approval, identifiers, and credentials', () => {
    assert.throws(() => loadSessionJourneyConfig({
      JOURNEY_ALLOW_WRITES: 'true', JOURNEY_BASE_URL: 'http://staging.example',
    }), /JOURNEY_ALLOW_REMOTE/)
    assert.throws(() => loadSessionJourneyConfig({
      JOURNEY_ALLOW_WRITES: 'true', JOURNEY_ALLOW_REMOTE: 'true',
      JOURNEY_BASE_URL: 'https://staging.example',
    }), /JOURNEY_ORGANIZATION_ID/)
    assert.throws(() => loadSessionJourneyConfig({
      JOURNEY_ALLOW_WRITES: 'true', JOURNEY_ALLOW_REMOTE: 'true',
      JOURNEY_BASE_URL: 'https://staging.example', JOURNEY_ORGANIZATION_ID: 'org',
      JOURNEY_SPACE_ID: 'space', JOURNEY_EXPERT_ID: 'expert',
    }), /JOURNEY_AUTH_TOKEN/)
  })

  it('runs the bounded lifecycle without exposing credentials in its result', async () => {
    const token = 'test-only-journey-token'
    const config = loadSessionJourneyConfig({
      JOURNEY_ALLOW_WRITES: 'true', JOURNEY_AUTH_TOKEN: token,
    })
    const observedAuthorization = []
    let requestNumber = 0
    const session = (version, archivedAt = null) => ({
      id: 'session-journey', version, status: 'draft', archivedAt,
    })
    const json = (payload, init = {}) => new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const responses = [
      json({ session: session(1) }, { status: 201 }),
      json({ session: session(1) }, {
        status: 201, headers: { 'Idempotency-Replayed': 'true' },
      }),
      json(session(1), { headers: { ETag: '"1"' } }),
      json({ items: [{ id: 'message-1' }] }),
      json({ items: [{ id: 'event-1' }] }),
      json(session(2), { headers: { ETag: '"2"' } }),
      json({ code: 'PRECONDITION_FAILED' }, { status: 412 }),
      json(session(3, '2026-07-22T00:00:00.000Z'), { headers: { ETag: '"3"' } }),
      json(session(4), { headers: { ETag: '"4"' } }),
      json(session(5, '2026-07-22T00:00:01.000Z'), { headers: { ETag: '"5"' } }),
    ]
    const result = await runSessionJourneys(config, async (_url, init) => {
      observedAuthorization.push(init.headers.Authorization)
      const response = responses[requestNumber]
      requestNumber += 1
      assert.ok(response)
      return response
    })

    assert.deepEqual(result, { journeys: 1, events: 1 })
    assert.equal(requestNumber, responses.length)
    assert.deepEqual(observedAuthorization, Array(responses.length).fill(`Bearer ${token}`))
    assert.equal(JSON.stringify(result).includes(token), false)
  })
})
