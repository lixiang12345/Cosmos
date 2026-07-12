import {
  ApiErrorSchema,
  CreateSessionResponseSchema,
  SessionListResponseSchema,
  type CreateSessionRequestInput,
} from '@relay/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { InMemorySessionRepository } from './session-repository.js'

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

function testApp(repository = new InMemorySessionRepository()) {
  const app = createApp({ sessionRepository: repository })
  openApps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()))
})

describe('Relay API', () => {
  it('reports health', async () => {
    const response = await testApp().inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('creates a Session with defaults from the shared contract', async () => {
    const repository = new InMemorySessionRepository({
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
      status: 'active',
      visibility: 'private',
      attachments: [],
    })
  })

  it('lists Sessions only from the requested organization and Space', async () => {
    const repository = new InMemorySessionRepository({ createId: () => crypto.randomUUID() })
    const normalizedRequest = {
      ...sessionRequest,
      start: true,
      visibility: 'private' as const,
      message: { ...sessionRequest.message, attachments: [] },
    }
    await repository.create({ organizationId: 'relay', spaceId: 'platform', idempotencyKey: 'platform-1', request: normalizedRequest })
    await repository.create({ organizationId: 'other', spaceId: 'platform', idempotencyKey: 'other-1', request: normalizedRequest })

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
    const repository = new InMemorySessionRepository()
    const app = testApp(repository)
    const url = '/api/v1/organizations/relay/spaces/platform/sessions'
    const withoutKey = await app.inject({ method: 'POST', url, payload: sessionRequest })

    expect(withoutKey.statusCode).toBe(400)
    expect(ApiErrorSchema.parse(withoutKey.json()).code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const request = { method: 'POST' as const, url, headers: { 'idempotency-key': 'same-command' }, payload: sessionRequest }
    const first = await app.inject(request)
    const replay = await app.inject(request)
    const sessions = await repository.listBySpace('relay', 'platform')

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
    expect(await repository.listBySpace('relay', 'platform')).toHaveLength(1)

    const otherSpace = await app.inject({
      ...request,
      url: '/api/v1/organizations/relay/spaces/commerce/sessions',
    })

    expect(otherSpace.statusCode).toBe(201)
    expect(otherSpace.headers['idempotency-replayed']).toBe('false')
    expect(await repository.listBySpace('relay', 'commerce')).toHaveLength(1)
  })
})
