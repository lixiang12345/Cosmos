import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ArtifactConflictError,
  ArtifactValidationError,
  ArtifactVersionConflictError,
} from './artifact-repository.js'
import { IdempotencyConflictError, AuthorizationChangedError } from './session-repository.js'
import { runMigrations } from './migrations.js'
import { PostgresArtifactRepository } from './postgres-artifact-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgresArtifactRepository', () => {
  const schema = `relay_artifact_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  let now = new Date('2026-07-13T01:00:00.000Z')
  let artifactSequence = 0
  const artifacts = new PostgresArtifactRepository(pool, {
    createId: () => `artifact-runtime-${++artifactSequence}`,
    now: () => new Date(now),
  })
  const timeline = new PostgresSessionTimelineRepository(pool)
  let sessionId = ''
  let turnId = ''

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO relay_organizations (id, name)
      VALUES ('artifact-org', 'Artifact Organization');
      INSERT INTO relay_spaces (organization_id, id, name)
      VALUES ('artifact-org', 'artifact-space', 'Artifact Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('artifact-org', 'artifact-owner', 'member'),
        ('artifact-org', 'artifact-reader', 'member'),
        ('artifact-org', 'artifact-manager', 'member'),
        ('artifact-org', 'artifact-shared', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('artifact-org', 'artifact-space', 'artifact-owner', 'member'),
        ('artifact-org', 'artifact-space', 'artifact-reader', 'member'),
        ('artifact-org', 'artifact-space', 'artifact-manager', 'space_manager'),
        ('artifact-org', 'artifact-space', 'artifact-shared', 'member');
    `)
    await seedSessionConfiguration(pool, 'artifact-org', 'artifact-space')
    const created = await new PostgresSessionRepository(pool, {
      createId: (() => {
        let next = 0
        return () => `artifact-session-${++next}`
      })(),
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    }).create({
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      actorId: 'artifact-owner',
      actorKind: 'user',
      requestId: 'artifact-session-create',
      idempotencyKey: 'artifact-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Private Artifact Session',
        visibility: 'private',
        start: true,
        message: { content: 'Prepare a production change.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('Artifact fixture requires a started Session.')
    sessionId = created.session.id
    turnId = created.turn.id
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  const createRecord = (overrides: Record<string, unknown> = {}) => ({
    organizationId: 'artifact-org',
    spaceId: 'artifact-space',
    sessionId,
    actorId: 'artifact-owner',
    actorKind: 'user' as const,
    requestId: 'artifact-create-request',
    idempotencyKey: 'artifact-create-key',
    request: {
      turnId,
      type: 'pull_request' as const,
      provider: 'github',
      externalId: 'relay/cosmos#42',
      label: 'Production checkout fix',
      url: 'https://github.com/relay/cosmos/pull/42',
      status: 'open',
      attributes: { draft: false, checks: 7 },
    },
    ...overrides,
  })

  it('conceals Private Sessions and validates the optional Turn reference transactionally', async () => {
    await expect(artifacts.list(
      'artifact-org', 'artifact-space', sessionId, 'artifact-reader',
    )).resolves.toBeNull()
    await expect(artifacts.create(createRecord({
      idempotencyKey: 'artifact-invalid-turn-key',
      request: { ...createRecord().request, turnId: 'missing-turn' },
    }))).rejects.toBeInstanceOf(ArtifactValidationError)

    const counts = await pool.query<{ artifacts: string; events: string }>(`
      SELECT
        (SELECT count(*)::text FROM relay_artifacts) AS artifacts,
        (SELECT count(*)::text FROM relay_session_events
          WHERE event_type LIKE 'artifact.%') AS events
    `)
    expect(counts.rows[0]).toEqual({ artifacts: '0', events: '0' })
  })

  it('creates exactly once, rejects key reuse and duplicate external identities', async () => {
    const created = await artifacts.create(createRecord())
    expect(created).toMatchObject({
      replayed: false,
      artifact: {
        sessionId,
        turnId,
        type: 'pull_request',
        provider: 'github',
        externalId: 'relay/cosmos#42',
        version: 1,
        removedAt: null,
      },
    })
    const replayed = await artifacts.create(createRecord())
    expect(replayed).toEqual({ artifact: created?.artifact, replayed: true })
    await expect(artifacts.create(createRecord({
      request: { ...createRecord().request, label: 'Different request' },
    }))).rejects.toBeInstanceOf(IdempotencyConflictError)
    await expect(artifacts.create(createRecord({
      idempotencyKey: 'artifact-duplicate-key',
      requestId: 'artifact-duplicate-request',
    }))).rejects.toBeInstanceOf(ArtifactConflictError)

    const list = await artifacts.list(
      'artifact-org', 'artifact-space', sessionId, 'artifact-owner',
      { type: 'pull_request', limit: 1 },
    )
    expect(list).toMatchObject({
      hasMore: false,
      nextCursor: null,
      items: [{ id: created?.artifact.id }],
    })
    await expect(artifacts.list(
      'artifact-org', 'artifact-space', sessionId, 'artifact-owner', { type: 'commit' },
    )).resolves.toMatchObject({ items: [] })
  })

  it('allows shared reads but reserves manual mutation for the creator or Space manager', async () => {
    await pool.query(`
      INSERT INTO relay_session_share_grants (
        organization_id, space_id, session_id, id, principal_type,
        principal_id, role, created_at, created_by
      ) VALUES (
        'artifact-org', 'artifact-space', $1, 'artifact-share', 'user',
        'artifact-shared', 'collaborator', $2, 'artifact-owner'
      )
    `, [sessionId, now.toISOString()])
    await expect(artifacts.list(
      'artifact-org', 'artifact-space', sessionId, 'artifact-shared',
    )).resolves.toMatchObject({ items: [{ type: 'pull_request' }] })
    await expect(artifacts.update({
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      sessionId,
      artifactId: 'artifact-runtime-1',
      actorId: 'artifact-shared',
      actorKind: 'user',
      requestId: 'artifact-shared-update',
      expectedVersion: 1,
      request: { label: 'Shared edit' },
    })).rejects.toBeInstanceOf(AuthorizationChangedError)
    await expect(artifacts.create(createRecord({
      actorId: 'artifact-manager',
      idempotencyKey: 'artifact-manager-private-key',
    }))).resolves.toBeNull()
  })

  it('uses CAS for updates, avoids no-op ledger noise, and projects redacted events', async () => {
    now = new Date('2026-07-13T01:01:00.000Z')
    await expect(artifacts.update({
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      sessionId,
      artifactId: 'artifact-runtime-1',
      actorId: 'artifact-owner',
      actorKind: 'user',
      requestId: 'artifact-stale-update',
      expectedVersion: 7,
      request: { status: 'merged' },
    })).rejects.toBeInstanceOf(ArtifactVersionConflictError)
    const updated = await artifacts.update({
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      sessionId,
      artifactId: 'artifact-runtime-1',
      actorId: 'artifact-owner',
      actorKind: 'user',
      requestId: 'artifact-update',
      expectedVersion: 1,
      request: { status: 'merged', attributes: { checks: 9 } },
    })
    expect(updated).toMatchObject({ status: 'merged', attributes: { checks: 9 }, version: 2 })
    const noOp = await artifacts.update({
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      sessionId,
      artifactId: 'artifact-runtime-1',
      actorId: 'artifact-owner',
      actorKind: 'user',
      requestId: 'artifact-noop',
      expectedVersion: 2,
      request: { status: 'merged' },
    })
    expect(noOp?.version).toBe(2)

    const events = await timeline.listEvents(
      'artifact-org', 'artifact-space', sessionId, 'artifact-owner',
    )
    expect(events?.items.slice(-2)).toMatchObject([
      { type: 'artifact.created', payload: { status: 'open', version: 1, removedAt: null } },
      { type: 'artifact.updated', payload: { status: 'merged', version: 2, removedAt: null } },
    ])
    expect(JSON.stringify(events)).not.toContain('github.com')
    expect(JSON.stringify(events)).not.toContain('checks')
  })

  it('soft-removes exactly once and makes removed rows immutable and unlistable', async () => {
    now = new Date('2026-07-13T01:02:00.000Z')
    const record = {
      organizationId: 'artifact-org',
      spaceId: 'artifact-space',
      sessionId,
      artifactId: 'artifact-runtime-1',
      actorId: 'artifact-owner',
      actorKind: 'user' as const,
      requestId: 'artifact-remove',
      idempotencyKey: 'artifact-remove-key',
      expectedVersion: 2,
    }
    const removed = await artifacts.remove(record)
    expect(removed).toMatchObject({
      replayed: false,
      artifact: { version: 3, removedAt: now.toISOString() },
    })
    await expect(artifacts.remove(record)).resolves.toEqual({
      artifact: removed?.artifact,
      replayed: true,
    })
    await expect(artifacts.list(
      'artifact-org', 'artifact-space', sessionId, 'artifact-owner',
    )).resolves.toMatchObject({ items: [] })
    await expect(pool.query(`
      UPDATE relay_artifacts SET label = 'Forbidden', version = version + 1
      WHERE organization_id = 'artifact-org' AND space_id = 'artifact-space'
        AND session_id = $1 AND id = 'artifact-runtime-1'
    `, [sessionId])).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query(`
      DELETE FROM relay_artifacts
      WHERE organization_id = 'artifact-org' AND space_id = 'artifact-space'
        AND session_id = $1 AND id = 'artifact-runtime-1'
    `, [sessionId])).rejects.toMatchObject({ code: '55000' })
  })

  it('commits one redacted Event, AuditEvent, and Outbox row per actual mutation', async () => {
    const rows = await pool.query<{
      event_count: string
      audit_count: string
      outbox_count: string
      event_payloads: unknown
      audit_states: unknown
      outbox_payloads: unknown
    }>(`
      SELECT
        (SELECT count(*)::text FROM relay_session_events
          WHERE event_type LIKE 'artifact.%') AS event_count,
        (SELECT count(*)::text FROM relay_audit_events
          WHERE action LIKE 'artifact.%') AS audit_count,
        (SELECT count(*)::text FROM relay_outbox_events
          WHERE aggregate_type = 'artifact') AS outbox_count,
        (SELECT jsonb_agg(payload ORDER BY occurred_at) FROM relay_session_events
          WHERE event_type LIKE 'artifact.%') AS event_payloads,
        (SELECT jsonb_agg(after_state ORDER BY occurred_at) FROM relay_audit_events
          WHERE action LIKE 'artifact.%') AS audit_states,
        (SELECT jsonb_agg(payload ORDER BY occurred_at) FROM relay_outbox_events
          WHERE aggregate_type = 'artifact') AS outbox_payloads
    `)
    expect(rows.rows[0]).toMatchObject({
      event_count: '3',
      audit_count: '3',
      outbox_count: '3',
    })
    const serialized = JSON.stringify(rows.rows[0])
    expect(serialized).not.toContain('github.com')
    expect(serialized).not.toContain('relay/cosmos#42')
    expect(serialized).not.toContain('checks')
    expect(serialized).toContain('artifact-runtime-1')
  })
})
