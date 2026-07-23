import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  IntegrationDtoSchema,
  IntegrationMutationResponseSchema,
  type CreateIntegrationRequest,
  type IntegrationDto,
  type IntegrationMutationResponse,
  type UpdateIntegrationRequest,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptyIntegrationRepository,
  IntegrationDuplicateError,
  IntegrationVersionConflictError,
  type IntegrationMutationScope,
  type IntegrationRepository,
  type IntegrationScope,
} from './integration-repository.js'

type IntegrationRow = {
  organization_id: string
  space_id: string
  id: string
  type: string
  name: string
  connection_status: string
  health: string
  scopes: string[]
  external_account: string | null
  diagnostic: string | null
  connected_at: Date | null
  last_event_at: Date | null
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

function rowToDto(row: IntegrationRow): IntegrationDto {
  return IntegrationDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    type: row.type,
    name: row.name,
    connectionStatus: row.connection_status,
    health: row.health,
    scopes: row.scopes,
    externalAccount: row.external_account,
    diagnostic: row.diagnostic,
    connectedAt: row.connected_at ? row.connected_at.toISOString() : null,
    lastEventAt: row.last_event_at ? row.last_event_at.toISOString() : null,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresIntegrationRepository implements IntegrationRepository {
  constructor(private readonly pool: Pool) {}

  async listIntegrations(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: IntegrationDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<IntegrationRow>(
        `SELECT * FROM cosmos_integrations
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

  async getIntegration(
    organizationId: string,
    spaceId: string,
    integrationId: string,
    actorId: string,
  ): Promise<IntegrationDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<IntegrationRow>(
        `SELECT * FROM cosmos_integrations
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, integrationId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createIntegration(
    scope: IntegrationScope & { idempotencyKey: string; request: CreateIntegrationRequest },
  ): Promise<IntegrationMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')
    const externalAccount = request.externalAccount ?? null
    const scopes = request.scopes ?? []

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<IntegrationRow>(
        `SELECT i.* FROM cosmos_integrations i
         JOIN cosmos_integration_audit_events a
           ON a.organization_id = i.organization_id
          AND a.space_id = i.space_id
          AND a.integration_id = i.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_integrations
         WHERE organization_id = $1 AND space_id = $2
           AND type = $3 AND name = $4
           AND connection_status <> 'archived'`,
        [organizationId, spaceId, request.type, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new IntegrationDuplicateError(request.name)
      }

      const inserted = await client.query<IntegrationRow>(
        `INSERT INTO cosmos_integrations
           (organization_id, space_id, id, type, name, external_account, scopes,
            connection_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'action_required', $8)
         RETURNING *`,
        [organizationId, spaceId, id, request.type, request.name, externalAccount, scopes, actorId],
      )

      await client.query(
        `INSERT INTO cosmos_integration_audit_events
           (organization_id, space_id, id, integration_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return IntegrationMutationResponseSchema.parse({
      integration: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async updateIntegration(
    scope: IntegrationMutationScope & { request: UpdateIntegrationRequest },
  ): Promise<IntegrationMutationResponse | null> {
    const { organizationId, spaceId, integrationId, actorId, requestId, expectedVersion, idempotencyKey, request } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<IntegrationRow>(
        `SELECT * FROM cosmos_integrations
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, integrationId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new IntegrationVersionConflictError(expectedVersion, current.version)
      }

      const updated = await client.query<IntegrationRow>(
        `UPDATE cosmos_integrations
         SET connection_status = CASE WHEN $4::boolean THEN $5 ELSE connection_status END,
             connected_at = CASE WHEN $4::boolean AND $5 = 'connected' THEN now()
                                 WHEN $4::boolean AND $5 <> 'connected' THEN NULL
                                 ELSE connected_at END,
             health = CASE WHEN $6::boolean THEN $7 ELSE health END,
             scopes = CASE WHEN $8::boolean THEN $9::text[] ELSE scopes END,
             external_account = CASE WHEN $10::boolean THEN $11 ELSE external_account END,
             diagnostic = CASE WHEN $12::boolean THEN $13 ELSE diagnostic END
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [
          organizationId, spaceId, integrationId,
          'connectionStatus' in request, request.connectionStatus ?? null,
          'health' in request, request.health ?? null,
          'scopes' in request, request.scopes ?? [],
          'externalAccount' in request, request.externalAccount ?? null,
          'diagnostic' in request, request.diagnostic ?? null,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_integration_audit_events
           (organization_id, space_id, id, integration_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'update', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), integrationId, actorId,
          updated.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: updated.rows[0]!, replayed: false }
    })

    if (!result) return null
    return IntegrationMutationResponseSchema.parse({
      integration: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveIntegration(scope: IntegrationMutationScope): Promise<IntegrationMutationResponse | null> {
    const { organizationId, spaceId, integrationId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = Buffer.from(idempotencyKey).toString('base64')

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<IntegrationRow>(
        `SELECT * FROM cosmos_integrations
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, integrationId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new IntegrationVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<IntegrationRow>(
        `UPDATE cosmos_integrations
         SET connection_status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING *`,
        [organizationId, spaceId, integrationId],
      )

      await client.query(
        `INSERT INTO cosmos_integration_audit_events
           (organization_id, space_id, id, integration_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), integrationId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return IntegrationMutationResponseSchema.parse({
      integration: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptyIntegrationRepository }
