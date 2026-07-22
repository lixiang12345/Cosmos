import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapDevelopmentDatabase } from './development-database-bootstrap.js'
import { runMigrations } from './migrations.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('development database bootstrap', () => {
  const schema = `cosmos_development_bootstrap_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('creates an idempotent usable local workspace and published catalog', async () => {
    await bootstrapDevelopmentDatabase(pool, 'user-local-admin')
    await bootstrapDevelopmentDatabase(pool, 'user-local-admin')

    const membership = await pool.query<{
      organization_role: string
      spaces: number
      managed_spaces: number
    }>(`
      SELECT organization_membership.role AS organization_role,
        count(space_membership.space_id)::integer AS spaces,
        count(space_membership.space_id) FILTER (
          WHERE space_membership.role = 'space_manager'
        )::integer AS managed_spaces
      FROM cosmos_organization_memberships organization_membership
      JOIN cosmos_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = 'cosmos'
        AND organization_membership.actor_id = 'user-local-admin'
      GROUP BY organization_membership.role
    `)
    expect(membership.rows).toEqual([{
      organization_role: 'organization_owner',
      spaces: 2,
      managed_spaces: 2,
    }])

    const catalog = await pool.query<{
      environments: number
      experts: number
      built_in_experts: number
      repositories: number
    }>(`
      SELECT
        (SELECT count(*)::integer FROM cosmos_environments
          WHERE organization_id = 'cosmos' AND status = 'ready') AS environments,
        (SELECT count(*)::integer FROM cosmos_experts
          WHERE organization_id = 'cosmos' AND status = 'published') AS experts,
        (SELECT count(*)::integer FROM cosmos_experts
          WHERE organization_id = 'cosmos' AND status = 'published' AND kind = 'built_in') AS built_in_experts,
        (SELECT count(*)::integer FROM cosmos_environment_revision_repositories
          WHERE organization_id = 'cosmos' AND is_default) AS repositories
    `)
    expect(catalog.rows).toEqual([{
      environments: 2, experts: 4, built_in_experts: 2, repositories: 2,
    }])
  })
})
