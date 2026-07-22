import { createHash, randomUUID } from 'node:crypto'
import {
  ArtifactDtoSchema,
  type ArtifactDto,
  type ArtifactType,
} from '@cosmos/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  ArtifactConflictError,
  ArtifactValidationError,
  ArtifactVersionConflictError,
  type ArtifactListOptions,
  type ArtifactListPage,
  type ArtifactMutationResult,
  type ArtifactRepository,
  type CreateArtifactRecord,
  type RemoveArtifactRecord,
  type UpdateArtifactRecord,
} from './artifact-repository.js'
import { setLocalApiDatabaseContext } from './postgres-runtime-database.js'
import { AuthorizationChangedError, IdempotencyConflictError } from './session-repository.js'

type TimestampValue = Date | string

type ArtifactRow = {
  organization_id: string
  space_id: string
  session_id: string
  id: string
  turn_id: string | null
  type: ArtifactType
  provider: string | null
  external_id: string | null
  label: string
  url: string
  status: string | null
  attributes: unknown
  created_by_tool_call_id: string | null
  created_by: string
  created_at: TimestampValue
  updated_at: TimestampValue
  removed_at: TimestampValue | null
  version: number
}

type MutationTarget = {
  policyReason: 'session_creator' | 'space_manager'
}

const artifactColumns = `
  organization_id, space_id, session_id, id, turn_id, type, provider,
  external_id, label, url, status, attributes, created_by_tool_call_id,
  created_by, created_at, updated_at, removed_at, version
`

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapArtifact(row: ArtifactRow): ArtifactDto {
  return ArtifactDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    id: row.id,
    turnId: row.turn_id,
    type: row.type,
    provider: row.provider,
    externalId: row.external_id,
    label: row.label,
    url: row.url,
    status: row.status,
    attributes: row.attributes,
    createdByToolCallId: row.created_by_tool_call_id,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    removedAt: row.removed_at === null ? null : timestamp(row.removed_at),
    version: row.version,
  })
}

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

function attributesSize(attributes: Record<string, unknown>) {
  return Buffer.byteLength(JSON.stringify(attributes), 'utf8')
}

function assertAttributesSize(attributes: Record<string, unknown>) {
  if (attributesSize(attributes) > 65_536) {
    throw new ArtifactValidationError('attributes', 'Artifact attributes cannot exceed 64 KiB.')
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export type PostgresArtifactRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  idempotencyTtlMs?: number
}

export class PostgresArtifactRepository implements ArtifactRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly idempotencyTtlMs: number

  constructor(private readonly pool: Pool, options: PostgresArtifactRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1_000
  }

  async list(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: ArtifactListOptions = {},
  ): Promise<ArtifactListPage | null> {
    const limit = options.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Artifact page limit must be an integer between 1 and 100.')
    }
    const parameters: unknown[] = [organizationId, spaceId, sessionId, actorId]
    const clauses = ['artifact.removed_at IS NULL']
    if (options.type) {
      parameters.push(options.type)
      clauses.push(`artifact.type = $${parameters.length}`)
    }
    if (options.cursor) {
      if (!options.cursor.id.trim() || Number.isNaN(Date.parse(options.cursor.createdAt))) {
        throw new RangeError('Artifact cursor must contain a valid timestamp and id.')
      }
      parameters.push(options.cursor.createdAt, options.cursor.id)
      clauses.push(`(artifact.created_at, artifact.id) < (
        $${parameters.length - 1}::timestamptz, $${parameters.length}
      )`)
    }
    parameters.push(limit + 1)

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await setLocalApiDatabaseContext(client, { organizationId, spaceId, actorId })
      const result = await client.query<ArtifactRow & { access_session_id: string }>(`
        WITH access AS (
          SELECT session.id AS session_id
          FROM cosmos_sessions session
          JOIN cosmos_organization_memberships organization_membership
            ON organization_membership.organization_id = session.organization_id
            AND organization_membership.actor_id = $4
          JOIN cosmos_space_memberships space_membership
            ON space_membership.organization_id = session.organization_id
            AND space_membership.space_id = session.space_id
            AND space_membership.actor_id = $4
          WHERE session.organization_id = $1
            AND session.space_id = $2
            AND session.id = $3
            AND (
              session.visibility = 'space'
              OR session.created_by = $4
              OR EXISTS (
                SELECT 1 FROM cosmos_session_share_grants share_grant
                WHERE share_grant.organization_id = session.organization_id
                  AND share_grant.space_id = session.space_id
                  AND share_grant.session_id = session.id
                  AND share_grant.revoked_at IS NULL
                  AND (share_grant.expires_at IS NULL
                    OR share_grant.expires_at > transaction_timestamp())
                  AND (
                    (share_grant.principal_type = 'user' AND share_grant.principal_id = $4)
                    OR (
                      share_grant.principal_type = 'group'
                      AND EXISTS (
                        SELECT 1 FROM cosmos_group_memberships group_membership
                        WHERE group_membership.organization_id = share_grant.organization_id
                          AND group_membership.group_id = share_grant.principal_id
                          AND group_membership.actor_id = $4
                      )
                    )
                  )
              )
            )
        )
        SELECT access.session_id AS access_session_id, item.*
        FROM access
        LEFT JOIN LATERAL (
          SELECT ${artifactColumns.split(',').map((column) => `artifact.${column.trim()}`).join(', ')}
          FROM cosmos_artifacts artifact
          WHERE artifact.organization_id = $1
            AND artifact.space_id = $2
            AND artifact.session_id = access.session_id
            AND ${clauses.join('\n            AND ')}
          ORDER BY artifact.created_at DESC, artifact.id DESC
          LIMIT $${parameters.length}
        ) item ON true
        ORDER BY item.created_at DESC NULLS LAST, item.id DESC NULLS LAST
      `, parameters)
      await client.query('COMMIT')
      if (result.rows.length === 0) return null
      const rows = result.rows.filter((row) => row.id !== null)
      const hasMore = rows.length > limit
      const items = rows.slice(0, limit).map(mapArtifact)
      const last = items.at(-1)
      return {
        items,
        hasMore,
        nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async create(record: CreateArtifactRecord): Promise<ArtifactMutationResult | null> {
    assertAttributesSize(record.request.attributes)
    return this.inTransaction(record, (client) => this.createInTransaction(client, record))
  }

  async update(record: UpdateArtifactRecord): Promise<ArtifactDto | null> {
    if (record.request.attributes) assertAttributesSize(record.request.attributes)
    return this.inTransaction(record, (client) => this.updateInTransaction(client, record))
  }

  async remove(record: RemoveArtifactRecord): Promise<ArtifactMutationResult | null> {
    return this.inTransaction(record, (client) => this.removeInTransaction(client, record))
  }

  private async inTransaction<T>(
    record: { organizationId: string; spaceId: string; actorId: string },
    operation: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await setLocalApiDatabaseContext(client, record)
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async mutationTarget(
    client: PoolClient,
    record: CreateArtifactRecord | UpdateArtifactRecord | RemoveArtifactRecord,
  ): Promise<MutationTarget | null> {
    if (record.actorKind !== 'user') throw new AuthorizationChangedError()
    const result = await client.query<{
      visibility: 'private' | 'space'
      created_by: string
      space_role: string
      active_share: boolean
    }>(`
      SELECT session.visibility, session.created_by, space_membership.role AS space_role,
        EXISTS (
          SELECT 1 FROM cosmos_session_share_grants share_grant
          WHERE share_grant.organization_id = session.organization_id
            AND share_grant.space_id = session.space_id
            AND share_grant.session_id = session.id
            AND share_grant.revoked_at IS NULL
            AND (share_grant.expires_at IS NULL
              OR share_grant.expires_at > transaction_timestamp())
            AND (
              (share_grant.principal_type = 'user' AND share_grant.principal_id = $4)
              OR (
                share_grant.principal_type = 'group'
                AND EXISTS (
                  SELECT 1 FROM cosmos_group_memberships group_membership
                  WHERE group_membership.organization_id = share_grant.organization_id
                    AND group_membership.group_id = share_grant.principal_id
                    AND group_membership.actor_id = $4
                )
              )
            )
        ) AS active_share
      FROM cosmos_sessions session
      JOIN cosmos_organization_memberships organization_membership
        ON organization_membership.organization_id = session.organization_id
        AND organization_membership.actor_id = $4
      JOIN cosmos_space_memberships space_membership
        ON space_membership.organization_id = session.organization_id
        AND space_membership.space_id = session.space_id
        AND space_membership.actor_id = $4
      WHERE session.organization_id = $1 AND session.space_id = $2 AND session.id = $3
      FOR UPDATE OF session, organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.sessionId, record.actorId])
    const row = result.rows[0]
    if (!row) return null
    const canRead = row.visibility === 'space' || row.created_by === record.actorId || row.active_share
    if (!canRead) return null
    if (row.created_by === record.actorId) return { policyReason: 'session_creator' }
    if (row.visibility === 'space' && row.space_role === 'space_manager') {
      return { policyReason: 'space_manager' }
    }
    throw new AuthorizationChangedError()
  }

  private async createInTransaction(
    client: PoolClient,
    record: CreateArtifactRecord,
  ): Promise<ArtifactMutationResult | null> {
    const target = await this.mutationTarget(client, record)
    if (!target) return null
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/artifacts`
    const idempotency = await this.prepareIdempotency(client, {
      ...record,
      canonicalPath,
      method: 'POST',
      request: record.request,
    })
    if (idempotency.responseBody) {
      return { artifact: ArtifactDtoSchema.parse(idempotency.responseBody), replayed: true }
    }
    if (record.request.turnId) {
      const turn = await client.query(`
        SELECT 1 FROM cosmos_turns
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      `, [record.organizationId, record.spaceId, record.sessionId, record.request.turnId])
      if (!turn.rowCount) {
        throw new ArtifactValidationError('turnId', 'The Artifact turnId does not belong to this Session.')
      }
    }
    const occurredAt = idempotency.now.toISOString()
    let inserted
    try {
      inserted = await client.query<ArtifactRow>(`
        INSERT INTO cosmos_artifacts (
          organization_id, space_id, session_id, id, turn_id, type,
          provider, external_id, label, url, status, attributes,
          created_by_tool_call_id, created_by, created_at, updated_at,
          removed_at, removed_by, version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
          NULL, $13, $14, $14, NULL, NULL, 1
        )
        RETURNING ${artifactColumns}
      `, [
        record.organizationId,
        record.spaceId,
        record.sessionId,
        this.createId(),
        record.request.turnId ?? null,
        record.request.type,
        record.request.provider ?? null,
        record.request.externalId ?? null,
        record.request.label,
        record.request.url,
        record.request.status ?? null,
        JSON.stringify(record.request.attributes),
        record.actorId,
        occurredAt,
      ])
    } catch (error) {
      if (isUniqueViolation(error)) throw new ArtifactConflictError()
      throw error
    }
    const artifact = mapArtifact(inserted.rows[0])
    await this.appendLedgers(client, {
      record,
      artifact,
      before: null,
      action: 'create',
      policyReason: target.policyReason,
      idempotencyKeyHash: idempotency.keyHash,
      occurredAt,
    })
    await this.saveIdempotency(client, {
      ...record,
      canonicalPath,
      method: 'POST',
      keyHash: idempotency.keyHash,
      requestHash: idempotency.requestHash,
      expiresAt: idempotency.expiresAt,
      response: artifact,
      statusCode: 201,
    })
    return { artifact, replayed: false }
  }

  private async updateInTransaction(
    client: PoolClient,
    record: UpdateArtifactRecord,
  ): Promise<ArtifactDto | null> {
    const target = await this.mutationTarget(client, record)
    if (!target) return null
    const selected = await client.query<ArtifactRow>(`
      SELECT ${artifactColumns}
      FROM cosmos_artifacts
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND id = $4 AND removed_at IS NULL
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId, record.artifactId])
    if (!selected.rows[0]) return null
    const before = mapArtifact(selected.rows[0])
    if (before.version !== record.expectedVersion) {
      throw new ArtifactVersionConflictError(record.expectedVersion, before.version)
    }
    const next = {
      label: record.request.label ?? before.label,
      url: record.request.url ?? before.url,
      status: record.request.status === undefined ? before.status : record.request.status,
      attributes: record.request.attributes ?? before.attributes,
    }
    if (
      next.label === before.label
      && next.url === before.url
      && next.status === before.status
      && canonicalJson(next.attributes) === canonicalJson(before.attributes)
    ) return before

    const occurredAt = this.now().toISOString()
    const updated = await client.query<ArtifactRow>(`
      UPDATE cosmos_artifacts
      SET label = $5, url = $6, status = $7, attributes = $8::jsonb,
        updated_at = $9, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      RETURNING ${artifactColumns}
    `, [
      record.organizationId,
      record.spaceId,
      record.sessionId,
      record.artifactId,
      next.label,
      next.url,
      next.status,
      JSON.stringify(next.attributes),
      occurredAt,
    ])
    const artifact = mapArtifact(updated.rows[0])
    await this.appendLedgers(client, {
      record,
      artifact,
      before,
      action: 'update',
      policyReason: target.policyReason,
      idempotencyKeyHash: null,
      occurredAt,
    })
    return artifact
  }

  private async removeInTransaction(
    client: PoolClient,
    record: RemoveArtifactRecord,
  ): Promise<ArtifactMutationResult | null> {
    const target = await this.mutationTarget(client, record)
    if (!target) return null
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/artifacts/${record.artifactId}`
    const idempotency = await this.prepareIdempotency(client, {
      ...record,
      canonicalPath,
      method: 'DELETE',
      request: { expectedVersion: record.expectedVersion },
    })
    if (idempotency.responseBody) {
      return { artifact: ArtifactDtoSchema.parse(idempotency.responseBody), replayed: true }
    }
    const selected = await client.query<ArtifactRow>(`
      SELECT ${artifactColumns}
      FROM cosmos_artifacts
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND id = $4 AND removed_at IS NULL
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId, record.artifactId])
    if (!selected.rows[0]) return null
    const before = mapArtifact(selected.rows[0])
    if (before.version !== record.expectedVersion) {
      throw new ArtifactVersionConflictError(record.expectedVersion, before.version)
    }
    const occurredAt = idempotency.now.toISOString()
    const updated = await client.query<ArtifactRow>(`
      UPDATE cosmos_artifacts
      SET removed_at = $5, removed_by = $6, updated_at = $5, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      RETURNING ${artifactColumns}
    `, [
      record.organizationId,
      record.spaceId,
      record.sessionId,
      record.artifactId,
      occurredAt,
      record.actorId,
    ])
    const artifact = mapArtifact(updated.rows[0])
    await this.appendLedgers(client, {
      record,
      artifact,
      before,
      action: 'remove',
      policyReason: target.policyReason,
      idempotencyKeyHash: idempotency.keyHash,
      occurredAt,
    })
    await this.saveIdempotency(client, {
      ...record,
      canonicalPath,
      method: 'DELETE',
      keyHash: idempotency.keyHash,
      requestHash: idempotency.requestHash,
      expiresAt: idempotency.expiresAt,
      response: artifact,
      statusCode: 204,
    })
    return { artifact, replayed: false }
  }

  private async appendLedgers(
    client: PoolClient,
    input: {
      record: CreateArtifactRecord | UpdateArtifactRecord | RemoveArtifactRecord
      artifact: ArtifactDto
      before: ArtifactDto | null
      action: 'create' | 'update' | 'remove'
      policyReason: string
      idempotencyKeyHash: string | null
      occurredAt: string
    },
  ) {
    const projection = (artifact: ArtifactDto) => ({
      artifactId: artifact.id,
      type: artifact.type,
      label: artifact.label,
      status: artifact.status,
      version: artifact.version,
      removedAt: artifact.removedAt,
    })
    const reservation = await client.query<{ sequence: string }>(`
      UPDATE cosmos_sessions
      SET last_event_sequence = last_event_sequence + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence AS sequence
    `, [input.artifact.organizationId, input.artifact.spaceId, input.artifact.sessionId])
    if (!reservation.rows[0]) throw new Error('The Artifact event sequence could not be reserved.')
    const eventType = {
      create: 'artifact.created',
      update: 'artifact.updated',
      remove: 'artifact.removed',
    }[input.action]
    const afterState = projection(input.artifact)
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id,
        actor_kind, artifact_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'artifact', $7, $8::jsonb, $9,
        $10, $7, NULL, $11, $12
      )
    `, [
      input.artifact.organizationId,
      input.artifact.spaceId,
      input.artifact.sessionId,
      this.createId(),
      reservation.rows[0].sequence,
      eventType,
      input.artifact.id,
      JSON.stringify(afterState),
      input.record.actorId,
      input.record.actorKind,
      input.record.requestId,
      input.occurredAt,
    ])
    await client.query(`
      INSERT INTO cosmos_audit_events (
        organization_id, audit_event_id, space_id, session_id,
        actor_id, actor_kind, delegation_chain, action,
        target_type, target_id, result, request_id, idempotency_key_hash,
        policy_decision, policy_reason, before_state, after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, '[]'::jsonb, $7,
        'artifact', $8, 'success', $9, $10,
        'allow', $11, $12::jsonb, $13::jsonb, $14
      )
    `, [
      input.artifact.organizationId,
      this.createId(),
      input.artifact.spaceId,
      input.artifact.sessionId,
      input.record.actorId,
      input.record.actorKind,
      `artifact.${input.action}`,
      input.artifact.id,
      input.record.requestId,
      input.idempotencyKeyHash,
      input.policyReason,
      input.before === null ? null : JSON.stringify(projection(input.before)),
      JSON.stringify(afterState),
      input.occurredAt,
    ])
    await client.query(`
      INSERT INTO cosmos_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, 'artifact', $5, $6, $7::jsonb, $8)
    `, [
      this.createId(),
      input.artifact.organizationId,
      input.artifact.spaceId,
      input.artifact.sessionId,
      input.artifact.id,
      eventType,
      JSON.stringify({ sessionId: input.artifact.sessionId, ...afterState }),
      input.occurredAt,
    ])
  }

  private async prepareIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      actorId: string
      idempotencyKey: string
      canonicalPath: string
      method: 'POST' | 'DELETE'
      request: unknown
    },
  ) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([
        input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash,
      ]),
    ])
    const now = this.now()
    const existing = await client.query<{ request_hash: string; response_body: unknown | null }>(`
      SELECT idempotency.request_hash, response.response_body
      FROM cosmos_idempotency_records idempotency
      LEFT JOIN cosmos_idempotency_responses response
        ON response.organization_id = idempotency.organization_id
        AND response.actor_id = idempotency.actor_id
        AND response.method = idempotency.method
        AND response.canonical_path = idempotency.canonical_path
        AND response.idempotency_key_hash = idempotency.idempotency_key_hash
        AND response.expires_at > $6
      WHERE idempotency.organization_id = $1 AND idempotency.actor_id = $2
        AND idempotency.method = $3 AND idempotency.canonical_path = $4
        AND idempotency.idempotency_key_hash = $5 AND idempotency.expires_at > $6
    `, [
      input.organizationId,
      input.actorId,
      input.method,
      input.canonicalPath,
      keyHash,
      now.toISOString(),
    ])
    if (existing.rowCount) {
      if (existing.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError()
      if (!existing.rows[0].response_body) {
        throw new Error('The idempotent Artifact response is unavailable.')
      }
      return {
        keyHash,
        requestHash,
        now,
        expiresAt: new Date(now.getTime() + this.idempotencyTtlMs).toISOString(),
        responseBody: existing.rows[0].response_body,
      }
    }
    await client.query(`
      DELETE FROM cosmos_idempotency_responses
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    await client.query(`
      DELETE FROM cosmos_idempotency_records
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    return {
      keyHash,
      requestHash,
      now,
      expiresAt: new Date(now.getTime() + this.idempotencyTtlMs).toISOString(),
      responseBody: null,
    }
  }

  private async saveIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      spaceId: string
      sessionId: string
      actorId: string
      canonicalPath: string
      method: 'POST' | 'DELETE'
      keyHash: string
      requestHash: string
      expiresAt: string
      response: ArtifactDto
      statusCode: number
    },
  ) {
    await client.query(`
      INSERT INTO cosmos_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      input.organizationId, input.spaceId, input.actorId, input.method,
      input.canonicalPath, input.keyHash, input.requestHash, input.sessionId, input.expiresAt,
    ])
    await client.query(`
      INSERT INTO cosmos_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      input.keyHash, input.statusCode, JSON.stringify(input.response),
      JSON.stringify({ etag: `"${input.response.version}"` }), input.expiresAt,
    ])
  }
}
