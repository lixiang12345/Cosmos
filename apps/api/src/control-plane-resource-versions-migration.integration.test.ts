import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

async function expectSqlState(query: Promise<unknown>, code: string) {
  await expect(query).rejects.toMatchObject({ code })
}

describeWithDatabase('005-007 control-plane resource versions migrations', () => {
  const schema = `cosmos_resource_versions_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)

    for (const migration of [
      '001_sessions.sql',
      '002_identity_and_membership.sql',
      '003_session_execution_queue.sql',
      '004_authoritative_session_configuration.sql',
    ]) {
      await migrationPool.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'))
    }

    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name)
      VALUES ('organization-a', 'Organization A');

      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('organization-a', 'space-a', 'Space A');

      INSERT INTO cosmos_environments (
        organization_id, space_id, id, name, created_by, updated_at
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'Environment A',
        'test-actor', '2020-01-01T00:00:00Z'
      );

      INSERT INTO cosmos_experts (
        organization_id, space_id, id, name, created_by, updated_at
      ) VALUES (
        'organization-a', 'space-a', 'expert-a', 'Expert A',
        'test-actor', '2020-01-01T00:00:00Z'
      );
    `)

    await migrationPool.query(await readFile(
      resolve(migrationsDirectory, '005_control_plane_resource_versions.sql'),
      'utf8',
    ))
    await migrationPool.query(await readFile(
      resolve(migrationsDirectory, '006_expert_catalog_index.sql'),
      'utf8',
    ))
    await migrationPool.query(await readFile(
      resolve(migrationsDirectory, '007_environment_catalog_index.sql'),
      'utf8',
    ))
  })

  afterAll(async () => {
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('defaults Expert and Environment versions to one', async () => {
    const experts = await migrationPool.query<{ version: number }>(`
      SELECT version
      FROM cosmos_experts
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = 'expert-a'
    `)
    const environments = await migrationPool.query<{ version: number }>(`
      SELECT version
      FROM cosmos_environments
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = 'environment-a'
    `)

    expect(experts.rows).toEqual([{ version: 1 }])
    expect(environments.rows).toEqual([{ version: 1 }])
  })

  it.each([
    ['cosmos_experts', 'expert-a'],
    ['cosmos_environments', 'environment-a'],
  ])('increments version and advances updated_at on every update to %s', async (table, id) => {
    const initial = await migrationPool.query<{ updated_at: Date; version: number }>(`
      SELECT updated_at, version
      FROM ${table}
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = $1
    `, [id])

    const firstUpdate = await migrationPool.query<{ updated_at: Date; version: number }>(`
      UPDATE ${table}
      SET description = 'First update'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = $1
      RETURNING updated_at, version
    `, [id])

    expect(firstUpdate.rows[0]?.version).toBe(initial.rows[0]!.version + 1)
    expect(firstUpdate.rows[0]!.updated_at.getTime()).toBeGreaterThan(
      initial.rows[0]!.updated_at.getTime(),
    )

    const secondUpdate = await migrationPool.query<{ updated_at: Date; version: number }>(`
      UPDATE ${table}
      SET name = 'Second update', version = 1000, updated_at = '2000-01-01T00:00:00Z'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = $1
      RETURNING updated_at, version
    `, [id])

    expect(secondUpdate.rows[0]?.version).toBe(firstUpdate.rows[0]!.version + 1)
    expect(secondUpdate.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
      firstUpdate.rows[0]!.updated_at.getTime(),
    )
  })

  it.each([
    ['cosmos_experts', 'invalid-expert'],
    ['cosmos_environments', 'invalid-environment'],
  ])('rejects non-positive versions in %s', async (table, id) => {
    await expectSqlState(migrationPool.query(`
      INSERT INTO ${table} (
        organization_id, space_id, id, name, created_by, version
      ) VALUES (
        'organization-a', 'space-a', $1, 'Invalid version', 'test-actor', 0
      )
    `, [id]), '23514')
  })

  it('creates the Expert and Environment list indexes', async () => {
    const indexes = await migrationPool.query<{ indexdef: string; indexname: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = $1
        AND indexname IN (
          'cosmos_experts_space_updated_idx',
          'cosmos_environments_space_updated_idx'
        )
      ORDER BY indexname
    `, [schema])

    expect(indexes.rows).toEqual([
      {
        indexname: 'cosmos_environments_space_updated_idx',
        indexdef: expect.stringContaining(
          '(organization_id, space_id, updated_at DESC, id DESC)',
        ),
      },
      {
        indexname: 'cosmos_experts_space_updated_idx',
        indexdef: expect.stringContaining(
          '(organization_id, space_id, updated_at DESC, id DESC)',
        ),
      },
    ])
  })
})
