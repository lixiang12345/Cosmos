import type { CreateSessionRequest } from '@cosmos/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import type { CreateSessionRecord } from './session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

const request: CreateSessionRequest = {
  title: 'Ledger proof title',
  expertId: 'expert-pr-author',
  visibility: 'private',
  start: true,
  message: {
    content: 'PROMPT_SENTINEL must never enter a ledger payload.',
    attachments: ['ATTACHMENT_SENTINEL.txt'],
  },
}

function createRecord(overrides: Partial<CreateSessionRecord> = {}): CreateSessionRecord {
  return {
    organizationId: 'ledger-organization',
    spaceId: 'ledger-space',
    actorId: 'ledger-user',
    actorKind: 'user',
    requestId: 'ledger-request',
    idempotencyKey: 'PLAINTEXT_IDEMPOTENCY_SENTINEL',
    request,
    ...overrides,
  }
}

describeWithDatabase('Session creation ledgers', () => {
  const schema = `cosmos_session_ledger_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO cosmos_organizations (id, name)
      VALUES ('ledger-organization', 'Ledger Organization');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('ledger-organization', 'ledger-space', 'Ledger Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES ('ledger-organization', 'ledger-user', 'organization_admin');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('ledger-organization', 'ledger-space', 'ledger-user', 'space_manager');
    `)
    await seedSessionConfiguration(pool, 'ledger-organization', 'ledger-space')
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('writes one redacted, contiguous success ledger and does not duplicate it on replay', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = createRecord()
    const created = await repository.create(record)
    const replayed = await repository.create(record)

    expect(replayed).toEqual({ ...created, replayed: true })
    const events = await pool.query<{
      sequence: string
      event_type: string
      resource_type: string
      resource_id: string
      actor_kind: string
      request_id: string
      command_id: string | null
      payload: unknown
    }>(`
      SELECT sequence, event_type, resource_type, resource_id, actor_kind,
        request_id, command_id, payload
      FROM cosmos_session_events
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
      ORDER BY sequence
    `, [record.organizationId, record.spaceId, created.session.id])
    expect(events.rows).toEqual([
      expect.objectContaining({ sequence: '1', event_type: 'session.created', resource_type: 'session' }),
      expect.objectContaining({ sequence: '2', event_type: 'message.created', resource_type: 'message' }),
      expect.objectContaining({ sequence: '3', event_type: 'turn.queued', resource_type: 'turn' }),
    ])
    expect(new Set(events.rows.map((event) => event.command_id))).toEqual(new Set([created.command?.id]))
    expect(events.rows.every((event) => event.actor_kind === 'user')).toBe(true)
    expect(events.rows.every((event) => event.request_id === record.requestId)).toBe(true)

    const audits = await pool.query<{
      action: string
      result: string
      policy_decision: string
      idempotency_key_hash: string
      after_state: unknown
    }>(`
      SELECT action, result, policy_decision, idempotency_key_hash, after_state
      FROM cosmos_audit_events
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
    `, [record.organizationId, record.spaceId, created.session.id])
    expect(audits.rows).toEqual([
      expect.objectContaining({
        action: 'session.create', result: 'success', policy_decision: 'allow',
        after_state: { status: 'queued', visibility: 'private', version: 1, executionQueued: true },
      }),
    ])
    expect(audits.rows[0].idempotency_key_hash).toMatch(/^[a-f0-9]{64}$/)

    const sessionSequence = await pool.query<{ last_event_sequence: string }>(`
      SELECT last_event_sequence FROM cosmos_sessions
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [record.organizationId, record.spaceId, created.session.id])
    expect(sessionSequence.rows[0].last_event_sequence).toBe('3')

    const serialized = JSON.stringify({ events: events.rows, audits: audits.rows })
    for (const secret of [
      'PROMPT_SENTINEL',
      'ATTACHMENT_SENTINEL',
      'PLAINTEXT_IDEMPOTENCY_SENTINEL',
      'Bearer ',
      'access-token',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('records a draft and its Message without inventing execution facts', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = createRecord({
      requestId: 'ledger-draft-request',
      idempotencyKey: 'ledger-draft-key',
      request: { ...request, start: false },
    })
    const created = await repository.create(record)
    const facts = await pool.query<{
      event_types: string[]
      audit_events: string
      turns: string
      commands: string
      outbox_events: string
      last_event_sequence: string
    }>(`
      SELECT
        ARRAY(SELECT event_type FROM cosmos_session_events
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          ORDER BY sequence) AS event_types,
        (SELECT count(*) FROM cosmos_audit_events
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3) AS audit_events,
        (SELECT count(*) FROM cosmos_turns WHERE session_id = $3) AS turns,
        (SELECT count(*) FROM cosmos_commands WHERE session_id = $3) AS commands,
        (SELECT count(*) FROM cosmos_outbox_events WHERE session_id = $3) AS outbox_events,
        (SELECT last_event_sequence FROM cosmos_sessions
          WHERE organization_id = $1 AND space_id = $2 AND id = $3) AS last_event_sequence
    `, [record.organizationId, record.spaceId, created.session.id])

    expect(facts.rows[0]).toEqual({
      event_types: ['session.created', 'message.created'],
      audit_events: '1',
      turns: '0',
      commands: '0',
      outbox_events: '0',
      last_event_sequence: '2',
    })
  })

  it('keeps domain, ledger, outbox, and idempotency writes atomic', async () => {
    const before = await pool.query<{ sessions: string; events: string; audits: string }>(`
      SELECT
        (SELECT count(*) FROM cosmos_sessions) AS sessions,
        (SELECT count(*) FROM cosmos_session_events) AS events,
        (SELECT count(*) FROM cosmos_audit_events) AS audits
    `)
    await pool.query(`
      CREATE FUNCTION cosmos_test_reject_idempotency_response() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected idempotency response failure';
      END;
      $$;
      CREATE TRIGGER cosmos_test_reject_idempotency_response
      BEFORE INSERT ON cosmos_idempotency_responses
      FOR EACH ROW EXECUTE FUNCTION cosmos_test_reject_idempotency_response();
    `)
    const repository = new PostgresSessionRepository(pool)
    const record = createRecord({
      requestId: 'ledger-rollback-request',
      idempotencyKey: 'ledger-rollback-key',
    })
    try {
      await expect(repository.create(record)).rejects.toThrow('injected idempotency response failure')
    } finally {
      await pool.query(`
        DROP TRIGGER cosmos_test_reject_idempotency_response ON cosmos_idempotency_responses;
        DROP FUNCTION cosmos_test_reject_idempotency_response();
      `)
    }

    const after = await pool.query<{
      sessions: string
      messages: string
      turns: string
      commands: string
      outbox_events: string
      events: string
      audits: string
      idempotency_records: string
      idempotency_responses: string
    }>(`
      SELECT
        (SELECT count(*) FROM cosmos_sessions) AS sessions,
        (SELECT count(*) FROM cosmos_messages) AS messages,
        (SELECT count(*) FROM cosmos_turns) AS turns,
        (SELECT count(*) FROM cosmos_commands) AS commands,
        (SELECT count(*) FROM cosmos_outbox_events) AS outbox_events,
        (SELECT count(*) FROM cosmos_session_events) AS events,
        (SELECT count(*) FROM cosmos_audit_events) AS audits,
        (SELECT count(*) FROM cosmos_idempotency_records) AS idempotency_records,
        (SELECT count(*) FROM cosmos_idempotency_responses) AS idempotency_responses
    `)
    expect(after.rows[0].sessions).toBe(before.rows[0].sessions)
    expect(after.rows[0].events).toBe(before.rows[0].events)
    expect(after.rows[0].audits).toBe(before.rows[0].audits)
    expect(after.rows[0]).toMatchObject({
      messages: '2',
      turns: '1',
      commands: '1',
      outbox_events: '1',
      idempotency_records: '2',
      idempotency_responses: '2',
    })
  })

  it('rejects cross-Session resources, duplicate sequence, and every ledger mutation', async () => {
    const resources = await pool.query<{
      session_id: string
      status: 'draft' | 'queued'
      message_id: string
      turn_id: string | null
      command_id: string | null
    }>(`
      SELECT session.id AS session_id, session.status, message.id AS message_id,
        turn_record.id AS turn_id, command.id AS command_id
      FROM cosmos_sessions session
      JOIN cosmos_messages message
        ON message.organization_id = session.organization_id
        AND message.space_id = session.space_id
        AND message.session_id = session.id
      LEFT JOIN cosmos_turns turn_record
        ON turn_record.organization_id = session.organization_id
        AND turn_record.space_id = session.space_id
        AND turn_record.session_id = session.id
      LEFT JOIN cosmos_commands command
        ON command.organization_id = session.organization_id
        AND command.space_id = session.space_id
        AND command.session_id = session.id
      WHERE session.organization_id = 'ledger-organization'
        AND session.space_id = 'ledger-space'
    `)
    const started = resources.rows.find((resource) => resource.status === 'queued')
    const draft = resources.rows.find((resource) => resource.status === 'draft')
    if (!started?.turn_id || !started.command_id || !draft) {
      throw new Error('Expected one started and one draft Session ledger fixture.')
    }

    await expect(pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, message_id,
        command_id, request_id, occurred_at
      ) VALUES (
        'ledger-organization', 'ledger-space', $1, 'cross-session-message-event', 8,
        'message.created', 'message', $2, '{}'::jsonb,
        'ledger-user', 'user', $2, $3, 'cross-session-message-request', now()
      )
    `, [started.session_id, draft.message_id, started.command_id])).rejects.toMatchObject({ code: '23503' })

    await expect(pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        command_id, request_id, occurred_at
      ) VALUES (
        'ledger-organization', 'ledger-space', $1, 'cross-session-turn-event', 9,
        'turn.queued', 'turn', $2, '{}'::jsonb,
        'ledger-user', 'user', $2, $3, 'cross-session-turn-request', now()
      )
    `, [draft.session_id, started.turn_id, started.command_id])).rejects.toMatchObject({ code: '23503' })

    await expect(pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, message_id,
        command_id, request_id, occurred_at
      ) VALUES (
        'ledger-organization', 'ledger-space', $1, 'cross-session-command-event', 10,
        'message.created', 'message', $2, '{}'::jsonb,
        'ledger-user', 'user', $2, $3, 'cross-session-command-request', now()
      )
    `, [draft.session_id, draft.message_id, started.command_id])).rejects.toMatchObject({ code: '23503' })

    await expect(pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, message_id,
        command_id, request_id, occurred_at
      ) VALUES (
        'ledger-organization', 'ledger-space', $1, 'duplicate-sequence-event', 1,
        'message.created', 'message', $2, '{}'::jsonb,
        'ledger-user', 'user', $2, $3, 'duplicate-request', now()
      )
    `, [started.session_id, started.message_id, started.command_id])).rejects.toMatchObject({ code: '23505' })

    await expect(pool.query(`
      UPDATE cosmos_session_events SET payload = '{"mutated":true}'::jsonb
      WHERE organization_id = 'ledger-organization' AND session_id = $1
    `, [started.session_id])).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query(`
      DELETE FROM cosmos_audit_events
      WHERE organization_id = 'ledger-organization' AND session_id = $1
    `, [started.session_id])).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query('TRUNCATE cosmos_session_events')).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query('TRUNCATE cosmos_audit_events')).rejects.toMatchObject({ code: '55000' })

    const counts = await pool.query<{ events: string; audits: string }>(`
      SELECT
        (SELECT count(*) FROM cosmos_session_events
          WHERE organization_id = 'ledger-organization' AND session_id = $1) AS events,
        (SELECT count(*) FROM cosmos_audit_events
          WHERE organization_id = 'ledger-organization' AND session_id = $1) AS audits
    `, [started.session_id])
    expect(Number(counts.rows[0].events)).toBeGreaterThan(0)
    expect(counts.rows[0].audits).toBe('1')
  })
})
