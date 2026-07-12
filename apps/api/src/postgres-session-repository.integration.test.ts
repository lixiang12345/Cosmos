import type { CreateSessionRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { IdempotencyConflictError } from './session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

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

describeWithDatabase('PostgresSessionRepository', () => {
  const pool = new Pool({ connectionString: databaseUrl })

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query(`
      TRUNCATE relay_idempotency_responses, relay_idempotency_records, relay_sessions, relay_space_memberships,
        relay_organization_memberships, relay_spaces, relay_organizations CASCADE
    `)
    const spaces = [
      ['relay', 'space-commerce'], ['relay', 'space-platform'], ['relay', 'space-ordering'],
      ['relay', 'space-conflict'], ['relay', 'space-canonical'], ['relay', 'space-expiry'],
      ['relay', 'space-draft'],
      ['relay', 'space-rollback'],
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
  })

  afterAll(async () => {
    await pool.end()
  })

  it('persists Sessions and isolates list results by organization and Space', async () => {
    const repository = new PostgresSessionRepository(pool)
    const created = await repository.create({
      organizationId: 'relay', spaceId: 'space-commerce', actorId: 'user-local-admin', idempotencyKey: 'persist-1', request,
    })
    await repository.create({
      organizationId: 'other', spaceId: 'space-commerce', actorId: 'user-local-admin', idempotencyKey: 'persist-1', request,
    })

    const reconnectedRepository = new PostgresSessionRepository(pool)
    await expect(reconnectedRepository.listBySpace('relay', 'space-commerce', 'user-local-admin')).resolves.toEqual([created.session])
  })

  it('creates one Session when the same command arrives concurrently', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
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
      responses: string
    }>(`
      SELECT
        (SELECT count(*) FROM relay_messages WHERE session_id = $1) AS messages,
        (SELECT count(*) FROM relay_turns WHERE session_id = $1) AS turns,
        (SELECT count(*) FROM relay_commands WHERE session_id = $1) AS commands,
        (SELECT count(*) FROM relay_outbox_events WHERE session_id = $1) AS outbox_events,
        (SELECT count(*) FROM relay_idempotency_responses
          WHERE organization_id = $2 AND actor_id = $3
            AND canonical_path = '/v1/organizations/relay/spaces/space-platform/sessions') AS responses
    `, [results[0].session.id, record.organizationId, record.actorId])
    expect(executionRows.rows[0]).toEqual({
      messages: '1', turns: '1', commands: '1', outbox_events: '1', responses: '1',
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

  it('orders Sessions by most recent activity', async () => {
    let now = new Date('2026-07-12T12:00:00.000Z')
    const repository = new PostgresSessionRepository(pool, { now: () => now })
    const first = await repository.create({
      organizationId: 'relay', spaceId: 'space-ordering', actorId: 'user-local-admin', idempotencyKey: 'ordering-1', request,
    })

    now = new Date('2026-07-12T12:01:00.000Z')
    const second = await repository.create({
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

  it('keeps drafts out of the execution queue', async () => {
    const repository = new PostgresSessionRepository(pool)
    const result = await repository.create({
      organizationId: 'relay', spaceId: 'space-draft', actorId: 'user-local-admin',
      idempotencyKey: 'draft-only', request: { ...request, start: false },
    })

    expect(result).toMatchObject({ session: { status: 'draft' }, replayed: false })
    expect(result.message).toBeUndefined()
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
    expect(counts.rows[0]).toEqual({ messages: '0', turns: '0', commands: '0', outbox_events: '0' })
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
