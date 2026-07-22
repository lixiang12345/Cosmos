import { ApiErrorSchema, ShareGrantDtoSchema } from '@cosmos/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { createApp } from './app.js'
import type { AuthenticatedActor } from './auth.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import { encodeSessionTimelineCursor } from './session-timeline-pagination.js'
import {
  AuthorizationChangedError,
  ShareGrantConflictError,
  ShareGrantVersionConflictError,
} from './session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Session ShareGrant policy', () => {
  const schema = `cosmos_shares_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const repository = new PostgresSessionRepository(pool)
  const timeline = new PostgresSessionTimelineRepository(pool)
  let sessionId: string

  const context = (actorId: string, requestId: string) => ({
    organizationId: 'share-org',
    spaceId: 'share-space',
    sessionId,
    actorId,
    actorKind: 'user' as const,
    requestId,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('share-org', 'Share Org');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('share-org', 'share-space', 'Share Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role) VALUES
        ('share-org', 'share-owner', 'member'),
        ('share-org', 'share-collaborator', 'member'),
        ('share-org', 'share-viewer', 'member'),
        ('share-org', 'share-group-user', 'member'),
        ('share-org', 'share-concurrent', 'member');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('share-org', 'share-space', 'share-owner', 'space_manager'),
        ('share-org', 'share-space', 'share-collaborator', 'member'),
        ('share-org', 'share-space', 'share-viewer', 'member'),
        ('share-org', 'share-space', 'share-group-user', 'member'),
        ('share-org', 'share-space', 'share-concurrent', 'member');
      INSERT INTO cosmos_groups (organization_id, id, name)
      VALUES ('share-org', 'share-team', 'Share Team');
      INSERT INTO cosmos_group_memberships (organization_id, group_id, actor_id)
      VALUES ('share-org', 'share-team', 'share-group-user');
    `)
    await seedSessionConfiguration(pool, 'share-org', 'share-space')
    const created = await repository.create({
      organizationId: 'share-org',
      spaceId: 'share-space',
      actorId: 'share-owner',
      actorKind: 'user',
      requestId: 'share-session-create',
      idempotencyKey: 'share-session-create',
      request: {
        expertId: 'expert-pr-author',
        title: 'Private collaboration',
        visibility: 'private',
        start: true,
        message: { content: 'Initial private message', attachments: [] },
      },
    })
    sessionId = created.session.id
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('enforces collaborator, viewer, group, expiry, CAS, and immediate revocation semantics', async () => {
    await expect(repository.getById('share-org', 'share-space', sessionId, 'share-collaborator'))
      .resolves.toBeNull()

    const collaborator = await repository.createShare({
      ...context('share-owner', 'grant-collaborator'),
      idempotencyKey: 'grant-collaborator',
      request: { principalType: 'user', principalId: 'share-collaborator', role: 'collaborator' },
    })
    expect(collaborator).toMatchObject({ replayed: false, grant: { role: 'collaborator', version: 1 } })
    await expect(repository.createShare({
      ...context('share-owner', 'grant-collaborator-replay'),
      idempotencyKey: 'grant-collaborator',
      request: { principalType: 'user', principalId: 'share-collaborator', role: 'collaborator' },
    })).resolves.toMatchObject({ replayed: true, grant: { id: collaborator?.grant.id } })

    const visible = await repository.getById('share-org', 'share-space', sessionId, 'share-collaborator')
    expect(visible?.title).toBe('Private collaboration')
    const renamed = await repository.rename({
      ...context('share-collaborator', 'collaborator-rename'),
      expectedVersion: visible!.version,
      request: { title: 'Collaboratively renamed' },
    })
    expect(renamed?.title).toBe('Collaboratively renamed')
    await expect(repository.send({
      ...context('share-collaborator', 'collaborator-send'),
      idempotencyKey: 'collaborator-send',
      request: { content: 'Collaborator follow-up', attachments: [] },
    })).resolves.toMatchObject({ replayed: false, message: { content: 'Collaborator follow-up' } })
    await expect(timeline.listMessages(
      'share-org', 'share-space', sessionId, 'share-collaborator',
    )).resolves.toMatchObject({ items: expect.arrayContaining([
      expect.objectContaining({ content: 'Collaborator follow-up' }),
    ]) })

    const viewer = await repository.createShare({
      ...context('share-owner', 'grant-viewer'),
      idempotencyKey: 'grant-viewer',
      request: { principalType: 'user', principalId: 'share-viewer', role: 'viewer' },
    })
    await expect(repository.getById('share-org', 'share-space', sessionId, 'share-viewer'))
      .resolves.toMatchObject({ id: sessionId })
    await expect(repository.send({
      ...context('share-viewer', 'viewer-send'),
      idempotencyKey: 'viewer-send',
      request: { content: 'Forbidden viewer write', attachments: [] },
    })).rejects.toBeInstanceOf(AuthorizationChangedError)

    await repository.createShare({
      ...context('share-owner', 'grant-group'),
      idempotencyKey: 'grant-group',
      request: { principalType: 'group', principalId: 'share-team', role: 'viewer' },
    })
    await expect(repository.getById('share-org', 'share-space', sessionId, 'share-group-user'))
      .resolves.toMatchObject({ id: sessionId })
    await pool.query(`
      DELETE FROM cosmos_group_memberships
      WHERE organization_id = 'share-org' AND group_id = 'share-team' AND actor_id = 'share-group-user'
    `)
    await expect(repository.getById('share-org', 'share-space', sessionId, 'share-group-user'))
      .resolves.toBeNull()

    await expect(repository.revokeShare({
      ...context('share-owner', 'revoke-collaborator-stale'),
      shareId: collaborator!.grant.id,
      idempotencyKey: 'revoke-collaborator-stale',
      expectedVersion: 2,
    })).rejects.toBeInstanceOf(ShareGrantVersionConflictError)
    const revoked = await repository.revokeShare({
      ...context('share-owner', 'revoke-collaborator'),
      shareId: collaborator!.grant.id,
      idempotencyKey: 'revoke-collaborator',
      expectedVersion: 1,
    })
    expect(revoked).toMatchObject({ replayed: false, grant: { revokedBy: 'share-owner', version: 2 } })
    await expect(repository.getById('share-org', 'share-space', sessionId, 'share-collaborator'))
      .resolves.toBeNull()
    await expect(timeline.listMessages(
      'share-org', 'share-space', sessionId, 'share-collaborator',
    )).resolves.toBeNull()

    await pool.query(`
      UPDATE cosmos_session_share_grants
      SET expires_at = created_at + interval '1 millisecond'
      WHERE organization_id = 'share-org' AND space_id = 'share-space'
        AND session_id = $1 AND id = $2
    `, [sessionId, viewer!.grant.id])
    const renewed = await repository.createShare({
      ...context('share-owner', 'renew-viewer'),
      idempotencyKey: 'renew-viewer',
      request: { principalType: 'user', principalId: 'share-viewer', role: 'collaborator' },
    })
    expect(renewed).toMatchObject({ grant: { role: 'collaborator', version: 1 } })

    const concurrent = await Promise.allSettled([
      repository.createShare({
        ...context('share-owner', 'concurrent-a'),
        idempotencyKey: 'concurrent-a',
        request: { principalType: 'user', principalId: 'share-concurrent', role: 'viewer' },
      }),
      repository.createShare({
        ...context('share-owner', 'concurrent-b'),
        idempotencyKey: 'concurrent-b',
        request: { principalType: 'user', principalId: 'share-concurrent', role: 'collaborator' },
      }),
    ])
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = concurrent.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: expect.any(ShareGrantConflictError) })

    const shares = await repository.listShares('share-org', 'share-space', sessionId, 'share-owner', { limit: 2 })
    expect(shares).toMatchObject({ hasMore: true, items: { length: 2 } })
    const actions = await pool.query<{ action: string; count: string }>(`
      SELECT action, count(*)::text AS count
      FROM cosmos_audit_events
      WHERE organization_id = 'share-org' AND session_id = $1
        AND action IN ('session.share.create', 'session.share.revoke')
      GROUP BY action
    `, [sessionId])
    expect(Object.fromEntries(actions.rows.map((row) => [row.action, Number(row.count)])))
      .toMatchObject({ 'session.share.create': 5, 'session.share.revoke': 2 })
    const outbox = await pool.query<{ event_type: string; count: string }>(`
      SELECT event_type, count(*)::text AS count
      FROM cosmos_outbox_events
      WHERE organization_id = 'share-org' AND session_id = $1
        AND event_type IN ('session.share_created', 'session.share_revoked')
      GROUP BY event_type
    `, [sessionId])
    expect(Object.fromEntries(outbox.rows.map((row) => [row.event_type, Number(row.count)])))
      .toMatchObject({ 'session.share_created': 5, 'session.share_revoked': 2 })
  })

  it('enforces HTTP preconditions, replay headers, and Private concealment after revoke', async () => {
    const created = await repository.create({
      organizationId: 'share-org',
      spaceId: 'share-space',
      actorId: 'share-owner',
      actorKind: 'user',
      requestId: 'http-session-create',
      idempotencyKey: 'http-session-create',
      request: {
        expertId: 'expert-pr-author',
        title: 'HTTP share policy',
        visibility: 'private',
        start: true,
        message: { content: 'HTTP policy fixture', attachments: [] },
      },
    })
    const tokens = new Map<string, AuthenticatedActor>([
      ['owner', { id: 'share-owner', kind: 'user' }],
      ['viewer', { id: 'share-viewer', kind: 'user' }],
    ])
    const app = createApp({
      sessionRepository: repository,
      sessionTimelineRepository: timeline,
      authenticate: async (authorization) => tokens.get(authorization?.replace(/^Bearer /, '') ?? '')!,
      executionReadinessCheck: async () => true,
      sessionEventStream: {
        heartbeatMs: 10,
        pollMs: 5,
        maxDurationMs: 300_000,
      },
    })
    await app.ready()
    const base = `/api/v1/organizations/share-org/spaces/share-space/sessions/${created.session.id}`
    const owner = { authorization: 'Bearer owner' }
    const viewer = { authorization: 'Bearer viewer' }

    const expectStreamToClose = async (
      streamBase: string,
      actor: { authorization: string },
      revoke: () => Promise<void>,
    ) => {
      const currentSequence = await pool.query<{ last_event_sequence: string }>(
        'SELECT last_event_sequence::text FROM cosmos_sessions WHERE organization_id = $1 AND space_id = $2 AND id = $3',
        ['share-org', 'share-space', streamBase.split('/').at(-1)],
      )
      const cursor = encodeSessionTimelineCursor({
        organizationId: 'share-org',
        spaceId: 'share-space',
        sessionId: streamBase.split('/').at(-1)!,
        sequence: Number(currentSequence.rows[0]?.last_event_sequence ?? 0),
      })
      const response = await app.inject({
        method: 'GET',
        url: `${streamBase}/events/stream`,
        headers: { ...actor, 'last-event-id': cursor },
        payloadAsStream: true,
      })
      expect(response.statusCode).toBe(200)
      const chunks: Buffer[] = []
      response.stream().on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      const closed = new Promise<void>((resolve) => response.raw.res.once('close', () => resolve()))
      await new Promise((resolve) => setTimeout(resolve, 20))
      await revoke()
      await expect(Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error('SSE revoke close timeout')), 500)),
      ])).resolves.toBeUndefined()
      return Buffer.concat(chunks).toString('utf8')
    }

    try {
      const missingKey = await app.inject({
        method: 'POST', url: `${base}/shares`, headers: owner,
        payload: { principalType: 'user', principalId: 'share-viewer', role: 'viewer' },
      })
      expect(missingKey.statusCode).toBe(400)
      expect(ApiErrorSchema.parse(missingKey.json())).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })

      const grantResponse = await app.inject({
        method: 'POST', url: `${base}/shares`,
        headers: { ...owner, 'idempotency-key': 'http-grant-viewer' },
        payload: { principalType: 'user', principalId: 'share-viewer', role: 'viewer' },
      })
      const grant = ShareGrantDtoSchema.parse(grantResponse.json())
      expect(grantResponse.statusCode).toBe(201)
      expect(grantResponse.headers.etag).toBe('"1"')
      expect(grantResponse.headers['idempotency-replayed']).toBe('false')

      const replay = await app.inject({
        method: 'POST', url: `${base}/shares`,
        headers: { ...owner, 'idempotency-key': 'http-grant-viewer' },
        payload: { principalType: 'user', principalId: 'share-viewer', role: 'viewer' },
      })
      expect(replay.statusCode).toBe(201)
      expect(replay.headers['idempotency-replayed']).toBe('true')
      expect(replay.json()).toEqual(grant)

      expect((await app.inject({ method: 'GET', url: base, headers: viewer })).statusCode).toBe(200)
      const viewerWrite = await app.inject({
        method: 'POST', url: `${base}/messages`,
        headers: { ...viewer, 'idempotency-key': 'http-viewer-write' },
        payload: { content: 'Viewer write must fail', attachments: [] },
      })
      expect(viewerWrite.statusCode).toBe(403)

      const list = await app.inject({ method: 'GET', url: `${base}/shares?limit=1`, headers: owner })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toMatchObject({ items: [{ id: grant.id }], page: { hasMore: false } })

      const missingIfMatch = await app.inject({
        method: 'DELETE', url: `${base}/shares/${grant.id}`,
        headers: { ...owner, 'idempotency-key': 'http-revoke-missing-cas' },
      })
      expect(missingIfMatch.statusCode).toBe(428)
      const stale = await app.inject({
        method: 'DELETE', url: `${base}/shares/${grant.id}`,
        headers: { ...owner, 'idempotency-key': 'http-revoke-stale', 'if-match': '"2"' },
      })
      expect(stale.statusCode).toBe(412)

      const shareStreamBody = await expectStreamToClose(
        base,
        viewer,
        async () => {
          const revokedResponse = await app.inject({
            method: 'DELETE', url: `${base}/shares/${grant.id}`,
            headers: { ...owner, 'idempotency-key': 'http-revoke', 'if-match': '"1"' },
          })
          expect(revokedResponse.statusCode).toBe(200)
          expect(revokedResponse.headers.etag).toBe('"2"')
          expect(ShareGrantDtoSchema.parse(revokedResponse.json())).toMatchObject({
            id: grant.id, version: 2, revokedBy: 'share-owner',
          })
          await repository.send({
            ...context('share-owner', 'sse-post-revoke-send'),
            idempotencyKey: 'sse-post-revoke-send',
            request: { content: 'Private event after ShareGrant revoke', attachments: [] },
          })
        },
      )
      expect(shareStreamBody).toContain('event: reconnect')
      expect(shareStreamBody).not.toContain('Private event after ShareGrant revoke')
      expect((await app.inject({ method: 'GET', url: base, headers: viewer })).statusCode).toBe(404)

      const membershipSession = await repository.create({
        organizationId: 'share-org',
        spaceId: 'share-space',
        actorId: 'share-owner',
        actorKind: 'user',
        requestId: 'sse-membership-session-create',
        idempotencyKey: 'sse-membership-session-create',
        request: {
          expertId: 'expert-pr-author',
          title: 'Membership stream',
          visibility: 'space',
          start: true,
          message: { content: 'Membership stream initial', attachments: [] },
        },
      })
      const membershipBase = `/api/v1/organizations/share-org/spaces/share-space/sessions/${membershipSession.session.id}`
      const membershipStreamBody = await expectStreamToClose(
        membershipBase,
        viewer,
        async () => {
          await pool.query(
            'DELETE FROM cosmos_space_memberships WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3',
            ['share-org', 'share-space', 'share-viewer'],
          )
          await repository.send({
            ...context('share-owner', 'sse-membership-post-revoke-send'),
            sessionId: membershipSession.session.id,
            idempotencyKey: 'sse-membership-post-revoke-send',
            request: { content: 'Private event after membership revoke', attachments: [] },
          })
        },
      )
      expect(membershipStreamBody).toContain('event: reconnect')
      expect(membershipStreamBody).not.toContain('Private event after membership revoke')
      expect((await app.inject({ method: 'GET', url: membershipBase, headers: viewer })).statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
