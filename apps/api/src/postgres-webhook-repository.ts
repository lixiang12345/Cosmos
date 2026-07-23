import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  WebhookDtoSchema,
  WebhookMutationResponseSchema,
  type CreateWebhookRequest,
  type WebhookDto,
  type WebhookMutationResponse,
} from '@cosmos/contracts'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  EmptyWebhookRepository,
  WebhookDuplicateError,
  WebhookVersionConflictError,
  type WebhookMutationScope,
  type WebhookRepository,
  type WebhookScope,
} from './webhook-repository.js'

type WebhookRow = {
  organization_id: string
  space_id: string
  id: string
  name: string
  url: string
  scope: string
  secret_last_four: string | null
  description: string | null
  event_count: number
  status: string
  version: number
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

const safeWebhookColumns = `
  organization_id, space_id, id, name, url, scope, secret_last_four, description,
  event_count, status, version, created_by, created_at, updated_at, archived_at
`

const safeJoinedWebhookColumns = `
  r.organization_id, r.space_id, r.id, r.name, r.url, r.scope, r.secret_last_four,
  r.description, r.event_count, r.status, r.version, r.created_by, r.created_at,
  r.updated_at, r.archived_at
`

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function opaqueValueReference(value: string) {
  const salt = randomUUID()
  return `sha256:${salt}:${hash(`${salt}\0${value}`)}`
}

// A single-use signing secret, surfaced to the caller exactly once at creation.
function generateSigningSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

function secretLastFour(value: string) {
  const characters = [...value]
  return characters.length > 4 ? characters.slice(-4).join('') : null
}

function rowToDto(row: WebhookRow): WebhookDto {
  return WebhookDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    name: row.name,
    url: row.url,
    scope: row.scope,
    description: row.description,
    eventCount: row.event_count,
    secretLastFour: row.secret_last_four,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  })
}

export class PostgresWebhookRepository implements WebhookRepository {
  constructor(private readonly pool: Pool) {}

  async listWebhooks(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: WebhookDto[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100)
    const rows = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<WebhookRow>(
        `SELECT ${safeWebhookColumns} FROM cosmos_webhooks
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

  async getWebhook(
    organizationId: string,
    spaceId: string,
    webhookId: string,
    actorId: string,
  ): Promise<WebhookDto | null> {
    const row = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const result = await client.query<WebhookRow>(
        `SELECT ${safeWebhookColumns} FROM cosmos_webhooks
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, webhookId],
      )
      return result.rows[0] ?? null
    })
    return row ? rowToDto(row) : null
  }

  async createWebhook(
    scope: WebhookScope & { idempotencyKey: string; request: CreateWebhookRequest },
  ): Promise<WebhookMutationResponse> {
    const { organizationId, spaceId, actorId, requestId, idempotencyKey, request } = scope
    const id = randomUUID()
    const idempotencyKeyHash = hash(idempotencyKey)
    const signingSecret = generateSigningSecret()
    const valueReference = opaqueValueReference(signingSecret)
    const lastFour = secretLastFour(signingSecret)

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<WebhookRow>(
        `SELECT ${safeJoinedWebhookColumns} FROM cosmos_webhooks r
         JOIN cosmos_webhook_audit_events a
           ON a.organization_id = r.organization_id
          AND a.space_id = r.space_id
          AND a.webhook_id = r.id
         WHERE a.organization_id = $1 AND a.space_id = $2
           AND a.idempotency_key_hash = $3 AND a.action = 'create'
         LIMIT 1`,
        [organizationId, spaceId, idempotencyKeyHash],
      )
      if (existing.rows[0]) {
        // Replays never re-issue the signing secret — it was shown only on the
        // original creation.
        return { row: existing.rows[0], replayed: true, signingSecret: null }
      }

      const duplicate = await client.query(
        `SELECT 1 FROM cosmos_webhooks
         WHERE organization_id = $1 AND space_id = $2
           AND scope = $3 AND name = $4
           AND status <> 'archived'`,
        [organizationId, spaceId, request.scope, request.name],
      )
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        throw new WebhookDuplicateError(request.scope, request.name)
      }

      const inserted = await client.query<WebhookRow>(
        `INSERT INTO cosmos_webhooks
           (organization_id, space_id, id, name, url, scope,
            signing_secret_ciphertext, secret_last_four, description, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
         RETURNING ${safeWebhookColumns}`,
        [
          organizationId, spaceId, id, request.name, request.url, request.scope,
          valueReference, lastFour, request.description ?? null, actorId,
        ],
      )

      await client.query(
        `INSERT INTO cosmos_webhook_audit_events
           (organization_id, space_id, id, webhook_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'create', 1, $6, $7)`,
        [organizationId, spaceId, randomUUID(), id, actorId, requestId, idempotencyKeyHash],
      )

      return { row: inserted.rows[0]!, replayed: false, signingSecret }
    })

    return WebhookMutationResponseSchema.parse({
      webhook: rowToDto(result.row),
      signingSecret: result.signingSecret,
      replayed: result.replayed,
    })
  }

  async archiveWebhook(scope: WebhookMutationScope): Promise<WebhookMutationResponse | null> {
    const { organizationId, spaceId, webhookId, actorId, requestId, expectedVersion, idempotencyKey } = scope
    const idempotencyKeyHash = hash(idempotencyKey)

    const result = await withApiDatabaseContext(this.pool, { organizationId, actorId }, async (client) => {
      const existing = await client.query<WebhookRow>(
        `SELECT ${safeWebhookColumns} FROM cosmos_webhooks
         WHERE organization_id = $1 AND space_id = $2 AND id = $3`,
        [organizationId, spaceId, webhookId],
      )
      if (!existing.rows[0]) return null

      const current = existing.rows[0]
      if (current.version !== expectedVersion) {
        throw new WebhookVersionConflictError(expectedVersion, current.version)
      }

      const archived = await client.query<WebhookRow>(
        `UPDATE cosmos_webhooks
         SET status = 'archived', archived_at = now()
         WHERE organization_id = $1 AND space_id = $2 AND id = $3
         RETURNING ${safeWebhookColumns}`,
        [organizationId, spaceId, webhookId],
      )

      await client.query(
        `INSERT INTO cosmos_webhook_audit_events
           (organization_id, space_id, id, webhook_id, actor_id, action,
            resource_version, request_id, idempotency_key_hash)
         VALUES ($1, $2, $3, $4, $5, 'archive', $6, $7, $8)`,
        [organizationId, spaceId, randomUUID(), webhookId, actorId,
          archived.rows[0]!.version, requestId, idempotencyKeyHash],
      )

      return { row: archived.rows[0]!, replayed: false }
    })

    if (!result) return null
    return WebhookMutationResponseSchema.parse({
      webhook: rowToDto(result.row),
      signingSecret: null,
      replayed: result.replayed,
    })
  }
}

export { EmptyWebhookRepository }
