import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  MeResponseSchema,
  SessionListResponseSchema,
  type CreateSessionRequestInput,
} from '@relay/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator } from './auth.js'
import {
  AuthorizationChangedError,
  InMemorySessionRepository,
  type InMemorySessionRepositoryOptions,
} from './session-repository.js'

const openApps: ReturnType<typeof createApp>[] = []
const sessionRequest: CreateSessionRequestInput = {
  title: 'Fix checkout race condition',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 3,
  environmentId: 'environment-platform',
  repository: 'platform/checkout',
  baseBranch: 'main',
  message: { content: 'Trace the duplicate reservation path and implement a regression test.' },
}

const testActorOrganizations = {
  'user-local-admin': [
    {
      id: 'relay', name: 'Relay', role: 'organization_owner' as const,
      spaces: [
        { id: 'commerce', name: 'Commerce', role: 'space_manager' as const },
        { id: 'platform', name: 'Platform', role: 'space_manager' as const },
      ],
    },
    {
      id: 'other', name: 'Other', role: 'organization_owner' as const,
      spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
    },
  ],
}

function testRepository(options: InMemorySessionRepositoryOptions = {}) {
  return new InMemorySessionRepository({
    ...options,
    actorOrganizations: options.actorOrganizations ?? testActorOrganizations,
  })
}

function testApp(repository = testRepository()) {
  const app = createApp({
    sessionRepository: repository,
    authenticate: createDevelopmentAuthenticator('user-local-admin'),
  })
  openApps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()))
})

describe('Relay API', () => {
  it('reports health', async () => {
    const app = createApp()
    openApps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('reports dependency readiness without changing the liveness signal', async () => {
    const app = createApp({
      authenticate: createDevelopmentAuthenticator('user-local-admin'),
      readinessCheck: async () => { throw new Error('database unavailable') },
    })
    openApps.push(app)

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    const readiness = await app.inject({ method: 'GET', url: '/api/ready' })

    expect(health.statusCode).toBe(200)
    expect(readiness.statusCode).toBe(503)
    expect(ApiErrorSchema.parse(readiness.json())).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE', retryable: true,
    })
  })

  it('keeps only health public and rejects unauthenticated requests before body parsing', async () => {
    const app = createApp()
    openApps.push(app)

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    const sessions = await app.inject({
      method: 'GET', url: '/api/v1/organizations/relay/spaces/platform/sessions',
    })
    const me = await app.inject({ method: 'GET', url: '/api/v1/me' })
    const readiness = await app.inject({ method: 'GET', url: '/api/ready' })
    const unsupportedHealthMethod = await app.inject({ method: 'POST', url: '/api/health' })

    expect(health.statusCode).toBe(200)
    expect(sessions.statusCode).toBe(401)
    expect(sessions.headers['www-authenticate']).toBe('Bearer realm="relay-api"')
    expect(ApiErrorSchema.parse(sessions.json())).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', retryable: false,
    })
    expect(readiness.statusCode).toBe(401)
    expect(me.statusCode).toBe(401)
    expect(unsupportedHealthMethod.statusCode).toBe(401)

    const malformedBody = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '{not-json',
    })
    expect(malformedBody.statusCode).toBe(401)
  })

  it('discovers the authenticated actor and only their explicitly seeded memberships', async () => {
    const repository = testRepository({
      actorOrganizations: {
        'user-local-admin': [
          {
            id: 'organization-a', name: 'Zeta', role: 'viewer',
            spaces: [{ id: 'space-a', name: 'Zeta Space', role: 'viewer' }],
          },
          {
            id: 'organization-z', name: 'Alpha', role: 'organization_admin',
            spaces: [
              { id: 'space-a', name: 'Zeta Space', role: 'member' },
              { id: 'space-z', name: 'Alpha Space', role: 'space_manager' },
            ],
          },
        ],
        'another-user': [{
          id: 'organization-hidden', name: 'Hidden', role: 'member', spaces: [],
        }],
      },
    })
    const response = await testApp(repository).inject({ method: 'GET', url: '/api/v1/me' })
    const body = MeResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(body).toEqual({
      actor: { id: 'user-local-admin', kind: 'user' },
      organizations: [
        {
          id: 'organization-z', name: 'Alpha', role: 'organization_admin',
          spaces: [
            { id: 'space-z', name: 'Alpha Space', role: 'space_manager' },
            { id: 'space-a', name: 'Zeta Space', role: 'member' },
          ],
        },
        {
          id: 'organization-a', name: 'Zeta', role: 'viewer',
          spaces: [{ id: 'space-a', name: 'Zeta Space', role: 'viewer' }],
        },
      ],
    })
  })

  it('returns an authenticated actor with no synthetic memberships', async () => {
    const response = await testApp(new InMemorySessionRepository()).inject({ method: 'GET', url: '/api/v1/me' })

    expect(response.statusCode).toBe(200)
    expect(MeResponseSchema.parse(response.json())).toEqual({
      actor: { id: 'user-local-admin', kind: 'user' },
      organizations: [],
    })
  })

  it('creates a Session with defaults from the shared contract', async () => {
    const repository = testRepository({
      createId: () => 'session-1',
      now: () => new Date('2026-07-12T08:00:00.000Z'),
    })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'create-session-1' },
      payload: sessionRequest,
    })
    const body = CreateSessionResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(201)
    expect(response.headers['idempotency-replayed']).toBe('false')
    expect(body.session).toMatchObject({
      id: 'session-1',
      organizationId: 'relay',
      spaceId: 'platform',
      status: 'queued',
      visibility: 'private',
      attachments: [],
    })
    expect(body.message).toMatchObject({ sessionId: 'session-1', sequence: 1, role: 'user' })
    expect(body.turn).toMatchObject({ sessionId: 'session-1', ordinal: 1, status: 'queued' })
    expect(body.command).toMatchObject({ type: 'session.start', status: 'accepted' })
    expect(response.headers.location).toBe('/api/v1/organizations/relay/spaces/platform/sessions/session-1')
  })

  it('caps Space write access at the Organization role', async () => {
    const repository = testRepository({
      actorOrganizations: {
        'user-local-admin': [{
          id: 'relay', name: 'Relay', role: 'viewer',
          spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' }],
        }],
      },
    })
    const response = await testApp(repository).inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'organization-viewer-create' },
      payload: sessionRequest,
    })

    expect(response.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'PERMISSION_DENIED', retryable: false,
    })
    await expect(repository.create({
      organizationId: 'relay',
      spaceId: 'platform',
      actorId: 'user-local-admin',
      idempotencyKey: 'repository-organization-viewer-create',
      request: CreateSessionRequestSchema.parse(sessionRequest),
    })).rejects.toBeInstanceOf(AuthorizationChangedError)
  })

  it('lists Sessions only from the requested organization and Space', async () => {
    const repository = testRepository({ createId: () => crypto.randomUUID() })
    const normalizedRequest = {
      ...sessionRequest,
      start: true,
      visibility: 'private' as const,
      message: { ...sessionRequest.message, attachments: [] },
    }
    await repository.create({ organizationId: 'relay', spaceId: 'platform', actorId: 'user-local-admin', idempotencyKey: 'platform-1', request: normalizedRequest })
    await repository.create({ organizationId: 'other', spaceId: 'platform', actorId: 'user-local-admin', idempotencyKey: 'other-1', request: normalizedRequest })

    const response = await testApp(repository).inject({
      method: 'GET',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
    })
    const body = SessionListResponseSchema.parse(response.json())

    expect(response.statusCode).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ organizationId: 'relay', spaceId: 'platform' })
    expect(body.page.hasMore).toBe(false)
  })

  it('returns a contract-shaped error for invalid input', async () => {
    const response = await testApp().inject({
      method: 'POST',
      url: '/api/v1/organizations/relay/spaces/platform/sessions',
      headers: { 'idempotency-key': 'invalid-session' },
      payload: { ...sessionRequest, message: { content: '' } },
    })
    const error = ApiErrorSchema.parse(response.json())

    expect(response.statusCode).toBe(400)
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', retryable: false })
    expect(error.fieldErrors?.['message.content']).toBeDefined()
  })

  it('requires Idempotency-Key and replays the same Session per organization and Space', async () => {
    const repository = testRepository()
    const app = testApp(repository)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'
    const withoutKey = await app.inject({ method: 'POST', url, payload: sessionRequest })

    expect(withoutKey.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(withoutKey.json()).code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const request = { method: 'POST' as const, url, headers: { 'idempotency-key': 'same-command' }, payload: sessionRequest }
    const first = await app.inject(request)
    const replay = await app.inject(request)
    const sessions = await repository.listBySpace('relay', 'platform', 'user-local-admin')

    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.json()).toEqual(first.json())
    expect(sessions).toHaveLength(1)

    const conflictingReplay = await app.inject({
      ...request,
      payload: { ...sessionRequest, title: 'A different command' },
    })
    const conflict = ApiErrorSchema.parse(conflictingReplay.json())

    expect(conflictingReplay.statusCode).toBe(409)
    expect(conflict).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      retryable: false,
    })
    expect(await repository.listBySpace('relay', 'platform', 'user-local-admin')).toHaveLength(1)

    const otherSpace = await app.inject({
      ...request,
      url: '/api/v1/organizations/relay/spaces/commerce/sessions',
    })

    expect(otherSpace.statusCode).toBe(201)
    expect(otherSpace.headers['idempotency-replayed']).toBe('false')
    expect(await repository.listBySpace('relay', 'commerce', 'user-local-admin')).toHaveLength(1)
  })
})
