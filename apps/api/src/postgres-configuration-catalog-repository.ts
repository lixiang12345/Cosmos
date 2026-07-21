import { createHash, randomUUID } from 'node:crypto'
import {
  EnvironmentDetailDtoSchema,
  EnvironmentSummaryDtoSchema,
  ExpertDetailDtoSchema,
  ExpertSummaryDtoSchema,
  ExpertDraftRevisionDtoSchema,
  ExpertPublishedRevisionDtoSchema,
  type CreateExpertRequest,
  type EnvironmentDetailDto,
  type EnvironmentSummaryDto,
  type ExpertDetailDto,
  type ExpertSummaryDto,
  type ExpertDraftRevisionDto,
  type ExpertPublishedRevisionDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import { queryWithApiDatabaseContext, withApiDatabaseContext } from './postgres-runtime-database.js'
import type {
  ConfigurationCatalogCursor,
  ConfigurationCatalogListOptions,
  ConfigurationCatalogPage,
  ConfigurationCatalogRepository,
  CreateExpertRecord,
  ExpertMutationResult,
  ExpertVersionMutationRecord,
  UpdateExpertRecord,
} from './configuration-catalog-repository.js'
import {
  ExpertConfigurationValidationError,
  ExpertIdempotencyConflictError,
  ExpertStateConflictError,
  ExpertVersionConflictError,
} from './configuration-catalog-repository.js'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000

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
  revision_capabilities: unknown
  revision_launch_guidance: string | null
  draft_revision_id?: string | null
  draft_revision_expert_id?: string | null
  draft_revision_number?: number | null
  draft_revision_status?: 'draft' | null
  draft_revision_model?: string | null
  draft_revision_environment_id?: string | null
  draft_revision_environment_revision_id?: string | null
  draft_allow_repository_override?: boolean | null
  draft_allow_base_branch_override?: boolean | null
  draft_revision_created_at?: TimestampValue | null
  draft_revision_instructions?: string | null
  draft_revision_capabilities?: unknown
  draft_revision_launch_guidance?: string | null
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
  , published_revision.configuration -> 'capabilities' AS revision_capabilities
  , published_revision.configuration ->> 'launchGuidance' AS revision_launch_guidance
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

const expertDetailDraftColumns = `
  published_revision.instructions AS revision_instructions,
  draft_revision.id AS draft_revision_id,
  draft_revision.expert_id AS draft_revision_expert_id,
  draft_revision.revision AS draft_revision_number,
  draft_revision.status AS draft_revision_status,
  draft_revision.model AS draft_revision_model,
  draft_revision.environment_id AS draft_revision_environment_id,
  draft_revision.environment_revision_id AS draft_revision_environment_revision_id,
  draft_revision.allow_repository_override AS draft_allow_repository_override,
  draft_revision.allow_base_branch_override AS draft_allow_base_branch_override,
  draft_revision.created_at AS draft_revision_created_at,
  draft_revision.instructions AS draft_revision_instructions,
  draft_revision.configuration -> 'capabilities' AS draft_revision_capabilities,
  draft_revision.configuration ->> 'launchGuidance' AS draft_revision_launch_guidance
`

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function revisionConfiguration(input: Pick<CreateExpertRequest, 'capabilities' | 'launchGuidance'>) {
  return { capabilities: input.capabilities, launchGuidance: input.launchGuidance }
}

async function selectExpertDetail(
  client: PoolClient,
  organizationId: string,
  spaceId: string,
  expertId: string,
) {
  const result = await client.query<ExpertRow>(`
    SELECT ${expertSummaryColumns}, ${expertDetailDraftColumns}
    FROM relay_experts expert
    LEFT JOIN relay_expert_revisions published_revision
      ON published_revision.organization_id = expert.organization_id
      AND published_revision.space_id = expert.space_id
      AND published_revision.expert_id = expert.id
      AND published_revision.id = expert.published_revision_id
      AND published_revision.status = 'published'
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM relay_expert_revisions candidate
      WHERE candidate.organization_id = expert.organization_id
        AND candidate.space_id = expert.space_id
        AND candidate.expert_id = expert.id
        AND candidate.status = 'draft'
      ORDER BY candidate.revision DESC
      LIMIT 1
    ) draft_revision ON true
    WHERE expert.organization_id = $1 AND expert.space_id = $2 AND expert.id = $3
  `, [organizationId, spaceId, expertId])
  return result.rows[0] ? mapExpertDetail(result.rows[0]) : null
}

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

function mapPublishedRevisionSummary(row: ExpertRow) {
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
    publishedRevisionSummary: mapPublishedRevisionSummary(row),
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at as TimestampValue),
  })
}

function mapExpertDetail(row: ExpertRow): ExpertDetailDto {
  const summary = mapExpertSummary(row)
  const publishedRevisionSummary = mapPublishedRevisionSummary(row)
  const publishedRevision = publishedRevisionSummary === null
    ? null
    : ExpertPublishedRevisionDtoSchema.parse({
        ...publishedRevisionSummary,
        instructions: row.revision_instructions,
        capabilities: Array.isArray(row.revision_capabilities) ? row.revision_capabilities : [],
        launchGuidance: row.revision_launch_guidance ?? '',
      })
  const draftRevision = row.draft_revision_id == null
    ? null
    : ExpertDraftRevisionDtoSchema.parse({
        id: row.draft_revision_id,
        expertId: row.draft_revision_expert_id,
        revision: row.draft_revision_number,
        status: row.draft_revision_status,
        model: row.draft_revision_model,
        environmentId: row.draft_revision_environment_id,
        environmentRevisionId: row.draft_revision_environment_revision_id,
        allowRepositoryOverride: row.draft_allow_repository_override,
        allowBaseBranchOverride: row.draft_allow_base_branch_override,
        instructions: row.draft_revision_instructions,
        capabilities: Array.isArray(row.draft_revision_capabilities)
          ? row.draft_revision_capabilities
          : [],
        launchGuidance: row.draft_revision_launch_guidance ?? '',
        createdAt: row.draft_revision_created_at == null
          ? null
          : timestamp(row.draft_revision_created_at),
      })
  return ExpertDetailDtoSchema.parse({
    ...summary,
    publishedRevision: publishedRevision === null
      ? null
      : publishedRevision,
    draftRevisionId: draftRevision?.id ?? null,
    draftRevision,
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
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(
    private readonly pool: Pool,
    options: { createId?: () => string; now?: () => Date } = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  private async validateEnvironment(
    client: PoolClient,
    organizationId: string,
    spaceId: string,
    environmentId: string,
    environmentRevisionId: string,
  ) {
    const result = await client.query(`
      SELECT 1
      FROM relay_environments environment
      JOIN relay_environment_revisions revision
        ON revision.organization_id = environment.organization_id
        AND revision.space_id = environment.space_id
        AND revision.environment_id = environment.id
        AND revision.id = environment.active_revision_id
        AND revision.status = 'ready'
      WHERE environment.organization_id = $1 AND environment.space_id = $2
        AND environment.id = $3 AND environment.status = 'ready'
        AND environment.active_revision_id = $4
    `, [organizationId, spaceId, environmentId, environmentRevisionId])
    if (result.rowCount === 0) {
      throw new ExpertConfigurationValidationError(
        'The selected Environment revision is not active and ready.',
        {
          environmentId: ['Select a Ready Environment in the current Space.'],
          environmentRevisionId: ['Use the active revision returned by the Environment Catalog.'],
        },
      )
    }
  }

  private async prepareIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      spaceId: string
      actorId: string
      method: 'POST'
      canonicalPath: string
      idempotencyKey: string
      request: unknown
    },
  ) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [canonicalJson([
      input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash,
    ])])
    const now = this.now()
    await client.query(`
      DELETE FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    const existing = await client.query<{ request_hash: string; response_body: unknown }>(`
      SELECT request_hash, response_body
      FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at > $6
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new ExpertIdempotencyConflictError()
      return {
        replay: ExpertDetailDtoSchema.parse(existing.rows[0].response_body),
        keyHash,
        requestHash,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
      }
    }
    return {
      replay: null,
      keyHash,
      requestHash,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    }
  }

  private async saveIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      spaceId: string
      actorId: string
      method: 'POST'
      canonicalPath: string
      keyHash: string
      requestHash: string
      expiresAt: string
      expert: ExpertDetailDto
      statusCode: number
    },
  ) {
    await client.query(`
      INSERT INTO relay_control_plane_idempotency (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, status_code, response_body,
        response_headers, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
    `, [
      input.organizationId, input.spaceId, input.actorId, input.method,
      input.canonicalPath, input.keyHash, input.requestHash, input.statusCode,
      JSON.stringify(input.expert), JSON.stringify({ etag: `"${input.expert.version}"` }),
      input.expiresAt,
    ])
  }

  async hasRepositoryAccess(
    organizationId: string,
    spaceId: string,
    actorId: string,
    repository: string,
  ): Promise<boolean> {
    const result = await queryWithApiDatabaseContext<{ allowed: boolean }>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
      ${accessCte}
      SELECT EXISTS (
        SELECT 1
        FROM access
        JOIN relay_environments environment
          ON environment.organization_id = $1
          AND environment.space_id = $2
          AND environment.status = 'ready'
          AND environment.active_revision_id IS NOT NULL
        JOIN relay_environment_revisions active_revision
          ON active_revision.organization_id = environment.organization_id
          AND active_revision.space_id = environment.space_id
          AND active_revision.environment_id = environment.id
          AND active_revision.id = environment.active_revision_id
          AND active_revision.status = 'ready'
        JOIN relay_environment_revision_repositories repository_binding
          ON repository_binding.organization_id = active_revision.organization_id
          AND repository_binding.space_id = active_revision.space_id
          AND repository_binding.environment_id = active_revision.environment_id
          AND repository_binding.environment_revision_id = active_revision.id
          AND repository_binding.repository = $4
      ) AS allowed
      `,
      [organizationId, spaceId, actorId, repository.trim()],
    )
    return result.rows[0]?.allowed === true
  }

  async listExperts(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ConfigurationCatalogListOptions = {},
  ): Promise<ConfigurationCatalogPage<ExpertSummaryDto> | null> {
    const limit = pageSize(options.limit)
    const cursor = cursorClause('expert', options.cursor, limit)
    const result = await queryWithApiDatabaseContext<ExpertRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
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
      `,
      [organizationId, spaceId, actorId, ...cursor.parameters],
    )
    return mapPage(result.rows, limit, mapExpertSummary)
  }

  async getExpert(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<ExpertDetailDto | null> {
    const result = await queryWithApiDatabaseContext<ExpertRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
      ${accessCte}
      SELECT item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT ${expertSummaryColumns}, ${expertDetailDraftColumns}
        FROM relay_experts expert
        LEFT JOIN relay_expert_revisions published_revision
          ON published_revision.organization_id = expert.organization_id
          AND published_revision.space_id = expert.space_id
          AND published_revision.expert_id = expert.id
          AND published_revision.id = expert.published_revision_id
          AND published_revision.status = 'published'
        LEFT JOIN LATERAL (
          SELECT candidate.*
          FROM relay_expert_revisions candidate
          WHERE candidate.organization_id = expert.organization_id
            AND candidate.space_id = expert.space_id
            AND candidate.expert_id = expert.id
            AND candidate.status = 'draft'
          ORDER BY candidate.revision DESC
          LIMIT 1
        ) draft_revision ON true
        WHERE expert.organization_id = $1
          AND expert.space_id = $2
          AND expert.id = $4
          AND (expert.visibility = 'space' OR expert.created_by = $3)
          AND (
            expert.status = 'published'
            OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer')
          )
      ) item ON true
      `,
      [organizationId, spaceId, actorId, expertId],
    )
    const row = result.rows[0]
    return !row || row.id === null ? null : mapExpertDetail(row)
  }

  async createExpert(record: CreateExpertRecord): Promise<ExpertMutationResult> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/experts`
      const idempotency = await this.prepareIdempotency(client, {
        ...record,
        method: 'POST',
        canonicalPath,
        request: record.request,
      })
      if (idempotency.replay) return { expert: idempotency.replay, replayed: true }
      await this.validateEnvironment(
        client,
        record.organizationId,
        record.spaceId,
        record.request.environmentId,
        record.request.environmentRevisionId,
      )
      const expertId = this.createId()
      const revisionId = this.createId()
      await client.query(`
        INSERT INTO relay_experts (
          organization_id, space_id, id, name, description, visibility,
          status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
      `, [
        record.organizationId, record.spaceId, expertId, record.request.name,
        record.request.description, record.request.visibility, record.actorId,
      ])
      await client.query(`
        INSERT INTO relay_expert_revisions (
          organization_id, space_id, expert_id, id, revision, status,
          environment_id, environment_revision_id, allow_repository_override,
          allow_base_branch_override, instructions, model, configuration, created_by
        ) VALUES ($1, $2, $3, $4, 1, 'draft', $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      `, [
        record.organizationId, record.spaceId, expertId, revisionId,
        record.request.environmentId, record.request.environmentRevisionId,
        record.request.allowRepositoryOverride, record.request.allowBaseBranchOverride,
        record.request.instructions, record.request.model,
        JSON.stringify(revisionConfiguration(record.request)), record.actorId,
      ])
      const expert = await selectExpertDetail(
        client, record.organizationId, record.spaceId, expertId,
      )
      if (!expert) throw new Error('The created Expert could not be read back.')
      await this.saveIdempotency(client, {
        ...record,
        method: 'POST',
        canonicalPath,
        keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash,
        expiresAt: idempotency.expiresAt,
        expert,
        statusCode: 201,
      })
      return { expert, replayed: false }
    })
  }

  async updateExpert(record: UpdateExpertRecord): Promise<ExpertDetailDto | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const selected = await client.query<{
        version: number
        status: 'draft' | 'published' | 'disabled' | 'archived'
        published_revision_id: string | null
      }>(`
        SELECT version, status, published_revision_id
        FROM relay_experts
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        FOR UPDATE
      `, [record.organizationId, record.spaceId, record.expertId])
      const target = selected.rows[0]
      if (!target) return null
      if (target.version !== record.expectedVersion) {
        throw new ExpertVersionConflictError(record.expectedVersion, target.version)
      }
      if (target.status === 'archived') {
        throw new ExpertStateConflictError('Archived Experts cannot be edited.')
      }

      let draft = await client.query<{
        id: string
        environment_id: string
        environment_revision_id: string
      }>(`
        SELECT id, environment_id, environment_revision_id
        FROM relay_expert_revisions
        WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND status = 'draft'
        ORDER BY revision DESC LIMIT 1
      `, [record.organizationId, record.spaceId, record.expertId])
      if (!draft.rows[0]) {
        if (!target.published_revision_id) {
          throw new ExpertStateConflictError('The Expert has no draft revision to edit.')
        }
        const revisionId = this.createId()
        await client.query(`
          INSERT INTO relay_expert_revisions (
            organization_id, space_id, expert_id, id, revision, status,
            environment_id, environment_revision_id, allow_repository_override,
            allow_base_branch_override, instructions, model, configuration, created_by
          )
          SELECT organization_id, space_id, expert_id, $4,
            (SELECT max(revision) + 1 FROM relay_expert_revisions revisions
              WHERE revisions.organization_id = published.organization_id
                AND revisions.space_id = published.space_id
                AND revisions.expert_id = published.expert_id),
            'draft', environment_id, environment_revision_id, allow_repository_override,
            allow_base_branch_override, instructions, model, configuration, $5
          FROM relay_expert_revisions published
          WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $6
        `, [
          record.organizationId, record.spaceId, record.expertId, revisionId,
          record.actorId, target.published_revision_id,
        ])
        draft = await client.query<{
          id: string
          environment_id: string
          environment_revision_id: string
        }>(`
          SELECT id, environment_id, environment_revision_id
          FROM relay_expert_revisions
          WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $4
        `, [record.organizationId, record.spaceId, record.expertId, revisionId])
      }
      const currentDraft = draft.rows[0]
      if (!currentDraft) throw new Error('The Expert draft could not be prepared.')
      const environmentId = record.request.environmentId ?? currentDraft.environment_id
      const environmentRevisionId = record.request.environmentRevisionId
        ?? currentDraft.environment_revision_id
      await this.validateEnvironment(
        client, record.organizationId, record.spaceId, environmentId, environmentRevisionId,
      )
      const configurationPatch: Record<string, unknown> = {}
      if (record.request.capabilities !== undefined) {
        configurationPatch.capabilities = record.request.capabilities
      }
      if (record.request.launchGuidance !== undefined) {
        configurationPatch.launchGuidance = record.request.launchGuidance
      }
      await client.query(`
        UPDATE relay_expert_revisions
        SET environment_id = COALESCE($5, environment_id),
          environment_revision_id = COALESCE($6, environment_revision_id),
          allow_repository_override = COALESCE($7, allow_repository_override),
          allow_base_branch_override = COALESCE($8, allow_base_branch_override),
          instructions = COALESCE($9, instructions),
          model = COALESCE($10, model),
          configuration = configuration || $11::jsonb
        WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $4
      `, [
        record.organizationId, record.spaceId, record.expertId, currentDraft.id,
        record.request.environmentId ?? null,
        record.request.environmentRevisionId ?? null,
        record.request.allowRepositoryOverride ?? null,
        record.request.allowBaseBranchOverride ?? null,
        record.request.instructions ?? null,
        record.request.model ?? null,
        JSON.stringify(configurationPatch),
      ])
      await client.query(`
        UPDATE relay_experts
        SET name = COALESCE($4, name), description = COALESCE($5, description),
          visibility = COALESCE($6, visibility)
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [
        record.organizationId, record.spaceId, record.expertId,
        record.request.name ?? null, record.request.description ?? null,
        record.request.visibility ?? null,
      ])
      return selectExpertDetail(client, record.organizationId, record.spaceId, record.expertId)
    })
  }

  async publishExpert(
    record: ExpertVersionMutationRecord & { idempotencyKey: string },
  ): Promise<ExpertMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/experts/${record.expertId}/publish`
      const idempotency = await this.prepareIdempotency(client, {
        ...record,
        method: 'POST',
        canonicalPath,
        request: { expectedVersion: record.expectedVersion },
      })
      if (idempotency.replay) return { expert: idempotency.replay, replayed: true }
      const selected = await client.query<{ version: number; status: string }>(`
        SELECT version, status FROM relay_experts
        WHERE organization_id = $1 AND space_id = $2 AND id = $3 FOR UPDATE
      `, [record.organizationId, record.spaceId, record.expertId])
      const target = selected.rows[0]
      if (!target) return null
      if (target.version !== record.expectedVersion) {
        throw new ExpertVersionConflictError(record.expectedVersion, target.version)
      }
      if (target.status === 'archived') {
        throw new ExpertStateConflictError('Archived Experts cannot be published.')
      }
      const draft = await client.query<{
        id: string
        environment_id: string
        environment_revision_id: string
      }>(`
        SELECT id, environment_id, environment_revision_id
        FROM relay_expert_revisions
        WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND status = 'draft'
        ORDER BY revision DESC LIMIT 1
      `, [record.organizationId, record.spaceId, record.expertId])
      const revision = draft.rows[0]
      if (!revision) throw new ExpertStateConflictError('The Expert has no draft revision to publish.')
      await this.validateEnvironment(
        client, record.organizationId, record.spaceId,
        revision.environment_id, revision.environment_revision_id,
      )
      await client.query(`
        UPDATE relay_expert_revisions SET status = 'published'
        WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $4
      `, [record.organizationId, record.spaceId, record.expertId, revision.id])
      await client.query(`
        UPDATE relay_experts SET status = 'published', published_revision_id = $4
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [record.organizationId, record.spaceId, record.expertId, revision.id])
      const expert = await selectExpertDetail(
        client, record.organizationId, record.spaceId, record.expertId,
      )
      if (!expert) throw new Error('The published Expert could not be read back.')
      await this.saveIdempotency(client, {
        ...record,
        method: 'POST',
        canonicalPath,
        keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash,
        expiresAt: idempotency.expiresAt,
        expert,
        statusCode: 200,
      })
      return { expert, replayed: false }
    })
  }

  private async setExpertStatus(
    record: ExpertVersionMutationRecord,
    nextStatus: 'disabled' | 'archived',
  ): Promise<ExpertDetailDto | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const selected = await client.query<{
        version: number
        status: 'draft' | 'published' | 'disabled' | 'archived'
        published_revision_id: string | null
      }>(`
        SELECT version, status, published_revision_id FROM relay_experts
        WHERE organization_id = $1 AND space_id = $2 AND id = $3 FOR UPDATE
      `, [record.organizationId, record.spaceId, record.expertId])
      const target = selected.rows[0]
      if (!target) return null
      if (target.version !== record.expectedVersion) {
        throw new ExpertVersionConflictError(record.expectedVersion, target.version)
      }
      if (target.status === nextStatus) {
        return selectExpertDetail(client, record.organizationId, record.spaceId, record.expertId)
      }
      if (target.status === 'archived') {
        throw new ExpertStateConflictError('Archived Experts cannot change status.')
      }
      if (nextStatus === 'disabled' && !target.published_revision_id) {
        throw new ExpertStateConflictError('Only an Expert with a published revision can be disabled.')
      }
      await client.query(`
        UPDATE relay_experts SET status = $4
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [record.organizationId, record.spaceId, record.expertId, nextStatus])
      return selectExpertDetail(client, record.organizationId, record.spaceId, record.expertId)
    })
  }

  disableExpert(record: ExpertVersionMutationRecord) {
    return this.setExpertStatus(record, 'disabled')
  }

  archiveExpert(record: ExpertVersionMutationRecord) {
    return this.setExpertStatus(record, 'archived')
  }

  async listExpertRevisions(
    organizationId: string,
    spaceId: string,
    expertId: string,
    actorId: string,
  ): Promise<Array<ExpertDraftRevisionDto | ExpertPublishedRevisionDto> | null> {
    return withApiDatabaseContext(
      this.pool,
      { organizationId, spaceId, actorId },
      async (client) => {
        const visible = await client.query(`
          ${accessCte}
          SELECT expert.id
          FROM access
          JOIN relay_experts expert ON expert.organization_id = $1 AND expert.space_id = $2
            AND expert.id = $4
            AND (expert.visibility = 'space' OR expert.created_by = $3)
            AND (expert.status = 'published'
              OR (access.organization_role <> 'viewer' AND access.space_role <> 'viewer'))
        `, [organizationId, spaceId, actorId, expertId])
        if (!visible.rows[0]) return null
        const revisions = await client.query<{
          id: string
          revision: number
          status: 'draft' | 'published'
          model: string
          environment_id: string
          environment_revision_id: string
          allow_repository_override: boolean
          allow_base_branch_override: boolean
          instructions: string
          capabilities: unknown
          launch_guidance: string | null
          created_at: TimestampValue
        }>(`
          SELECT id, revision, status, model, environment_id, environment_revision_id,
            allow_repository_override, allow_base_branch_override, instructions,
            configuration -> 'capabilities' AS capabilities,
            configuration ->> 'launchGuidance' AS launch_guidance, created_at
          FROM relay_expert_revisions
          WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3
          ORDER BY revision DESC LIMIT 100
        `, [organizationId, spaceId, expertId])
        return revisions.rows.map((revision) => {
          const candidate = {
            id: revision.id,
            expertId,
            revision: revision.revision,
            status: revision.status,
            model: revision.model,
            environmentId: revision.environment_id,
            environmentRevisionId: revision.environment_revision_id,
            allowRepositoryOverride: revision.allow_repository_override,
            allowBaseBranchOverride: revision.allow_base_branch_override,
            instructions: revision.instructions,
            capabilities: Array.isArray(revision.capabilities) ? revision.capabilities : [],
            launchGuidance: revision.launch_guidance ?? '',
            createdAt: timestamp(revision.created_at),
          }
          return revision.status === 'draft'
            ? ExpertDraftRevisionDtoSchema.parse(candidate)
            : ExpertPublishedRevisionDtoSchema.parse(candidate)
        })
      },
    )
  }

  async listEnvironments(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ConfigurationCatalogListOptions = {},
  ): Promise<ConfigurationCatalogPage<EnvironmentSummaryDto> | null> {
    const limit = pageSize(options.limit)
    const cursor = cursorClause('environment', options.cursor, limit)
    const result = await queryWithApiDatabaseContext<EnvironmentRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
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
      `,
      [organizationId, spaceId, actorId, ...cursor.parameters],
    )
    return mapPage(result.rows, limit, mapEnvironmentSummary)
  }

  async getEnvironment(
    organizationId: string,
    spaceId: string,
    environmentId: string,
    actorId: string,
  ): Promise<EnvironmentDetailDto | null> {
    const result = await queryWithApiDatabaseContext<EnvironmentDetailRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
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
      `,
      [organizationId, spaceId, actorId, environmentId],
    )
    const first = result.rows[0]
    return !first || first.id === null ? null : mapEnvironmentDetail(result.rows)
  }
}
