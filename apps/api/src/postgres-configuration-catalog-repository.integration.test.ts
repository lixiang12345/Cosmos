import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgresConfigurationCatalogRepository integration', () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const repository = new PostgresConfigurationCatalogRepository(pool)

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query(`
      ALTER TABLE relay_session_events DISABLE TRIGGER relay_session_events_reject_truncate;
      ALTER TABLE relay_audit_events DISABLE TRIGGER relay_audit_events_reject_truncate;
      ALTER TABLE relay_attempts DISABLE TRIGGER relay_attempts_reject_truncate;
      ALTER TABLE relay_artifacts DISABLE TRIGGER relay_artifacts_reject_truncate;
      ALTER TABLE relay_files DISABLE TRIGGER relay_files_reject_truncate;
      ALTER TABLE relay_file_versions DISABLE TRIGGER relay_file_versions_reject_truncate;
      ALTER TABLE relay_tool_calls DISABLE TRIGGER relay_tool_calls_reject_truncate;
      ALTER TABLE relay_approvals DISABLE TRIGGER relay_approvals_reject_truncate;
      ALTER TABLE relay_tool_side_effects DISABLE TRIGGER relay_tool_side_effects_reject_truncate;
      ALTER TABLE relay_approval_assignments DISABLE TRIGGER relay_approval_assignments_reject_truncate;
      ALTER TABLE relay_approval_decisions DISABLE TRIGGER relay_approval_decisions_reject_truncate;
      ALTER TABLE relay_session_workers DISABLE TRIGGER relay_session_workers_reject_truncate;
    `)
    try {
      await pool.query('TRUNCATE relay_organizations CASCADE')
    } finally {
      await pool.query(`
        ALTER TABLE relay_session_events ENABLE TRIGGER relay_session_events_reject_truncate;
        ALTER TABLE relay_audit_events ENABLE TRIGGER relay_audit_events_reject_truncate;
        ALTER TABLE relay_attempts ENABLE TRIGGER relay_attempts_reject_truncate;
        ALTER TABLE relay_artifacts ENABLE TRIGGER relay_artifacts_reject_truncate;
        ALTER TABLE relay_files ENABLE TRIGGER relay_files_reject_truncate;
        ALTER TABLE relay_file_versions ENABLE TRIGGER relay_file_versions_reject_truncate;
        ALTER TABLE relay_tool_calls ENABLE TRIGGER relay_tool_calls_reject_truncate;
        ALTER TABLE relay_approvals ENABLE TRIGGER relay_approvals_reject_truncate;
        ALTER TABLE relay_tool_side_effects ENABLE TRIGGER relay_tool_side_effects_reject_truncate;
        ALTER TABLE relay_approval_assignments ENABLE TRIGGER relay_approval_assignments_reject_truncate;
        ALTER TABLE relay_approval_decisions ENABLE TRIGGER relay_approval_decisions_reject_truncate;
        ALTER TABLE relay_session_workers ENABLE TRIGGER relay_session_workers_reject_truncate;
      `)
    }
    await pool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('catalog-org-a', 'Catalog Organization A'),
        ('catalog-org-b', 'Catalog Organization B');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('catalog-org-a', 'catalog-space', 'Catalog Space'),
        ('catalog-org-a', 'catalog-empty', 'Empty Catalog'),
        ('catalog-org-a', 'catalog-precision', 'Cursor Precision Catalog'),
        ('catalog-org-b', 'catalog-space', 'Other Catalog Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('catalog-org-a', 'catalog-owner', 'organization_owner'),
        ('catalog-org-a', 'catalog-peer', 'member'),
        ('catalog-org-a', 'catalog-viewer', 'viewer'),
        ('catalog-org-a', 'catalog-space-viewer', 'member'),
        ('catalog-org-b', 'catalog-b-owner', 'organization_owner');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('catalog-org-a', 'catalog-space', 'catalog-owner', 'space_manager'),
        ('catalog-org-a', 'catalog-empty', 'catalog-owner', 'space_manager'),
        ('catalog-org-a', 'catalog-precision', 'catalog-owner', 'space_manager'),
        ('catalog-org-a', 'catalog-space', 'catalog-peer', 'member'),
        ('catalog-org-a', 'catalog-space', 'catalog-viewer', 'space_manager'),
        ('catalog-org-a', 'catalog-space', 'catalog-space-viewer', 'viewer'),
        ('catalog-org-b', 'catalog-space', 'catalog-b-owner', 'space_manager');

      INSERT INTO relay_environments (
        organization_id, space_id, id, name, description, status, created_by, created_at, updated_at
      ) VALUES
        ('catalog-org-a', 'catalog-space', 'environment-ready', 'Ready Environment', 'Ready for execution.',
          'draft', 'catalog-owner', '2026-07-12T08:00:00Z', '2026-07-12T08:00:00Z'),
        ('catalog-org-a', 'catalog-space', 'environment-draft', 'Draft Environment', 'Still being configured.',
          'draft', 'catalog-owner', '2026-07-12T07:00:00Z', '2026-07-12T07:00:00Z'),
        ('catalog-org-b', 'catalog-space', 'environment-ready', 'Other Tenant Environment', 'Tenant B only.',
          'draft', 'catalog-b-owner', '2026-07-12T08:00:00Z', '2026-07-12T08:00:00Z');
      INSERT INTO relay_environment_revisions (
        organization_id, space_id, environment_id, id, revision, status, configuration, created_by, created_at
      ) VALUES
        ('catalog-org-a', 'catalog-space', 'environment-ready', 'environment-revision-ready', 1, 'draft',
          '{"secretValue":"catalog-environment-secret"}', 'catalog-owner', '2026-07-12T08:10:00Z'),
        ('catalog-org-b', 'catalog-space', 'environment-ready', 'environment-revision-ready', 1, 'draft',
          '{}', 'catalog-b-owner', '2026-07-12T08:10:00Z');
      INSERT INTO relay_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES
        ('catalog-org-a', 'catalog-space', 'environment-ready', 'environment-revision-ready',
          'repository-default', 'relay/platform', 'main', true),
        ('catalog-org-a', 'catalog-space', 'environment-ready', 'environment-revision-ready',
          'repository-secondary', 'relay/docs', 'main', false),
        ('catalog-org-b', 'catalog-space', 'environment-ready', 'environment-revision-ready',
          'repository-default', 'other/platform', 'main', true);
      UPDATE relay_environment_revisions SET status = 'ready'
      WHERE environment_id = 'environment-ready';
      UPDATE relay_environments
      SET status = 'ready', active_revision_id = 'environment-revision-ready'
      WHERE id = 'environment-ready';

      INSERT INTO relay_experts (
        organization_id, space_id, id, name, description, visibility, status, created_by, created_at, updated_at
      ) VALUES
        ('catalog-org-a', 'catalog-space', 'expert-published', 'Published Expert', 'Visible published Expert.',
          'space', 'draft', 'catalog-owner', '2026-07-12T09:00:00Z', '2026-07-12T09:00:00Z'),
        ('catalog-org-a', 'catalog-space', 'expert-private', 'Private Expert', 'Owner-only Expert.',
          'private', 'draft', 'catalog-owner', '2026-07-12T08:50:00Z', '2026-07-12T08:50:00Z'),
        ('catalog-org-a', 'catalog-space', 'expert-disabled', 'Disabled Expert', 'Previously published Expert.',
          'space', 'draft', 'catalog-owner', '2026-07-12T08:40:00Z', '2026-07-12T08:40:00Z'),
        ('catalog-org-a', 'catalog-space', 'expert-draft', 'Draft Expert', 'Member-visible draft Expert.',
          'space', 'draft', 'catalog-owner', '2026-07-12T08:30:00Z', '2026-07-12T08:30:00Z'),
        ('catalog-org-b', 'catalog-space', 'expert-published', 'Other Tenant Expert', 'Tenant B only.',
          'space', 'draft', 'catalog-b-owner', '2026-07-12T09:00:00Z', '2026-07-12T09:00:00Z');
      INSERT INTO relay_expert_revisions (
        organization_id, space_id, expert_id, id, revision, status, environment_id,
        environment_revision_id, allow_repository_override, allow_base_branch_override,
        instructions, model, configuration, created_by, created_at
      ) VALUES
        ('catalog-org-a', 'catalog-space', 'expert-published', 'expert-revision-published', 1, 'draft',
          'environment-ready', 'environment-revision-ready', true, false,
          'Use verified evidence.', 'default', '{"secretValue":"catalog-expert-secret"}',
          'catalog-owner', '2026-07-12T09:10:00Z'),
        ('catalog-org-a', 'catalog-space', 'expert-private', 'expert-revision-private', 1, 'draft',
          'environment-ready', 'environment-revision-ready', false, false,
          'Private instructions.', 'default', '{}', 'catalog-owner', '2026-07-12T09:11:00Z'),
        ('catalog-org-a', 'catalog-space', 'expert-disabled', 'expert-revision-disabled', 1, 'draft',
          'environment-ready', 'environment-revision-ready', true, true,
          'Disabled instructions.', 'default', '{}', 'catalog-owner', '2026-07-12T09:12:00Z'),
        ('catalog-org-b', 'catalog-space', 'expert-published', 'expert-revision-published', 1, 'draft',
          'environment-ready', 'environment-revision-ready', true, true,
          'Other tenant instructions.', 'default', '{}', 'catalog-b-owner', '2026-07-12T09:10:00Z');
      UPDATE relay_expert_revisions SET status = 'published';
      UPDATE relay_experts
      SET status = 'published', published_revision_id = CASE id
        WHEN 'expert-private' THEN 'expert-revision-private'
        WHEN 'expert-disabled' THEN 'expert-revision-disabled'
        ELSE 'expert-revision-published'
      END
      WHERE id <> 'expert-draft';
      UPDATE relay_experts SET status = 'disabled'
      WHERE organization_id = 'catalog-org-a' AND id = 'expert-disabled';

      INSERT INTO relay_experts (
        organization_id, space_id, id, name, visibility, status, created_by, created_at, updated_at
      ) VALUES
        ('catalog-org-a', 'catalog-precision', 'expert-micro-900', 'Microsecond 900',
          'space', 'draft', 'catalog-owner', '2026-07-12T10:00:00.123900Z', '2026-07-12T10:00:00.123900Z'),
        ('catalog-org-a', 'catalog-precision', 'expert-micro-800', 'Microsecond 800',
          'space', 'draft', 'catalog-owner', '2026-07-12T10:00:00.123800Z', '2026-07-12T10:00:00.123800Z'),
        ('catalog-org-a', 'catalog-precision', 'expert-micro-700', 'Microsecond 700',
          'space', 'draft', 'catalog-owner', '2026-07-12T10:00:00.123700Z', '2026-07-12T10:00:00.123700Z');
    `)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('distinguishes an authorized empty catalog from missing or revoked membership', async () => {
    await expect(repository.listExperts(
      'catalog-org-a', 'catalog-empty', 'catalog-owner',
    )).resolves.toEqual({ items: [], hasMore: false, nextCursor: null })
    await expect(repository.listExperts(
      'catalog-org-a', 'catalog-space', 'catalog-b-owner',
    )).resolves.toBeNull()

    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = 'catalog-org-a' AND space_id = 'catalog-space' AND actor_id = 'catalog-peer'
    `)
    await expect(repository.listEnvironments(
      'catalog-org-a', 'catalog-space', 'catalog-peer',
    )).resolves.toBeNull()
    await pool.query(`
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('catalog-org-a', 'catalog-space', 'catalog-peer', 'member')
    `)
  })

  it('isolates tenants and conceals Private Experts from non-owners', async () => {
    await expect(repository.getExpert(
      'catalog-org-a', 'catalog-space', 'expert-private', 'catalog-owner',
    )).resolves.toMatchObject({ id: 'expert-private', visibility: 'private' })
    await expect(repository.getExpert(
      'catalog-org-a', 'catalog-space', 'expert-private', 'catalog-peer',
    )).resolves.toBeNull()
    await expect(repository.getExpert(
      'catalog-org-a', 'catalog-space', 'expert-published', 'catalog-b-owner',
    )).resolves.toBeNull()
    await expect(repository.getExpert(
      'catalog-org-b', 'catalog-space', 'expert-published', 'catalog-b-owner',
    )).resolves.toMatchObject({ name: 'Other Tenant Expert' })
  })

  it('limits effective Viewers to Published Experts and Ready Environments', async () => {
    const organizationViewerExperts = await repository.listExperts(
      'catalog-org-a', 'catalog-space', 'catalog-viewer',
    )
    const spaceViewerExperts = await repository.listExperts(
      'catalog-org-a', 'catalog-space', 'catalog-space-viewer',
    )
    expect(organizationViewerExperts?.items.map((expert) => expert.status)).toEqual(['published'])
    expect(spaceViewerExperts?.items.map((expert) => expert.status)).toEqual(['published'])
    await expect(repository.getExpert(
      'catalog-org-a', 'catalog-space', 'expert-draft', 'catalog-viewer',
    )).resolves.toBeNull()

    const viewerEnvironments = await repository.listEnvironments(
      'catalog-org-a', 'catalog-space', 'catalog-viewer',
    )
    expect(viewerEnvironments?.items.map((environment) => environment.status)).toEqual(['ready'])
    const memberEnvironments = await repository.listEnvironments(
      'catalog-org-a', 'catalog-space', 'catalog-peer',
    )
    expect(memberEnvironments?.items.map((environment) => environment.status).sort()).toEqual(['draft', 'ready'])
  })

  it('paginates with a stable keyset cursor without returning duplicates', async () => {
    const first = await repository.listExperts(
      'catalog-org-a', 'catalog-space', 'catalog-owner', { limit: 2 },
    )
    expect(first?.hasMore).toBe(true)
    expect(first?.nextCursor).not.toBeNull()
    const second = await repository.listExperts(
      'catalog-org-a', 'catalog-space', 'catalog-owner', {
        limit: 2,
        cursor: first?.nextCursor ?? undefined,
      },
    )
    const firstIds = new Set(first?.items.map((expert) => expert.id))
    expect(second?.items.every((expert) => !firstIds.has(expert.id))).toBe(true)
  })

  it('preserves PostgreSQL microseconds across keyset page boundaries', async () => {
    const ids: string[] = []
    let cursor: { updatedAt: string; id: string } | undefined

    for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
      const page = await repository.listExperts(
        'catalog-org-a', 'catalog-precision', 'catalog-owner', { limit: 1, cursor },
      )
      expect(page?.items).toHaveLength(1)
      ids.push(page!.items[0]!.id)
      cursor = page?.nextCursor ?? undefined
      if (pageNumber < 2) expect(cursor?.updatedAt).toMatch(/\.\d{6}Z$/)
    }

    expect(ids).toEqual(['expert-micro-900', 'expert-micro-800', 'expert-micro-700'])
    expect(new Set(ids).size).toBe(3)
  })

  it('returns only safe revision and repository fields from detail queries', async () => {
    const expert = await repository.getExpert(
      'catalog-org-a', 'catalog-space', 'expert-published', 'catalog-owner',
    )
    expect(expert?.publishedRevision).toMatchObject({
      id: 'expert-revision-published',
      instructions: 'Use verified evidence.',
    })
    expect(JSON.stringify(expert)).not.toContain('catalog-expert-secret')
    expect(expert?.publishedRevision).not.toHaveProperty('configuration')

    const environment = await repository.getEnvironment(
      'catalog-org-a', 'catalog-space', 'environment-ready', 'catalog-owner',
    )
    expect(environment?.activeRevision?.repositoryBindings).toEqual([
      { repositoryId: 'repository-default', repository: 'relay/platform', baseBranch: 'main', isDefault: true },
      { repositoryId: 'repository-secondary', repository: 'relay/docs', baseBranch: 'main', isDefault: false },
    ])
    expect(JSON.stringify(environment)).not.toContain('catalog-environment-secret')
    expect(environment?.activeRevision).not.toHaveProperty('configuration')
  })
})
