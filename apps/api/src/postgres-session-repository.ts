import { createHash, randomUUID } from 'node:crypto'
import {
  CreateSessionResponseSchema,
  MeOrganizationSchema,
  SessionDtoSchema,
  SendSessionMessageResponseSchema,
  StartSessionResponseSchema,
  type CreateSessionResponse,
  type MeOrganization,
  type SessionDto,
  type SendSessionMessageResponse,
  type StartSessionResponse,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  AuthorizationChangedError,
  EnvironmentNotReadyError,
  ExecutionUnavailableError,
  ExpertNotPublishedError,
  IdempotencyConflictError,
  SessionConfigurationNotFoundError,
  canWriteSpace,
  createSessionRecords,
  createSessionFollowUpRecords,
  createSessionStartRecords,
  createSessionDto,
  orderActorOrganizations,
  resolveRepositoryBinding,
  type CreateSessionRecord,
  type CreateSessionResult,
  type InMemoryRepositoryBinding,
  type OrganizationRole,
  type ResolvedSessionConfiguration,
  type RenameSessionRecord,
  type SendSessionMessageRecord,
  type SendSessionMessageResult,
  type SessionListOptions,
  type SessionListPage,
  type SessionLifecycleResult,
  type SessionRepository,
  type SpaceAccess,
  type SpaceRole,
  type SetSessionArchivedRecord,
  type StartSessionRecord,
  type StartSessionResult,
  SessionStateConflictError,
  SessionVersionConflictError,
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
  expert_revision_id: string | null
  environment_id: string | null
  environment_revision_id: string | null
  repository_id: string | null
  configuration_resolution_version: 0 | 1
  repository: string
  base_branch: string
  visibility: SessionDto['visibility']
  status: SessionDto['status']
  attachments: unknown
  source: 'manual'
  created_at: Date | string
  updated_at: Date | string
  last_activity_at: Date | string
  archived_at: Date | string | null
  version: number
}

type SessionEventDraft = {
  eventType:
    | 'session.created'
    | 'session.updated'
    | 'session.renamed'
    | 'session.archived'
    | 'session.restored'
    | 'message.created'
    | 'turn.queued'
  resourceType: 'session' | 'message' | 'turn'
  resourceId: string
  payload: Record<string, unknown>
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
    expertRevisionId: row.expert_revision_id ?? undefined,
    environmentId: row.environment_id ?? undefined,
    environmentRevisionId: row.environment_revision_id ?? undefined,
    repositoryId: row.repository_id ?? undefined,
    configurationResolutionVersion: row.configuration_resolution_version,
    repository: row.repository,
    baseBranch: row.base_branch,
    visibility: row.visibility,
    status: row.status,
    attachments: row.attachments,
    source: row.source,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    lastActivityAt: timestamp(row.last_activity_at),
    archivedAt: row.archived_at === null ? null : timestamp(row.archived_at),
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

function responseToStartResult(response: StartSessionResponse, replayed: boolean): StartSessionResult {
  return { ...response, replayed }
}

function responseToSendResult(
  response: SendSessionMessageResponse,
  replayed: boolean,
): SendSessionMessageResult {
  return { ...response, replayed }
}

function responseToLifecycleResult(session: SessionDto, replayed: boolean): SessionLifecycleResult {
  return { session, replayed }
}

const sessionColumns = `
  id, organization_id, space_id, title, summary, expert_id, expert_name,
  expert_version, expert_revision_id, environment_id, environment_revision_id,
  repository_id, configuration_resolution_version, repository, base_branch,
  visibility, status, attachments, source, created_at, updated_at,
  last_activity_at, archived_at, version
`

export type PostgresSessionRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  idempotencyTtlMs?: number
  executionMaxAttempts?: number
}

export class PostgresSessionRepository implements SessionRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly idempotencyTtlMs: number
  private readonly executionMaxAttempts: number

  constructor(private readonly pool: Pool, options: PostgresSessionRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1_000
    this.executionMaxAttempts = options.executionMaxAttempts ?? 5
    if (!Number.isSafeInteger(this.executionMaxAttempts)
      || this.executionMaxAttempts < 1
      || this.executionMaxAttempts > 20) {
      throw new Error('executionMaxAttempts must be an integer between 1 and 20.')
    }
  }

  async listActorOrganizations(actorId: string): Promise<MeOrganization[]> {
    const result = await this.pool.query<{
      organization_id: string
      organization_name: string
      organization_role: OrganizationRole
      space_id: string | null
      space_name: string | null
      space_role: SpaceRole | null
    }>(`
      SELECT organization.id AS organization_id, organization.name AS organization_name,
        organization_membership.role AS organization_role,
        space.id AS space_id, space.name AS space_name, space_membership.role AS space_role
      FROM relay_organization_memberships organization_membership
      JOIN relay_organizations organization
        ON organization.id = organization_membership.organization_id
      LEFT JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      LEFT JOIN relay_spaces space
        ON space.organization_id = space_membership.organization_id
        AND space.id = space_membership.space_id
      WHERE organization_membership.actor_id = $1
    `, [actorId])
    const organizations = new Map<string, MeOrganization>()

    for (const row of result.rows) {
      let organization = organizations.get(row.organization_id)
      if (!organization) {
        organization = MeOrganizationSchema.parse({
          id: row.organization_id,
          name: row.organization_name,
          role: row.organization_role,
          spaces: [],
        })
        organizations.set(row.organization_id, organization)
      }
      if (row.space_id !== null && row.space_name !== null && row.space_role !== null) {
        organization.spaces.push({
          id: row.space_id,
          name: row.space_name,
          role: row.space_role,
        })
      }
    }

    return orderActorOrganizations(
      [...organizations.values()].map((organization) => MeOrganizationSchema.parse(organization)),
    )
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

  async listBySpace(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: SessionListOptions = {},
  ): Promise<SessionListPage> {
    const limit = options.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Session page limit must be an integer between 1 and 100.')
    }
    const parameters: unknown[] = [organizationId, spaceId, actorId]
    const clauses = ['(session.visibility = \'space\' OR session.created_by = $3)']
    if (options.archived !== 'all') {
      clauses.push(options.archived === true
        ? 'session.archived_at IS NOT NULL'
        : 'session.archived_at IS NULL')
    }
    if (options.status) {
      parameters.push(options.status)
      clauses.push(`session.status = $${parameters.length}`)
    }
    if (options.search) {
      const pattern = `%${options.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      parameters.push(pattern)
      clauses.push(`(
        session.title ILIKE $${parameters.length} ESCAPE '\\'
        OR session.summary ILIKE $${parameters.length} ESCAPE '\\'
        OR session.expert_name ILIKE $${parameters.length} ESCAPE '\\'
        OR session.repository ILIKE $${parameters.length} ESCAPE '\\'
      )`)
    }
    if (options.cursor) {
      if (!options.cursor.id.trim() || Number.isNaN(new Date(options.cursor.lastActivityAt).valueOf())) {
        throw new RangeError('Session cursor must contain a valid timestamp and Session id.')
      }
      parameters.push(options.cursor.lastActivityAt, options.cursor.id)
      clauses.push(`(session.last_activity_at, session.id) < (
        $${parameters.length - 1}::timestamptz, $${parameters.length}
      )`)
    }
    parameters.push(limit + 1)
    const result = await this.pool.query<SessionRow & { cursor_last_activity_at: string }>(`
      SELECT ${sessionColumns.split(',').map((column) => `session.${column.trim()}`).join(', ')},
        to_char(
          session.last_activity_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS cursor_last_activity_at
      FROM relay_sessions session
      JOIN relay_organization_memberships organization_membership
        ON organization_membership.organization_id = session.organization_id
        AND organization_membership.actor_id = $3
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = session.organization_id
        AND space_membership.space_id = session.space_id
        AND space_membership.actor_id = $3
      WHERE session.organization_id = $1 AND session.space_id = $2
        AND ${clauses.join('\n        AND ')}
      ORDER BY session.last_activity_at DESC, session.id DESC
      LIMIT $${parameters.length}
    `, parameters)
    const hasMore = result.rows.length > limit
    const selectedRows = result.rows.slice(0, limit)
    const items = selectedRows.map(mapSession)
    const last = selectedRows.at(-1)
    return {
      items,
      hasMore,
      nextCursor: hasMore && last
        ? { lastActivityAt: last.cursor_last_activity_at, id: last.id }
        : null,
      projectionUpdatedAt: items[0]?.updatedAt ?? null,
    }
  }

  async getById(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
  ): Promise<SessionDto | null> {
    const result = await this.pool.query<SessionRow>(`
      SELECT ${sessionColumns.split(',').map((column) => `session.${column.trim()}`).join(', ')}
      FROM relay_sessions session
      JOIN relay_organization_memberships organization_membership
        ON organization_membership.organization_id = session.organization_id
        AND organization_membership.actor_id = $4
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = session.organization_id
        AND space_membership.space_id = session.space_id
        AND space_membership.actor_id = $4
      WHERE session.organization_id = $1
        AND session.space_id = $2
        AND session.id = $3
        AND (session.visibility = 'space' OR session.created_by = $4)
    `, [organizationId, spaceId, sessionId, actorId])
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async rename(record: RenameSessionRecord): Promise<SessionDto | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.renameInTransaction(client, record)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async setArchived(record: SetSessionArchivedRecord): Promise<SessionLifecycleResult | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.setArchivedInTransaction(client, record)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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

  async start(record: StartSessionRecord): Promise<StartSessionResult | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.startInTransaction(client, record)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async send(record: SendSessionMessageRecord): Promise<SendSessionMessageResult | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.sendInTransaction(client, record)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async lockMetadataTarget(
    client: PoolClient,
    record: RenameSessionRecord | SetSessionArchivedRecord,
  ): Promise<{ session: SessionDto; policyReason: string } | null> {
    const access = await client.query<SpaceAccess>(`
      SELECT organization_membership.role AS "organizationRole", space_membership.role AS "spaceRole"
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
      FOR UPDATE OF organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.actorId])
    if (!access.rowCount || !canWriteSpace(access.rows[0])) throw new AuthorizationChangedError()

    const candidate = await client.query<SessionRow & { created_by: string }>(`
      SELECT ${sessionColumns}, created_by
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId])
    const row = candidate.rows[0]
    if (!row || (row.visibility === 'private' && row.created_by !== record.actorId)) return null
    if (row.created_by === record.actorId) {
      return { session: mapSession(row), policyReason: 'session_creator' }
    }
    if (row.visibility === 'space' && access.rows[0].spaceRole === 'space_manager') {
      return { session: mapSession(row), policyReason: 'space_manager' }
    }
    throw new AuthorizationChangedError()
  }

  private async renameInTransaction(
    client: PoolClient,
    record: RenameSessionRecord,
  ): Promise<SessionDto | null> {
    const target = await this.lockMetadataTarget(client, record)
    if (!target) return null
    const before = target.session
    if (before.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, before.version)
    }
    if (before.title === record.request.title) return before

    const updated = await client.query<SessionRow>(`
      UPDATE relay_sessions
      SET title = $4, updated_at = $5, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING ${sessionColumns}
    `, [
      record.organizationId,
      record.spaceId,
      record.sessionId,
      record.request.title,
      this.now().toISOString(),
    ])
    const session = mapSession(updated.rows[0])
    await this.appendMetadataLedger(
      client,
      record,
      before,
      session,
      'rename',
      target.policyReason,
      null,
    )
    return session
  }

  private async setArchivedInTransaction(
    client: PoolClient,
    record: SetSessionArchivedRecord,
  ): Promise<SessionLifecycleResult | null> {
    const target = await this.lockMetadataTarget(client, record)
    if (!target) return null

    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson({ expectedVersion: record.expectedVersion }))
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/${record.action}`
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([record.organizationId, record.actorId, 'POST', canonicalPath, keyHash]),
    ])
    const now = this.now()
    const existing = await client.query<{ request_hash: string; response_body: unknown | null }>(`
      SELECT idempotency.request_hash, response.response_body
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
      if (!existing.rows[0].response_body) throw new Error('The idempotent Session lifecycle response is unavailable.')
      return responseToLifecycleResult(SessionDtoSchema.parse(existing.rows[0].response_body), true)
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

    const before = target.session
    if (before.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, before.version)
    }
    const alreadyInTargetState = record.action === 'archive'
      ? before.archivedAt !== null
      : before.archivedAt === null
    let session = before
    if (!alreadyInTargetState) {
      const updated = await client.query<SessionRow>(`
        UPDATE relay_sessions
        SET archived_at = $4, updated_at = $5, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        RETURNING ${sessionColumns}
      `, [
        record.organizationId,
        record.spaceId,
        record.sessionId,
        record.action === 'archive' ? now.toISOString() : null,
        now.toISOString(),
      ])
      session = mapSession(updated.rows[0])
      await this.appendMetadataLedger(
        client,
        record,
        before,
        session,
        record.action,
        target.policyReason,
        keyHash,
      )
    }

    const expiresAt = new Date(now.getTime() + this.idempotencyTtlMs).toISOString()
    await client.query(`
      INSERT INTO relay_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, 'POST', $4, $5, $6, $7, $8)
    `, [
      record.organizationId,
      record.spaceId,
      record.actorId,
      canonicalPath,
      keyHash,
      requestHash,
      session.id,
      expiresAt,
    ])
    await client.query(`
      INSERT INTO relay_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, 'POST', $3, $4, 200, $5::jsonb, $6::jsonb, $7)
    `, [
      record.organizationId,
      record.actorId,
      canonicalPath,
      keyHash,
      JSON.stringify(session),
      JSON.stringify({ etag: `"${session.version}"` }),
      expiresAt,
    ])
    return responseToLifecycleResult(session, false)
  }

  private async appendMetadataLedger(
    client: PoolClient,
    record: RenameSessionRecord | SetSessionArchivedRecord,
    before: SessionDto,
    session: SessionDto,
    action: 'rename' | 'archive' | 'restore',
    policyReason: string,
    idempotencyKeyHash: string | null,
  ) {
    const eventType = action === 'rename'
      ? 'session.renamed'
      : action === 'archive'
        ? 'session.archived'
        : 'session.restored'
    const auditAction = `session.${action}` as const
    const payload = action === 'rename'
      ? { title: session.title, version: session.version }
      : { archivedAt: session.archivedAt, version: session.version }
    const sequence = await client.query<{ sequence: string }>(`
      UPDATE relay_sessions
      SET last_event_sequence = last_event_sequence + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence AS sequence
    `, [session.organizationId, session.spaceId, session.id])
    if (!sequence.rowCount) throw new Error('The Session event sequence could not be reserved.')

    await client.query(`
      INSERT INTO relay_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id,
        actor_kind, message_id, turn_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'session', $3, $7::jsonb, $8, $9,
        NULL, NULL, NULL, $10, $11
      )
    `, [
      session.organizationId,
      session.spaceId,
      session.id,
      this.createId(),
      sequence.rows[0].sequence,
      eventType,
      JSON.stringify(payload),
      record.actorId,
      record.actorKind,
      record.requestId,
      session.updatedAt,
    ])

    const beforeState = action === 'rename'
      ? { title: before.title, version: before.version }
      : { archivedAt: before.archivedAt, version: before.version }
    const afterState = action === 'rename'
      ? { title: session.title, version: session.version }
      : { archivedAt: session.archivedAt, version: session.version }
    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, action, target_type, target_id, result, request_id,
        idempotency_key_hash, policy_decision, policy_reason, before_state,
        after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'session', $4,
        'success', $8, $9, 'allow', $10, $11::jsonb, $12::jsonb, $13
      )
    `, [
      session.organizationId,
      this.createId(),
      session.spaceId,
      session.id,
      record.actorId,
      record.actorKind,
      auditAction,
      record.requestId,
      idempotencyKeyHash,
      policyReason,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      session.updatedAt,
    ])
  }

  private async sendInTransaction(
    client: PoolClient,
    record: SendSessionMessageRecord,
  ): Promise<SendSessionMessageResult | null> {
    const access = await client.query<SpaceAccess>(`
      SELECT organization_membership.role AS "organizationRole", space_membership.role AS "spaceRole"
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
      FOR UPDATE OF organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.actorId])
    if (!access.rowCount || !canWriteSpace(access.rows[0])) throw new AuthorizationChangedError()

    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson(record.request))
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/messages`
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([record.organizationId, record.actorId, 'POST', canonicalPath, keyHash]),
    ])
    const now = this.now()
    const existing = await client.query<{ request_hash: string; response_body: unknown | null }>(`
      SELECT idempotency.request_hash, response.response_body
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
      if (!existing.rows[0].response_body) throw new Error('The idempotent send response is unavailable.')
      return responseToSendResult(
        SendSessionMessageResponseSchema.parse(existing.rows[0].response_body),
        true,
      )
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

    const candidate = await client.query<SessionRow & { created_by: string }>(`
      SELECT ${sessionColumns}, created_by
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId])
    const row = candidate.rows[0]
    if (!row || (row.visibility === 'private' && row.created_by !== record.actorId)) return null
    const before = mapSession(row)
    if (before.status === 'draft' || before.status === 'canceled') {
      throw new SessionStateConflictError(before.status, 'send')
    }
    if (record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
    }

    const counters = await client.query<{ message_sequence: string; turn_ordinal: number }>(`
      SELECT
        COALESCE((SELECT MAX(sequence) FROM relay_messages
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3), 0) + 1
          AS message_sequence,
        COALESCE((SELECT MAX(ordinal) FROM relay_turns
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3), 0) + 1
          AS turn_ordinal
    `, [record.organizationId, record.spaceId, record.sessionId])
    const messageSequence = Number(counters.rows[0]?.message_sequence)
    const turnOrdinal = counters.rows[0]?.turn_ordinal
    if (!Number.isSafeInteger(messageSequence) || !Number.isSafeInteger(turnOrdinal)) {
      throw new Error('The Session Message or Turn sequence could not be allocated.')
    }

    const targetStatus = before.status === 'completed' || before.status === 'failed'
      ? 'queued'
      : before.status
    const updated = await client.query<SessionRow>(`
      UPDATE relay_sessions
      SET status = $4, updated_at = $5, last_activity_at = $5, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING ${sessionColumns}
    `, [record.organizationId, record.spaceId, record.sessionId, targetStatus, now.toISOString()])
    const session = mapSession(updated.rows[0])
    const records = createSessionFollowUpRecords(record, session, {
      messageSequence,
      turnOrdinal,
      createId: this.createId,
      timestamp: session.updatedAt,
    })

    await client.query(`
      INSERT INTO relay_messages (
        id, organization_id, space_id, session_id, sequence, role,
        actor_id, content, attachments, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
    `, [
      records.message.id, session.organizationId, session.spaceId, session.id,
      records.message.sequence, records.message.role, records.message.actorId,
      records.message.content, JSON.stringify(records.message.attachments), records.message.createdAt,
    ])
    await client.query(`
      INSERT INTO relay_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        initiator_id, input_message_id, status, queued_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      records.turn.id, session.organizationId, session.spaceId, session.id,
      records.turn.ordinal, records.turn.initiatorType, records.turn.initiatorId,
      records.turn.inputMessageId, records.turn.status, records.turn.queuedAt, records.turn.version,
    ])
    await client.query(`
      INSERT INTO relay_commands (
        id, organization_id, space_id, session_id, type, status,
        resource_type, resource_id, payload, accepted_at, available_at,
        protocol_version, requested_by, request_id, max_attempts
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10,
        1, $11, $12, $13
      )
    `, [
      records.command.id, session.organizationId, session.spaceId, session.id,
      records.command.type, records.command.status, records.command.resourceType,
      records.command.resourceId, JSON.stringify({
        turnId: records.turn.id,
        messageId: records.message.id,
        configurationResolutionVersion: session.configurationResolutionVersion,
        expertRevisionId: session.expertRevisionId,
        environmentRevisionId: session.environmentRevisionId,
        repositoryId: session.repositoryId,
      }),
      records.command.acceptedAt,
      record.actorId,
      record.requestId,
      this.executionMaxAttempts,
    ])
    await client.query(`
      INSERT INTO relay_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, 'session', $4, 'session.message_sent', $5::jsonb, $6)
    `, [
      this.createId(), session.organizationId, session.spaceId, session.id,
      JSON.stringify({
        sessionId: session.id,
        messageId: records.message.id,
        turnId: records.turn.id,
        commandId: records.command.id,
      }),
      session.updatedAt,
    ])
    await this.appendSendLedger(client, record, before, session, records, keyHash)

    const response = SendSessionMessageResponseSchema.parse({ session, ...records })
    const expiresAt = new Date(now.getTime() + this.idempotencyTtlMs).toISOString()
    await client.query(`
      INSERT INTO relay_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, 'POST', $4, $5, $6, $7, $8)
    `, [
      record.organizationId, record.spaceId, record.actorId, canonicalPath, keyHash,
      requestHash, session.id, expiresAt,
    ])
    await client.query(`
      INSERT INTO relay_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, 'POST', $3, $4, 202, $5::jsonb, $6::jsonb, $7)
    `, [
      record.organizationId, record.actorId, canonicalPath, keyHash,
      JSON.stringify(response), JSON.stringify({ etag: `"${session.version}"` }), expiresAt,
    ])
    return responseToSendResult(response, false)
  }

  private async startInTransaction(
    client: PoolClient,
    record: StartSessionRecord,
  ): Promise<StartSessionResult | null> {
    const access = await client.query<SpaceAccess>(`
      SELECT organization_membership.role AS "organizationRole", space_membership.role AS "spaceRole"
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
      FOR UPDATE OF organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.actorId])
    if (!access.rowCount || !canWriteSpace(access.rows[0])) throw new AuthorizationChangedError()

    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson({ expectedVersion: record.expectedVersion }))
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/start`
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([record.organizationId, record.actorId, 'POST', canonicalPath, keyHash]),
    ])

    const now = this.now()
    const existing = await client.query<{
      request_hash: string
      response_body: unknown | null
    }>(`
      SELECT idempotency.request_hash, response.response_body
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
      if (!existing.rows[0].response_body) throw new Error('The idempotent start response is unavailable.')
      return responseToStartResult(StartSessionResponseSchema.parse(existing.rows[0].response_body), true)
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

    const candidate = await client.query<SessionRow & { created_by: string }>(`
      SELECT ${sessionColumns}, created_by
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId])
    const row = candidate.rows[0]
    if (!row || (row.visibility === 'private' && row.created_by !== record.actorId)) return null
    const before = mapSession(row)
    if (before.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, before.version)
    }
    if (before.status !== 'draft') throw new SessionStateConflictError(before.status)
    if (record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
    }

    const initialMessage = await client.query<{ id: string }>(`
      SELECT id
      FROM relay_messages
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND sequence = 1 AND role = 'user'
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.sessionId])
    const messageRow = initialMessage.rows[0]
    if (!messageRow) throw new Error('The draft Session does not have an initial Message.')
    const message = { id: messageRow.id }

    const updated = await client.query<SessionRow>(`
      UPDATE relay_sessions
      SET status = 'queued', updated_at = $4, last_activity_at = $4, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING ${sessionColumns}
    `, [record.organizationId, record.spaceId, record.sessionId, now.toISOString()])
    const session = mapSession(updated.rows[0])
    const records = createSessionStartRecords(session, message, record.actorId, {
      createId: this.createId,
      timestamp: session.updatedAt,
    })

    await client.query(`
      INSERT INTO relay_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        initiator_id, input_message_id, status, queued_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      records.turn.id, session.organizationId, session.spaceId, session.id,
      records.turn.ordinal, records.turn.initiatorType, records.turn.initiatorId,
      records.turn.inputMessageId, records.turn.status, records.turn.queuedAt, records.turn.version,
    ])
    await client.query(`
      INSERT INTO relay_commands (
        id, organization_id, space_id, session_id, type, status,
        resource_type, resource_id, payload, accepted_at, available_at,
        protocol_version, requested_by, request_id, max_attempts
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10,
        1, $11, $12, $13
      )
    `, [
      records.command.id, session.organizationId, session.spaceId, session.id,
      records.command.type, records.command.status, records.command.resourceType,
      records.command.resourceId, JSON.stringify({
        turnId: records.turn.id,
        configurationResolutionVersion: session.configurationResolutionVersion,
        expertRevisionId: session.expertRevisionId,
        environmentRevisionId: session.environmentRevisionId,
        repositoryId: session.repositoryId,
      }),
      records.command.acceptedAt,
      record.actorId,
      record.requestId,
      this.executionMaxAttempts,
    ])
    await client.query(`
      INSERT INTO relay_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, 'session', $4, 'session.started', $5::jsonb, $6)
    `, [
      this.createId(), session.organizationId, session.spaceId, session.id,
      JSON.stringify({
        sessionId: session.id,
        messageId: message.id,
        turnId: records.turn.id,
        commandId: records.command.id,
        configurationResolutionVersion: session.configurationResolutionVersion,
        expertRevisionId: session.expertRevisionId,
        environmentRevisionId: session.environmentRevisionId,
        repositoryId: session.repositoryId,
      }),
      session.updatedAt,
    ])
    await this.appendStartLedger(client, record, before, session, records, keyHash)

    const response = StartSessionResponseSchema.parse({ session, ...records })
    const expiresAt = new Date(now.getTime() + this.idempotencyTtlMs).toISOString()
    await client.query(`
      INSERT INTO relay_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, 'POST', $4, $5, $6, $7, $8)
    `, [
      record.organizationId, record.spaceId, record.actorId, canonicalPath, keyHash,
      requestHash, session.id, expiresAt,
    ])
    await client.query(`
      INSERT INTO relay_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, 'POST', $3, $4, 202, $5::jsonb, $6::jsonb, $7)
    `, [
      record.organizationId, record.actorId, canonicalPath, keyHash,
      JSON.stringify(response), JSON.stringify({ etag: `"${session.version}"` }), expiresAt,
    ])
    return responseToStartResult(response, false)
  }

  private async createInTransaction(client: PoolClient, record: CreateSessionRecord): Promise<CreateSessionResult> {
    const access = await client.query<SpaceAccess>(`
      SELECT organization_membership.role AS "organizationRole", space_membership.role AS "spaceRole"
      FROM relay_organization_memberships organization_membership
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = organization_membership.organization_id
        AND space_membership.actor_id = organization_membership.actor_id
      WHERE organization_membership.organization_id = $1
        AND space_membership.space_id = $2
        AND organization_membership.actor_id = $3
      FOR UPDATE OF organization_membership, space_membership
    `, [record.organizationId, record.spaceId, record.actorId])
    if (!access.rowCount || !canWriteSpace(access.rows[0])) throw new AuthorizationChangedError()

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
        : {
            session: await this.getSession(
              client,
              record.organizationId,
              record.spaceId,
              existing.rows[0].session_id,
            ),
          }
      return responseToResult(response, true)
    }

    if (record.request.start && record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
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
    const configuration = await this.resolveConfiguration(client, record)
    const session = createSessionDto(record, {
      configuration,
      id: this.createId(),
      timestamp: now.toISOString(),
    })
    const startRecords = createSessionRecords(record, session, { createId: this.createId })
    await client.query(`
      INSERT INTO relay_sessions (
        ${sessionColumns}, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18::jsonb, $19, $20, $21, $22, NULL, $23, $24
      )
    `, [
      session.id, session.organizationId, session.spaceId, session.title, session.summary,
      session.expertId, session.expertName, session.expertVersion ?? null,
      session.expertRevisionId ?? null, session.environmentId ?? null,
      session.environmentRevisionId ?? null, session.repositoryId ?? null,
      session.configurationResolutionVersion, session.repository, session.baseBranch,
      session.visibility, session.status, JSON.stringify(session.attachments), session.source,
      session.createdAt, session.updatedAt, session.lastActivityAt, session.version, record.actorId,
    ])
    if (startRecords.message) {
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
    }
    if (startRecords.message && startRecords.turn && startRecords.command) {
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
          resource_type, resource_id, payload, accepted_at, available_at,
          protocol_version, requested_by, request_id, max_attempts
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10,
          1, $11, $12, $13
        )
      `, [
        startRecords.command.id, session.organizationId, session.spaceId, session.id,
        startRecords.command.type, startRecords.command.status, startRecords.command.resourceType,
        startRecords.command.resourceId, JSON.stringify({
          turnId: startRecords.turn.id,
          configurationResolutionVersion: session.configurationResolutionVersion,
          expertRevisionId: session.expertRevisionId,
          environmentRevisionId: session.environmentRevisionId,
          repositoryId: session.repositoryId,
        }),
        startRecords.command.acceptedAt,
        record.actorId,
        record.requestId,
        this.executionMaxAttempts,
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
          configurationResolutionVersion: session.configurationResolutionVersion,
          expertRevisionId: session.expertRevisionId,
          environmentRevisionId: session.environmentRevisionId,
          repositoryId: session.repositoryId,
        }),
        session.createdAt,
      ])
    }
    await this.appendCreationLedger(client, record, session, startRecords, keyHash)
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

  private async appendCreationLedger(
    client: PoolClient,
    record: CreateSessionRecord,
    session: SessionDto,
    records: Pick<CreateSessionResponse, 'message' | 'turn' | 'command'>,
    idempotencyKeyHash: string,
  ) {
    if (!records.message) throw new Error('A new Session must have an initial Message.')
    const drafts: SessionEventDraft[] = [
      {
        eventType: 'session.created',
        resourceType: 'session',
        resourceId: session.id,
        payload: {
          status: session.status,
          visibility: session.visibility,
          version: session.version,
          configurationResolutionVersion: session.configurationResolutionVersion,
        },
      },
      {
        eventType: 'message.created',
        resourceType: 'message',
        resourceId: records.message.id,
        payload: {
          sequence: records.message.sequence,
          role: records.message.role,
        },
      },
    ]
    if (records.turn) {
      drafts.push({
        eventType: 'turn.queued',
        resourceType: 'turn',
        resourceId: records.turn.id,
        payload: {
          ordinal: records.turn.ordinal,
          status: records.turn.status,
          version: records.turn.version,
          inputMessageId: records.turn.inputMessageId,
        },
      })
    }

    const reservation = await client.query<{ first_sequence: string }>(`
      UPDATE relay_sessions
      SET last_event_sequence = last_event_sequence + $4
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence - $4 + 1 AS first_sequence
    `, [session.organizationId, session.spaceId, session.id, drafts.length])
    if (!reservation.rowCount) throw new Error('The Session event sequence could not be reserved.')
    const firstSequence = Number(reservation.rows[0].first_sequence)

    for (const [index, draft] of drafts.entries()) {
      await client.query(`
        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence,
          event_type, resource_type, resource_id, payload, actor_id,
          actor_kind, message_id, turn_id, command_id, request_id, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
          $12, $13, $14, $15, $16
        )
      `, [
        session.organizationId,
        session.spaceId,
        session.id,
        this.createId(),
        firstSequence + index,
        draft.eventType,
        draft.resourceType,
        draft.resourceId,
        JSON.stringify(draft.payload),
        record.actorId,
        record.actorKind,
        draft.resourceType === 'message' ? draft.resourceId : null,
        draft.resourceType === 'turn' ? draft.resourceId : null,
        records.command?.id ?? null,
        record.requestId,
        session.createdAt,
      ])
    }

    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, action, target_type, target_id, result, request_id,
        idempotency_key_hash, policy_decision, policy_reason, before_state,
        after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'session.create', 'session', $4,
        'success', $7, $8, 'allow', 'organization_and_space_write', NULL,
        $9::jsonb, $10
      )
    `, [
      session.organizationId,
      this.createId(),
      session.spaceId,
      session.id,
      record.actorId,
      record.actorKind,
      record.requestId,
      idempotencyKeyHash,
      JSON.stringify({
        status: session.status,
        visibility: session.visibility,
        version: session.version,
        executionQueued: Boolean(records.command),
      }),
      session.createdAt,
    ])
  }

  private async appendStartLedger(
    client: PoolClient,
    record: StartSessionRecord,
    before: SessionDto,
    session: SessionDto,
    records: Pick<StartSessionResponse, 'turn' | 'command'>,
    idempotencyKeyHash: string,
  ) {
    const drafts: SessionEventDraft[] = [
      {
        eventType: 'session.updated',
        resourceType: 'session',
        resourceId: session.id,
        payload: { status: session.status, version: session.version },
      },
      {
        eventType: 'turn.queued',
        resourceType: 'turn',
        resourceId: records.turn.id,
        payload: {
          ordinal: records.turn.ordinal,
          status: records.turn.status,
          version: records.turn.version,
          inputMessageId: records.turn.inputMessageId,
        },
      },
    ]
    const reservation = await client.query<{ first_sequence: string }>(`
      UPDATE relay_sessions
      SET last_event_sequence = last_event_sequence + $4
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence - $4 + 1 AS first_sequence
    `, [session.organizationId, session.spaceId, session.id, drafts.length])
    if (!reservation.rowCount) throw new Error('The Session event sequence could not be reserved.')
    const firstSequence = Number(reservation.rows[0].first_sequence)

    for (const [index, draft] of drafts.entries()) {
      await client.query(`
        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence,
          event_type, resource_type, resource_id, payload, actor_id,
          actor_kind, message_id, turn_id, command_id, request_id, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
          NULL, $12, $13, $14, $15
        )
      `, [
        session.organizationId,
        session.spaceId,
        session.id,
        this.createId(),
        firstSequence + index,
        draft.eventType,
        draft.resourceType,
        draft.resourceId,
        JSON.stringify(draft.payload),
        record.actorId,
        record.actorKind,
        draft.resourceType === 'turn' ? draft.resourceId : null,
        records.command.id,
        record.requestId,
        session.updatedAt,
      ])
    }

    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, action, target_type, target_id, result, request_id,
        idempotency_key_hash, policy_decision, policy_reason, before_state,
        after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'session.start', 'session', $4,
        'success', $7, $8, 'allow', 'organization_and_space_write',
        $9::jsonb, $10::jsonb, $11
      )
    `, [
      session.organizationId,
      this.createId(),
      session.spaceId,
      session.id,
      record.actorId,
      record.actorKind,
      record.requestId,
      idempotencyKeyHash,
      JSON.stringify({ status: before.status, version: before.version }),
      JSON.stringify({
        status: session.status,
        version: session.version,
        executionQueued: true,
      }),
      session.updatedAt,
    ])
  }

  private async appendSendLedger(
    client: PoolClient,
    record: SendSessionMessageRecord,
    before: SessionDto,
    session: SessionDto,
    records: Pick<SendSessionMessageResponse, 'message' | 'turn' | 'command'>,
    idempotencyKeyHash: string,
  ) {
    const drafts: SessionEventDraft[] = [
      {
        eventType: 'message.created',
        resourceType: 'message',
        resourceId: records.message.id,
        payload: { sequence: records.message.sequence, role: records.message.role },
      },
      {
        eventType: 'turn.queued',
        resourceType: 'turn',
        resourceId: records.turn.id,
        payload: {
          ordinal: records.turn.ordinal,
          status: records.turn.status,
          version: records.turn.version,
          inputMessageId: records.turn.inputMessageId,
        },
      },
      {
        eventType: 'session.updated',
        resourceType: 'session',
        resourceId: session.id,
        payload: { status: session.status, version: session.version },
      },
    ]
    const reservation = await client.query<{ first_sequence: string }>(`
      UPDATE relay_sessions
      SET last_event_sequence = last_event_sequence + $4
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence - $4 + 1 AS first_sequence
    `, [session.organizationId, session.spaceId, session.id, drafts.length])
    if (!reservation.rowCount) throw new Error('The Session event sequence could not be reserved.')
    const firstSequence = Number(reservation.rows[0].first_sequence)

    for (const [index, draft] of drafts.entries()) {
      await client.query(`
        INSERT INTO relay_session_events (
          organization_id, space_id, session_id, event_id, sequence,
          event_type, resource_type, resource_id, payload, actor_id,
          actor_kind, message_id, turn_id, command_id, request_id, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
          $12, $13, $14, $15, $16
        )
      `, [
        session.organizationId,
        session.spaceId,
        session.id,
        this.createId(),
        firstSequence + index,
        draft.eventType,
        draft.resourceType,
        draft.resourceId,
        JSON.stringify(draft.payload),
        record.actorId,
        record.actorKind,
        draft.resourceType === 'message' ? draft.resourceId : null,
        draft.resourceType === 'turn' ? draft.resourceId : null,
        records.command.id,
        record.requestId,
        session.updatedAt,
      ])
    }

    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, action, target_type, target_id, result, request_id,
        idempotency_key_hash, policy_decision, policy_reason, before_state,
        after_state, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'session.send', 'session', $4,
        'success', $7, $8, 'allow', 'organization_and_space_write',
        $9::jsonb, $10::jsonb, $11
      )
    `, [
      session.organizationId,
      this.createId(),
      session.spaceId,
      session.id,
      record.actorId,
      record.actorKind,
      record.requestId,
      idempotencyKeyHash,
      JSON.stringify({ status: before.status, version: before.version }),
      JSON.stringify({
        status: session.status,
        version: session.version,
        messageSequence: records.message.sequence,
        turnOrdinal: records.turn.ordinal,
      }),
      session.updatedAt,
    ])
  }

  private async resolveConfiguration(
    client: PoolClient,
    record: CreateSessionRecord,
  ): Promise<ResolvedSessionConfiguration> {
    const expert = await client.query<{
      name: string
      status: 'draft' | 'published' | 'disabled' | 'archived'
      visibility: 'private' | 'space'
      created_by: string
      published_revision_id: string | null
    }>(`
      SELECT name, status, visibility, created_by, published_revision_id
      FROM relay_experts
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.request.expertId])
    if (!expert.rowCount) throw new SessionConfigurationNotFoundError()
    const expertRow = expert.rows[0]
    if (expertRow.visibility === 'private' && expertRow.created_by !== record.actorId) {
      throw new SessionConfigurationNotFoundError()
    }
    if (expertRow.status !== 'published' || !expertRow.published_revision_id) {
      throw new ExpertNotPublishedError()
    }

    const expertRevision = await client.query<{
      id: string
      revision: number
      status: 'draft' | 'published'
      environment_id: string
      environment_revision_id: string
      allow_repository_override: boolean
      allow_base_branch_override: boolean
    }>(`
      SELECT id, revision, status, environment_id, environment_revision_id,
        allow_repository_override, allow_base_branch_override
      FROM relay_expert_revisions
      WHERE organization_id = $1 AND space_id = $2 AND expert_id = $3 AND id = $4
      FOR UPDATE
    `, [
      record.organizationId,
      record.spaceId,
      record.request.expertId,
      expertRow.published_revision_id,
    ])
    const expertRevisionRow = expertRevision.rows[0]
    if (!expertRevisionRow || expertRevisionRow.status !== 'published') throw new ExpertNotPublishedError()

    const environment = await client.query<{
      status: 'draft' | 'provisioning' | 'ready' | 'updating' | 'failed' | 'disabled'
      active_revision_id: string | null
    }>(`
      SELECT status, active_revision_id
      FROM relay_environments
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, expertRevisionRow.environment_id])
    const environmentRow = environment.rows[0]
    if (
      !environmentRow
      || environmentRow.status !== 'ready'
      || environmentRow.active_revision_id !== expertRevisionRow.environment_revision_id
    ) {
      throw new EnvironmentNotReadyError()
    }

    const environmentRevision = await client.query<{ status: 'draft' | 'ready' }>(`
      SELECT status
      FROM relay_environment_revisions
      WHERE organization_id = $1 AND space_id = $2 AND environment_id = $3 AND id = $4
      FOR UPDATE
    `, [
      record.organizationId,
      record.spaceId,
      expertRevisionRow.environment_id,
      expertRevisionRow.environment_revision_id,
    ])
    if (environmentRevision.rows[0]?.status !== 'ready') throw new EnvironmentNotReadyError()

    const repositoryRows = await client.query<{
      repository_id: string
      repository: string
      base_branch: string
      is_default: boolean
    }>(`
      SELECT repository_id, repository, base_branch, is_default
      FROM relay_environment_revision_repositories
      WHERE organization_id = $1 AND space_id = $2
        AND environment_id = $3 AND environment_revision_id = $4
      FOR UPDATE
    `, [
      record.organizationId,
      record.spaceId,
      expertRevisionRow.environment_id,
      expertRevisionRow.environment_revision_id,
    ])
    const repositories: InMemoryRepositoryBinding[] = repositoryRows.rows.map((repository) => ({
      id: repository.repository_id,
      repository: repository.repository,
      baseBranch: repository.base_branch,
      isDefault: repository.is_default,
    }))
    const selectedRepository = resolveRepositoryBinding(record.request, repositories, {
      allowRepositoryOverride: expertRevisionRow.allow_repository_override,
      allowBaseBranchOverride: expertRevisionRow.allow_base_branch_override,
    })

    return {
      configurationResolutionVersion: 1,
      expertId: record.request.expertId,
      expertName: expertRow.name,
      expertVersion: expertRevisionRow.revision,
      expertRevisionId: expertRevisionRow.id,
      environmentId: expertRevisionRow.environment_id,
      environmentRevisionId: expertRevisionRow.environment_revision_id,
      repositoryId: selectedRepository.id,
      repository: selectedRepository.repository,
      baseBranch: selectedRepository.baseBranch,
    }
  }

  private async getSession(
    client: PoolClient,
    organizationId: string,
    spaceId: string,
    sessionId: string,
  ) {
    const result = await client.query<SessionRow>(`
      SELECT ${sessionColumns}
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [organizationId, spaceId, sessionId])
    if (!result.rowCount) throw new Error('The idempotent Session no longer exists.')
    return mapSession(result.rows[0])
  }
}
