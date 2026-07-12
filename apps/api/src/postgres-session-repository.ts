import { createHash, randomUUID } from 'node:crypto'
import {
  CreateSessionResponseSchema,
  SessionDtoSchema,
  type CreateSessionResponse,
  type SessionDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  AuthorizationChangedError,
  IdempotencyConflictError,
  createSessionStartRecords,
  createSessionDto,
  type CreateSessionRecord,
  type CreateSessionResult,
  type OrganizationRole,
  type SessionRepository,
  type SpaceAccess,
  type SpaceRole,
} from './session-repository.js'

type SessionRow = {
  id: string
  organization_id: string
  space_id: string
  title: string
  summary: string
  expert_id: string
  expert_name: string
  expert_version: number | null
  environment_id: string | null
  repository: string
  base_branch: string
  visibility: SessionDto['visibility']
  status: SessionDto['status']
  attachments: unknown
  source: 'manual'
  created_at: Date | string
  updated_at: Date | string
  last_activity_at: Date | string
  version: number
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapSession(row: SessionRow): SessionDto {
  return SessionDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    title: row.title,
    summary: row.summary,
    expertId: row.expert_id,
    expertName: row.expert_name,
    expertVersion: row.expert_version ?? undefined,
    environmentId: row.environment_id ?? undefined,
    repository: row.repository,
    baseBranch: row.base_branch,
    visibility: row.visibility,
    status: row.status,
    attachments: row.attachments,
    source: row.source,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    lastActivityAt: timestamp(row.last_activity_at),
    version: row.version,
  })
}

function responseToResult(response: CreateSessionResponse, replayed: boolean): CreateSessionResult {
  return {
    session: response.session,
    message: response.message,
    turn: response.turn,
    command: response.command,
    replayed,
  }
}

const sessionColumns = `
  id, organization_id, space_id, title, summary, expert_id, expert_name,
  expert_version, environment_id, repository, base_branch, visibility, status,
  attachments, source, created_at, updated_at, last_activity_at, version
`

export type PostgresSessionRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  idempotencyTtlMs?: number
}

export class PostgresSessionRepository implements SessionRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly idempotencyTtlMs: number

  constructor(private readonly pool: Pool, options: PostgresSessionRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1_000
  }

  async getSpaceAccess(organizationId: string, spaceId: string, actorId: string): Promise<SpaceAccess | null> {
    const result = await this.pool.query<{
      organization_role: OrganizationRole
      space_role: SpaceRole
    }>(`
      SELECT organization_membership.role AS organization_role, space_membership.role AS space_role
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
    `, [organizationId, spaceId, actorId])
    const row = result.rows[0]
    return row ? { organizationRole: row.organization_role, spaceRole: row.space_role } : null
  }

  async listBySpace(organizationId: string, spaceId: string, actorId: string): Promise<SessionDto[]> {
    const result = await this.pool.query<SessionRow>(`
      SELECT ${sessionColumns}
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2
        AND (visibility = 'space' OR created_by = $3)
      ORDER BY last_activity_at DESC, id DESC
    `, [organizationId, spaceId, actorId])
    return result.rows.map(mapSession)
  }

  async create(record: CreateSessionRecord): Promise<CreateSessionResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.createInTransaction(client, record)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async createInTransaction(client: PoolClient, record: CreateSessionRecord): Promise<CreateSessionResult> {
    const access = await client.query<{ role: SpaceRole }>(`
      SELECT space_membership.role
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
      FOR UPDATE OF organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.actorId])
    if (!access.rowCount || access.rows[0].role === 'viewer') throw new AuthorizationChangedError()

    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson(record.request))
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions`
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([record.organizationId, record.actorId, 'POST', canonicalPath, keyHash]),
    ])

    const now = this.now()
    const existing = await client.query<{
      request_hash: string
      session_id: string
      response_body: unknown | null
    }>(`
      SELECT idempotency.request_hash, idempotency.session_id, response.response_body
      FROM relay_idempotency_records idempotency
      LEFT JOIN relay_idempotency_responses response
        ON response.organization_id = idempotency.organization_id
        AND response.actor_id = idempotency.actor_id
        AND response.method = idempotency.method
        AND response.canonical_path = idempotency.canonical_path
        AND response.idempotency_key_hash = idempotency.idempotency_key_hash
        AND response.expires_at > $5
      WHERE idempotency.organization_id = $1 AND idempotency.actor_id = $2
        AND idempotency.method = 'POST' AND idempotency.canonical_path = $3
        AND idempotency.idempotency_key_hash = $4 AND idempotency.expires_at > $5
    `, [record.organizationId, record.actorId, canonicalPath, keyHash, now.toISOString()])

    if (existing.rowCount) {
      if (existing.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError()
      const response = existing.rows[0].response_body
        ? CreateSessionResponseSchema.parse(existing.rows[0].response_body)
        : { session: await this.getSession(client, existing.rows[0].session_id) }
      return responseToResult(response, true)
    }

    await client.query(`
      DELETE FROM relay_idempotency_responses
      WHERE organization_id = $1 AND actor_id = $2 AND method = 'POST'
        AND canonical_path = $3 AND idempotency_key_hash = $4
        AND expires_at <= $5
    `, [record.organizationId, record.actorId, canonicalPath, keyHash, now.toISOString()])
    await client.query(`
      DELETE FROM relay_idempotency_records
      WHERE organization_id = $1 AND actor_id = $2 AND method = 'POST'
        AND canonical_path = $3 AND idempotency_key_hash = $4
        AND expires_at <= $5
    `, [record.organizationId, record.actorId, canonicalPath, keyHash, now.toISOString()])
    const session = createSessionDto(record, { id: this.createId(), timestamp: now.toISOString() })
    const startRecords = createSessionStartRecords(record, session, { createId: this.createId })
    await client.query(`
      INSERT INTO relay_sessions (
        ${sessionColumns}, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14::jsonb, $15, $16, $17, $18, $19, $20
      )
    `, [
      session.id, session.organizationId, session.spaceId, session.title, session.summary,
      session.expertId, session.expertName, session.expertVersion ?? null,
      session.environmentId ?? null, session.repository, session.baseBranch, session.visibility,
      session.status, JSON.stringify(session.attachments), session.source, session.createdAt,
      session.updatedAt, session.lastActivityAt, session.version, record.actorId,
    ])
    if (startRecords.message && startRecords.turn && startRecords.command) {
      await client.query(`
        INSERT INTO relay_messages (
          id, organization_id, space_id, session_id, sequence, role,
          actor_id, content, attachments, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      `, [
        startRecords.message.id, session.organizationId, session.spaceId, session.id,
        startRecords.message.sequence, startRecords.message.role, startRecords.message.actorId,
        startRecords.message.content, JSON.stringify(startRecords.message.attachments),
        startRecords.message.createdAt,
      ])
      await client.query(`
        INSERT INTO relay_turns (
          id, organization_id, space_id, session_id, ordinal, initiator_type,
          initiator_id, input_message_id, status, queued_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        startRecords.turn.id, session.organizationId, session.spaceId, session.id,
        startRecords.turn.ordinal, startRecords.turn.initiatorType, startRecords.turn.initiatorId,
        startRecords.turn.inputMessageId, startRecords.turn.status, startRecords.turn.queuedAt,
        startRecords.turn.version,
      ])
      await client.query(`
        INSERT INTO relay_commands (
          id, organization_id, space_id, session_id, type, status,
          resource_type, resource_id, payload, accepted_at, available_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
      `, [
        startRecords.command.id, session.organizationId, session.spaceId, session.id,
        startRecords.command.type, startRecords.command.status, startRecords.command.resourceType,
        startRecords.command.resourceId, JSON.stringify({ turnId: startRecords.turn.id }),
        startRecords.command.acceptedAt,
      ])
      await client.query(`
        INSERT INTO relay_outbox_events (
          id, organization_id, space_id, session_id, aggregate_type,
          aggregate_id, event_type, payload, occurred_at
        ) VALUES ($1, $2, $3, $4, 'session', $4, 'session.created', $5::jsonb, $6)
      `, [
        this.createId(), session.organizationId, session.spaceId, session.id,
        JSON.stringify({
          sessionId: session.id,
          messageId: startRecords.message.id,
          turnId: startRecords.turn.id,
          commandId: startRecords.command.id,
        }),
        session.createdAt,
      ])
    }
    const response = CreateSessionResponseSchema.parse({ session, ...startRecords })
    const expiresAt = new Date(now.getTime() + this.idempotencyTtlMs).toISOString()
    await client.query(`
      INSERT INTO relay_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, 'POST', $4, $5, $6, $7, $8)
    `, [
      record.organizationId, record.spaceId, record.actorId, canonicalPath, keyHash, requestHash, session.id,
      expiresAt,
    ])
    await client.query(`
      INSERT INTO relay_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, 'POST', $3, $4, 201, $5::jsonb, $6::jsonb, $7)
    `, [
      record.organizationId, record.actorId, canonicalPath, keyHash,
      JSON.stringify(response), JSON.stringify({ location: `${canonicalPath}/${session.id}` }), expiresAt,
    ])
    return responseToResult(response, false)
  }

  private async getSession(client: PoolClient, sessionId: string) {
    const result = await client.query<SessionRow>(`
      SELECT ${sessionColumns} FROM relay_sessions WHERE id = $1
    `, [sessionId])
    if (!result.rowCount) throw new Error('The idempotent Session no longer exists.')
    return mapSession(result.rows[0])
  }
}
