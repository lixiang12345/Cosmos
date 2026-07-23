import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  DaemonDtoSchema,
  DaemonMutationResponseSchema,
  type CreateDaemonRequest,
  type DaemonDto,
  type DaemonMutationResponse,
  type UpdateDaemonRequest,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  DaemonDuplicateError,
  DaemonEnvironmentNotFoundError,
  DaemonVersionConflictError,
  EmptyDaemonRepository,
  type DaemonMutationScope,
  type DaemonRepository,
  type DaemonScope,
} from './daemon-repository.js'

type DaemonRow = {
  organization_id: string
  space_id: string
  id: string
  environment_id: string
  name: string
  description: string
  capabilities: string[]
  enabled: boolean
  status: string
  concurrency_slots: number
  last_heartbeat_at: Date | null
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

function rowToDto(row: DaemonRow): DaemonDto {
  return DaemonDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    environmentId: row.environment_id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
    enabled: row.enabled,
    status: row.status,
    concurrencySlots: row.concurrency_slots,
    lastHeartbeatAt: row.last_heartbeat_at ? row.last_heartbeat_at.toISOString() : null,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresDaemonRepository implements DaemonRepository {
  constructor(private readonly pool: Pool) {}

  async listDaemons(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: DaemonDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<DaemonRow>(
        `SELECT * FROM cosmos_daemons
         WHERE organization_id = $1 AND space_id = $2
           AND status <> 'archived'
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

  async getDaemon(
    organizationId: string,
    spaceId: string,
    daemonId: string,
    actorId: string,
  ): Promise<DaemonDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<DaemonRow>(
        `SELECT * FROM cosmos_daemons
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, daemonId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createDaemon(
    scope: DaemonScope & { idempotencyKey: string; request: CreateDaemonRequest },
  ): Promise<DaemonMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')
    const description = request.description ?? ''
    const capabilities = request.capabilities ?? []
    const concurrencySlots = request.concurrencySlots ?? 4

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<DaemonRow>(
        `SELECT d.* FROM cosmos_daemons d
         JOIN cosmos_daemon_audit_events a
           ON a.organization_id = d.organization_id
          AND a.space_id = d.space_id
          AND a.daemon_id = d.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      const environment = await client.query(
        `SELECT 1 FROM cosmos_environments
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, request.environmentId],
      )
      if (!environment.rowCount) {
        throw new DaemonEnvironmentNotFoundError(request.environmentId)
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_daemons
         WHERE organization_id = $1 AND space_id = $2
           AND name = $3
           AND status <> 'archived'`,
        [organizationId, spaceId, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new DaemonDuplicateError(request.name)
      }

      const inserted = await client.query<DaemonRow>(
        `INSERT INTO cosmos_daemons
           (organization_id, space_id, id, environment_id, name, description,
            capabilities, concurrency_slots, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'offline', $9)
         RETURNING *`,
        [organizationId, spaceId, id, request.environmentId, request.name, description,
          capabilities, concurrencySlots, actorId],
      )

      await client.query(
        `INSERT INTO cosmos_daemon_audit_events
           (organization_id, space_id, id, daemon_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return DaemonMutationResponseSchema.parse({
      daemon: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async updateDaemon(
    scope: DaemonMutationScope & { request: UpdateDaemonRequest },
  ): Promise<DaemonMutationResponse | null> {
    const { organizationId, spaceId, daemonId, actorId, requestId, expectedVersion, idempotencyKey, request } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<DaemonRow>(
        `SELECT * FROM cosmos_daemons
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, daemonId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new DaemonVersionConflictError(expectedVersion, current.version)
      }

      const updated = await client.query<DaemonRow>(
        `UPDATE cosmos_daemons
         SET description = CASE WHEN $4::boolean THEN $5 ELSE description END,
             capabilities = CASE WHEN $6::boolean THEN $7::text[] ELSE capabilities END,
             concurrency_slots = CASE WHEN $8::boolean THEN $9 ELSE concurrency_slots END,
             enabled = CASE WHEN $10::boolean THEN $11 ELSE enabled END
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [
          organizationId, spaceId, daemonId,
          'description' in request, request.description ?? '',
          'capabilities' in request, request.capabilities ?? [],
          'concurrencySlots' in request, request.concurrencySlots ?? 4,
          'enabled' in request, request.enabled ?? true,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_daemon_audit_events
           (organization_id, space_id, id, daemon_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'update', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), daemonId, actorId,
          updated.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: updated.rows[0]!, replayed: false }
    })

    if (!result) return null
    return DaemonMutationResponseSchema.parse({
      daemon: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveDaemon(scope: DaemonMutationScope): Promise<DaemonMutationResponse | null> {
    const { organizationId, spaceId, daemonId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<DaemonRow>(
        `SELECT * FROM cosmos_daemons
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, daemonId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new DaemonVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<DaemonRow>(
        `UPDATE cosmos_daemons
         SET status = 'archived', enabled = false, archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, daemonId],
      )

      await client.query(
        `INSERT INTO cosmos_daemon_audit_events
           (organization_id, space_id, id, daemon_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), daemonId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return DaemonMutationResponseSchema.parse({
      daemon: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptyDaemonRepository }
