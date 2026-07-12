import { ApiErrorSchema, SessionListResponseSchema } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { AuthenticatedActor } from './auth.js'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const sessionRequest = {
  title: 'Tenant isolation proof', expertId: 'expert-pr-author', expertName: 'PR Author',
  repository: 'commerce/checkout', baseBranch: 'main',
  message: { content: 'Verify tenant and Private Session isolation.' },
}

describeWithDatabase('HTTP authentication and tenant isolation', () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const actors = new Map<string, AuthenticatedActor>([
    ['token-a', { id: 'user-a', kind: 'user' }],
    ['token-b', { id: 'user-b', kind: 'user' }],
    ['token-viewer', { id: 'user-viewer', kind: 'user' }],
    ['token-outsider', { id: 'user-outsider', kind: 'user' }],
  ])
  const authenticate = async (authorization: string | undefined) => {
    const actor = authorization ? actors.get(authorization.replace(/^Bearer /, '')) : undefined
    if (!actor) throw new Error('invalid test token')
    return actor
  }
  const repository = new PostgresSessionRepository(pool)
  const app = createApp({ sessionRepository: repository, authenticate })

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query(`
      TRUNCATE relay_idempotency_responses, relay_idempotency_records, relay_sessions, relay_space_memberships,
        relay_organization_memberships, relay_spaces, relay_organizations CASCADE;
      INSERT INTO relay_organizations (id, name) VALUES ('org-a', 'Organization A'), ('org-b', 'Organization B');
      INSERT INTO relay_spaces (organization_id, id, name)
        VALUES ('org-a', 'space-a', 'Space A'), ('org-a', 'space-b', 'Space B'), ('org-b', 'space-a', 'Space A');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('org-a', 'user-a', 'member'), ('org-a', 'user-b', 'member'), ('org-a', 'user-viewer', 'viewer');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('org-a', 'space-a', 'user-a', 'member'), ('org-a', 'space-a', 'user-b', 'member'),
        ('org-a', 'space-a', 'user-viewer', 'viewer'), ('org-a', 'space-b', 'user-a', 'member');
    `)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const url = '/api/v1/organizations/org-a/spaces/space-a/sessions'
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  it('hides non-member and cross-tenant resources with the same 404 shape', async () => {
    const outsider = await app.inject({ method: 'GET', url, headers: auth('token-outsider') })
    const crossTenant = await app.inject({
      method: 'GET', url: '/api/v1/organizations/org-b/spaces/space-a/sessions', headers: auth('token-a'),
    })

    expect(outsider.statusCode).toBe(404)
    expect(crossTenant.statusCode).toBe(404)
    expect(ApiErrorSchema.parse(outsider.json())).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(crossTenant.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: outsider.json().message })
  })

  it('allows viewers to list Space Sessions but rejects writes', async () => {
    const list = await app.inject({ method: 'GET', url, headers: auth('token-viewer') })
    const create = await app.inject({
      method: 'POST', url, headers: { ...auth('token-viewer'), 'idempotency-key': 'viewer-create' }, payload: sessionRequest,
    })

    expect(list.statusCode).toBe(200)
    expect(create.statusCode).toBe(403)
    expect(ApiErrorSchema.parse(create.json())).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('shows a Private Session only to its creator and a Space Session to members', async () => {
    const privateCreate = await app.inject({
      method: 'POST', url, headers: { ...auth('token-a'), 'idempotency-key': 'private-a' }, payload: sessionRequest,
    })
    const spaceCreate = await app.inject({
      method: 'POST', url, headers: { ...auth('token-a'), 'idempotency-key': 'space-a' },
      payload: { ...sessionRequest, title: 'Shared with the Space', visibility: 'space' },
    })
    const creatorList = SessionListResponseSchema.parse((await app.inject({
      method: 'GET', url, headers: auth('token-a'),
    })).json())
    const memberList = SessionListResponseSchema.parse((await app.inject({
      method: 'GET', url, headers: auth('token-b'),
    })).json())

    expect(privateCreate.statusCode).toBe(201)
    expect(spaceCreate.statusCode).toBe(201)
    expect(creatorList.items.map((session) => session.title)).toEqual(expect.arrayContaining([
      'Tenant isolation proof', 'Shared with the Space',
    ]))
    expect(memberList.items.map((session) => session.title)).toEqual(['Shared with the Space'])
  })

  it('scopes the same idempotency key independently by actor and Space', async () => {
    const sameKey = 'same-visible-key'
    const [actorA, actorB, otherSpace] = await Promise.all([
      app.inject({ method: 'POST', url, headers: { ...auth('token-a'), 'idempotency-key': sameKey }, payload: { ...sessionRequest, title: 'Actor A' } }),
      app.inject({ method: 'POST', url, headers: { ...auth('token-b'), 'idempotency-key': sameKey }, payload: { ...sessionRequest, title: 'Actor B' } }),
      app.inject({
        method: 'POST', url: '/api/v1/organizations/org-a/spaces/space-b/sessions',
        headers: { ...auth('token-a'), 'idempotency-key': sameKey }, payload: { ...sessionRequest, title: 'Other Space' },
      }),
    ])

    const ids = [actorA, actorB, otherSpace].map((response) => response.json().session.id)
    expect(new Set(ids).size).toBe(3)
  })
})
