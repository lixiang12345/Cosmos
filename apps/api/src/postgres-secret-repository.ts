import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  SecretDtoSchema,
  SecretMutationResponseSchema,
  type CreateSecretRequest,
  type SecretDto,
  type SecretMutationResponse,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptySecretRepository,
  SecretDuplicateError,
  SecretVersionConflictError,
  type SecretMutationScope,
  type SecretRepository,
  type SecretScope,
} from './secret-repository.js'

type SecretRow = {
  organization_id: string
  space_id: string
  id: string
  name: string
  scope: string
  last_four: string | null
  description: string | null
  vm_install: boolean
  status: string
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

const safeSecretColumns = `
  organization_id, space_id, id, name, scope, last_four, description,
  vm_install, status, version, created_by, created_at, updated_at, archived_at
`

const safeJoinedSecretColumns = `
  r.organization_id, r.space_id, r.id, r.name, r.scope, r.last_four, r.description,
  r.vm_install, r.status, r.version, r.created_by, r.created_at, r.updated_at, r.archived_at
`

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function opaqueValueReference(value: string) {
  const salt = randomUUID()
  return `sha256:${salt}:${hash(`${salt}\0${value}`)}`
}

function secretLastFour(value: string) {
  const characters = [...value]
  return characters.length > 4 ? characters.slice(-4).join('') : null
}

function rowToDto(row: SecretRow): SecretDto {
  return SecretDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    scope: row.scope,
    description: row.description,
    vmInstall: row.vm_install,
    lastFour: row.last_four,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresSecretRepository implements SecretRepository {
  constructor(private readonly pool: Pool) {}

  async listSecrets(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: SecretDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<SecretRow>(
        `SELECT ${safeSecretColumns} FROM cosmos_secrets
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

  async getSecret(
    organizationId: string,
    spaceId: string,
    secretId: string,
    actorId: string,
  ): Promise<SecretDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<SecretRow>(
        `SELECT ${safeSecretColumns} FROM cosmos_secrets
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, secretId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createSecret(
    scope: SecretScope & { idempotencyKey: string; request: CreateSecretRequest },
  ): Promise<SecretMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = hash(idempotencyKey)
    const valueReference = opaqueValueReference(request.value)
    const lastFour = secretLastFour(request.value)

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<SecretRow>(
        `SELECT ${safeJoinedSecretColumns} FROM cosmos_secrets r
         JOIN cosmos_secret_audit_events a
           ON a.organization_id = r.organization_id
          AND a.space_id = r.space_id
          AND a.secret_id = r.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        return { row: existing.rows[0], replayed: true }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_secrets
         WHERE organization_id = $1 AND space_id = $2
           AND scope = $3 AND name = $4
           AND status <> 'archived'`,
        [organizationId, spaceId, request.scope, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new SecretDuplicateError(request.scope, request.name)
      }

      const inserted = await client.query<SecretRow>(
        `INSERT INTO cosmos_secrets
           (organization_id, space_id, id, name, scope, value_ciphertext,
            last_four, description, vm_install, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
         RETURNING ${safeSecretColumns}`,
        [
          organizationId, spaceId, id, request.name, request.scope,
          valueReference, lastFour, request.description ?? null,
          request.vmInstall, actorId,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_secret_audit_events
           (organization_id, space_id, id, secret_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false }
    })

    return SecretMutationResponseSchema.parse({
      secret: rowToDto(result.row),
      replayed: result.replayed,
    })
  }

  async archiveSecret(scope: SecretMutationScope): Promise<SecretMutationResponse | null> {
    const { organizationId, spaceId, secretId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = hash(idempotencyKey)

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<SecretRow>(
        `SELECT ${safeSecretColumns} FROM cosmos_secrets
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, secretId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new SecretVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<SecretRow>(
        `UPDATE cosmos_secrets
         SET status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING ${safeSecretColumns}`,
        [organizationId, spaceId, secretId],
      )

      await client.query(
        `INSERT INTO cosmos_secret_audit_events
           (organization_id, space_id, id, secret_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), secretId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return SecretMutationResponseSchema.parse({
      secret: rowToDto(result.row),
      replayed: result.replayed,
    })
  }
}

export { EmptySecretRepository }
