import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  McpServerDtoSchema,
  McpServerMutationResponseSchema,
  type CreateMcpServerRequest,
  type McpServerDto,
  type McpServerMutationResponse,
  type UpdateMcpServerRequest,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptyMcpServerRepository,
  McpServerDuplicateError,
  McpServerVersionConflictError,
  type McpServerMutationScope,
  type McpServerRepository,
  type McpServerScope,
} from './mcp-server-repository.js'

type McpServerRow = {
  organization_id: string
  space_id: string
  id: string
  name: string
  transport: string
  endpoint: string | null
  command: string | null
  connection_status: string
  tool_count: number
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

function rowToDto(row: McpServerRow): McpServerDto {
  return McpServerDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    transport: row.transport,
    endpoint: row.endpoint,
    command: row.command,
    connectionStatus: row.connection_status,
    toolCount: row.tool_count,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresMcpServerRepository implements McpServerRepository {
  constructor(private readonly pool: Pool) {}

  async listMcpServers(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: McpServerDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<McpServerRow>(
        `SELECT * FROM cosmos_mcp_servers
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

  async getMcpServer(
    organizationId: string,
    spaceId: string,
    mcpServerId: string,
    actorId: string,
  ): Promise<McpServerDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<McpServerRow>(
        `SELECT * FROM cosmos_mcp_servers
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, mcpServerId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createMcpServer(
    scope: McpServerScope & { idempotencyKey: string; request: CreateMcpServerRequest },
  ): Promise<McpServerMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')
    const isStdio = request.transport === 'stdio'
    const command = isStdio ? request.command ?? null : null
    const endpoint = isStdio ? null : request.endpoint ?? null

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<McpServerRow>(
        `SELECT s.* FROM cosmos_mcp_servers s
         JOIN cosmos_mcp_server_audit_events a
           ON a.organization_id = s.organization_id
          AND a.space_id = s.space_id
          AND a.mcp_server_id = s.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_mcp_servers
         WHERE organization_id = $1 AND space_id = $2
           AND name = $3
           AND connection_status <> 'archived'`,
        [organizationId, spaceId, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new McpServerDuplicateError(request.name)
      }

      const inserted = await client.query<McpServerRow>(
        `INSERT INTO cosmos_mcp_servers
           (organization_id, space_id, id, name, transport, endpoint, command,
            connection_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'action_required', $8)
         RETURNING *`,
        [organizationId, spaceId, id, request.name, request.transport, endpoint, command, actorId],
      )

      await client.query(
        `INSERT INTO cosmos_mcp_server_audit_events
           (organization_id, space_id, id, mcp_server_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return McpServerMutationResponseSchema.parse({
      server: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async updateMcpServer(
    scope: McpServerMutationScope & { request: UpdateMcpServerRequest },
  ): Promise<McpServerMutationResponse | null> {
    const { organizationId, spaceId, mcpServerId, actorId, requestId, expectedVersion, idempotencyKey, request } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<McpServerRow>(
        `SELECT * FROM cosmos_mcp_servers
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, mcpServerId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new McpServerVersionConflictError(expectedVersion, current.version)
      }

      const updated = await client.query<McpServerRow>(
        `UPDATE cosmos_mcp_servers
         SET endpoint = CASE WHEN $4::boolean THEN $5 ELSE endpoint END,
             command = CASE WHEN $6::boolean THEN $7 ELSE command END
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [
          organizationId, spaceId, mcpServerId,
          'endpoint' in request, request.endpoint ?? null,
          'command' in request, request.command ?? null,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_mcp_server_audit_events
           (organization_id, space_id, id, mcp_server_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'update', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), mcpServerId, actorId,
          updated.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: updated.rows[0]!, replayed: false }
    })

    if (!result) return null
    return McpServerMutationResponseSchema.parse({
      server: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveMcpServer(scope: McpServerMutationScope): Promise<McpServerMutationResponse | null> {
    const { organizationId, spaceId, mcpServerId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<McpServerRow>(
        `SELECT * FROM cosmos_mcp_servers
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, mcpServerId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new McpServerVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<McpServerRow>(
        `UPDATE cosmos_mcp_servers
         SET connection_status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, mcpServerId],
      )

      await client.query(
        `INSERT INTO cosmos_mcp_server_audit_events
           (organization_id, space_id, id, mcp_server_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), mcpServerId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return McpServerMutationResponseSchema.parse({
      server: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptyMcpServerRepository }
