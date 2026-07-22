function integer(value, name, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function isLoopback(url) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}

export function loadSessionJourneyConfig(env) {
  const rawUrl = env.JOURNEY_BASE_URL?.trim() || 'http://127.0.0.1:8787'
  let baseUrl
  try {
    baseUrl = new URL(rawUrl)
  } catch {
    throw new Error('JOURNEY_BASE_URL must be a valid HTTP(S) URL.')
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('JOURNEY_BASE_URL must use HTTP or HTTPS.')
  }
  const loopback = isLoopback(baseUrl)
  if (!loopback && (env.JOURNEY_ALLOW_REMOTE !== 'true' || baseUrl.protocol !== 'https:')) {
    throw new Error('Remote journey requires JOURNEY_ALLOW_REMOTE=true and an HTTPS JOURNEY_BASE_URL.')
  }
  if (env.JOURNEY_ALLOW_WRITES !== 'true') {
    throw new Error('Session journey writes require JOURNEY_ALLOW_WRITES=true.')
  }
  const config = {
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    organizationId: env.JOURNEY_ORGANIZATION_ID?.trim() || (loopback ? 'relay' : ''),
    spaceId: env.JOURNEY_SPACE_ID?.trim() || (loopback ? 'space-platform' : ''),
    expertId: env.JOURNEY_EXPERT_ID?.trim() || (loopback ? 'expert-space-platform' : ''),
    authToken: env.JOURNEY_AUTH_TOKEN?.trim() || undefined,
    journeys: integer(env.JOURNEY_COUNT, 'JOURNEY_COUNT', 1, 1, 100),
    concurrency: integer(env.JOURNEY_CONCURRENCY, 'JOURNEY_CONCURRENCY', 1, 1, 10),
    timeoutMs: integer(env.JOURNEY_TIMEOUT_MS, 'JOURNEY_TIMEOUT_MS', 5_000, 100, 60_000),
  }
  for (const [name, value] of Object.entries({
    JOURNEY_ORGANIZATION_ID: config.organizationId,
    JOURNEY_SPACE_ID: config.spaceId,
    JOURNEY_EXPERT_ID: config.expertId,
  })) {
    if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new Error(`${name} must be a safe identifier.`)
    }
  }
  if (!loopback && !config.authToken) {
    throw new Error('Remote journey requires JOURNEY_AUTH_TOKEN from a secret manager.')
  }
  return { ...config, concurrency: Math.min(config.concurrency, config.journeys) }
}

function pathFor(config, suffix = '') {
  return `${config.baseUrl}/api/v1/organizations/${encodeURIComponent(config.organizationId)}`
    + `/spaces/${encodeURIComponent(config.spaceId)}${suffix}`
}

async function request(config, fetchImpl, method, suffix, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) }
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`
  let response
  try {
    response = await fetchImpl(pathFor(config, suffix), {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: 'error',
    })
  } catch {
    throw new Error(`${method} request failed.`)
  }
  let payload = null
  if (response.headers.get('content-type')?.includes('application/json')) {
    try { payload = await response.json() } catch { payload = null }
  } else {
    await response.body?.cancel().catch(() => undefined)
  }
  return { response, payload }
}

function requireStatus(result, expected, action) {
  if (result.response.status !== expected) {
    throw new Error(`${action} returned HTTP ${result.response.status}, expected ${expected}.`)
  }
}

function requireSession(result, action) {
  requireStatus(result, 200, action)
  if (!result.payload?.id || !Number.isInteger(result.payload.version)) {
    throw new Error(`${action} returned an invalid Session.`)
  }
  return result.payload
}

function sessionPath(sessionId, suffix = '') {
  return `/sessions/${encodeURIComponent(sessionId)}${suffix}`
}

async function runOne(config, fetchImpl, index) {
  const unique = `${Date.now()}-${process.pid}-${index}`
  const createBody = JSON.stringify({
    expertId: config.expertId,
    title: `Operations journey ${unique}`,
    visibility: 'private',
    start: false,
    message: { content: `Operations journey fixture ${unique}` },
  })
  const createKey = `ops-journey-create-${unique}`
  const created = await request(config, fetchImpl, 'POST', '/sessions', {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createKey },
    body: createBody,
  })
  requireStatus(created, 201, 'Session create')
  const session = created.payload?.session
  if (!session?.id || session.status !== 'draft' || session.version !== 1) {
    throw new Error('Session create returned an invalid draft.')
  }
  const replay = await request(config, fetchImpl, 'POST', '/sessions', {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createKey },
    body: createBody,
  })
  requireStatus(replay, 201, 'Session create replay')
  if (replay.response.headers.get('idempotency-replayed') !== 'true'
    || replay.payload?.session?.id !== session.id) {
    throw new Error('Session create replay did not return the original result.')
  }

  const detail = await request(config, fetchImpl, 'GET', sessionPath(session.id))
  const detailed = requireSession(detail, 'Session detail')
  const etag = detail.response.headers.get('etag')
  if (!etag || detailed.status !== 'draft') throw new Error('Session detail did not return a draft ETag.')

  const messages = await request(config, fetchImpl, 'GET', sessionPath(session.id, '/messages'))
  requireStatus(messages, 200, 'Session messages')
  if (!Array.isArray(messages.payload?.items) || messages.payload.items.length !== 1) {
    throw new Error('Session messages did not contain the initial message.')
  }
  const events = await request(config, fetchImpl, 'GET', sessionPath(session.id, '/events'))
  requireStatus(events, 200, 'Session events')
  if (!Array.isArray(events.payload?.items) || events.payload.items.length < 1) {
    throw new Error('Session events did not contain the create event.')
  }

  const renamed = await request(config, fetchImpl, 'PATCH', sessionPath(session.id), {
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ title: `Renamed ${unique}` }),
  })
  const renamedSession = requireSession(renamed, 'Session rename')
  const renamedEtag = renamed.response.headers.get('etag')
  if (renamedSession.version !== 2 || !renamedEtag) throw new Error('Session rename did not advance the version.')

  const stale = await request(config, fetchImpl, 'PATCH', sessionPath(session.id), {
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ title: `Stale ${unique}` }),
  })
  requireStatus(stale, 412, 'Stale Session rename')

  const archived = await request(config, fetchImpl, 'POST', sessionPath(session.id, '/archive'), {
    headers: { 'Idempotency-Key': `ops-journey-archive-${unique}`, 'If-Match': renamedEtag },
  })
  const archivedSession = requireSession(archived, 'Session archive')
  const archivedEtag = archived.response.headers.get('etag')
  if (!archivedSession.archivedAt || !archivedEtag) throw new Error('Session archive did not set archivedAt.')

  const restored = await request(config, fetchImpl, 'POST', sessionPath(session.id, '/restore'), {
    headers: { 'Idempotency-Key': `ops-journey-restore-${unique}`, 'If-Match': archivedEtag },
  })
  const restoredSession = requireSession(restored, 'Session restore')
  const restoredEtag = restored.response.headers.get('etag')
  if (restoredSession.archivedAt !== null || !restoredEtag) throw new Error('Session restore did not clear archivedAt.')

  const finalArchive = await request(config, fetchImpl, 'POST', sessionPath(session.id, '/archive'), {
    headers: { 'Idempotency-Key': `ops-journey-final-archive-${unique}`, 'If-Match': restoredEtag },
  })
  const finalSession = requireSession(finalArchive, 'Session final archive')
  if (!finalSession.archivedAt) throw new Error('Session final archive did not complete.')
  return { sessionId: session.id, events: events.payload.items.length }
}

export async function runSessionJourneys(config, fetchImpl = fetch) {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: config.concurrency }, async () => {
    while (next < config.journeys) {
      const index = next
      next += 1
      results.push(await runOne(config, fetchImpl, index))
    }
  }))
  return { journeys: results.length, events: results.reduce((sum, result) => sum + result.events, 0) }
}
