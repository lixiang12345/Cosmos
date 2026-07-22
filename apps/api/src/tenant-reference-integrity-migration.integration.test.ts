import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')
const legacySchemaMigrations = [
  '001_sessions.sql',
  '002_identity_and_membership.sql',
  '003_session_execution_queue.sql',
]
const preIntegrityMigrations = [
  '004_authoritative_session_configuration.sql',
  '005_control_plane_resource_versions.sql',
  '006_expert_catalog_index.sql',
  '007_environment_catalog_index.sql',
]

async function expectForeignKeyViolation(query: Promise<unknown>) {
  await expect(query).rejects.toMatchObject({ code: '23503' })
}

async function applyMigrations(pool: Pool, migrations: string[]) {
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'))
  }
}

async function seedLegacyTenantReferences(pool: Pool) {
  await pool.query(`
    INSERT INTO cosmos_organizations (id, name)
    VALUES ('organization-a', 'Organization A'), ('organization-b', 'Organization B');

    INSERT INTO cosmos_spaces (organization_id, id, name)
    VALUES
      ('organization-a', 'space-a', 'Space A'),
      ('organization-a', 'space-b', 'Space B'),
      ('organization-b', 'space-a', 'Space A');

    INSERT INTO cosmos_sessions (
      id, organization_id, space_id, title, summary, expert_id, expert_name,
      repository, base_branch, visibility, status, source, created_by,
      created_at, updated_at, last_activity_at, version
    ) VALUES
      ('session-a', 'organization-a', 'space-a', 'Session A', '', 'expert-a',
        'Expert A', 'cosmos/repository', 'main', 'private', 'active', 'manual',
        'test-actor', now(), now(), now(), 1),
      ('session-sibling', 'organization-a', 'space-a', 'Sibling Session', '',
        'expert-a', 'Expert A', 'cosmos/repository', 'main', 'private', 'active',
        'manual', 'test-actor', now(), now(), now(), 1),
      ('session-space-b', 'organization-a', 'space-b', 'Space B Session', '',
        'expert-a', 'Expert A', 'cosmos/repository', 'main', 'private', 'active',
        'manual', 'test-actor', now(), now(), now(), 1),
      ('session-organization-b', 'organization-b', 'space-a', 'Organization B Session', '',
        'expert-a', 'Expert A', 'cosmos/repository', 'main', 'private', 'active',
        'manual', 'test-actor', now(), now(), now(), 1);

    INSERT INTO cosmos_messages (
      id, organization_id, space_id, session_id, sequence, role, content, created_at
    ) VALUES
      ('message-a', 'organization-a', 'space-a', 'session-a', 1, 'user', 'A', now()),
      ('message-sibling', 'organization-a', 'space-a', 'session-sibling', 1, 'user', 'Sibling', now()),
      ('message-space-b', 'organization-a', 'space-b', 'session-space-b', 1, 'user', 'Space B', now()),
      ('message-organization-b', 'organization-b', 'space-a', 'session-organization-b', 1, 'user', 'Organization B', now());
  `)
}

async function preparePreIntegritySchema(pool: Pool) {
  await applyMigrations(pool, legacySchemaMigrations)
  await seedLegacyTenantReferences(pool)
  await applyMigrations(pool, preIntegrityMigrations)
}

describeWithDatabase('008-013 tenant reference integrity migrations', () => {
  const schema = `cosmos_tenant_integrity_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await preparePreIntegritySchema(migrationPool)
    await applyMigrations(migrationPool, [
      '008_tenant_reference_integrity.sql',
      '009_session_tenant_identity.sql',
      '010_turn_tenant_identity.sql',
      '011_command_tenant_identity.sql',
      '012_tenant_reference_constraints.sql',
      '013_validate_tenant_references.sql',
    ])
  })

  afterAll(async () => {
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('validates both tenant-scoped foreign keys during upgrade', async () => {
    const constraints = await migrationPool.query<{ conname: string; convalidated: boolean }>(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE connamespace = $1::regnamespace
        AND conname IN (
          'cosmos_turns_input_message_tenant_fk',
          'cosmos_idempotency_records_session_tenant_fk'
        )
      ORDER BY conname
    `, [schema])

    expect(constraints.rows).toEqual([
      { conname: 'cosmos_idempotency_records_session_tenant_fk', convalidated: true },
      { conname: 'cosmos_turns_input_message_tenant_fk', convalidated: true },
    ])
  })

  it('fails closed instead of silently accepting an existing 008 index', async () => {
    await expect(applyMigrations(
      migrationPool,
      ['008_tenant_reference_integrity.sql'],
    )).rejects.toMatchObject({ code: '42P07' })
  })

  it('repairs an already-versioned legacy schema that lacks composite Session constraints', async () => {
    const legacySchema = `cosmos_legacy_integrity_${crypto.randomUUID().replaceAll('-', '')}`
    const legacyPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${legacySchema}`,
    })
    await adminPool.query(`CREATE SCHEMA ${legacySchema}`)
    try {
      await preparePreIntegritySchema(legacyPool)
      await legacyPool.query(`
        DO $$
        DECLARE table_name regclass;
        DECLARE constraint_name text;
        BEGIN
          FOREACH table_name IN ARRAY ARRAY[
            'cosmos_messages'::regclass,
            'cosmos_turns'::regclass,
            'cosmos_commands'::regclass,
            'cosmos_outbox_events'::regclass,
            'cosmos_idempotency_records'::regclass
          ]
          LOOP
            FOR constraint_name IN
              SELECT conname FROM pg_constraint
              WHERE conrelid = table_name
                AND confrelid IN ('cosmos_sessions'::regclass, 'cosmos_messages'::regclass)
                AND contype = 'f'
            LOOP
              EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', table_name, constraint_name);
            END LOOP;
          END LOOP;
        END;
        $$;
        ALTER TABLE cosmos_sessions
          DROP CONSTRAINT cosmos_sessions_tenant_identity_unique;
      `)

      await applyMigrations(legacyPool, [
        '008_tenant_reference_integrity.sql',
        '009_session_tenant_identity.sql',
        '010_turn_tenant_identity.sql',
        '011_command_tenant_identity.sql',
        '012_tenant_reference_constraints.sql',
        '013_validate_tenant_references.sql',
      ])
      const constraints = await legacyPool.query<{ conname: string; convalidated: boolean }>(`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE connamespace = $1::regnamespace
          AND conname IN (
            'cosmos_sessions_tenant_identity_unique',
            'cosmos_messages_session_tenant_fk',
            'cosmos_turns_session_tenant_fk',
            'cosmos_turns_input_message_tenant_fk',
            'cosmos_commands_session_tenant_fk',
            'cosmos_outbox_events_session_tenant_fk',
            'cosmos_idempotency_records_session_tenant_fk'
          )
        ORDER BY conname
      `, [legacySchema])
      expect(constraints.rows).toHaveLength(7)
      expect(constraints.rows.every((constraint) => constraint.convalidated)).toBe(true)
    } finally {
      await legacyPool.end()
      await adminPool.query(`DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`)
    }
  })

  it('validates only the active schema and does not trust a custom unvalidated FK', async () => {
    const cleanSchema = `cosmos_clean_validation_${crypto.randomUUID().replaceAll('-', '')}`
    const dirtySchema = `cosmos_other_validation_${crypto.randomUUID().replaceAll('-', '')}`
    const cleanPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${cleanSchema}`,
    })
    const dirtyPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${dirtySchema}`,
    })
    await adminPool.query(`CREATE SCHEMA ${cleanSchema}`)
    await adminPool.query(`CREATE SCHEMA ${dirtySchema}`)
    const indexMigrations = [
      '008_tenant_reference_integrity.sql',
      '009_session_tenant_identity.sql',
      '010_turn_tenant_identity.sql',
      '011_command_tenant_identity.sql',
    ]
    try {
      await preparePreIntegritySchema(cleanPool)
      await preparePreIntegritySchema(dirtyPool)
      await applyMigrations(cleanPool, indexMigrations)
      await applyMigrations(dirtyPool, indexMigrations)
      await cleanPool.query(`
        ALTER TABLE cosmos_idempotency_records
          ADD CONSTRAINT custom_unvalidated_session_tenant_fk
          FOREIGN KEY (organization_id, space_id, session_id)
          REFERENCES cosmos_sessions(organization_id, space_id, id)
          NOT VALID
      `)
      await dirtyPool.query(`
        INSERT INTO cosmos_idempotency_records (
          organization_id, space_id, actor_id, method, canonical_path,
          idempotency_key_hash, request_hash, session_id, expires_at
        ) VALUES (
          'organization-a', 'space-a', 'test-actor', 'POST', '/sessions',
          'other-schema-dirty-key', 'dirty-request', 'session-organization-b',
          now() + interval '1 day'
        )
      `)
      await applyMigrations(cleanPool, ['012_tenant_reference_constraints.sql'])
      await applyMigrations(dirtyPool, ['012_tenant_reference_constraints.sql'])

      await expect(applyMigrations(cleanPool, ['013_validate_tenant_references.sql']))
        .resolves.toBeUndefined()
      const cleanConstraint = await cleanPool.query<{ convalidated: boolean }>(`
        SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'cosmos_idempotency_records'::regclass
          AND conname = 'cosmos_idempotency_records_session_tenant_fk'
      `)
      expect(cleanConstraint.rows).toEqual([{ convalidated: true }])
      await expectForeignKeyViolation(
        applyMigrations(dirtyPool, ['013_validate_tenant_references.sql']),
      )
    } finally {
      await cleanPool.end()
      await dirtyPool.end()
      await adminPool.query(`DROP SCHEMA IF EXISTS ${cleanSchema} CASCADE`)
      await adminPool.query(`DROP SCHEMA IF EXISTS ${dirtySchema} CASCADE`)
    }
  })

  it('allows same-tenant Turn and idempotency references', async () => {
    await expect(migrationPool.query(`
      INSERT INTO cosmos_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        input_message_id, status, queued_at, version
      ) VALUES (
        'turn-valid', 'organization-a', 'space-a', 'session-a', 1, 'user',
        'message-a', 'queued', now(), 1
      );

      INSERT INTO cosmos_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES (
        'organization-a', 'space-a', 'test-actor', 'POST',
        '/v1/organizations/organization-a/spaces/space-a/sessions',
        'valid-key', 'valid-request', 'session-a', now() + interval '1 day'
      );
    `)).resolves.toBeDefined()
  })

  it.each([
    ['another Session', 'message-sibling'],
    ['another Space', 'message-space-b'],
    ['another Organization', 'message-organization-b'],
  ])('rejects a Turn input Message from %s', async (_label, messageId) => {
    await expectForeignKeyViolation(migrationPool.query(`
      INSERT INTO cosmos_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        input_message_id, status, queued_at, version
      ) VALUES (
        $1, 'organization-a', 'space-a', 'session-a', 2, 'user',
        $2, 'queued', now(), 1
      )
    `, [`turn-${messageId}`, messageId]))
  })

  it.each([
    ['another Space', 'session-space-b'],
    ['another Organization', 'session-organization-b'],
  ])('rejects an idempotency Session from %s', async (_label, sessionId) => {
    await expectForeignKeyViolation(migrationPool.query(`
      INSERT INTO cosmos_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES (
        'organization-a', 'space-a', 'test-actor', 'POST',
        '/v1/organizations/organization-a/spaces/space-a/sessions',
        $1, 'invalid-request', $2, now() + interval '1 day'
      )
    `, [`invalid-${sessionId}`, sessionId]))
  })

  it.each([
    [
      'Turn input Message',
      `INSERT INTO cosmos_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        input_message_id, status, queued_at, version
      ) VALUES (
        'dirty-turn', 'organization-a', 'space-a', 'session-a', 1, 'user',
        'message-organization-b', 'queued', now(), 1
      )`,
      "DELETE FROM cosmos_turns WHERE id = 'dirty-turn'",
    ],
    [
      'idempotency Session',
      `INSERT INTO cosmos_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES (
        'organization-a', 'space-a', 'test-actor', 'POST', '/sessions',
        'dirty-key', 'dirty-request', 'session-organization-b', now() + interval '1 day'
      )`,
      "DELETE FROM cosmos_idempotency_records WHERE idempotency_key_hash = 'dirty-key'",
    ],
  ])('refuses to validate an existing cross-tenant %s reference', async (
    _label,
    dirtyInsert,
    removeDirtyRow,
  ) => {
    const dirtySchema = `cosmos_dirty_integrity_${crypto.randomUUID().replaceAll('-', '')}`
    const dirtyPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${dirtySchema}`,
    })
    await adminPool.query(`CREATE SCHEMA ${dirtySchema}`)
    try {
      await preparePreIntegritySchema(dirtyPool)
      await applyMigrations(dirtyPool, [
        '008_tenant_reference_integrity.sql',
        '009_session_tenant_identity.sql',
        '010_turn_tenant_identity.sql',
        '011_command_tenant_identity.sql',
      ])
      await dirtyPool.query(dirtyInsert)

      await applyMigrations(dirtyPool, ['012_tenant_reference_constraints.sql'])
      await expectForeignKeyViolation(applyMigrations(dirtyPool, ['013_validate_tenant_references.sql']))
      await dirtyPool.query(removeDirtyRow)
      await expect(applyMigrations(dirtyPool, ['013_validate_tenant_references.sql']))
        .resolves.toBeUndefined()
    } finally {
      await dirtyPool.end()
      await adminPool.query(`DROP SCHEMA IF EXISTS ${dirtySchema} CASCADE`)
    }
  })
})
