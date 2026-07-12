import {
  EnvironmentDetailDtoSchema,
  EnvironmentSummaryDtoSchema,
  ExpertDetailDtoSchema,
  ExpertSummaryDtoSchema,
  type EnvironmentDetailDto,
  type EnvironmentSummaryDto,
  type ExpertDetailDto,
  type ExpertSummaryDto,
} from '@relay/contracts'
import type { Pool } from 'pg'
import type {
  ConfigurationCatalogCursor,
  ConfigurationCatalogListOptions,
  ConfigurationCatalogPage,
  ConfigurationCatalogRepository,
} from './configuration-catalog-repository.js'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100

const accessCte = `
  WITH access AS MATERIALIZED (
    SELECT
      (
        SELECT organization_membership.role
        FROM relay_organization_memberships organization_membership
        WHERE organization_membership.organization_id = $1
          AND organization_membership.actor_id = $3
      ) AS organization_role,
      (
        SELECT space_membership.role
        FROM relay_space_memberships space_membership
        WHERE space_membership.organization_id = $1
          AND space_membership.space_id = $2
          AND space_membership.actor_id = $3
      ) AS space_role
    WHERE EXISTS (
      SELECT 1
      FROM relay_organization_memberships organization_membership
      WHERE organization_membership.organization_id = $1
        AND organization_membership.actor_id = $3
    ) AND EXISTS (
      SELECT 1
      FROM relay_space_memberships space_membership
      WHERE space_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND space_membership.actor_id = $3
    )
  )
`

type TimestampValue = Date | string

type PageRow = {
  id: string | null
  updated_at: TimestampValue | null
  cursor_updated_at: string | null
}

type ExpertRow = PageRow & {
  organization_id: string
  space_id: string
  name: string
  description: string
  visibility: 'private' | 'space'
  status: 'draft' | 'published' | 'disabled' | 'archived'
  published_revision_id: string | null
  version: number
  created_at: TimestampValue
  revision_id: string | null
  revision_expert_id: string | null
  revision_number: number | null
  revision_status: 'published' | null
  revision_model: string | null
  revision_environment_id: string | null
  revision_environment_revision_id: string | null
  allow_repository_override: boolean | null
  allow_base_branch_override: boolean | null
  revision_created_at: TimestampValue | null
  revision_instructions?: string | null
}

type EnvironmentRow = PageRow & {
  organization_id: string
  space_id: string
  name: string
  description: string
  status: 'draft' | 'provisioning' | 'ready' | 'updating' | 'failed' | 'disabled'
  active_revision_id: string | null
  version: number
  created_at: TimestampValue
  revision_id: string | null
  revision_environment_id: string | null
  revision_number: number | null
  revision_status: 'ready' | null
  revision_created_at: TimestampValue | null
  default_repository_id: string | null
  default_repository: string | null
  default_base_branch: string | null
  default_is_default: boolean | null
}

type EnvironmentDetailRow = EnvironmentRow & {
  binding_repository_id: string | null
  binding_repository: string | null
  binding_base_branch: string | null
  binding_is_default: boolean | null
}

const expertSummaryColumns = `
  expert.id,
  expert.organization_id,
  expert.space_id,
  expert.name,
  expert.description,
  expert.visibility,
  expert.status,
  expert.published_revision_id,
  expert.version,
  expert.created_at,
  expert.updated_at,
  to_char(
    expert.updated_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS cursor_updated_at,
  published_revision.id AS revision_id,
  published_revision.expert_id AS revision_expert_id,
  published_revision.revision AS revision_number,
  published_revision.status AS revision_status,
  published_revision.model AS revision_model,
  published_revision.environment_id AS revision_environment_id,
  published_revision.environment_revision_id AS revision_environment_revision_id,
  published_revision.allow_repository_override,
  published_revision.allow_base_branch_override,
  published_revision.created_at AS revision_created_at
`

const environmentSummaryColumns = `
  environment.id,
  environment.organization_id,
  environment.space_id,
  environment.name,
  environment.description,
  environment.status,
  environment.active_revision_id,
  environment.version,
  environment.created_at,
  environment.updated_at,
  to_char(
    environment.updated_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS cursor_updated_at,
  active_revision.id AS revision_id,
  active_revision.environment_id AS revision_environment_id,
  active_revision.revision AS revision_number,
  active_revision.status AS revision_status,
  active_revision.created_at AS revision_created_at,
  default_repository.repository_id AS default_repository_id,
  default_repository.repository AS default_repository,
  default_repository.base_branch AS default_base_branch,
  default_repository.is_default AS default_is_default
`

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function pageSize(limit: number | undefined) {
  const resolved = limit ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_PAGE_SIZE) {
    throw new RangeError(`Catalog page limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`)
  }
  return resolved
}

function cursorClause(
  resource: 'expert' | 'environment',
  cursor: ConfigurationCatalogCursor | undefined,
  limit: number,
) {
  if (!cursor) return { sql: '', parameters: [limit + 1] as const, limitParameter: 4 }
  if (!cursor.id.trim() || Number.isNaN(new Date(cursor.updatedAt).valueOf())) {
    throw new RangeError('Catalog cursor must contain a valid timestamp and resource id.')
  }
  return {
    sql: `AND (${resource}.updated_at, ${resource}.id) < ($4::timestamptz, $5)`,
    parameters: [cursor.updatedAt, cursor.id, limit + 1] as const,
    limitParameter: 6,
  }
}

function mapPage<Row extends PageRow, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
): ConfigurationCatalogPage<Item> | null {
  if (rows.length === 0) return null
  const resourceRows = rows.filter((row) => row.id !== null)
  const hasMore = resourceRows.length > limit
  const selectedRows = resourceRows.slice(0, limit)
  const last = selectedRows.at(-1)
  return {
    items: selectedRows.map(map),
    hasMore,
    nextCursor: hasMore && last?.id !== null && last?.cursor_updated_at != null
      ? { id: last.id, updatedAt: last.cursor_updated_at }
      : null,
  }
}

function mapPublishedRevision(row: ExpertRow) {
  if (row.published_revision_id === null) return null
  return {
    id: row.revision_id,
    expertId: row.revision_expert_id,
    revision: row.revision_number,
    status: row.revision_status,
    model: row.revision_model,
    environmentId: row.revision_environment_id,
    environmentRevisionId: row.revision_environment_revision_id,
    allowRepositoryOverride: row.allow_repository_override,
    allowBaseBranchOverride: row.allow_base_branch_override,
    createdAt: row.revision_created_at === null ? null : timestamp(row.revision_created_at),
  }
}

function mapExpertSummary(row: ExpertRow): ExpertSummaryDto {
  return ExpertSummaryDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    publishedRevisionId: row.published_revision_id,
    publishedRevisionSummary: mapPublishedRevision(row),
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at as TimestampValue),
  })
}

function mapExpertDetail(row: ExpertRow): ExpertDetailDto {
  const summary = mapExpertSummary(row)
  const publishedRevision = mapPublishedRevision(row)
  return ExpertDetailDtoSchema.parse({
    ...summary,
    publishedRevision: publishedRevision === null
      ? null
      : { ...publishedRevision, instructions: row.revision_instructions },
  })
}

function mapDefaultRepository(row: EnvironmentRow) {
  if (row.active_revision_id === null) return null
  return {
    repositoryId: row.default_repository_id,
    repository: row.default_repository,
    baseBranch: row.default_base_branch,
    isDefault: row.default_is_default,
  }
}

function mapEnvironmentSummary(row: EnvironmentRow): EnvironmentSummaryDto {
  const activeRevision = row.active_revision_id === null
    ? null
    : {
        id: row.revision_id,
        environmentId: row.revision_environment_id,
        revision: row.revision_number,
        status: row.revision_status,
        defaultRepository: mapDefaultRepository(row),
        createdAt: row.revision_created_at === null ? null : timestamp(row.revision_created_at),
      }
  return EnvironmentSummaryDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description,
    status: row.status,
    activeRevisionId: row.active_revision_id,
    activeRevision,
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at as TimestampValue),
  })
}

function mapEnvironmentDetail(rows: EnvironmentDetailRow[]): EnvironmentDetailDto {
  const first = rows[0]
  if (!first) throw new Error('Environment detail rows are unexpectedly empty.')
  const summary = mapEnvironmentSummary(first)
  const repositoryBindings = rows.flatMap((row) => row.binding_repository_id === null
    ? []
    : [{
        repositoryId: row.binding_repository_id,
        repository: row.binding_repository,
        baseBranch: row.binding_base_branch,
        isDefault: row.binding_is_default,
      }])
  return EnvironmentDetailDtoSchema.parse({
    ...summary,
    activeRevision: summary.activeRevision === null
      ? null
      : { ...summary.activeRevision, repositoryBindings },
  })
}

export class PostgresConfigurationCatalogRepository implements ConfigurationCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async listExperts(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ConfigurationCatalogListOptions = {},
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto> | null> {
    const limit = pageSize(options.limit)
    const cursor = cursorClause('expert', options.cursor, limit)
    const result = await this.pool.query<ExpertRow>(`
      ${accessCte}
      SELECT item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT ${expertSummaryColumns}
        FROM relay_experts expert
        LEFT JOIN relay_expert_revisions published_revision
          ON published_revision.organization_id = expert.organization_id
          AND published_revision.space_id = expert.space_id
          AND published_revision.expert_id = expert.id
          AND published_revision.id = expert.published_revision_id
          AND published_revision.status = 'published'
        WHERE expert.organization_id = $1
          AND expert.space_id = $2
          AND (expert.visibility = 'space' OR expert.created_by = $3)
          AND (
            expert.status = 'published'
            OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer')
          )
          ${cursor.sql}
        ORDER BY expert.updated_at DESC, expert.id DESC
        LIMIT $${cursor.limitParameter}
      ) item ON true
      ORDER BY item.updated_at DESC NULLS LAST, item.id DESC NULLS LAST
    `, [organizationId, spaceId, actorId, ...cursor.parameters])
    return mapPage(result.rows, limit, mapExpertSummary)
  }

  async getExpert(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<ExpertDetailDto | null> {
    const result = await this.pool.query<ExpertRow>(`
      ${accessCte}
      SELECT item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT ${expertSummaryColumns}, published_revision.instructions AS revision_instructions
        FROM relay_experts expert
        LEFT JOIN relay_expert_revisions published_revision
          ON published_revision.organization_id = expert.organization_id
          AND published_revision.space_id = expert.space_id
          AND published_revision.expert_id = expert.id
          AND published_revision.id = expert.published_revision_id
          AND published_revision.status = 'published'
        WHERE expert.organization_id = $1
          AND expert.space_id = $2
          AND expert.id = $4
          AND (expert.visibility = 'space' OR expert.created_by = $3)
          AND (
            expert.status = 'published'
            OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer')
          )
      ) item ON true
    `, [organizationId, spaceId, actorId, expertId])
    const row = result.rows[0]
    return !row || row.id === null ? null : mapExpertDetail(row)
  }

  async listEnvironments(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ConfigurationCatalogListOptions = {},
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto> | null> {
    const limit = pageSize(options.limit)
    const cursor = cursorClause('environment', options.cursor, limit)
    const result = await this.pool.query<EnvironmentRow>(`
      ${accessCte}
      SELECT item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT ${environmentSummaryColumns}
        FROM relay_environments environment
        LEFT JOIN relay_environment_revisions active_revision
          ON active_revision.organization_id = environment.organization_id
          AND active_revision.space_id = environment.space_id
          AND active_revision.environment_id = environment.id
          AND active_revision.id = environment.active_revision_id
          AND active_revision.status = 'ready'
        LEFT JOIN relay_environment_revision_repositories default_repository
          ON default_repository.organization_id = active_revision.organization_id
          AND default_repository.space_id = active_revision.space_id
          AND default_repository.environment_id = active_revision.environment_id
          AND default_repository.environment_revision_id = active_revision.id
          AND default_repository.is_default
        WHERE environment.organization_id = $1
          AND environment.space_id = $2
          AND (
            environment.status = 'ready'
            OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer')
          )
          ${cursor.sql}
        ORDER BY environment.updated_at DESC, environment.id DESC
        LIMIT $${cursor.limitParameter}
      ) item ON true
      ORDER BY item.updated_at DESC NULLS LAST, item.id DESC NULLS LAST
    `, [organizationId, spaceId, actorId, ...cursor.parameters])
    return mapPage(result.rows, limit, mapEnvironmentSummary)
  }

  async getEnvironment(
    organizationId: string,
    spaceId: string,
    environmentId: string,
    actorId: string,
  ): Promise<EnvironmentDetailDto | null> {
    const result = await this.pool.query<EnvironmentDetailRow>(`
      ${accessCte}
      SELECT item.*,
        repository_binding.repository_id AS binding_repository_id,
        repository_binding.repository AS binding_repository,
        repository_binding.base_branch AS binding_base_branch,
        repository_binding.is_default AS binding_is_default
      FROM access
      LEFT JOIN LATERAL (
        SELECT ${environmentSummaryColumns}
        FROM relay_environments environment
        LEFT JOIN relay_environment_revisions active_revision
          ON active_revision.organization_id = environment.organization_id
          AND active_revision.space_id = environment.space_id
          AND active_revision.environment_id = environment.id
          AND active_revision.id = environment.active_revision_id
          AND active_revision.status = 'ready'
        LEFT JOIN relay_environment_revision_repositories default_repository
          ON default_repository.organization_id = active_revision.organization_id
          AND default_repository.space_id = active_revision.space_id
          AND default_repository.environment_id = active_revision.environment_id
          AND default_repository.environment_revision_id = active_revision.id
          AND default_repository.is_default
        WHERE environment.organization_id = $1
          AND environment.space_id = $2
          AND environment.id = $4
          AND (
            environment.status = 'ready'
            OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer')
          )
      ) item ON true
      LEFT JOIN relay_environment_revision_repositories repository_binding
        ON repository_binding.organization_id = item.organization_id
        AND repository_binding.space_id = item.space_id
        AND repository_binding.environment_id = item.id
        AND repository_binding.environment_revision_id = item.revision_id
      ORDER BY repository_binding.is_default DESC NULLS LAST, repository_binding.repository_id ASC NULLS LAST
    `, [organizationId, spaceId, actorId, environmentId])
    const first = result.rows[0]
    return !first || first.id === null ? null : mapEnvironmentDetail(result.rows)
  }
}
