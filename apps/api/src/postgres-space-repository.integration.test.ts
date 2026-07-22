import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSpaceRepository } from './postgres-space-repository.js'
import { SpacePermissionError, SpaceValidationError, SpaceVersionConflictError } from './space-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Space authority under the restricted API runtime role', () => {
  const schema = `cosmos_space_${randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c role=cosmos_api_runtime -c search_path=${schema}` })
  let sequence = 0
  const repository = new PostgresSpaceRepository(apiPool, { createId: () => `space-generated-${++sequence}` })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id,name) VALUES ('space-org','Space Organization'),('other-org','Other');
      INSERT INTO cosmos_spaces (organization_id,id,name) VALUES
        ('space-org','space-default','Default Space'),
        ('space-org','space-target','Target Space'),
        ('other-org','space-hidden','Hidden Space');
      UPDATE cosmos_organizations SET default_space_id='space-default' WHERE id='space-org';
      INSERT INTO cosmos_organization_memberships (organization_id,actor_id,role) VALUES
        ('space-org','space-owner','organization_owner'),
        ('space-org','space-member','member'),
        ('other-org','other-owner','organization_owner');
      INSERT INTO cosmos_space_memberships (organization_id,space_id,actor_id,role) VALUES
        ('space-org','space-default','space-owner','space_manager'),
        ('space-org','space-target','space-owner','space_manager'),
        ('space-org','space-default','space-member','member'),
        ('other-org','space-hidden','other-owner','space_manager');
    `)
  })

  afterAll(async () => {
    await apiPool.end(); await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await adminPool.end()
  })

  it('lists only memberships, creates idempotently, and rejects non-admin create', async () => {
    const listed = await repository.listSpaces('space-org', 'space-owner')
    expect(listed.map(({ id }) => id)).toEqual(['space-default', 'space-target'])
    expect(listed[0]).toMatchObject({ isDefault: true, slug: 'space-default' })
    const request = { name: 'Release Engineering', slug: 'release-engineering', description: 'Release work.' }
    const created = await repository.createSpace({ organizationId: 'space-org', actorId: 'space-owner', requestId: 'create', idempotencyKey: 'create-space', request })
    expect(created).toMatchObject({ replayed: false, space: { name: request.name, version: 1 } })
    await expect(repository.createSpace({ organizationId: 'space-org', actorId: 'space-owner', requestId: 'replay', idempotencyKey: 'create-space', request }))
      .resolves.toMatchObject({ replayed: true, space: { id: created.space.id } })
    await expect(repository.createSpace({ organizationId: 'space-org', actorId: 'space-member', requestId: 'member', idempotencyKey: 'member-space', request: { ...request, slug: 'forbidden' } }))
      .rejects.toBeInstanceOf(SpacePermissionError)
  })

  it('validates CAS/default invariants and returns an honest migration preview', async () => {
    const target = await repository.getSpace('space-org', 'space-target', 'space-owner')
    expect(target).not.toBeNull()
    await expect(repository.updateSpace({ organizationId: 'space-org', spaceId: target!.id, actorId: 'space-owner', requestId: 'stale', expectedVersion: 99, idempotencyKey: 'stale', request: { description: 'stale' } }))
      .rejects.toBeInstanceOf(SpaceVersionConflictError)
    const updated = await repository.updateSpace({ organizationId: 'space-org', spaceId: target!.id, actorId: 'space-owner', requestId: 'update', expectedVersion: target!.version, idempotencyKey: 'update', request: { description: 'Migration target.' } })
    expect(updated).toMatchObject({ space: { description: 'Migration target.', version: 2 } })
    const defaultSpace = await repository.getSpace('space-org', 'space-default', 'space-owner')
    await expect(repository.updateSpace({ organizationId: 'space-org', spaceId: defaultSpace!.id, actorId: 'space-owner', requestId: 'rename-default', expectedVersion: defaultSpace!.version, idempotencyKey: 'rename-default', request: { name: 'Renamed' } }))
      .rejects.toBeInstanceOf(SpaceValidationError)
    const changed = await repository.setDefaultSpace({ organizationId: 'space-org', spaceId: target!.id, actorId: 'space-owner', requestId: 'default', expectedVersion: updated!.space.version, idempotencyKey: 'make-default' })
    expect(changed).toMatchObject({ space: { isDefault: true, version: 3 } })
    const preview = await repository.previewMigration('space-org', 'space-default', 'space-target', 'space-owner')
    expect(preview).toMatchObject({ canMigrate: true, resourceCounts: { sessions: 0, experts: 0, environments: 0, automations: 0, files: 0 } })
    await expect(repository.getSpace('other-org', 'space-hidden', 'space-owner')).resolves.toBeNull()
  })
})
