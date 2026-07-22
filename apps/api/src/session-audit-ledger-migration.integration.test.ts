import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

async function applyMigrations(pool: Pool, migrations: string[]) {
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'))
  }
}

describeWithDatabase('pre-release Session ledger forward repair', () => {
  const schema = `cosmos_legacy_ledger_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await applyMigrations(pool, ['001_sessions.sql', '002_identity_and_membership.sql'])
    await pool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('legacy-ledger', 'Legacy Ledger');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('legacy-ledger', 'legacy-space', 'Legacy Space');
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version
      ) VALUES (
        'legacy-session', 'legacy-ledger', 'legacy-space', 'Legacy Session', '',
        'legacy-expert', 'Legacy Expert', 'cosmos/legacy', 'main', 'private',
        'queued', 'manual', 'legacy-user', now(), now(), now(), 1
      );
    `)
    await applyMigrations(pool, ['003_session_execution_queue.sql'])
    await pool.query(`
      INSERT INTO cosmos_messages (
        id, organization_id, space_id, session_id, sequence, role, actor_id,
        content, created_at
      ) VALUES (
        'legacy-message', 'legacy-ledger', 'legacy-space', 'legacy-session', 1,
        'user', 'legacy-user', 'legacy prompt excluded from ledger', now()
      );
      INSERT INTO cosmos_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        initiator_id, input_message_id, status, queued_at, version
      ) VALUES (
        'legacy-turn', 'legacy-ledger', 'legacy-space', 'legacy-session', 1,
        'user', 'legacy-user', 'legacy-message', 'queued', now(), 1
      );
      INSERT INTO cosmos_commands (
        id, organization_id, space_id, session_id, type, status, resource_type,
        resource_id, accepted_at, available_at
      ) VALUES (
        'legacy-command', 'legacy-ledger', 'legacy-space', 'legacy-session',
        'session.start', 'accepted', 'turn', 'legacy-turn', now(), now()
      );
    `)
    await applyMigrations(pool, [
      '004_authoritative_session_configuration.sql',
      '005_control_plane_resource_versions.sql',
      '006_expert_catalog_index.sql',
      '007_environment_catalog_index.sql',
      '008_tenant_reference_integrity.sql',
      '009_session_tenant_identity.sql',
      '010_turn_tenant_identity.sql',
      '011_command_tenant_identity.sql',
      '012_tenant_reference_constraints.sql',
      '013_validate_tenant_references.sql',
    ])

    await pool.query(`
      ALTER TABLE cosmos_sessions
        ADD COLUMN last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0);
      CREATE TABLE cosmos_session_events (
        organization_id text NOT NULL,
        space_id text NOT NULL,
        session_id text NOT NULL,
        event_id text NOT NULL,
        sequence bigint NOT NULL,
        event_type text NOT NULL,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        payload_schema_version smallint NOT NULL DEFAULT 1,
        payload jsonb NOT NULL,
        actor_id text NOT NULL,
        actor_kind text NOT NULL,
        command_id text,
        request_id text NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (organization_id, event_id),
        UNIQUE (organization_id, space_id, session_id, sequence),
        FOREIGN KEY (organization_id, space_id, session_id)
          REFERENCES cosmos_sessions(organization_id, space_id, id)
      );
      CREATE TABLE cosmos_audit_events (
        organization_id text NOT NULL,
        audit_event_id text NOT NULL,
        space_id text NOT NULL,
        session_id text NOT NULL,
        actor_id text NOT NULL,
        actor_kind text NOT NULL,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text NOT NULL,
        result text NOT NULL,
        request_id text NOT NULL,
        idempotency_key_hash text NOT NULL,
        policy_decision text NOT NULL,
        policy_reason text NOT NULL,
        before_state jsonb,
        after_state jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (organization_id, audit_event_id),
        FOREIGN KEY (organization_id, space_id, session_id)
          REFERENCES cosmos_sessions(organization_id, space_id, id)
      );
      CREATE FUNCTION cosmos_reject_ledger_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Cosmos ledger rows are immutable' USING ERRCODE = '55000';
      END;
      $$;
      CREATE TRIGGER cosmos_session_events_reject_update_delete
        BEFORE UPDATE OR DELETE ON cosmos_session_events
        FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
      CREATE TRIGGER cosmos_audit_events_reject_update_delete
        BEFORE UPDATE OR DELETE ON cosmos_audit_events
        FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, command_id,
        request_id, occurred_at
      ) VALUES
        ('legacy-ledger', 'legacy-space', 'legacy-session', 'legacy-event-1', 1,
          'session.created', 'session', 'legacy-session', '{}'::jsonb,
          'legacy-user', 'user', 'legacy-command', 'legacy-request', now()),
        ('legacy-ledger', 'legacy-space', 'legacy-session', 'legacy-event-2', 2,
          'message.created', 'message', 'legacy-message', '{}'::jsonb,
          'legacy-user', 'user', 'legacy-command', 'legacy-request', now()),
        ('legacy-ledger', 'legacy-space', 'legacy-session', 'legacy-event-3', 3,
          'turn.queued', 'turn', 'legacy-turn', '{}'::jsonb,
          'legacy-user', 'user', 'legacy-command', 'legacy-request', now());
      INSERT INTO cosmos_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, action, target_type, target_id, result, request_id,
        idempotency_key_hash, policy_decision, policy_reason, before_state,
        after_state, occurred_at
      ) VALUES (
        'legacy-ledger', 'legacy-audit', 'legacy-space', 'legacy-session',
        'legacy-user', 'user', 'session.create', 'session', 'legacy-session',
        'success', 'legacy-request', repeat('a', 64), 'allow',
        'organization_and_space_write', NULL, '{}'::jsonb, now()
      );
      UPDATE cosmos_sessions SET last_event_sequence = 3 WHERE id = 'legacy-session';
    `)
    await applyMigrations(pool, [
      '014_session_audit_ledgers.sql',
      '015_validate_session_audit_ledgers.sql',
    ])
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('backfills typed references and hardens the existing ledgers without deleting facts', async () => {
    const events = await pool.query<{
      event_type: string
      message_id: string | null
      turn_id: string | null
      command_id: string | null
    }>(`
      SELECT event_type, message_id, turn_id, command_id
      FROM cosmos_session_events ORDER BY sequence
    `)
    expect(events.rows).toEqual([
      { event_type: 'session.created', message_id: null, turn_id: null, command_id: 'legacy-command' },
      { event_type: 'message.created', message_id: 'legacy-message', turn_id: null, command_id: 'legacy-command' },
      { event_type: 'turn.queued', message_id: null, turn_id: 'legacy-turn', command_id: 'legacy-command' },
    ])
    const constraints = await pool.query<{ conname: string; convalidated: boolean }>(`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'cosmos_session_events'::regclass
        AND conname IN (
          'cosmos_session_events_message_tenant_fk',
          'cosmos_session_events_turn_tenant_fk',
          'cosmos_session_events_command_tenant_fk',
          'cosmos_session_events_typed_resource_check'
        )
      ORDER BY conname
    `)
    expect(constraints.rows).toHaveLength(4)
    expect(constraints.rows.every((constraint) => constraint.convalidated)).toBe(true)
    await expect(pool.query('TRUNCATE cosmos_session_events')).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query('TRUNCATE cosmos_audit_events')).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query('SELECT count(*) AS count FROM cosmos_session_events'))
      .resolves.toMatchObject({ rows: [{ count: '3' }] })
  })
})
