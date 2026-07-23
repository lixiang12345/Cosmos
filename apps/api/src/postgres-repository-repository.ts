import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  RepositoryDtoSchema,
  RepositoryMutationResponseSchema,
  type CreateRepositoryRequest,
  type RepositoryDto,
  type RepositoryMutationResponse,
  type UpdateRepositoryRequest,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptyRepositoryRepository,
  RepositoryDuplicateError,
  RepositoryVersionConflictError,
  type RepositoryMutationScope,
  type RepositoryRepository,
  type RepositoryScope,
} from './repository-repository.js'

type RepositoryRow = {
  organization_id: string
  space_id: string
  id: string
  provider: string
  full_name: string
  default_branch: string
  installation_id: string | null
  connection_status: string
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

function rowToDto(row: RepositoryRow): RepositoryDto {
  return RepositoryDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    provider: row.provider,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    installationId: row.installation_id,
    connectionStatus: row.connection_status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresRepositoryRepository implements RepositoryRepository {
  constructor(private readonly pool: Pool) {}

  async listRepositories(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: RepositoryDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<RepositoryRow>(
        `SELECT * FROM cosmos_repositories
         WHERE organization_id = $1 AND space_id = $2
           AND connection_status <> 'archived'
         ORDER BY updated_at DESC, id DESC
         LIMIT $3`,
        [organizationId, spaceId, limit + 1],
      )
      return result.rows
    })
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(rowToDto)
    return { items, nextCursor: null, hasMore }
  }

  async getRepository(
    organizationId: string,
    spaceId: string,
    repositoryId: string,
    actorId: string,
  ): Promise<RepositoryDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<RepositoryRow>(
        `SELECT * FROM cosmos_repositories
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, repositoryId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createRepository(
    scope: RepositoryScope & { idempotencyKey: string; request: CreateRepositoryRequest },
  ): Promise<RepositoryMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      // Check idempotency
      const existing = await client.query<RepositoryRow>(
        `SELECT r.* FROM cosmos_repositories r
         JOIN cosmos_repository_audit_events a
           ON a.organization_id = r.organization_id
          AND a.space_id = r.space_id
          AND a.repository_id = r.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      // Check duplicate active repository
      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_repositories
         WHERE organization_id = $1 AND space_id = $2
           AND provider = $3 AND full_name = $4
           AND connection_status <> 'archived'`,
        [organizationId, spaceId, request.provider, request.fullName],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new RepositoryDuplicateError(request.provider, request.fullName)
      }

      const inserted = await client.query<RepositoryRow>(
        `INSERT INTO cosmos_repositories
           (organization_id, space_id, id, provider, full_name, default_branch,
            installation_id, connection_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'action_required', $8)
         RETURNING *`,
        [
          organizationId, spaceId, id,
          request.provider, request.fullName,
          request.defaultBranch ?? 'main',
          request.installationId ?? null,
          actorId,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_repository_audit_events
           (organization_id, space_id, id, repository_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return RepositoryMutationResponseSchema.parse({
      repository: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async updateRepository(
    scope: RepositoryMutationScope & { request: UpdateRepositoryRequest },
  ): Promise<RepositoryMutationResponse | null> {
    const { organizationId, spaceId, repositoryId, actorId, requestId, expectedVersion, idempotencyKey, request } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<RepositoryRow>(
        `SELECT * FROM cosmos_repositories
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, repositoryId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new RepositoryVersionConflictError(expectedVersion, current.version)
      }

      const updated = await client.query<RepositoryRow>(
        `UPDATE cosmos_repositories
         SET default_branch = COALESCE($4, default_branch),
             installation_id = CASE WHEN $5::boolean THEN $6 ELSE installation_id END
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [
          organizationId, spaceId, repositoryId,
          request.defaultBranch ?? null,
          'installationId' in request,
          request.installationId ?? null,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_repository_audit_events
           (organization_id, space_id, id, repository_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'update', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), repositoryId, actorId,
          updated.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: updated.rows[0]!, replayed: false }
    })

    if (!result) return null
    return RepositoryMutationResponseSchema.parse({
      repository: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveRepository(scope: RepositoryMutationScope): Promise<RepositoryMutationResponse | null> {
    const { organizationId, spaceId, repositoryId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<RepositoryRow>(
        `SELECT * FROM cosmos_repositories
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, repositoryId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new RepositoryVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<RepositoryRow>(
        `UPDATE cosmos_repositories
         SET connection_status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, repositoryId],
      )

      await client.query(
        `INSERT INTO cosmos_repository_audit_events
           (organization_id, space_id, id, repository_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), repositoryId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return RepositoryMutationResponseSchema.parse({
      repository: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptyRepositoryRepository }
