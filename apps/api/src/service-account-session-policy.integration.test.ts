import { ApiErrorSchema, CreateSessionResponseSchema, SendSessionMessageResponseSchema } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import { PostgresServiceAccountPolicyRepository } from './service-account-policy-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('ServiceAccount Session operation policy', () => {
  const schema = `relay_service_policy_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const sessionRepository = new PostgresSessionRepository(pool)
  const policyRepository = new PostgresServiceAccountPolicyRepository(pool)

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO relay_organizations (id, name) VALUES ('automation-org', 'Automation Org');
      INSERT INTO relay_spaces (organization_id, id, name)
      VALUES ('automation-org', 'automation-space', 'Automation Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('automation-org', 'service-automation', 'member'),
        ('automation-org', 'automation-owner', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('automation-org', 'automation-space', 'service-automation', 'member'),
        ('automation-org', 'automation-space', 'automation-owner', 'space_manager');
      INSERT INTO relay_service_accounts (organization_id, id, audience, status)
      VALUES ('automation-org', 'service-automation', 'relay-api', 'active');
      INSERT INTO relay_service_account_bindings (
        organization_id, space_id, service_account_id, id, scope, resource_type, resource_id
      ) VALUES (
        'automation-org', 'automation-space', 'service-automation', 'binding-create',
        'session.create', 'expert', 'expert-pr-author'
      );
    `)
    await seedSessionConfiguration(pool, 'automation-org', 'automation-space')
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('allows only exact create/send/archive bindings and denies replay after revocation', async () => {
    const app = createApp({
      sessionRepository,
      serviceAccountPolicyRepository: policyRepository,
      authenticate: async () => ({
        id: 'service-automation', kind: 'service_account', audience: 'relay-api',
      }),
      executionEnabled: true,
      executionReadinessCheck: async () => true,
    })
    await app.ready()
    const base = '/api/v1/organizations/automation-org/spaces/automation-space/sessions'
    try {
      const create = await app.inject({
        method: 'POST',
        url: base,
        headers: { 'idempotency-key': 'service-create' },
        payload: {
          expertId: 'expert-pr-author',
          title: 'Automation Session',
          visibility: 'private',
          start: true,
          message: { content: 'Automation kickoff', attachments: [] },
        },
      })
      expect(create.statusCode).toBe(201)
      const creation = CreateSessionResponseSchema.parse(create.json())
      expect(creation.turn?.initiatorType).toBe('event')
      const sessionUrl = `${base}/${creation.session.id}`

      const unboundSend = await app.inject({
        method: 'POST', url: `${sessionUrl}/messages`,
        headers: { 'idempotency-key': 'service-send' },
        payload: { content: 'Unbound send', attachments: [] },
      })
      expect(unboundSend.statusCode).toBe(403)

      await pool.query(`
        INSERT INTO relay_service_account_bindings (
          organization_id, space_id, service_account_id, id, scope, resource_type, resource_id
        ) VALUES
          ('automation-org', 'automation-space', 'service-automation', 'binding-send',
           'session.send', 'session', $1),
          ('automation-org', 'automation-space', 'service-automation', 'binding-archive',
           'session.archive', 'session', $1)
      `, [creation.session.id])

      const send = await app.inject({
        method: 'POST', url: `${sessionUrl}/messages`,
        headers: { 'idempotency-key': 'service-send' },
        payload: { content: 'Bound automation send', attachments: [] },
      })
      expect(send.statusCode).toBe(202)
      const sent = SendSessionMessageResponseSchema.parse(send.json())
      expect(sent.turn.initiatorType).toBe('event')

      const [list, detail, rename, restore, share] = await Promise.all([
        app.inject({ method: 'GET', url: base }),
        app.inject({ method: 'GET', url: sessionUrl }),
        app.inject({
          method: 'PATCH', url: sessionUrl, headers: { 'if-match': `"${sent.session.version}"` },
          payload: { title: 'Forbidden rename' },
        }),
        app.inject({
          method: 'POST', url: `${sessionUrl}/restore`,
          headers: { 'if-match': `"${sent.session.version}"`, 'idempotency-key': 'service-restore' },
        }),
        app.inject({
          method: 'POST', url: `${sessionUrl}/shares`,
          headers: { 'idempotency-key': 'service-share' },
          payload: { principalType: 'user', principalId: 'automation-owner', role: 'viewer' },
        }),
      ])
      expect([list, detail, rename, restore, share].map((response) => response.statusCode))
        .toEqual([403, 403, 403, 403, 403])

      const archive = await app.inject({
        method: 'POST', url: `${sessionUrl}/archive`,
        headers: { 'if-match': `"${sent.session.version}"`, 'idempotency-key': 'service-archive' },
      })
      expect(archive.statusCode).toBe(200)
      expect(archive.json()).toMatchObject({ archivedAt: expect.any(String) })

      await pool.query(`
        UPDATE relay_service_account_bindings
        SET revoked_at = now(), version = version + 1
        WHERE organization_id = 'automation-org' AND space_id = 'automation-space'
          AND service_account_id = 'service-automation' AND id = 'binding-send'
      `)
      const replayAfterRevoke = await app.inject({
        method: 'POST', url: `${sessionUrl}/messages`,
        headers: { 'idempotency-key': 'service-send' },
        payload: { content: 'Bound automation send', attachments: [] },
      })
      expect(replayAfterRevoke.statusCode).toBe(403)
      expect(ApiErrorSchema.parse(replayAfterRevoke.json())).toMatchObject({ code: 'PERMISSION_DENIED' })

      const audits = await pool.query<{ action: string; actor_kind: string; policy_reason: string }>(`
        SELECT action, actor_kind, policy_reason
        FROM relay_audit_events
        WHERE organization_id = 'automation-org' AND session_id = $1
        ORDER BY occurred_at, action
      `, [creation.session.id])
      expect(audits.rows).toEqual(expect.arrayContaining([
        {
          action: 'session.create',
          actor_kind: 'service_account',
          policy_reason: 'service_account_expert_binding',
        },
        {
          action: 'session.send',
          actor_kind: 'service_account',
          policy_reason: 'service_account_session_binding',
        },
        {
          action: 'session.archive',
          actor_kind: 'service_account',
          policy_reason: 'service_account_session_binding',
        },
      ]))
    } finally {
      await app.close()
    }
  })

  it('fails closed for audience mismatch and wildcard bindings', async () => {
    await expect(policyRepository.authorizeSessionOperation({
      organizationId: 'automation-org',
      spaceId: 'automation-space',
      serviceAccountId: 'service-automation',
      audience: 'another-api',
      scope: 'session.create',
      resourceType: 'expert',
      resourceId: 'expert-pr-author',
    })).resolves.toBe(false)
    await expect(pool.query(`
      INSERT INTO relay_service_account_bindings (
        organization_id, space_id, service_account_id, id, scope, resource_type, resource_id
      ) VALUES (
        'automation-org', 'automation-space', 'service-automation', 'binding-wildcard',
        'session.send', 'session', '*'
      )
    `)).rejects.toMatchObject({ code: '23514' })
  })
})
