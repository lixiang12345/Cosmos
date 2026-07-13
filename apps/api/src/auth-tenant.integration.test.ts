import { ApiErrorSchema, MeResponseSchema, SessionDtoSchema, SessionListResponseSchema } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { AuthenticatedActor } from './auth.js'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

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
    ['token-service', { id: 'service-ci', kind: 'service_account' }],
  ])
  const authenticate = async (authorization: string | undefined) => {
    const actor = authorization ? actors.get(authorization.replace(/^Bearer /, '')) : undefined
    if (!actor) throw new Error('invalid test token')
    return actor
  }
  const repository = new PostgresSessionRepository(pool)
  const app = createApp({
    sessionRepository: repository,
    authenticate,
    executionReadinessCheck: async () => true,
  })

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query(`
      ALTER TABLE relay_session_events DISABLE TRIGGER relay_session_events_reject_truncate;
      ALTER TABLE relay_audit_events DISABLE TRIGGER relay_audit_events_reject_truncate;
      ALTER TABLE relay_attempts DISABLE TRIGGER relay_attempts_reject_truncate;
      ALTER TABLE relay_artifacts DISABLE TRIGGER relay_artifacts_reject_truncate;
      ALTER TABLE relay_files DISABLE TRIGGER relay_files_reject_truncate;
      ALTER TABLE relay_file_versions DISABLE TRIGGER relay_file_versions_reject_truncate;
    `)
    try {
      await pool.query(`
        TRUNCATE relay_idempotency_responses, relay_idempotency_records, relay_sessions,
          relay_space_memberships, relay_organization_memberships, relay_spaces, relay_organizations CASCADE
      `)
    } finally {
      await pool.query(`
        ALTER TABLE relay_session_events ENABLE TRIGGER relay_session_events_reject_truncate;
        ALTER TABLE relay_audit_events ENABLE TRIGGER relay_audit_events_reject_truncate;
        ALTER TABLE relay_attempts ENABLE TRIGGER relay_attempts_reject_truncate;
        ALTER TABLE relay_artifacts ENABLE TRIGGER relay_artifacts_reject_truncate;
        ALTER TABLE relay_files ENABLE TRIGGER relay_files_reject_truncate;
        ALTER TABLE relay_file_versions ENABLE TRIGGER relay_file_versions_reject_truncate;
      `)
    }
    await pool.query(`
      INSERT INTO relay_organizations (id, name) VALUES ('org-a', 'Organization A'), ('org-b', 'Organization B');
      INSERT INTO relay_spaces (organization_id, id, name)
        VALUES ('org-a', 'space-a', 'Space A'), ('org-a', 'space-b', 'Space B'), ('org-b', 'space-a', 'Space A');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('org-a', 'user-a', 'member'), ('org-a', 'user-b', 'member'), ('org-a', 'user-viewer', 'viewer'),
        ('org-b', 'user-a', 'viewer'), ('org-b', 'service-ci', 'organization_admin');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('org-a', 'space-a', 'user-a', 'member'), ('org-a', 'space-a', 'user-b', 'member'),
        ('org-a', 'space-a', 'user-viewer', 'viewer'), ('org-a', 'space-b', 'user-a', 'member');
    `)
    await seedSessionConfiguration(pool, 'org-a', 'space-a')
    await seedSessionConfiguration(pool, 'org-a', 'space-b')
    await seedSessionConfiguration(pool, 'org-b', 'space-a')
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const url = '/api/v1/organizations/org-a/spaces/space-a/sessions'
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  it('discovers only the authenticated actor memberships in deterministic order', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('token-a') })

    expect(response.statusCode).toBe(200)
    expect(MeResponseSchema.parse(response.json())).toEqual({
      actor: { id: 'user-a', kind: 'user' },
      organizations: [
        {
          id: 'org-a', name: 'Organization A', role: 'member',
          spaces: [
            { id: 'space-a', name: 'Space A', role: 'member' },
            { id: 'space-b', name: 'Space B', role: 'member' },
          ],
        },
        { id: 'org-b', name: 'Organization B', role: 'viewer', spaces: [] },
      ],
    })
  })

  it('returns service-account identity and an empty organization list for an outsider', async () => {
    const service = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('token-service') })
    const outsider = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('token-outsider') })

    expect(MeResponseSchema.parse(service.json())).toEqual({
      actor: { id: 'service-ci', kind: 'service_account' },
      organizations: [{
        id: 'org-b', name: 'Organization B', role: 'organization_admin', spaces: [],
      }],
    })
    expect(MeResponseSchema.parse(outsider.json())).toEqual({
      actor: { id: 'user-outsider', kind: 'user' }, organizations: [],
    })
  })

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

    const privateSession = SessionDtoSchema.parse(privateCreate.json().session)
    const spaceSession = SessionDtoSchema.parse(spaceCreate.json().session)
    const privateDetailUrl = `${url}/${privateSession.id}`
    const creatorDetail = await app.inject({ method: 'GET', url: privateDetailUrl, headers: auth('token-a') })
    const hiddenDetail = await app.inject({ method: 'GET', url: privateDetailUrl, headers: auth('token-b') })
    const missingDetail = await app.inject({ method: 'GET', url: `${url}/missing-session`, headers: auth('token-b') })
    const sharedDetail = await app.inject({ method: 'GET', url: `${url}/${spaceSession.id}`, headers: auth('token-b') })
    const crossSpaceDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/org-a/spaces/space-b/sessions/${spaceSession.id}`,
      headers: auth('token-a'),
    })

    expect(SessionDtoSchema.parse(creatorDetail.json())).toEqual(privateSession)
    expect(creatorDetail.headers.etag).toBe('"1"')
    expect(creatorDetail.headers['cache-control']).toBe('private, no-store')
    expect(creatorDetail.headers.vary).toBe('Authorization')
    expect(SessionDtoSchema.parse(sharedDetail.json())).toEqual(spaceSession)
    expect(hiddenDetail.statusCode).toBe(404)
    expect(crossSpaceDetail.statusCode).toBe(404)
    expect(hiddenDetail.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND', message: missingDetail.json().message,
    })

    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = 'org-a' AND space_id = 'space-a' AND actor_id = 'user-a'
    `)
    const revokedDetail = await app.inject({ method: 'GET', url: privateDetailUrl, headers: auth('token-a') })
    expect(revokedDetail.statusCode).toBe(404)
    expect(revokedDetail.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND', message: missingDetail.json().message,
    })
    await pool.query(`
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('org-a', 'space-a', 'user-a', 'member')
    `)
  })

  it('conceals an unknown repository override with the same not-found response', async () => {
    const unknownRepository = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth('token-a'), 'idempotency-key': 'unknown-repository-http' },
      payload: { ...sessionRequest, advancedOverrides: { repositoryId: 'repository-unknown' } },
    })
    const missing = await app.inject({
      method: 'GET', url: `${url}/missing-session`, headers: auth('token-a'),
    })

    expect(unknownRepository.statusCode).toBe(404)
    expect(unknownRepository.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND', message: missing.json().message,
    })
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
