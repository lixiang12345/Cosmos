import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresArtifactRepository } from './postgres-artifact-repository.js'
import { PostgresExecutionRepository } from './postgres-execution-repository.js'
import { PostgresSecurityAuditRepository } from './postgres-security-audit-repository.js'
import {
  assertRuntimeDatabaseRole,
  withApiDatabaseContext,
} from './postgres-runtime-database.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('restricted runtime roles and tenant RLS', () => {
  const schema = `relay_runtime_rls_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_worker_runtime -c search_path=${schema}`,
  })
  const sessions = new PostgresSessionRepository(apiPool)
  const artifacts = new PostgresArtifactRepository(apiPool)
  const execution = new PostgresExecutionRepository(workerPool)
  const securityAudit = new PostgresSecurityAuditRepository(apiPool, '11'.repeat(32), {
    createId: () => 'security-audit-1',
    hmacKeyId: 'integration-v1',
    now: () => new Date('2026-07-13T16:00:00.000Z'),
  })
  let sessionA = ''
  let sessionB = ''

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('rls-org-a', 'RLS Organization A'),
        ('rls-org-b', 'RLS Organization B');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('rls-org-a', 'rls-space-a', 'RLS Space A'),
        ('rls-org-b', 'rls-space-b', 'RLS Space B');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('rls-org-a', 'rls-user-a', 'member'),
        ('rls-org-b', 'rls-user-b', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('rls-org-a', 'rls-space-a', 'rls-user-a', 'member'),
        ('rls-org-b', 'rls-space-b', 'rls-user-b', 'member');
    `)
    await seedSessionConfiguration(migrationPool, 'rls-org-a', 'rls-space-a')
    await seedSessionConfiguration(migrationPool, 'rls-org-b', 'rls-space-b')

    const runtimeConnection = await apiPool.query<{
      role: string
      schema: string
      membership_select: boolean
    }>(`
      SELECT current_user AS role, current_schema() AS schema,
        has_table_privilege(
          current_user,
          format('%I.relay_organization_memberships', current_schema()),
          'SELECT'
        ) AS membership_select
    `)
    expect(runtimeConnection.rows[0]).toEqual({
      role: 'relay_api_runtime',
      schema,
      membership_select: true,
    })

    const create = async (suffix: 'a' | 'b') => sessions.create({
      organizationId: `rls-org-${suffix}`,
      spaceId: `rls-space-${suffix}`,
      actorId: `rls-user-${suffix}`,
      actorKind: 'user',
      requestId: `rls-create-${suffix}`,
      idempotencyKey: `rls-create-${suffix}`,
      request: {
        title: `RLS Session ${suffix.toUpperCase()}`,
        expertId: 'expert-pr-author',
        visibility: 'space',
        start: true,
        message: { content: `Run tenant ${suffix.toUpperCase()}`, attachments: [] },
      },
    })
    sessionA = (await create('a')).session.id
    sessionB = (await create('b')).session.id
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('forces RLS on every tenant table and assumes non-bypass runtime roles', async () => {
    await expect(assertRuntimeDatabaseRole(apiPool, 'relay_api_runtime')).resolves.toBeUndefined()
    await expect(assertRuntimeDatabaseRole(workerPool, 'relay_worker_runtime')).resolves.toBeUndefined()

    const roleRows = await adminPool.query<{
      rolname: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolcanlogin: boolean
      rolinherit: boolean
    }>(`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
      FROM pg_roles
      WHERE rolname IN ('relay_api_runtime', 'relay_worker_runtime')
      ORDER BY rolname
    `)
    expect(roleRows.rows).toEqual([
      {
        rolname: 'relay_api_runtime',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolinherit: false,
      },
      {
        rolname: 'relay_worker_runtime',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolinherit: false,
      },
    ])

    const protection = await migrationPool.query<{
      protected_tables: string
      rls_tables: string
      forced_tables: string
    }>(`
      SELECT
        count(*)::text AS protected_tables,
        count(*) FILTER (WHERE relrowsecurity)::text AS rls_tables,
        count(*) FILTER (WHERE relforcerowsecurity)::text AS forced_tables
      FROM pg_class
      WHERE relnamespace = current_schema()::regnamespace
        AND relname LIKE 'relay_%'
        AND relkind = 'r'
        AND relname NOT IN ('relay_schema_migrations', 'relay_worker_heartbeats')
    `)
    expect(protection.rows[0]).toEqual({
      protected_tables: '48',
      rls_tables: '48',
      forced_tables: '48',
    })
  })

  it('appends fingerprint-only security failures outside rolled-back domain transactions', async () => {
    await securityAudit.append({
      requestId: 'security-request-1',
      actor: { id: 'rls-user-a', kind: 'user' },
      method: 'PATCH',
      routePattern: '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId',
      statusCode: 404,
      errorCode: 'RESOURCE_NOT_FOUND',
      organizationId: 'rls-org-a',
      spaceId: 'rls-space-a',
      target: { sessionId: 'private-session-that-must-not-leak' },
      idempotencyKey: 'never-store-this-key',
      clientIp: '203.0.113.8',
      userAgent: 'security-audit-test-agent',
    })

    const rows = await migrationPool.query<{
      actor_fingerprint: string
      client_ip_fingerprint: string
      error_code: string
      hmac_key_id: string
      idempotency_key_fingerprint: string
      organization_fingerprint: string
      outcome: string
      route_pattern: string
      space_fingerprint: string
      target_fingerprint: string
      user_agent_fingerprint: string
    }>('SELECT * FROM relay_security_audit_events WHERE audit_event_id = $1', ['security-audit-1'])
    expect(rows.rows[0]).toMatchObject({
      error_code: 'RESOURCE_NOT_FOUND',
      hmac_key_id: 'integration-v1',
      outcome: 'denied',
      route_pattern: '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId',
      actor_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      client_ip_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      idempotency_key_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      organization_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      space_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      target_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      user_agent_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(rows.rows[0])).not.toContain('rls-user-a')
    expect(JSON.stringify(rows.rows[0])).not.toContain('private-session-that-must-not-leak')
    expect(JSON.stringify(rows.rows[0])).not.toContain('never-store-this-key')
    await expect(apiPool.query('SELECT * FROM relay_security_audit_events'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(workerPool.query(`
      INSERT INTO relay_security_audit_events (
        audit_event_id, request_id, hmac_key_id, method, route_pattern, outcome, status_code,
        error_code, client_ip_fingerprint, occurred_at
      ) VALUES (
        'worker-audit', 'worker-request', 'worker-v1', 'GET', '/forbidden', 'failed', 500,
        'INTERNAL_ERROR', repeat('0', 64), clock_timestamp()
      )
    `)).rejects.toMatchObject({ code: '42501' })
    await expect(migrationPool.query('UPDATE relay_security_audit_events SET error_code = error_code'))
      .rejects.toMatchObject({ code: '55000' })
    await expect(migrationPool.query('DELETE FROM relay_security_audit_events'))
      .rejects.toMatchObject({ code: '55000' })
    await expect(migrationPool.query('TRUNCATE relay_security_audit_events'))
      .rejects.toMatchObject({ code: '55000' })
  })

  it('requires current membership and exact transaction-local tenant context', async () => {
    await expect(sessions.listActorOrganizations('rls-user-a')).resolves.toEqual([
      {
        id: 'rls-org-a',
        name: 'RLS Organization A',
        role: 'member',
        spaces: [{ id: 'rls-space-a', name: 'RLS Space A', role: 'member' }],
      },
    ])

    const unscoped = await apiPool.query<{ count: string }>('SELECT count(*)::text AS count FROM relay_sessions')
    expect(unscoped.rows[0]?.count).toBe('0')

    const visible = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-a', spaceId: 'rls-space-a', actorId: 'rls-user-a' },
      (client) => client.query<{ id: string }>('SELECT id FROM relay_sessions ORDER BY id'),
    )
    expect(visible.rows).toEqual([{ id: sessionA }])

    const spoofed = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-b', spaceId: 'rls-space-b', actorId: 'rls-user-a' },
      (client) => client.query<{ count: string }>('SELECT count(*)::text AS count FROM relay_sessions'),
    )
    expect(spoofed.rows[0]?.count).toBe('0')

    await expect(withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-a', spaceId: 'rls-space-a', actorId: 'rls-user-a' },
      (client) => client.query(`
        INSERT INTO relay_session_share_grants (
          organization_id, space_id, session_id, id, principal_type,
          principal_id, role, created_at, created_by
        ) VALUES (
          'rls-org-b', 'rls-space-b', $1, 'cross-tenant-grant', 'user',
          'rls-user-b', 'viewer', clock_timestamp(), 'rls-user-a'
        )
      `, [sessionB]),
    )).rejects.toMatchObject({ code: '42501' })

    await expect(withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-a', spaceId: 'rls-space-a', actorId: 'rls-user-a' },
      (client) => client.query(`
        UPDATE relay_organization_memberships
        SET role = 'viewer'
        WHERE organization_id = 'rls-org-a' AND actor_id = 'rls-user-a'
      `),
    )).rejects.toMatchObject({ code: '42501' })

    const afterRelease = await apiPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM relay_sessions',
    )
    expect(afterRelease.rows[0]?.count).toBe('0')
  })

  it('applies API runtime RLS to Artifact writes and reads', async () => {
    const created = await artifacts.create({
      organizationId: 'rls-org-a',
      spaceId: 'rls-space-a',
      sessionId: sessionA,
      actorId: 'rls-user-a',
      actorKind: 'user',
      requestId: 'rls-artifact-create',
      idempotencyKey: 'rls-artifact-key',
      request: {
        type: 'link',
        label: 'RLS evidence',
        url: 'https://evidence.example.com/rls/artifact',
        attributes: {},
      },
    })
    expect(created).toMatchObject({
      replayed: false,
      artifact: { organizationId: 'rls-org-a', sessionId: sessionA },
    })

    const unscoped = await apiPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM relay_artifacts',
    )
    expect(unscoped.rows[0]?.count).toBe('0')

    const visible = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-a', spaceId: 'rls-space-a', actorId: 'rls-user-a' },
      (client) => client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM relay_artifacts',
      ),
    )
    expect(visible.rows[0]?.count).toBe('1')

    const spoofed = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'rls-org-b', spaceId: 'rls-space-b', actorId: 'rls-user-a' },
      (client) => client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM relay_artifacts',
      ),
    )
    expect(spoofed.rows[0]?.count).toBe('0')
    await expect(artifacts.list(
      'rls-org-a', 'rls-space-a', sessionA, 'rls-user-b',
    )).resolves.toBeNull()
  })

  it('limits the Worker role to cross-tenant execution data', async () => {
    const claim = await execution.claimNext({ leaseOwner: 'rls-worker-1', leaseDurationMs: 30_000 })
    expect(claim).toMatchObject({
      organizationId: expect.stringMatching(/^rls-org-[ab]$/),
      sessionId: expect.any(String),
      attemptNumber: 1,
    })

    const sessionsVisible = await workerPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM relay_sessions',
    )
    expect(sessionsVisible.rows[0]?.count).toBe('2')

    const serviceAccountsVisible = await workerPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM relay_service_accounts',
    )
    expect(serviceAccountsVisible.rows[0]?.count).toBe('0')
    await expect(apiPool.query('SELECT * FROM relay_audit_events'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(workerPool.query(`
      UPDATE relay_messages SET actor_id = 'runtime-mutation'
      WHERE id = (SELECT id FROM relay_messages LIMIT 1)
    `)).rejects.toMatchObject({ code: '42501' })
  })
})
