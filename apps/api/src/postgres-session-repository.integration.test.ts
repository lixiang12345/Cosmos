import type { CreateSessionRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration, type SeededSessionConfiguration } from './session-configuration-test-fixture.js'
import {
  AuthorizationChangedError,
  EnvironmentNotReadyError,
  ExpertNotPublishedError,
  IdempotencyConflictError,
  SessionConfigurationNotFoundError,
  SessionConfigurationValidationError,
} from './session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

async function waitForBlockedApplication(pool: Pool, applicationName: string, blockerPid: number) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const result = await pool.query(`
      SELECT 1
      FROM pg_stat_activity
      WHERE application_name = $1 AND $2 = ANY(pg_blocking_pids(pid))
    `, [applicationName, blockerPid])
    if (result.rowCount) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${applicationName} to block on the membership lock.`)
}

const request: CreateSessionRequest = {
  title: 'Persist the checkout Session',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 2,
  environmentId: 'environment-commerce',
  repository: 'commerce/checkout',
  baseBranch: 'main',
  visibility: 'private',
  start: true,
  message: { content: 'Verify persistence and concurrent idempotency.', attachments: [] },
}

const auditContext = {
  actorKind: 'user' as const,
  requestId: 'postgres-session-repository-integration',
}

describeWithDatabase('PostgresSessionRepository', () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const configurations = new Map<string, SeededSessionConfiguration>()

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query(`
      ALTER TABLE relay_session_events DISABLE TRIGGER relay_session_events_reject_truncate;
      ALTER TABLE relay_audit_events DISABLE TRIGGER relay_audit_events_reject_truncate;
      ALTER TABLE relay_attempts DISABLE TRIGGER relay_attempts_reject_truncate;
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
      `)
    }
    const spaces = [
      ['relay', 'space-commerce'], ['relay', 'space-platform'], ['relay', 'space-ordering'],
      ['relay', 'space-conflict'], ['relay', 'space-canonical'], ['relay', 'space-expiry'],
      ['relay', 'space-draft'],
      ['relay', 'space-rollback'],
      ['relay', 'space-policy'],
      ['relay', 'space-private-expert'],
      ['relay', 'space-revision-pin'],
      ['relay', 'space-role-cap'],
      ['relay', 'space-role-recheck'],
      ['other', 'space-commerce'],
    ]
    for (const [organizationId, spaceId] of spaces) {
      await pool.query('INSERT INTO relay_organizations (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [organizationId])
      await pool.query('INSERT INTO relay_spaces (organization_id, id, name) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING', [organizationId, spaceId])
      await pool.query(`
        INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
        VALUES ($1, 'user-local-admin', 'organization_owner') ON CONFLICT DO NOTHING
      `, [organizationId])
      await pool.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ($1, $2, 'user-local-admin', 'space_manager') ON CONFLICT DO NOTHING
      `, [organizationId, spaceId])
    }
    await pool.query(`
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('relay', 'user-capped', 'viewer'),
        ('relay', 'user-recheck', 'member'),
        ('relay', 'user-expert-owner', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('relay', 'space-role-cap', 'user-capped', 'space_manager'),
        ('relay', 'space-role-recheck', 'user-recheck', 'member'),
        ('relay', 'space-private-expert', 'user-expert-owner', 'member');
    `)
    for (const [organizationId, spaceId] of spaces) {
      const configurationOptions = spaceId === 'space-policy'
        ? { allowRepositoryOverride: false, allowBaseBranchOverride: false }
        : spaceId === 'space-private-expert'
          ? { expertVisibility: 'private' as const, expertCreatedBy: 'user-expert-owner' }
          : {}
      configurations.set(
        `${organizationId}/${spaceId}`,
        await seedSessionConfiguration(pool, organizationId, spaceId, configurationOptions),
      )
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  it('discovers actual memberships with stable Organization and Space ordering', async () => {
    await pool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('discovery-a', 'Discovery Z'), ('discovery-z', 'Discovery A');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('discovery-z', 'space-a', 'Space Z'), ('discovery-z', 'space-z', 'Space A'),
        ('discovery-z', 'space-hidden', 'Hidden Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('discovery-a', 'discovery-user', 'viewer'),
        ('discovery-z', 'discovery-user', 'organization_admin');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('discovery-z', 'space-a', 'discovery-user', 'viewer'),
        ('discovery-z', 'space-z', 'discovery-user', 'space_manager');
    `)
    const repository = new PostgresSessionRepository(pool)

    await expect(repository.listActorOrganizations('discovery-user')).resolves.toEqual([
      {
        id: 'discovery-z', name: 'Discovery A', role: 'organization_admin',
        spaces: [
          { id: 'space-z', name: 'Space A', role: 'space_manager' },
          { id: 'space-a', name: 'Space Z', role: 'viewer' },
        ],
      },
      { id: 'discovery-a', name: 'Discovery Z', role: 'viewer', spaces: [] },
    ])
    await expect(repository.listActorOrganizations('missing-user')).resolves.toEqual([])
  })

  it('persists Sessions and isolates list results by organization and Space', async () => {
    const repository = new PostgresSessionRepository(pool)
    const created = await repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-commerce', actorId: 'user-local-admin', idempotencyKey: 'persist-1', request,
    })
    await repository.create({
      ...auditContext,
      organizationId: 'other', spaceId: 'space-commerce', actorId: 'user-local-admin', idempotencyKey: 'persist-1', request,
    })

    const reconnectedRepository = new PostgresSessionRepository(pool)
    await expect(reconnectedRepository.listBySpace('relay', 'space-commerce', 'user-local-admin')).resolves.toEqual([created.session])
    expect(created.session).toMatchObject({
      expertName: 'Authoritative PR Author',
      expertVersion: 1,
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-1',
      environmentId: 'environment-default',
      environmentRevisionId: 'environment-revision-1',
      repositoryId: 'repository-default',
      repository: 'commerce/checkout',
      baseBranch: 'main',
    })
  })

  it('persists only locked server configuration and includes its revision pins in execution payloads', async () => {
    const repository = new PostgresSessionRepository(pool)
    const result = await repository.create({
      ...auditContext,
      organizationId: 'relay',
      spaceId: 'space-commerce',
      actorId: 'user-local-admin',
      idempotencyKey: 'forged-compatibility-fields',
      request: {
        ...request,
        title: 'Authoritative configuration proof',
        expertName: 'Forged Expert',
        expertVersion: 999,
        environmentId: 'forged-environment',
        repository: 'forged/repository',
        advancedOverrides: { repositoryId: 'repository-default' },
      },
    })
    expect(result.session).toMatchObject({
      expertName: 'Authoritative PR Author',
      expertVersion: 1,
      environmentId: 'environment-default',
      repository: 'commerce/checkout',
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-1',
      environmentRevisionId: 'environment-revision-1',
      repositoryId: 'repository-default',
    })

    const payloads = await pool.query<{
      command_payload: unknown
      outbox_payload: unknown
      protocol_version: number
      requested_by: string
      request_id: string
      max_attempts: number
    }>(`
      SELECT command.payload AS command_payload, outbox.payload AS outbox_payload,
        command.protocol_version, command.requested_by, command.request_id,
        command.max_attempts
      FROM relay_commands command
      JOIN relay_outbox_events outbox ON outbox.session_id = command.session_id
      WHERE command.session_id = $1
    `, [result.session.id])
    expect(payloads.rows[0].command_payload).toMatchObject({
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-1',
      environmentRevisionId: 'environment-revision-1',
      repositoryId: 'repository-default',
    })
    expect(payloads.rows[0].outbox_payload).toMatchObject({
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-1',
      environmentRevisionId: 'environment-revision-1',
      repositoryId: 'repository-default',
    })
    expect(payloads.rows[0]).toMatchObject({
      protocol_version: 1,
      requested_by: 'user-local-admin',
      request_id: auditContext.requestId,
      max_attempts: 5,
    })
  })

  it('conceals unknown repository selectors and rejects forbidden branch overrides', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId: 'relay',
      spaceId: 'space-commerce',
      actorId: 'user-local-admin',
      request,
    }

    await expect(repository.create({
      ...record,
      idempotencyKey: 'unknown-repository-selector',
      request: { ...request, advancedOverrides: { repositoryId: 'repository-unknown' } },
    })).rejects.toBeInstanceOf(SessionConfigurationNotFoundError)
    await expect(repository.create({
      ...record,
      spaceId: 'space-policy',
      idempotencyKey: 'forbidden-base-branch',
      request: { ...request, baseBranch: undefined, advancedOverrides: { baseBranch: 'release' } },
    })).rejects.toBeInstanceOf(SessionConfigurationValidationError)
  })

  it('conceals a private Expert from a noncreator before creating idempotency state', async () => {
    const repository = new PostgresSessionRepository(pool)
    await expect(repository.create({
      ...auditContext,
      organizationId: 'relay',
      spaceId: 'space-private-expert',
      actorId: 'user-local-admin',
      idempotencyKey: 'private-expert-concealment',
      request,
    })).rejects.toBeInstanceOf(SessionConfigurationNotFoundError)

    const counts = await pool.query<{ sessions: string; idempotency_records: string }>(`
      SELECT
        (SELECT count(*) FROM relay_sessions
          WHERE organization_id = 'relay' AND space_id = 'space-private-expert') AS sessions,
        (SELECT count(*) FROM relay_idempotency_records
          WHERE organization_id = 'relay' AND space_id = 'space-private-expert') AS idempotency_records
    `)
    expect(counts.rows[0]).toEqual({ sessions: '0', idempotency_records: '0' })
  })

  it('rolls back when the published Expert or its pinned Environment becomes unavailable', async () => {
    const repository = new PostgresSessionRepository(pool)
    await pool.query(`
      UPDATE relay_experts SET status = 'disabled'
      WHERE organization_id = 'relay' AND space_id = 'space-role-cap' AND id = 'expert-pr-author'
    `)
    try {
      await expect(repository.create({
        ...auditContext,
        organizationId: 'relay', spaceId: 'space-role-cap', actorId: 'user-local-admin',
        idempotencyKey: 'disabled-expert-rollback', request,
      })).rejects.toBeInstanceOf(ExpertNotPublishedError)
    } finally {
      await pool.query(`
        UPDATE relay_experts SET status = 'published'
        WHERE organization_id = 'relay' AND space_id = 'space-role-cap' AND id = 'expert-pr-author'
      `)
    }

    await pool.query(`
      UPDATE relay_environments SET status = 'disabled'
      WHERE organization_id = 'relay' AND space_id = 'space-role-recheck' AND id = 'environment-default'
    `)
    try {
      await expect(repository.create({
        ...auditContext,
        organizationId: 'relay', spaceId: 'space-role-recheck', actorId: 'user-local-admin',
        idempotencyKey: 'disabled-environment-rollback', request,
      })).rejects.toBeInstanceOf(EnvironmentNotReadyError)
    } finally {
      await pool.query(`
        UPDATE relay_environments SET status = 'ready'
        WHERE organization_id = 'relay' AND space_id = 'space-role-recheck' AND id = 'environment-default'
      `)
    }

    const counts = await pool.query<{
      sessions: string
      idempotency_records: string
      idempotency_responses: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_sessions
          WHERE organization_id = 'relay' AND space_id IN ('space-role-cap', 'space-role-recheck')) AS sessions,
        (SELECT count(*) FROM relay_idempotency_records
          WHERE organization_id = 'relay' AND space_id IN ('space-role-cap', 'space-role-recheck')) AS idempotency_records,
        (SELECT count(*) FROM relay_idempotency_responses
          WHERE organization_id = 'relay'
            AND canonical_path IN (
              '/v1/organizations/relay/spaces/space-role-cap/sessions',
              '/v1/organizations/relay/spaces/space-role-recheck/sessions'
            )) AS idempotency_responses
    `)
    expect(counts.rows[0]).toEqual({
      sessions: '0', idempotency_records: '0', idempotency_responses: '0',
    })
  })

  it('replays the original pinned revisions after the Expert publishes a newer configuration', async () => {
    const organizationId = 'relay'
    const spaceId = 'space-revision-pin'
    const configuration = configurations.get(`${organizationId}/${spaceId}`)
    if (!configuration) throw new Error('Expected an authoritative test configuration.')
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId,
      spaceId,
      actorId: 'user-local-admin',
      idempotencyKey: 'revision-pinning',
      request,
    }
    const first = await repository.create(record)

    await pool.query(`
      INSERT INTO relay_environment_revisions (
        organization_id, space_id, environment_id, id, revision, status, created_by
      ) VALUES ($1, $2, $3, 'environment-revision-2', 2, 'draft', 'system:test-fixture')
    `, [organizationId, spaceId, configuration.environmentId])
    await pool.query(`
      INSERT INTO relay_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES ($1, $2, $3, 'environment-revision-2', 'repository-v2', $4, 'main', true)
    `, [organizationId, spaceId, configuration.environmentId, configuration.repository])
    await pool.query(`
      UPDATE relay_environment_revisions SET status = 'ready'
      WHERE organization_id = $1 AND space_id = $2
        AND environment_id = $3 AND id = 'environment-revision-2'
    `, [organizationId, spaceId, configuration.environmentId])
    await pool.query(`
      UPDATE relay_environments SET active_revision_id = 'environment-revision-2'
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [organizationId, spaceId, configuration.environmentId])
    await pool.query(`
      INSERT INTO relay_expert_revisions (
        organization_id, space_id, expert_id, id, revision, status,
        environment_id, environment_revision_id, created_by
      ) VALUES ($1, $2, $3, 'expert-revision-2', 2, 'draft', $4, 'environment-revision-2', 'system:test-fixture')
    `, [organizationId, spaceId, configuration.expertId, configuration.environmentId])
    await pool.query(`
      UPDATE relay_expert_revisions SET status = 'published'
      WHERE organization_id = $1 AND space_id = $2
        AND expert_id = $3 AND id = 'expert-revision-2'
    `, [organizationId, spaceId, configuration.expertId])
    await pool.query(`
      UPDATE relay_experts SET published_revision_id = 'expert-revision-2'
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [organizationId, spaceId, configuration.expertId])

    const replay = await repository.create(record)
    const next = await repository.create({ ...record, idempotencyKey: 'revision-pinning-next' })

    expect(replay).toEqual({ ...first, replayed: true })
    expect(replay.session).toMatchObject({
      expertRevisionId: 'expert-revision-1',
      environmentRevisionId: 'environment-revision-1',
      repositoryId: 'repository-default',
    })
    expect(next.session).toMatchObject({
      expertVersion: 2,
      expertRevisionId: 'expert-revision-2',
      environmentRevisionId: 'environment-revision-2',
      repositoryId: 'repository-v2',
    })
  })

  it('rechecks membership inside the list query after access is revoked', async () => {
    const repository = new PostgresSessionRepository(pool)
    const created = await repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-commerce', actorId: 'user-local-admin',
      idempotencyKey: 'revocation-list-1', request: { ...request, title: 'Revocation proof' },
    })
    expect((await repository.listBySpace('relay', 'space-commerce', 'user-local-admin'))
      .some((session) => session.id === created.session.id)).toBe(true)

    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = 'relay' AND space_id = 'space-commerce' AND actor_id = 'user-local-admin'
    `)
    await expect(repository.listBySpace('relay', 'space-commerce', 'user-local-admin')).resolves.toEqual([])
    await pool.query(`
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('relay', 'space-commerce', 'user-local-admin', 'space_manager')
    `)
  })

  it('creates one Session when the same command arrives concurrently', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-platform', actorId: 'user-local-admin', idempotencyKey: 'concurrent-command', request,
    }

    const results = await Promise.all(Array.from({ length: 6 }, () => repository.create(record)))
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1)
    expect(results.filter((result) => result.replayed)).toHaveLength(5)
    expect(results.every((result) => result.session.status === 'queued')).toBe(true)
    expect(results.every((result) => result.message?.id === results[0].message?.id)).toBe(true)
    expect(results.every((result) => result.turn?.id === results[0].turn?.id)).toBe(true)
    expect(results.every((result) => result.command?.id === results[0].command?.id)).toBe(true)
    await expect(repository.listBySpace('relay', 'space-platform', 'user-local-admin')).resolves.toHaveLength(1)

    const executionRows = await pool.query<{
      messages: string
      turns: string
      commands: string
      outbox_events: string
      session_events: string
      audit_events: string
      responses: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_messages WHERE session_id = $1) AS messages,
        (SELECT count(*) FROM relay_turns WHERE session_id = $1) AS turns,
        (SELECT count(*) FROM relay_commands WHERE session_id = $1) AS commands,
        (SELECT count(*) FROM relay_outbox_events WHERE session_id = $1) AS outbox_events,
        (SELECT count(*) FROM relay_session_events WHERE session_id = $1) AS session_events,
        (SELECT count(*) FROM relay_audit_events WHERE session_id = $1) AS audit_events,
        (SELECT count(*) FROM relay_idempotency_responses
          WHERE organization_id = $2 AND actor_id = $3
            AND canonical_path = '/v1/organizations/relay/spaces/space-platform/sessions') AS responses
    `, [results[0].session.id, record.organizationId, record.actorId])
    expect(executionRows.rows[0]).toEqual({
      messages: '1', turns: '1', commands: '1', outbox_events: '1',
      session_events: '3', audit_events: '1', responses: '1',
    })

    const persistedKeys = await pool.query<{
      idempotency_key_hash: string
    }>(`
      SELECT idempotency_key_hash
      FROM relay_idempotency_records
      WHERE organization_id = $1 AND space_id = $2
    `, [record.organizationId, record.spaceId])
    expect(persistedKeys.rows).toHaveLength(1)
    expect(persistedKeys.rows[0].idempotency_key_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(persistedKeys.rows[0].idempotency_key_hash).not.toBe(record.idempotencyKey)
  })

  it('intersects Organization and Space roles when creating a Session', async () => {
    const repository = new PostgresSessionRepository(pool)

    await expect(repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-role-cap', actorId: 'user-capped',
      idempotencyKey: 'organization-viewer-create', request,
    })).rejects.toBeInstanceOf(AuthorizationChangedError)
    await expect(repository.listBySpace('relay', 'space-role-cap', 'user-capped')).resolves.toEqual([])
  })

  it('rechecks both membership roles inside the create transaction', async () => {
    const repository = new PostgresSessionRepository(pool)
    await expect(repository.getSpaceAccess('relay', 'space-role-recheck', 'user-recheck')).resolves.toEqual({
      organizationRole: 'member', spaceRole: 'member',
    })

    await pool.query(`
      UPDATE relay_organization_memberships SET role = 'viewer'
      WHERE organization_id = 'relay' AND actor_id = 'user-recheck'
    `)

    await expect(repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-role-recheck', actorId: 'user-recheck',
      idempotencyKey: 'role-downgraded-before-create', request,
    })).rejects.toBeInstanceOf(AuthorizationChangedError)
  })

  it('rejects creation when an Organization downgrade commits while authorization waits', async () => {
    const organizationId = 'role-race-organization'
    const spaceId = 'role-race-space'
    const actorId = 'role-race-user'
    const applicationName = 'relay-role-downgrade-race-test'
    await pool.query(
      "INSERT INTO relay_organizations (id, name) VALUES ($1, 'Role race Organization')",
      [organizationId],
    )
    await pool.query(
      "INSERT INTO relay_spaces (organization_id, id, name) VALUES ($1, $2, 'Role race Space')",
      [organizationId, spaceId],
    )
    await pool.query(`
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES ($1, $2, 'member')
    `, [organizationId, actorId])
    await pool.query(`
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ($1, $2, $3, 'space_manager')
    `, [organizationId, spaceId, actorId])

    const downgradeClient = await pool.connect()
    const createPool = new Pool({ connectionString: databaseUrl, max: 1, application_name: applicationName })
    const repository = new PostgresSessionRepository(createPool)
    let downgradeTransactionOpen = false
    let creation: ReturnType<PostgresSessionRepository['create']> | undefined
    try {
      await downgradeClient.query('BEGIN')
      downgradeTransactionOpen = true
      const blockerPid = (await downgradeClient.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )).rows[0].pid
      await downgradeClient.query(`
        UPDATE relay_organization_memberships SET role = 'viewer'
        WHERE organization_id = $1 AND actor_id = $2
      `, [organizationId, actorId])

      creation = repository.create({
        ...auditContext,
        organizationId,
        spaceId,
        actorId,
        idempotencyKey: 'concurrent-role-downgrade',
        request,
      })
      void creation.catch(() => undefined)
      await waitForBlockedApplication(pool, applicationName, blockerPid)
      await downgradeClient.query('COMMIT')
      downgradeTransactionOpen = false

      await expect(creation).rejects.toBeInstanceOf(AuthorizationChangedError)
      const counts = await pool.query(`
        SELECT
          (SELECT count(*) FROM relay_sessions
            WHERE organization_id = $1 AND space_id = $2 AND created_by = $3) AS sessions,
          (SELECT count(*) FROM relay_idempotency_records
            WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3) AS idempotency_records
      `, [organizationId, spaceId, actorId])
      expect(counts.rows[0]).toEqual({ sessions: '0', idempotency_records: '0' })
    } finally {
      if (downgradeTransactionOpen) await downgradeClient.query('ROLLBACK')
      downgradeClient.release()
      await creation?.catch(() => undefined)
      await createPool.end()
    }
  })

  it('orders Sessions by most recent activity', async () => {
    let now = new Date('2026-07-12T12:00:00.000Z')
    const repository = new PostgresSessionRepository(pool, { now: () => now })
    const first = await repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-ordering', actorId: 'user-local-admin', idempotencyKey: 'ordering-1', request,
    })

    now = new Date('2026-07-12T12:01:00.000Z')
    const second = await repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-ordering', actorId: 'user-local-admin', idempotencyKey: 'ordering-2', request,
    })

    await expect(repository.listBySpace('relay', 'space-ordering', 'user-local-admin')).resolves.toEqual([
      second.session,
      first.session,
    ])
  })

  it('rejects a different request that reuses the same idempotency key', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-conflict', actorId: 'user-local-admin', idempotencyKey: 'conflicting-command', request,
    }
    await repository.create(record)
    await expect(repository.create({
      ...record, request: { ...request, title: 'A different request' },
    })).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('replays semantically identical requests regardless of object key order', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-canonical', actorId: 'user-local-admin', idempotencyKey: 'canonical-command', request,
    }
    const first = await repository.create(record)
    const reorderedRequest: CreateSessionRequest = {
      message: {
        attachments: [...request.message.attachments],
        content: request.message.content,
      },
      start: request.start,
      visibility: request.visibility,
      baseBranch: request.baseBranch,
      repository: request.repository,
      environmentId: request.environmentId,
      expertVersion: request.expertVersion,
      expertName: request.expertName,
      expertId: request.expertId,
      title: request.title,
    }
    const replay = await repository.create({ ...record, request: reorderedRequest })

    expect(replay).toEqual({ ...first, replayed: true })
    await expect(repository.listBySpace('relay', 'space-canonical', 'user-local-admin')).resolves.toHaveLength(1)
  })

  it('allows a key to create a new Session after its idempotency window expires', async () => {
    let now = new Date('2026-07-12T12:00:00.000Z')
    const repository = new PostgresSessionRepository(pool, {
      now: () => now,
      idempotencyTtlMs: 1_000,
    })
    const record = {
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-expiry', actorId: 'user-local-admin', idempotencyKey: 'expiring-command', request,
    }
    const first = await repository.create(record)

    now = new Date('2026-07-12T12:00:02.000Z')
    const afterExpiry = await repository.create({
      ...record, request: { ...request, title: 'A command after expiry' },
    })

    expect(afterExpiry.replayed).toBe(false)
    expect(afterExpiry.session.id).not.toBe(first.session.id)
    await expect(repository.listBySpace('relay', 'space-expiry', 'user-local-admin')).resolves.toHaveLength(2)
  })

  it('starts a draft from its persisted first Message without duplicating queue records', async () => {
    const repository = new PostgresSessionRepository(pool)
    const result = await repository.create({
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-draft', actorId: 'user-local-admin',
      idempotencyKey: 'draft-only', request: { ...request, start: false },
    })

    expect(result).toMatchObject({ session: { status: 'draft' }, replayed: false })
    expect(result.message).toMatchObject({
      sessionId: result.session.id,
      sequence: 1,
      role: 'user',
      content: request.message.content,
    })
    expect(result.turn).toBeUndefined()
    expect(result.command).toBeUndefined()
    const counts = await pool.query<{
      messages: string
      turns: string
      commands: string
      outbox_events: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_messages WHERE session_id = $1) AS messages,
        (SELECT count(*) FROM relay_turns WHERE session_id = $1) AS turns,
        (SELECT count(*) FROM relay_commands WHERE session_id = $1) AS commands,
        (SELECT count(*) FROM relay_outbox_events WHERE session_id = $1) AS outbox_events
    `, [result.session.id])
    expect(counts.rows[0]).toEqual({ messages: '1', turns: '0', commands: '0', outbox_events: '0' })

    const startRecord = {
      ...auditContext,
      organizationId: 'relay',
      spaceId: 'space-draft',
      sessionId: result.session.id,
      actorId: 'user-local-admin',
      idempotencyKey: 'start-draft-only',
      expectedVersion: 1,
      executionAvailability: 'available' as const,
    }
    const started = await repository.start(startRecord)
    const replay = await repository.start(startRecord)

    expect(started).toMatchObject({
      session: { id: result.session.id, status: 'queued', version: 2 },
      turn: { inputMessageId: result.message?.id, ordinal: 1, status: 'queued' },
      command: { type: 'session.start', status: 'accepted' },
      replayed: false,
    })
    expect(replay).toEqual({ ...started, replayed: true })
    const startedCounts = await pool.query<{
      messages: string
      turns: string
      commands: string
      outbox_events: string
      session_events: string
      audit_events: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_messages WHERE session_id = $1) AS messages,
        (SELECT count(*) FROM relay_turns WHERE session_id = $1) AS turns,
        (SELECT count(*) FROM relay_commands WHERE session_id = $1) AS commands,
        (SELECT count(*) FROM relay_outbox_events WHERE session_id = $1) AS outbox_events,
        (SELECT count(*) FROM relay_session_events WHERE session_id = $1) AS session_events,
        (SELECT count(*) FROM relay_audit_events WHERE session_id = $1) AS audit_events
    `, [result.session.id])
    expect(startedCounts.rows[0]).toEqual({
      messages: '1', turns: '1', commands: '1', outbox_events: '1',
      session_events: '4', audit_events: '2',
    })
    const ledger = await pool.query<{ action: string; before_state: unknown }>(`
      SELECT action, before_state
      FROM relay_audit_events
      WHERE session_id = $1
      ORDER BY action
    `, [result.session.id])
    expect(ledger.rows).toEqual([
      { action: 'session.create', before_state: null },
      { action: 'session.start', before_state: { status: 'draft', version: 1 } },
    ])
  })

  it('rolls back every domain and idempotency row when command creation fails', async () => {
    await pool.query(`
      CREATE FUNCTION relay_test_reject_command() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected command failure';
      END;
      $$;
      CREATE TRIGGER relay_test_reject_command
      BEFORE INSERT ON relay_commands
      FOR EACH ROW EXECUTE FUNCTION relay_test_reject_command();
    `)
    const repository = new PostgresSessionRepository(pool)
    const record = {
      ...auditContext,
      organizationId: 'relay', spaceId: 'space-rollback', actorId: 'user-local-admin',
      idempotencyKey: 'rollback-command', request: { ...request, title: 'Rollback proof' },
    }
    try {
      await expect(repository.create(record)).rejects.toThrow('injected command failure')
    } finally {
      await pool.query(`
        DROP TRIGGER relay_test_reject_command ON relay_commands;
        DROP FUNCTION relay_test_reject_command();
      `)
    }

    const counts = await pool.query<{
      sessions: string
      messages: string
      turns: string
      commands: string
      outbox_events: string
      idempotency_records: string
      idempotency_responses: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_sessions WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS sessions,
        (SELECT count(*) FROM relay_messages WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS messages,
        (SELECT count(*) FROM relay_turns WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS turns,
        (SELECT count(*) FROM relay_commands WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS commands,
        (SELECT count(*) FROM relay_outbox_events WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS outbox_events,
        (SELECT count(*) FROM relay_idempotency_records WHERE organization_id = 'relay' AND space_id = 'space-rollback') AS idempotency_records,
        (SELECT count(*) FROM relay_idempotency_responses
          WHERE organization_id = 'relay'
            AND canonical_path = '/v1/organizations/relay/spaces/space-rollback/sessions') AS idempotency_responses
    `)
    expect(counts.rows[0]).toEqual({
      sessions: '0', messages: '0', turns: '0', commands: '0', outbox_events: '0',
      idempotency_records: '0', idempotency_responses: '0',
    })
  })
})
