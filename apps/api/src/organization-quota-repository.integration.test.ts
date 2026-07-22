import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresOrganizationQuotaRepository } from './organization-quota-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Organization quota repository', () => {
  const schema = `cosmos_quota_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_api_runtime -c search_path=${schema}`,
  })
  const repository = new PostgresOrganizationQuotaRepository(apiPool)
  const now = new Date('2026-07-22T12:00:00.000Z')

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('quota-org', 'Quota Organization');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
        VALUES ('quota-org', 'quota-user', 'member');
      UPDATE cosmos_organization_quotas
      SET api_requests_limit = 2, api_window_seconds = 60
      WHERE organization_id = 'quota-org';
    `)
  })

  afterAll(async () => {
    await apiPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('atomically shares the Organization window and reports only the first denial', async () => {
    await expect(repository.consumeApiRequest({ organizationId: 'quota-org', actorId: 'quota-user', now }))
      .resolves.toMatchObject({ allowed: true, limit: 2, remaining: 1, firstDenied: false })
    await expect(repository.consumeApiRequest({ organizationId: 'quota-org', actorId: 'quota-user', now }))
      .resolves.toMatchObject({ allowed: true, limit: 2, remaining: 0, firstDenied: false })
    await expect(repository.consumeApiRequest({ organizationId: 'quota-org', actorId: 'quota-user', now }))
      .resolves.toMatchObject({ allowed: false, limit: 2, remaining: 0, firstDenied: true })
    await expect(repository.consumeApiRequest({ organizationId: 'quota-org', actorId: 'quota-user', now }))
      .resolves.toMatchObject({ allowed: false, limit: 2, remaining: 0, firstDenied: false })
    await expect(repository.consumeApiRequest({
      organizationId: 'quota-org', actorId: 'quota-user', now: new Date(now.getTime() + 61_000),
    })).resolves.toMatchObject({ allowed: true, limit: 2, remaining: 1 })
  })

  it('conceals quota rows from non-members', async () => {
    await expect(repository.consumeApiRequest({
      organizationId: 'quota-org', actorId: 'quota-outsider', now,
    })).resolves.toBeNull()
  })
})
