import type { CreateExpertRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ExpertConfigurationValidationError,
} from './configuration-catalog-repository.js'
import { runMigrations } from './migrations.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'
import { withApiDatabaseContext } from './postgres-runtime-database.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

const createRequest: CreateExpertRequest = {
  name: 'Release Expert',
  description: 'Prepares verified releases.',
  visibility: 'space',
  instructions: 'Inspect the requested release, make the change, and verify it.',
  model: 'gpt-5.6-sol',
  environmentId: 'environment-ready',
  environmentRevisionId: 'environment-revision-ready',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: false,
  capabilities: ['code-search', 'read-code', 'git'],
  launchGuidance: 'Describe the release scope and acceptance evidence.',
}

describeWithDatabase('Expert lifecycle under the restricted API runtime role', () => {
  const schema = `relay_expert_lifecycle_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const ids = ['expert-created', 'expert-revision-1', 'expert-revision-2']
  const repository = new PostgresConfigurationCatalogRepository(apiPool, {
    createId: () => ids.shift() ?? crypto.randomUUID(),
  })
  let expertVersion = 1

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('expert-org-a', 'Expert Organization A'),
        ('expert-org-b', 'Expert Organization B');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('expert-org-a', 'expert-space', 'Expert Space'),
        ('expert-org-b', 'expert-space', 'Other Expert Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('expert-org-a', 'expert-owner', 'organization_owner'),
        ('expert-org-a', 'expert-member', 'member'),
        ('expert-org-b', 'expert-b-owner', 'organization_owner');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('expert-org-a', 'expert-space', 'expert-owner', 'space_manager'),
        ('expert-org-a', 'expert-space', 'expert-member', 'member'),
        ('expert-org-b', 'expert-space', 'expert-b-owner', 'space_manager');
      INSERT INTO relay_environments (
        organization_id, space_id, id, name, status, created_by
      ) VALUES
        ('expert-org-a', 'expert-space', 'environment-ready', 'Ready Environment', 'draft', 'expert-owner'),
        ('expert-org-b', 'expert-space', 'environment-ready', 'Other Environment', 'draft', 'expert-b-owner');
      INSERT INTO relay_environment_revisions (
        organization_id, space_id, environment_id, id, revision, status, created_by
      ) VALUES
        ('expert-org-a', 'expert-space', 'environment-ready', 'environment-revision-ready', 1, 'draft', 'expert-owner'),
        ('expert-org-b', 'expert-space', 'environment-ready', 'environment-revision-ready', 1, 'draft', 'expert-b-owner');
      INSERT INTO relay_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES
        ('expert-org-a', 'expert-space', 'environment-ready', 'environment-revision-ready',
          'repository-default', 'relay/platform', 'main', true),
        ('expert-org-b', 'expert-space', 'environment-ready', 'environment-revision-ready',
          'repository-default', 'other/platform', 'main', true);
      UPDATE relay_environment_revisions SET status = 'ready'
      WHERE id = 'environment-revision-ready';
      UPDATE relay_environments SET status = 'ready', active_revision_id = 'environment-revision-ready'
      WHERE id = 'environment-ready';
    `)
  })

  afterAll(async () => {
    await apiPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('creates an idempotent draft and rejects a member write at RLS', async () => {
    const created = await repository.createExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      actorId: 'expert-owner',
      idempotencyKey: 'create-release-expert',
      request: createRequest,
    })
    expect(created).toMatchObject({
      replayed: false,
      expert: {
        id: 'expert-created',
        status: 'draft',
        version: 1,
        publishedRevision: null,
        draftRevision: {
          id: 'expert-revision-1',
          revision: 1,
          capabilities: ['code-search', 'read-code', 'git'],
          launchGuidance: createRequest.launchGuidance,
        },
      },
    })

    await expect(repository.createExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      actorId: 'expert-owner',
      idempotencyKey: 'create-release-expert',
      request: createRequest,
    })).resolves.toMatchObject({ replayed: true, expert: { id: 'expert-created' } })

    await expect(repository.createExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      actorId: 'expert-member',
      idempotencyKey: 'member-create-attempt',
      request: { ...createRequest, name: 'Forbidden Expert' },
    })).rejects.toMatchObject({ code: '42501' })

    await expect(repository.updateExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-member',
      expectedVersion: 1,
      request: { name: 'Forbidden update' },
    })).rejects.toMatchObject({ code: '42501' })
  })

  it('publishes immutable revisions and creates a new draft for later edits', async () => {
    const updated = await repository.updateExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
      request: {
        instructions: 'Inspect the release, make the requested change, and verify the evidence.',
        capabilities: ['code-search', 'read-code', 'run-command', 'git'],
      },
    })
    expect(updated).toMatchObject({
      version: 2,
      draftRevision: { id: 'expert-revision-1', revision: 1 },
    })
    expertVersion = updated!.version

    const published = await repository.publishExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
      idempotencyKey: 'publish-release-expert',
    })
    expect(published).toMatchObject({
      replayed: false,
      expert: {
        status: 'published',
        version: 3,
        publishedRevision: { id: 'expert-revision-1', revision: 1, status: 'published' },
        draftRevision: null,
      },
    })
    expertVersion = published!.expert.version

    await expect(withApiDatabaseContext(
      apiPool,
      { organizationId: 'expert-org-a', spaceId: 'expert-space', actorId: 'expert-owner' },
      (client) => client.query(`
        UPDATE relay_expert_revisions SET instructions = 'mutated'
        WHERE id = 'expert-revision-1'
      `),
    )).rejects.toMatchObject({ code: '55000' })

    const editedPublished = await repository.updateExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
      request: { name: 'Release Expert v2' },
    })
    expect(editedPublished).toMatchObject({
      status: 'published',
      version: 4,
      publishedRevision: { id: 'expert-revision-1', revision: 1, status: 'published' },
      draftRevision: { id: expect.any(String), revision: 2, status: 'draft' },
    })
    expertVersion = editedPublished!.version
  })

  it('rejects an inactive Environment and completes disable/archive without tenant leakage', async () => {
    await expect(repository.updateExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
      request: { environmentRevisionId: 'inactive-revision' },
    })).rejects.toBeInstanceOf(ExpertConfigurationValidationError)

    const disabled = await repository.disableExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
    })
    expect(disabled).toMatchObject({ status: 'disabled', version: 5 })
    expertVersion = disabled!.version

    const archived = await repository.archiveExpert({
      organizationId: 'expert-org-a',
      spaceId: 'expert-space',
      expertId: 'expert-created',
      actorId: 'expert-owner',
      expectedVersion: expertVersion,
    })
    expect(archived).toMatchObject({ status: 'archived', version: 6 })

    await expect(repository.getExpert(
      'expert-org-b', 'expert-space', 'expert-created', 'expert-b-owner',
    )).resolves.toBeNull()
  })
})
