import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

describeWithDatabase('001 to 002 identity migration', () => {
  const schema = `relay_migration_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
  })

  afterAll(async () => {
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('preserves old Sessions and scopes duplicate keys by concrete Space path', async () => {
    const migration001 = await readFile(resolve(migrationsDirectory, '001_sessions.sql'), 'utf8')
    const migration002 = await readFile(resolve(migrationsDirectory, '002_identity_and_membership.sql'), 'utf8')
    await migrationPool.query(migration001)

    await migrationPool.query(`
      INSERT INTO relay_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        repository, base_branch, visibility, status, source,
        created_at, updated_at, last_activity_at, version
      ) VALUES
        ('session-a', 'org-a', 'space-a', 'A', '', 'expert-a', 'Expert A',
          'org/repo', 'main', 'private', 'active', 'manual', now(), now(), now(), 1),
        ('session-b', 'org-a', 'space-b', 'B', '', 'expert-a', 'Expert A',
          'org/repo', 'main', 'private', 'active', 'manual', now(), now(), now(), 1);

      INSERT INTO relay_idempotency_records (
        organization_id, space_id, idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES
        ('org-a', 'space-a', 'same-hash', 'request-a', 'session-a', now() + interval '1 day'),
        ('org-a', 'space-b', 'same-hash', 'request-b', 'session-b', now() + interval '1 day');
    `)

    await expect(migrationPool.query(migration002)).resolves.toBeDefined()

    const sessions = await migrationPool.query<{
      id: string
      created_by: string
    }>('SELECT id, created_by FROM relay_sessions ORDER BY id')
    expect(sessions.rows).toEqual([
      { id: 'session-a', created_by: 'system:migration' },
      { id: 'session-b', created_by: 'system:migration' },
    ])

    const records = await migrationPool.query<{
      actor_id: string
      canonical_path: string
    }>('SELECT actor_id, canonical_path FROM relay_idempotency_records ORDER BY canonical_path')
    expect(records.rows).toEqual([
      {
        actor_id: 'system:migration',
        canonical_path: '/v1/organizations/org-a/spaces/space-a/sessions',
      },
      {
        actor_id: 'system:migration',
        canonical_path: '/v1/organizations/org-a/spaces/space-b/sessions',
      },
    ])

    const memberships = await migrationPool.query('SELECT actor_id FROM relay_organization_memberships')
    expect(memberships.rows).toEqual([])
  })
})
