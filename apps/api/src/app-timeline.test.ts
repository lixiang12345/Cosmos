import type {
  MeOrganization,
  SessionEventPage,
  SessionMessagePage,
} from '@cosmos/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { AuthenticationError, createDevelopmentAuthenticator } from './auth.js'
import { InMemorySessionRepository } from './session-repository.js'
import { encodeSessionTimelineCursor } from './session-timeline-pagination.js'
import {
  SessionTimelineCursorAheadError,
  type SessionTimelineListOptions,
  type SessionTimelineRepository,
} from './session-timeline-repository.js'

const timestamp = '2026-07-13T00:00:00.000Z'
const organizationId = 'cosmos'
const spaceId = 'platform'
const sessionId = 'session-1'
const actorId = 'user-1'
const scope = { organizationId, spaceId, sessionId }
const organizations: MeOrganization[] = [{
  id: organizationId,
  name: 'Cosmos',
  role: 'member',
  spaces: [{ id: spaceId, name: 'Platform', role: 'member' }],
}]

function messagePage(afterSequence = 0): SessionMessagePage {
  const all = [
    {
      ...scope,
      id: 'message-1',
      sequence: 1,
      role: 'user' as const,
      actorId,
      content: 'Ship the runtime.',
      attachments: [],
      createdAt: timestamp,
    },
    {
      ...scope,
      id: 'message-2',
      sequence: 2,
      role: 'agent' as const,
      actorId: null,
      content: 'Runtime shipped.',
      attachments: [],
      createdAt: timestamp,
    },
  ]
  const items = all.filter((message) => message.sequence > afterSequence).slice(0, 1)
  const hasMore = afterSequence < 1
  return {
    ...scope,
    items,
    page: { hasMore, nextCursor: hasMore ? String(items.at(-1)?.sequence) : null },
  }
}

function eventPage(afterSequence = 0): SessionEventPage {
  const items = afterSequence < 1 ? [{
    ...scope,
    eventId: 'event-1',
    sequence: 1,
    type: 'message.created' as const,
    resourceType: 'message' as const,
    resourceId: 'message-1',
    actorId,
    commandId: null,
    requestId: 'request-1',
    occurredAt: timestamp,
    payload: { messageId: 'message-1' },
  }] : []
  return { ...scope, items, page: { hasMore: false, nextCursor: null } }
}

function repository(overrides: Partial<SessionTimelineRepository> = {}): SessionTimelineRepository {
  return {
    async listMessages(_organizationId, _spaceId, _sessionId, _actorId, options = {}) {
      return messagePage(options.afterSequence)
    },
    async listEvents(_organizationId, _spaceId, _sessionId, _actorId, options = {}) {
      return eventPage(options.afterSequence)
    },
    ...overrides,
  }
}

function app(timelineRepository: SessionTimelineRepository, options: {
  authenticate?: ReturnType<typeof createDevelopmentAuthenticator>
  stream?: {
    heartbeatMs?: number
    pollMs?: number
    maxDurationMs?: number
    maxConnections?: number
    maxConnectionsPerActor?: number
    maxConnectionsPerSession?: number
    retryAfterSeconds?: number
  }
} = {}) {
  return createApp({
    authenticate: options.authenticate ?? createDevelopmentAuthenticator(actorId),
    sessionRepository: new InMemorySessionRepository({
      actorOrganizations: { [actorId]: organizations },
    }),
    sessionTimelineRepository: timelineRepository,
    executionReadinessCheck: async () => true,
    sessionEventStream: { heartbeatMs: 5, pollMs: 1, maxDurationMs: 100, ...options.stream },
  })
}

function basePath(suffix: string) {
  return `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${sessionId}/${suffix}`
}

afterEach(() => vi.restoreAllMocks())

describe('Session timeline API', () => {
  it('discovers execution and SSE support from authenticated deployment capabilities', async () => {
    const application = app(repository())
    const response = await application.inject({ method: 'GET', url: '/api/v1/capabilities' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ execution: { enabled: true, events: 'sse' } })
    await application.close()
  })

  it('returns messages with an opaque, scope-bound continuation cursor', async () => {
    const listMessages = vi.fn<SessionTimelineRepository['listMessages']>(
      async (_organizationId, _spaceId, _sessionId, _actorId, options = {}) => messagePage(options.afterSequence),
    )
    const application = app(repository({ listMessages }))
    const first = await application.inject({ method: 'GET', url: `${basePath('messages')}?limit=1` })
    const cursor = first.json().page.nextCursor as string
    const second = await application.inject({
      method: 'GET',
      url: `${basePath('messages')}?limit=1&cursor=${encodeURIComponent(cursor)}`,
    })

    expect(first.statusCode).toBe(200)
    expect(first.json().items).toHaveLength(1)
    expect(cursor).not.toBe('1')
    expect(second.statusCode).toBe(200)
    expect(second.json().items[0].sequence).toBe(2)
    expect(listMessages).toHaveBeenLastCalledWith(organizationId, spaceId, sessionId, actorId, {
      afterSequence: 1,
      limit: 1,
    })
    await application.close()
  })

  it('rejects cross-Session cursor replay before calling the repository', async () => {
    const listMessages = vi.fn<SessionTimelineRepository['listMessages']>()
    const cursor = encodeSessionTimelineCursor({ ...scope, sessionId: 'session-2', sequence: 1 })
    const application = app(repository({ listMessages }))
    const response = await application.inject({
      method: 'GET',
      url: `${basePath('messages')}?cursor=${encodeURIComponent(cursor)}`,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(listMessages).not.toHaveBeenCalled()
    await application.close()
  })

  it('conceals a Session when the repository recheck no longer authorizes it', async () => {
    const application = app(repository({ listEvents: async () => null }))
    const response = await application.inject({ method: 'GET', url: basePath('events') })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await application.close()
  })

  it.each([
    ['query cursor', { query: true, header: false }, 'query.cursor'],
    ['Last-Event-ID', { query: false, header: true }, 'header.Last-Event-ID'],
  ])('rejects a future SSE %s before hijacking the response', async (_name, source, field) => {
    const cursor = encodeSessionTimelineCursor({ ...scope, sequence: 99 })
    const application = app(repository({
      listEvents: async () => { throw new SessionTimelineCursorAheadError() },
    }))
    const response = await application.inject({
      method: 'GET',
      url: `${basePath('events/stream')}${source.query ? `?cursor=${cursor}` : ''}`,
      headers: source.header ? { 'last-event-id': cursor } : undefined,
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: { [field]: expect.any(Array) },
    })
    await application.close()
  })

  it('streams recoverable event ids and resumes from Last-Event-ID', async () => {
    const cursor = encodeSessionTimelineCursor({ ...scope, sequence: 1 })
    const observed: SessionTimelineListOptions[] = []
    const application = app(repository({
      async listEvents(_organizationId, _spaceId, _sessionId, _actorId, options = {}) {
        observed.push(options)
        return eventPage(options.afterSequence)
      },
    }))
    const response = await application.inject({
      method: 'GET',
      url: basePath('events/stream'),
      headers: { 'last-event-id': cursor },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(observed[0]).toMatchObject({ afterSequence: 1 })
    expect(response.body).toContain('event: reconnect')
    await application.close()
  })

  it('reauthenticates on heartbeat and closes an expired credential stream', async () => {
    let authenticationCount = 0
    const authenticate = vi.fn(async () => {
      authenticationCount += 1
      if (authenticationCount > 1) throw new AuthenticationError()
      return { id: actorId, kind: 'user' as const }
    })
    const application = app(repository({ listEvents: async () => ({
      ...scope,
      items: [],
      page: { hasMore: false, nextCursor: null },
    }) }), { authenticate })
    const response = await application.inject({ method: 'GET', url: basePath('events/stream') })

    expect(response.statusCode).toBe(200)
    expect(authenticationCount).toBeGreaterThan(1)
    expect(response.body).not.toContain(': heartbeat')
    expect(response.body).toContain('event: reconnect')
    await application.close()
  })

  it('reauthenticates while draining a continuously paginated event backlog', async () => {
    let authenticationCount = 0
    const authenticate = vi.fn(async () => {
      authenticationCount += 1
      if (authenticationCount > 1) throw new AuthenticationError()
      return { id: actorId, kind: 'user' as const }
    })
    const application = app(repository({
      async listEvents(_organizationId, _spaceId, _sessionId, _actorId, options = {}) {
        await new Promise((resolve) => setTimeout(resolve, 1))
        const sequence = (options.afterSequence ?? 0) + 1
        return {
          ...scope,
          items: [{
            ...scope,
            eventId: `event-${sequence}`,
            sequence,
            type: 'message.created',
            resourceType: 'message',
            resourceId: 'message-1',
            actorId,
            commandId: null,
            requestId: 'request-1',
            occurredAt: timestamp,
            payload: { messageId: 'message-1' },
          }],
          page: {
            hasMore: true,
            nextCursor: { ...scope, sequence },
          },
        }
      },
    }), { authenticate })
    const response = await application.inject({ method: 'GET', url: basePath('events/stream') })

    expect(response.statusCode).toBe(200)
    expect(authenticationCount).toBeGreaterThan(1)
    expect(response.body).toContain('event: reconnect')
    await application.close()
  })

  it.each([
    {
      name: 'global',
      limits: { maxConnections: 1, maxConnectionsPerActor: 2, maxConnectionsPerSession: 2 },
      rejectedActorId: 'user-2',
      rejectedSessionId: 'session-2',
    },
    {
      name: 'actor',
      limits: { maxConnections: 2, maxConnectionsPerActor: 1, maxConnectionsPerSession: 2 },
      rejectedActorId: actorId,
      rejectedSessionId: 'session-2',
    },
    {
      name: 'Session',
      limits: { maxConnections: 2, maxConnectionsPerActor: 2, maxConnectionsPerSession: 1 },
      rejectedActorId: 'user-2',
      rejectedSessionId: sessionId,
    },
  ])('atomically enforces the $name stream budget and releases it on disconnect', async ({
    limits,
    rejectedActorId,
    rejectedSessionId,
  }) => {
    let markHeldStreamStarted: (() => void) | undefined
    let releaseHeldQuery: (() => void) | undefined
    const heldStreamStarted = new Promise<void>((resolve) => { markHeldStreamStarted = resolve })
    const heldQuery = new Promise<void>((resolve) => { releaseHeldQuery = resolve })
    const callsByStream = new Map<string, number>()
    const timelineRepository = repository({
      async listEvents(requestOrganizationId, requestSpaceId, requestSessionId, requestActorId) {
        const key = `${requestActorId}:${requestSessionId}`
        const calls = (callsByStream.get(key) ?? 0) + 1
        callsByStream.set(key, calls)
        if (requestActorId === actorId && requestSessionId === sessionId && calls === 2) {
          markHeldStreamStarted?.()
          await heldQuery
        }
        return {
          organizationId: requestOrganizationId,
          spaceId: requestSpaceId,
          sessionId: requestSessionId,
          items: [],
          page: { hasMore: false, nextCursor: null },
        }
      },
    })
    const application = createApp({
      authenticate: async (authorization) => {
        const id = authorization?.replace(/^Bearer /, '')
        if (id !== actorId && id !== 'user-2') throw new AuthenticationError()
        return { id, kind: 'user' as const }
      },
      sessionRepository: new InMemorySessionRepository({
        actorOrganizations: { [actorId]: organizations, 'user-2': organizations },
      }),
      sessionTimelineRepository: timelineRepository,
      sessionEventStream: {
        heartbeatMs: 100,
        pollMs: 1,
        maxDurationMs: 20,
        retryAfterSeconds: 7,
        ...limits,
      },
    })
    const heldResponse = await application.inject({
      method: 'GET',
      url: basePath('events/stream'),
      headers: { authorization: `Bearer ${actorId}` },
      payloadAsStream: true,
    })

    await heldStreamStarted
    const rejectedPath = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${rejectedSessionId}/events/stream`
    const rejectedKey = `${rejectedActorId}:${rejectedSessionId}`
    const rejected = await application.inject({
      method: 'GET',
      url: rejectedPath,
      headers: { authorization: `Bearer ${rejectedActorId}` },
    })

    expect(rejected.statusCode).toBe(429)
    expect(rejected.headers['retry-after']).toBe('7')
    expect(rejected.json()).toMatchObject({
      code: 'SSE_CONNECTION_LIMIT_EXCEEDED',
      retryable: true,
    })
    expect(callsByStream.get(rejectedKey)).toBeUndefined()

    const disconnected = new Promise<void>((resolve) => heldResponse.raw.res.once('close', resolve))
    heldResponse.raw.res.destroy()
    await disconnected
    const recovered = await application.inject({
      method: 'GET',
      url: rejectedPath,
      headers: { authorization: `Bearer ${rejectedActorId}` },
    })

    expect(recovered.statusCode).toBe(200)
    releaseHeldQuery?.()
    await application.close()
  })

  it('releases the stream budget when the initial timeline query fails before hijack', async () => {
    let calls = 0
    const application = app(repository({
      async listEvents() {
        calls += 1
        if (calls === 1) throw new Error('injected initial timeline failure')
        return { ...scope, items: [], page: { hasMore: false, nextCursor: null } }
      },
    }), {
      stream: {
        heartbeatMs: 100,
        maxDurationMs: 20,
        maxConnections: 1,
      },
    })

    const failed = await application.inject({ method: 'GET', url: basePath('events/stream') })
    const recovered = await application.inject({ method: 'GET', url: basePath('events/stream') })

    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true })
    expect(recovered.statusCode).toBe(200)
    await application.close()
  })

  it('closes a hijacked stream when a later timeline query fails', async () => {
    let calls = 0
    const application = app(repository({
      async listEvents() {
        calls += 1
        if (calls > 1) throw new Error('injected timeline failure')
        return { ...scope, items: [], page: { hasMore: false, nextCursor: null } }
      },
    }))

    const response = await application.inject({ method: 'GET', url: basePath('events/stream') })

    expect(response.statusCode).toBe(200)
    expect(calls).toBe(2)
    await application.close()
  })
})
