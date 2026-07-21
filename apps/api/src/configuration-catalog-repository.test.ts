import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { EmptyConfigurationCatalogRepository } from './configuration-catalog-repository.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'

const expertRow = {
  id: 'expert-incident',
  organization_id: 'organization-relay',
  space_id: 'space-platform',
  name: 'Incident Investigator',
  description: 'Investigates production incidents.',
  visibility: 'space',
  status: 'published',
  published_revision_id: 'expert-revision-1',
  version: 2,
  created_at: new Date('2026-07-12T09:00:00.000Z'),
  updated_at: new Date('2026-07-12T10:00:00.000Z'),
  cursor_updated_at: '2026-07-12T10:00:00.000000Z',
  revision_id: 'expert-revision-1',
  revision_expert_id: 'expert-incident',
  revision_number: 1,
  revision_status: 'published',
  revision_model: 'default',
  revision_environment_id: 'environment-production',
  revision_environment_revision_id: 'environment-revision-1',
  allow_repository_override: true,
  allow_base_branch_override: false,
  revision_created_at: new Date('2026-07-12T09:30:00.000Z'),
  revision_instructions: 'Inspect evidence and verify the fix.',
} as const

const environmentRow = {
  id: 'environment-production',
  organization_id: 'organization-relay',
  space_id: 'space-platform',
  type: 'cloud',
  name: 'Production Environment',
  description: 'Production-safe repository access.',
  visibility: 'space',
  status: 'ready',
  active_revision_id: 'environment-revision-1',
  latest_revision_id: 'environment-revision-1',
  version: 3,
  created_at: new Date('2026-07-12T08:00:00.000Z'),
  updated_at: new Date('2026-07-12T10:30:00.000Z'),
  revision_id: 'environment-revision-1',
  revision_environment_id: 'environment-production',
  revision_number: 1,
  revision_status: 'ready',
  revision_created_at: new Date('2026-07-12T08:30:00.000Z'),
  active_revision_configuration: {
    image: 'ghcr.io/relay/runtime:stable',
    variableReferences: [],
    hooks: [],
    networkPolicy: { mode: 'restricted', allowedHosts: [] },
    sharing: 'space',
    daemonPoolId: null,
  },
  active_revision_checksum: 'a'.repeat(64),
  default_repository_id: 'repository-default',
  default_repository: 'relay/platform',
  default_base_branch: 'main',
  default_is_default: true,
  provisioning_job_id: null,
  provisioning_revision_id: null,
  provisioning_phase: null,
  provisioning_progress: null,
  provisioning_attempt: null,
  provisioning_max_attempts: null,
  provisioning_error_code: null,
  provisioning_error_message: null,
  provisioning_error_retryable: null,
  provisioning_created_at: null,
  provisioning_updated_at: null,
} as const

function repositoryReturning(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows })
  const transactionQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('set_config(')) {
      return { rows: [] }
    }
    return query(sql, parameters)
  })
  const client = { query: transactionQuery, release: vi.fn() }
  return {
    query,
    transactionQuery,
    repository: new PostgresConfigurationCatalogRepository({
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool),
  }
}

describe('PostgresConfigurationCatalogRepository', () => {
  it('maps a bounded Expert page and applies tenant, visibility, and Viewer checks in one query', async () => {
    const second = {
      ...expertRow,
      id: 'expert-build',
      published_revision_id: 'expert-revision-2',
      revision_id: 'expert-revision-2',
      revision_expert_id: 'expert-build',
      updated_at: new Date('2026-07-12T09:45:00.000Z'),
      cursor_updated_at: '2026-07-12T09:45:00.000000Z',
    }
    const third = {
      ...expertRow,
      id: 'expert-review',
      published_revision_id: 'expert-revision-3',
      revision_id: 'expert-revision-3',
      revision_expert_id: 'expert-review',
      updated_at: new Date('2026-07-12T09:30:00.000Z'),
      cursor_updated_at: '2026-07-12T09:30:00.000000Z',
    }
    const { query, repository } = repositoryReturning([expertRow, second, third])

    await expect(repository.listExperts(
      'organization-relay',
      'space-platform',
      'user-admin',
      { limit: 2 },
    )).resolves.toMatchObject({
      items: [{ id: 'expert-incident' }, { id: 'expert-build' }],
      hasMore: true,
      nextCursor: { id: 'expert-build', updatedAt: '2026-07-12T09:45:00.000000Z' },
    })

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]]
    expect(parameters).toEqual(['organization-relay', 'space-platform', 'user-admin', 3])
    expect(sql.match(/EXISTS \(/g)).toHaveLength(2)
    expect(sql).toContain("expert.visibility = 'space' OR expert.created_by = $3")
    expect(sql).toContain("expert.status = 'published'")
    expect(sql).toContain("access.organization_role <> 'viewer' AND access.space_role <> 'viewer'")
    expect(sql).toContain('ORDER BY expert.updated_at DESC, expert.id DESC')
    expect(sql).not.toMatch(/published_revision\.configuration\s+AS/u)
  })

  it('uses a stable keyset cursor and distinguishes missing membership from an empty catalog', async () => {
    const missing = repositoryReturning([])
    await expect(missing.repository.listExperts(
      'organization-relay', 'space-platform', 'user-missing',
    )).resolves.toBeNull()

    const empty = repositoryReturning([{ id: null, updated_at: null }])
    await expect(empty.repository.listExperts(
      'organization-relay', 'space-platform', 'user-member',
    )).resolves.toEqual({ items: [], hasMore: false, nextCursor: null })

    const paged = repositoryReturning([expertRow])
    await paged.repository.listExperts('organization-relay', 'space-platform', 'user-member', {
      limit: 25,
      cursor: { updatedAt: '2026-07-12T11:00:00.000Z', id: 'expert-z' },
    })
    const [sql, parameters] = paged.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('(expert.updated_at, expert.id) < ($4::timestamptz, $5)')
    expect(sql).toContain('LIMIT $6')
    expect(parameters).toEqual([
      'organization-relay', 'space-platform', 'user-member',
      '2026-07-12T11:00:00.000Z', 'expert-z', 26,
    ])
  })

  it('maps Expert detail without returning creator or raw revision configuration', async () => {
    const { query, repository } = repositoryReturning([expertRow])

    const expert = await repository.getExpert(
      'organization-relay', 'space-platform', 'expert-incident', 'user-admin',
    )
    expect(expert).toMatchObject({
      id: 'expert-incident',
      version: 2,
      publishedRevision: {
        id: 'expert-revision-1',
        instructions: 'Inspect evidence and verify the fix.',
      },
    })
    expect(expert).not.toHaveProperty('createdBy')
    expect(expert?.publishedRevision).not.toHaveProperty('createdBy')
    expect(expert?.publishedRevision).not.toHaveProperty('configuration')

    const [sql] = query.mock.calls[0] as [string]
    expect(sql.match(/EXISTS \(/g)).toHaveLength(2)
    expect(sql).not.toMatch(/published_revision\.configuration\s+AS/u)
    expect(sql).toContain('expert.id = $4')
  })

  it('maps Environment summaries and detail repository bindings from explicit columns', async () => {
    const listed = repositoryReturning([environmentRow])
    await expect(listed.repository.listEnvironments(
      'organization-relay', 'space-platform', 'user-admin',
    )).resolves.toMatchObject({
      items: [{
        id: 'environment-production',
        version: 3,
        activeRevision: {
          id: 'environment-revision-1',
          defaultRepository: { repositoryId: 'repository-default', isDefault: true },
        },
      }],
      hasMore: false,
    })
    const [listSql] = listed.query.mock.calls[0] as [string]
    expect(listSql.match(/EXISTS \(/g)).toHaveLength(2)

    const detailRows = [
      {
        ...environmentRow,
        latest_revision_environment_id: 'environment-production',
        latest_revision_number: 1,
        latest_revision_status: 'ready',
        latest_revision_configuration: environmentRow.active_revision_configuration,
        latest_revision_checksum: environmentRow.active_revision_checksum,
        latest_revision_created_at: environmentRow.revision_created_at,
        latest_binding_repository_id: 'repository-default',
        latest_binding_repository: 'relay/platform',
        latest_binding_base_branch: 'main',
        latest_binding_is_default: true,
        active_repository_bindings: [
          { repositoryId: 'repository-default', repository: 'relay/platform', baseBranch: 'main', isDefault: true },
          { repositoryId: 'repository-docs', repository: 'relay/docs', baseBranch: 'main', isDefault: false },
        ],
        provisioning_history: [],
      },
      {
        ...environmentRow,
        latest_revision_environment_id: 'environment-production',
        latest_revision_number: 1,
        latest_revision_status: 'ready',
        latest_revision_configuration: environmentRow.active_revision_configuration,
        latest_revision_checksum: environmentRow.active_revision_checksum,
        latest_revision_created_at: environmentRow.revision_created_at,
        latest_binding_repository_id: 'repository-docs',
        latest_binding_repository: 'relay/docs',
        latest_binding_base_branch: 'main',
        latest_binding_is_default: false,
        active_repository_bindings: [
          { repositoryId: 'repository-default', repository: 'relay/platform', baseBranch: 'main', isDefault: true },
          { repositoryId: 'repository-docs', repository: 'relay/docs', baseBranch: 'main', isDefault: false },
        ],
        provisioning_history: [],
      },
    ]
    const detailed = repositoryReturning(detailRows)
    const environment = await detailed.repository.getEnvironment(
      'organization-relay', 'space-platform', 'environment-production', 'user-admin',
    )
    expect(environment?.activeRevision?.repositoryBindings).toEqual([
      { repositoryId: 'repository-default', repository: 'relay/platform', baseBranch: 'main', isDefault: true },
      { repositoryId: 'repository-docs', repository: 'relay/docs', baseBranch: 'main', isDefault: false },
    ])
    const [sql] = detailed.query.mock.calls[0] as [string]
    expect(sql.match(/EXISTS \(/g)).toHaveLength(2)
    expect(sql).toContain('latest_revision.configuration AS latest_revision_configuration')
    expect(sql).toContain('active_bindings.bindings AS active_repository_bindings')
    expect(sql).toContain("environment.status = 'ready'")
  })

  it('rejects invalid pagination before querying PostgreSQL', async () => {
    const { query, repository } = repositoryReturning([])
    await expect(repository.listExperts(
      'organization-relay', 'space-platform', 'user-admin', { limit: 101 },
    )).rejects.toThrow(RangeError)
    await expect(repository.listEnvironments(
      'organization-relay', 'space-platform', 'user-admin', {
        cursor: { updatedAt: 'invalid', id: 'environment-production' },
      },
    )).rejects.toThrow(RangeError)
    expect(query).not.toHaveBeenCalled()
  })
})

describe('EmptyConfigurationCatalogRepository', () => {
  it('provides a deterministic no-database catalog', async () => {
    const repository = new EmptyConfigurationCatalogRepository()
    await expect(repository.listExperts('organization', 'space', 'actor')).resolves.toEqual({
      items: [], hasMore: false, nextCursor: null,
    })
    await expect(repository.getExpert('organization', 'space', 'expert', 'actor')).resolves.toBeNull()
    await expect(repository.listEnvironments('organization', 'space', 'actor')).resolves.toEqual({
      items: [], hasMore: false, nextCursor: null,
    })
    await expect(repository.getEnvironment('organization', 'space', 'environment', 'actor')).resolves.toBeNull()
  })
})
