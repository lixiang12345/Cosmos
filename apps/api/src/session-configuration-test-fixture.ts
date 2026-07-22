import type { Pool } from 'pg'

export type SeededSessionConfiguration = {
  expertId: string
  expertRevisionId: string
  environmentId: string
  environmentRevisionId: string
  repositoryId: string
  repository: string
  baseBranch: string
}

export async function seedSessionConfiguration(
  pool: Pool,
  organizationId: string,
  spaceId: string,
  options: {
    repository?: string
    baseBranch?: string
    allowRepositoryOverride?: boolean
    allowBaseBranchOverride?: boolean
    expertVisibility?: 'private' | 'space'
    expertCreatedBy?: string
  } = {},
): Promise<SeededSessionConfiguration> {
  const configuration = {
    expertId: 'expert-pr-author',
    expertRevisionId: 'expert-revision-1',
    environmentId: 'environment-default',
    environmentRevisionId: 'environment-revision-1',
    repositoryId: 'repository-default',
    repository: options.repository ?? 'commerce/checkout',
    baseBranch: options.baseBranch ?? 'main',
  }
  const actorId = options.expertCreatedBy ?? 'system:test-fixture'

  await pool.query(`
    INSERT INTO cosmos_environments (
      organization_id, space_id, id, name, status, created_by
    ) VALUES ($1, $2, $3, 'Default Environment', 'draft', $4)
  `, [organizationId, spaceId, configuration.environmentId, actorId])
  await pool.query(`
    INSERT INTO cosmos_environment_revisions (
      organization_id, space_id, environment_id, id, revision, status, created_by
    ) VALUES ($1, $2, $3, $4, 1, 'draft', $5)
  `, [organizationId, spaceId, configuration.environmentId, configuration.environmentRevisionId, actorId])
  await pool.query(`
    INSERT INTO cosmos_environment_revision_repositories (
      organization_id, space_id, environment_id, environment_revision_id,
      repository_id, repository, base_branch, is_default
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
  `, [
    organizationId,
    spaceId,
    configuration.environmentId,
    configuration.environmentRevisionId,
    configuration.repositoryId,
    configuration.repository,
    configuration.baseBranch,
  ])
  await pool.query(`
    UPDATE cosmos_environment_revisions SET status = 'ready'
    WHERE organization_id = $1 AND space_id = $2 AND environment_id = $3 AND id = $4
  `, [organizationId, spaceId, configuration.environmentId, configuration.environmentRevisionId])
  await pool.query(`
    UPDATE cosmos_environments
    SET status = 'ready', active_revision_id = $4, updated_at = now()
    WHERE organization_id = $1 AND space_id = $2 AND id = $3
  `, [organizationId, spaceId, configuration.environmentId, configuration.environmentRevisionId])
  await pool.query(`
    INSERT INTO cosmos_experts (
      organization_id, space_id, id, name, status, visibility, created_by
    ) VALUES ($1, $2, $3, 'Authoritative PR Author', 'draft', $4, $5)
  `, [
    organizationId,
    spaceId,
    configuration.expertId,
    options.expertVisibility ?? 'space',
    actorId,
  ])
  await pool.query(`
    INSERT INTO cosmos_expert_revisions (
      organization_id, space_id, expert_id, id, revision, status,
      environment_id, environment_revision_id, allow_repository_override,
      allow_base_branch_override, created_by
    ) VALUES ($1, $2, $3, $4, 1, 'draft', $5, $6, $7, $8, $9)
  `, [
    organizationId,
    spaceId,
    configuration.expertId,
    configuration.expertRevisionId,
    configuration.environmentId,
    configuration.environmentRevisionId,
    options.allowRepositoryOverride ?? true,
    options.allowBaseBranchOverride ?? true,
    actorId,
  ])
  await pool.query(`
    UPDATE cosmos_expert_revisions SET status = 'published'
    WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $4
  `, [organizationId, spaceId, configuration.expertId, configuration.expertRevisionId])
  await pool.query(`
    UPDATE cosmos_experts
    SET status = 'published', published_revision_id = $4, updated_at = now()
    WHERE organization_id = $1 AND space_id = $2 AND id = $3
  `, [organizationId, spaceId, configuration.expertId, configuration.expertRevisionId])

  return configuration
}
