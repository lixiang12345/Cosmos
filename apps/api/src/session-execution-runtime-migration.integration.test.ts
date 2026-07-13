import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

const legacyMigrations = [
  '001_sessions.sql',
  '002_identity_and_membership.sql',
  '003_session_execution_queue.sql',
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
  '014_session_audit_ledgers.sql',
  '015_validate_session_audit_ledgers.sql',
]

async function migrationFiles() {
  return (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
}

async function applyMigrations(pool: Pool, migrations: string[]) {
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'))
  }
}

async function seedLegacyExecutionRows(pool: Pool) {
  await pool.query(`
    INSERT INTO relay_organizations (id, name)
    VALUES ('organization-a', 'Organization A'), ('organization-b', 'Organization B');

    INSERT INTO relay_spaces (organization_id, id, name)
    VALUES
      ('organization-a', 'space-a', 'Space A'),
      ('organization-b', 'space-b', 'Space B');

    INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
    VALUES
      ('organization-a', 'actor-a', 'member'),
      ('organization-b', 'actor-b', 'member');

    INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
    VALUES
      ('organization-a', 'space-a', 'actor-a', 'member'),
      ('organization-b', 'space-b', 'actor-b', 'member');

    INSERT INTO relay_sessions (
      id, organization_id, space_id, title, summary, expert_id, expert_name,
      repository, base_branch, visibility, status, source, created_by,
      created_at, updated_at, last_activity_at, version
    ) VALUES
      (
        'session-a', 'organization-a', 'space-a', 'Session A', '', 'expert-a',
        'Expert A', 'relay/repository-a', 'main', 'private', 'queued', 'manual',
        'actor-a', now(), now(), now(), 1
      ),
      (
        'session-b', 'organization-b', 'space-b', 'Session B', '', 'expert-b',
        'Expert B', 'relay/repository-b', 'main', 'private', 'queued', 'manual',
        'actor-b', now(), now(), now(), 1
      );

    INSERT INTO relay_messages (
      id, organization_id, space_id, session_id, sequence, role, actor_id,
      content, created_at
    ) VALUES
      (
        'message-a', 'organization-a', 'space-a', 'session-a', 1, 'user',
        'actor-a', 'Run A', now()
      ),
      (
        'message-b', 'organization-b', 'space-b', 'session-b', 1, 'user',
        'actor-b', 'Run B', now()
      );

    INSERT INTO relay_turns (
      id, organization_id, space_id, session_id, ordinal, initiator_type,
      initiator_id, input_message_id, status, queued_at, version
    ) VALUES
      (
        'turn-a', 'organization-a', 'space-a', 'session-a', 1, 'user',
        'actor-a', 'message-a', 'queued', now(), 1
      ),
      (
        'turn-b', 'organization-b', 'space-b', 'session-b', 1, 'user',
        'actor-b', 'message-b', 'queued', now(), 1
      );

    INSERT INTO relay_commands (
      id, organization_id, space_id, session_id, type, status, resource_type,
      resource_id, accepted_at, available_at
    ) VALUES (
      'legacy-command-a', 'organization-a', 'space-a', 'session-a',
      'session.start', 'accepted', 'turn', 'turn-a', now(), now()
    );
  `)
}

describeWithDatabase('016-051 Session execution runtime migrations', () => {
  const adminPool = new Pool({ connectionString: databaseUrl })

  beforeAll(async () => {
    await adminPool.query('SELECT 1')
  })

  afterAll(async () => {
    await adminPool.end()
  })

  async function withSchema(
    prefix: string,
    test: (pool: Pool, schema: string) => Promise<void>,
  ) {
    const schema = `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
    const pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    })
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    try {
      await test(pool, schema)
    } finally {
      await pool.end()
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    }
  }

  async function prepareExecutionFixture(pool: Pool) {
    await applyMigrations(pool, legacyMigrations.slice(0, 3))
    await seedLegacyExecutionRows(pool)
    await applyMigrations(pool, (await migrationFiles()).slice(3))
  }

  it('installs the complete runtime schema on an empty database', async () => {
    await withSchema('relay_execution_fresh', async (pool) => {
      await runMigrations(pool)

      const versions = await pool.query<{ version: string }>(
        'SELECT version FROM relay_schema_migrations ORDER BY version',
      )
      expect(versions.rows.map((row) => row.version)).toEqual(await migrationFiles())

      const runtimeColumns = await pool.query<{ column_name: string; is_nullable: string }>(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'relay_attempts'
          AND column_name IN ('model', 'provider_model', 'runtime_id')
        ORDER BY column_name
      `)
      expect(runtimeColumns.rows).toEqual([
        { column_name: 'model', is_nullable: 'NO' },
        { column_name: 'provider_model', is_nullable: 'YES' },
        { column_name: 'runtime_id', is_nullable: 'YES' },
      ])
    })
  })

  it('upgrades a versioned 015 database without making legacy commands claimable', async () => {
    await withSchema('relay_execution_upgrade', async (pool) => {
      for (const migration of legacyMigrations) {
        await applyMigrations(pool, [migration])
        await pool.query(
          'INSERT INTO relay_schema_migrations (version) VALUES ($1)',
          [migration],
        )
        if (migration === '003_session_execution_queue.sql') {
          await seedLegacyExecutionRows(pool)
          await pool.query(`
            INSERT INTO relay_messages (
              id, organization_id, space_id, session_id, sequence, role, content, created_at
            ) VALUES
              ('legacy-failed-input', 'organization-a', 'space-a', 'session-a', 2, 'user', 'failed', now()),
              ('legacy-canceled-input', 'organization-a', 'space-a', 'session-a', 3, 'user', 'canceled', now()),
              ('legacy-completed-input', 'organization-a', 'space-a', 'session-a', 4, 'user', 'completed', now());
            INSERT INTO relay_turns (
              id, organization_id, space_id, session_id, ordinal, initiator_type,
              input_message_id, status, queued_at, version
            ) VALUES
              ('legacy-failed-turn', 'organization-a', 'space-a', 'session-a', 2,
                'user', 'legacy-failed-input', 'failed', now(), 1),
              ('legacy-canceled-turn', 'organization-a', 'space-a', 'session-a', 3,
                'user', 'legacy-canceled-input', 'canceled', now(), 1),
              ('legacy-completed-turn', 'organization-a', 'space-a', 'session-a', 4,
                'user', 'legacy-completed-input', 'completed', now(), 1);
          `)
        }
      }

      await pool.query(`
        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence, event_type,
          resource_type, resource_id, payload, actor_id, actor_kind, command_id,
          turn_id, request_id, occurred_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'legacy-event', 1,
          'turn.queued', 'turn', 'turn-a', '{}'::jsonb, 'actor-a', 'user',
          'legacy-command-a', 'turn-a', 'legacy-request', now()
        )
      `)

      await runMigrations(pool)

      const legacyCommand = await pool.query<{
        protocol_version: number
        requested_by: string | null
      }>(`
        SELECT protocol_version, requested_by
        FROM relay_commands WHERE id = 'legacy-command-a'
      `)
      expect(legacyCommand.rows).toEqual([{ protocol_version: 0, requested_by: null }])

      const claimable = await pool.query(`
        SELECT id FROM relay_commands
        WHERE protocol_version = 1
          AND status IN ('accepted', 'queued', 'running')
      `)
      expect(claimable.rows).toEqual([])

      const claimIndex = await pool.query<{ indexdef: string }>(`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'relay_commands_protocol1_claim_idx'
      `)
      expect(claimIndex.rows[0]?.indexdef).toContain('(protocol_version = 1)')

      const legacyEvent = await pool.query(`
        SELECT event_type, resource_type, turn_id, attempt_id
        FROM relay_session_events WHERE event_id = 'legacy-event'
      `)
      expect(legacyEvent.rows).toEqual([{
        event_type: 'turn.queued',
        resource_type: 'turn',
        turn_id: 'turn-a',
        attempt_id: null,
      }])

      await expect(pool.query(`
        UPDATE relay_turns
        SET status = 'queued', version = version + 1
        WHERE id = 'legacy-completed-turn'
      `)).rejects.toMatchObject({ code: '55000' })
    })
  })

  it('recovers orphaned concurrent indexes before recording their versions', async () => {
    await withSchema('relay_execution_restart', async (pool) => {
      const files = await migrationFiles()
      for (const migration of files.slice(0, files.indexOf('017_attempt_tenant_identity.sql'))) {
        await applyMigrations(pool, [migration])
        await pool.query(
          'INSERT INTO relay_schema_migrations (version) VALUES ($1)',
          [migration],
        )
      }
      const concurrentMigrations = [
        '017_attempt_tenant_identity.sql',
        '018_attempt_turn_number.sql',
        '019_attempt_one_nonterminal.sql',
        '020_command_protocol1_claim.sql',
      ]
      await applyMigrations(pool, concurrentMigrations)

      await runMigrations(pool)

      const indexes = await pool.query<{ index_name: string; is_valid: boolean }>(`
        SELECT index_class.relname AS index_name, index_record.indisvalid AS is_valid
        FROM pg_index index_record
        JOIN pg_class index_class ON index_class.oid = index_record.indexrelid
        WHERE index_class.relnamespace = current_schema()::regnamespace
          AND index_class.relname IN (
            'relay_attempts_tenant_identity_unique',
            'relay_attempts_turn_number_unique',
            'relay_attempts_one_nonterminal_idx',
            'relay_commands_protocol1_claim_idx'
          )
        ORDER BY index_class.relname
      `)
      expect(indexes.rows).toHaveLength(4)
      expect(indexes.rows.every((index) => index.is_valid)).toBe(true)
      const versions = await pool.query<{ version: string }>(`
        SELECT version FROM relay_schema_migrations
        WHERE version = ANY($1::text[])
      `, [concurrentMigrations])
      expect(versions.rows).toHaveLength(4)
    })
  })

  it('upgrades preserved pre-session.updated Event constraints', async () => {
    await withSchema('relay_session_updated_upgrade', async (pool) => {
      const files = await migrationFiles()
      for (const migration of files.slice(0, files.indexOf('026_session_updated_events.sql'))) {
        await applyMigrations(pool, [migration])
        await pool.query(
          'INSERT INTO relay_schema_migrations (version) VALUES ($1)',
          [migration],
        )
      }
      await pool.query(`
        ALTER TABLE relay_session_events
          DROP CONSTRAINT relay_session_events_runtime_event_type_check,
          ADD CONSTRAINT relay_session_events_runtime_event_type_check
          CHECK (event_type IN (
            'session.created', 'message.created', 'turn.queued', 'attempt.updated'
          )),
          DROP CONSTRAINT relay_session_events_runtime_typed_resource_check,
          ADD CONSTRAINT relay_session_events_runtime_typed_resource_check
          CHECK (event_type <> 'session.updated');
      `)

      await runMigrations(pool)

      const constraints = await pool.query<{
        conname: string
        convalidated: boolean
        definition: string
      }>(`
        SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND conname IN (
            'relay_session_events_runtime_event_type_check',
            'relay_session_events_runtime_typed_resource_check'
          )
        ORDER BY conname
      `)
      expect(constraints.rows).toHaveLength(2)
      expect(constraints.rows.every((constraint) => constraint.convalidated)).toBe(true)
      expect(constraints.rows.every((constraint) => (
        constraint.definition.includes('session.updated')
      ))).toBe(true)
    })
  })

  it('upgrades a versioned 027 Attempt without fabricating provider provenance', async () => {
    await withSchema('relay_provider_model_upgrade', async (pool) => {
      const files = await migrationFiles()
      const previousMigrations = files.slice(0, files.indexOf('028_attempt_provider_model.sql'))
      for (const migration of previousMigrations) {
        await applyMigrations(pool, [migration])
        await pool.query(
          'INSERT INTO relay_schema_migrations (version) VALUES ($1)',
          [migration],
        )
        if (migration === '003_session_execution_queue.sql') await seedLegacyExecutionRows(pool)
      }
      await pool.query(`
        INSERT INTO relay_attempts (
          organization_id, space_id, session_id, turn_id, id, number, status,
          model, created_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'turn-a', 'legacy-attempt', 1,
          'queued', 'requested-model-v1', now()
        )
      `)

      await runMigrations(pool)

      const attempt = await pool.query<{ model: string; provider_model: string | null }>(`
        SELECT model, provider_model FROM relay_attempts WHERE id = 'legacy-attempt'
      `)
      expect(attempt.rows).toEqual([{
        model: 'requested-model-v1',
        provider_model: null,
      }])
      const constraint = await pool.query<{ convalidated: boolean }>(`
        SELECT convalidated FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND conname = 'relay_attempts_provider_model_check'
      `)
      expect(constraint.rows).toEqual([{ convalidated: true }])
    })
  })

  it('enforces protocol-1 lifecycle tuples and attempt-count fencing', async () => {
    await withSchema('relay_execution_commands', async (pool) => {
      await prepareExecutionFixture(pool)

      await expect(pool.query(`
        INSERT INTO relay_commands (
          id, organization_id, space_id, session_id, type, status,
          resource_type, resource_id, accepted_at, available_at, protocol_version
        ) VALUES (
          'missing-request', 'organization-a', 'space-a', 'session-a',
          'turn.execute', 'accepted', 'turn', 'turn-a', now(), now(), 1
        )
      `)).rejects.toMatchObject({ code: '23514' })

      await expect(pool.query(`
        INSERT INTO relay_commands (
          id, organization_id, space_id, session_id, type, status,
          resource_type, resource_id, accepted_at, available_at, protocol_version,
          requested_by, request_id, max_attempts, attempts, queued_at, started_at,
          heartbeat_at
        ) VALUES (
          'missing-lease', 'organization-a', 'space-a', 'session-a',
          'turn.execute', 'running', 'turn', 'turn-a', now(), now(), 1,
          'actor-a', 'request-missing-lease', 3, 1, now(), now(), now()
        )
      `)).rejects.toMatchObject({ code: '23514' })

      await pool.query(`
        INSERT INTO relay_commands (
          id, organization_id, space_id, session_id, type, status,
          resource_type, resource_id, accepted_at, available_at, protocol_version,
          requested_by, request_id, max_attempts
        ) VALUES (
          'command-v1', 'organization-a', 'space-a', 'session-a',
          'turn.execute', 'accepted', 'turn', 'turn-a', now(), now(), 1,
          'actor-a', 'request-v1', 3
        )
      `)

      const firstClaim = await pool.query<{ attempts: number }>(`
        UPDATE relay_commands
        SET status = 'running', queued_at = now(), started_at = now(),
            heartbeat_at = now(), lease_owner = 'worker-1',
            lease_expires_at = now() + interval '1 minute', attempts = attempts + 1
        WHERE id = 'command-v1' AND attempts = 0
        RETURNING attempts
      `)
      expect(firstClaim.rows).toEqual([{ attempts: 1 }])

      await pool.query(`
        UPDATE relay_commands
        SET status = 'queued', queued_at = now(), started_at = NULL,
            heartbeat_at = NULL, lease_owner = NULL, lease_expires_at = NULL
        WHERE id = 'command-v1' AND attempts = 1
      `)

      const reclaimed = await pool.query<{ attempts: number }>(`
        UPDATE relay_commands
        SET status = 'running', started_at = now(), heartbeat_at = now(),
            lease_owner = 'worker-2',
            lease_expires_at = now() + interval '1 minute', attempts = attempts + 1
        WHERE id = 'command-v1' AND status = 'queued' AND attempts = 1
        RETURNING attempts
      `)
      expect(reclaimed.rows).toEqual([{ attempts: 2 }])

      const staleHeartbeat = await pool.query(`
        UPDATE relay_commands
        SET heartbeat_at = now(), lease_expires_at = now() + interval '1 minute'
        WHERE id = 'command-v1' AND attempts = 1
      `)
      expect(staleHeartbeat.rowCount).toBe(0)

      await expect(pool.query(`
        UPDATE relay_commands SET request_id = 'rewritten-request'
        WHERE id = 'command-v1'
      `)).rejects.toMatchObject({ code: '55000' })

      await expect(pool.query(`
        UPDATE relay_commands
        SET status = 'queued', attempts = max_attempts, queued_at = now(),
            started_at = NULL, heartbeat_at = NULL,
            lease_owner = NULL, lease_expires_at = NULL
        WHERE id = 'command-v1'
      `)).rejects.toMatchObject({ code: '23514' })

      await expect(pool.query(`
        UPDATE relay_commands SET attempts = 4 WHERE id = 'command-v1'
      `)).rejects.toMatchObject({ code: '23514' })

      await pool.query(`
        UPDATE relay_commands
        SET status = 'succeeded', completed_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
        WHERE id = 'command-v1'
      `)
      await expect(pool.query(`
        UPDATE relay_commands
        SET status = 'accepted', attempts = 0, queued_at = NULL,
            started_at = NULL, heartbeat_at = NULL, completed_at = NULL
        WHERE id = 'command-v1'
      `)).rejects.toMatchObject({ code: '55000' })

      await pool.query(`
        INSERT INTO relay_commands (
          id, organization_id, space_id, session_id, type, status,
          resource_type, resource_id, accepted_at, available_at, protocol_version,
          requested_by, request_id, max_attempts, attempts, queued_at
        ) VALUES (
          'revoked-command', 'organization-a', 'space-a', 'session-a',
          'turn.execute', 'queued', 'turn', 'turn-a', now(), now(), 1,
          'actor-a', 'revoked-request', 3, 1, now()
        )
      `)
      await pool.query(`
        DELETE FROM relay_space_memberships
        WHERE organization_id = 'organization-a'
          AND space_id = 'space-a'
          AND actor_id = 'actor-a'
      `)
      await pool.query(`
        UPDATE relay_commands
        SET status = 'canceled', completed_at = now(),
            failure_code = 'authorization_revoked',
            failure_message = 'Membership was revoked before retry.'
        WHERE id = 'revoked-command'
      `)
      await pool.query(`
        UPDATE relay_turns
        SET status = 'canceled', completed_at = now(), version = version + 1
        WHERE id = 'turn-a'
      `)
      await expect(pool.query(`
        UPDATE relay_turns
        SET status = 'queued', completed_at = NULL, version = version + 1
        WHERE id = 'turn-a'
      `)).rejects.toMatchObject({ code: '55000' })
      await expect(pool.query(`
        SELECT status, failure_code FROM relay_commands WHERE id = 'revoked-command'
      `)).resolves.toMatchObject({
        rows: [{ status: 'canceled', failure_code: 'authorization_revoked' }],
      })
    })
  })

  it('enforces append-only Attempt identity, one active try, and typed tenant links', async () => {
    await withSchema('relay_execution_attempts', async (pool) => {
      await prepareExecutionFixture(pool)

      await expect(pool.query(`
        INSERT INTO relay_attempts (
          organization_id, space_id, session_id, turn_id, id, number, status,
          model, created_at
        ) VALUES (
          'organization-b', 'space-b', 'session-b', 'turn-b', 'empty-model', 1,
          'queued', '  ', now()
        )
      `)).rejects.toMatchObject({ code: '23514' })

      await pool.query(`
        INSERT INTO relay_attempts (
          organization_id, space_id, session_id, turn_id, id, number, status,
          model, created_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'turn-a', 'attempt-a1', 1,
          'queued', 'claude-sonnet-4', now()
        )
      `)

      await expect(pool.query(`
        INSERT INTO relay_attempts (
          organization_id, space_id, session_id, turn_id, id, number, status,
          model, created_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'turn-a', 'attempt-a2', 2,
          'queued', 'claude-sonnet-4', now()
        )
      `)).rejects.toMatchObject({ code: '23505' })

      await expect(pool.query(`
        UPDATE relay_attempts
        SET status = 'starting', started_at = now()
        WHERE id = 'attempt-a1'
      `)).rejects.toMatchObject({ code: '23514' })

      await pool.query(`
        UPDATE relay_attempts
        SET status = 'starting', runtime_id = 'runtime-a1', started_at = now()
        WHERE id = 'attempt-a1';
        UPDATE relay_attempts
        SET status = 'running', heartbeat_at = now()
        WHERE id = 'attempt-a1';
      `)

      await expect(pool.query(`
        UPDATE relay_attempts SET provider_model = '  '
        WHERE id = 'attempt-a1'
      `)).rejects.toMatchObject({ code: '23514' })
      await expect(pool.query(`
        UPDATE relay_attempts SET provider_model = repeat('m', 257)
        WHERE id = 'attempt-a1'
      `)).rejects.toMatchObject({ code: '23514' })

      await expect(pool.query(`
        UPDATE relay_attempts SET runtime_id = 'runtime-replacement'
        WHERE id = 'attempt-a1'
      `)).rejects.toMatchObject({ code: '55000' })

      await pool.query(`
        UPDATE relay_attempts
        SET status = 'succeeded', completed_at = now(),
            provider_model = 'claude-sonnet-4-20260701'
        WHERE id = 'attempt-a1';
      `)

      await pool.query(`
        INSERT INTO relay_attempts (
          organization_id, space_id, session_id, turn_id, id, number, status,
          model, created_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'turn-a', 'attempt-a2', 2,
          'queued', 'claude-sonnet-4', now()
        )
      `)

      await expect(pool.query(`
        UPDATE relay_attempts SET number = 3 WHERE id = 'attempt-a2'
      `)).rejects.toMatchObject({ code: '55000' })
      await expect(pool.query(`
        DELETE FROM relay_attempts WHERE id = 'attempt-a2'
      `)).rejects.toMatchObject({ code: '55000' })

      await expect(pool.query(`
        INSERT INTO relay_messages (
          id, organization_id, space_id, session_id, sequence, role, content,
          created_at, turn_id, attempt_id
        ) VALUES (
          'invalid-user-output', 'organization-a', 'space-a', 'session-a', 2,
          'user', 'not agent output', now(), 'turn-a', 'attempt-a2'
        )
      `)).rejects.toMatchObject({ code: '23514' })

      await expect(pool.query(`
        INSERT INTO relay_messages (
          id, organization_id, space_id, session_id, sequence, role, content,
          created_at, turn_id, attempt_id
        ) VALUES (
          'cross-tenant-output', 'organization-b', 'space-b', 'session-b', 2,
          'agent', 'wrong tenant', now(), 'turn-b', 'attempt-a2'
        )
      `)).rejects.toMatchObject({ code: '23503' })

      await pool.query(`
        INSERT INTO relay_messages (
          id, organization_id, space_id, session_id, sequence, role, content,
          created_at, turn_id, attempt_id
        ) VALUES (
          'agent-output-a', 'organization-a', 'space-a', 'session-a', 2,
          'agent', 'done', now(), 'turn-a', 'attempt-a2'
        );

        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence, event_type,
          resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
          attempt_id, request_id, occurred_at
        ) VALUES (
          'organization-a', 'space-a', 'session-a', 'attempt-event-a', 1,
          'attempt.updated', 'attempt', 'attempt-a2', '{}'::jsonb, 'worker-1',
          'worker', 'turn-a', 'attempt-a2', 'request-attempt-a', now()
        );
      `)

      await expect(pool.query(`
        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence, event_type,
          resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
          attempt_id, request_id, occurred_at
        ) VALUES (
          'organization-b', 'space-b', 'session-b', 'cross-tenant-event', 1,
          'attempt.updated', 'attempt', 'attempt-a2', '{}'::jsonb, 'worker-1',
          'worker', 'turn-b', 'attempt-a2', 'request-cross-tenant', now()
        )
      `)).rejects.toMatchObject({ code: '23503' })

      const constraints = await pool.query<{ convalidated: boolean }>(`
        SELECT convalidated FROM pg_constraint
        WHERE conname IN (
          'relay_attempts_turn_tenant_fk',
          'relay_attempts_provider_model_check',
          'relay_messages_attempt_tenant_fk',
          'relay_session_events_attempt_tenant_fk',
          'relay_session_events_runtime_typed_resource_check'
        )
          AND connamespace = current_schema()::regnamespace
      `)
      expect(constraints.rows).toHaveLength(5)
      expect(constraints.rows.every((constraint) => constraint.convalidated)).toBe(true)
    })
  })
})
