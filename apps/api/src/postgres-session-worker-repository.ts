import { randomUUID } from 'node:crypto'
import {
  SessionWorkerDtoSchema,
  type SessionWorkerDto,
  type SessionWorkerStatus,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import { setLocalApiDatabaseContext } from './postgres-runtime-database.js'
import {
  SessionWorkerConflictError,
  SessionWorkerVersionConflictError,
  type CreateSessionWorkerRecord,
  type SessionWorkerListOptions,
  type SessionWorkerListPage,
  type SessionWorkerRepository,
  type SessionWorkerWriterRepository,
  type TransitionSessionWorkerRecord,
} from './session-worker-repository.js'

type TimestampValue = Date | string
type SessionWorkerRow = {
  organization_id: string
  space_id: string
  session_id: string
  id: string
  parent_turn_id: string
  parent_worker_id: string | null
  expert_revision_id: string | null
  name: string
  instructions: string
  status: SessionWorkerStatus
  depth: number
  ordinal: number
  result_summary: string | null
  created_at: TimestampValue
  updated_at: TimestampValue
  completed_at: TimestampValue | null
  version: number
}

const sessionWorkerColumns = `
  organization_id, space_id, session_id, id, parent_turn_id, parent_worker_id,
  expert_revision_id, name, instructions, status, depth, ordinal, result_summary,
  created_at, updated_at, completed_at, version
`

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapSessionWorker(row: SessionWorkerRow): SessionWorkerDto {
  return SessionWorkerDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    id: row.id,
    parentTurnId: row.parent_turn_id,
    parentWorkerId: row.parent_worker_id,
    expertRevisionId: row.expert_revision_id,
    name: row.name,
    instructions: row.instructions,
    status: row.status,
    depth: row.depth,
    ordinal: row.ordinal,
    resultSummary: row.result_summary,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    completedAt: row.completed_at === null ? null : timestamp(row.completed_at),
    version: row.version,
  })
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
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

function required(value: string, field: string, maximum: number) {
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) {
    throw new RangeError(`${field} must contain between 1 and ${maximum} characters.`)
  }
  return normalized
}

function databaseCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

export class PostgresSessionWorkerRepository implements SessionWorkerRepository {
  constructor(private readonly pool: Pool) {}

  async list(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: SessionWorkerListOptions,
  ): Promise<SessionWorkerListPage | null> {
    return transaction(this.pool, async (client) => {
      await setLocalApiDatabaseContext(client, { organizationId, spaceId, actorId })
      const session = await client.query(`
        SELECT 1
        FROM relay_sessions session
        WHERE session.organization_id = $1
          AND session.space_id = $2
          AND session.id = $3
          AND (
            session.visibility = 'space'
            OR session.created_by = $4
            OR EXISTS (
              SELECT 1 FROM relay_session_share_grants share_grant
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
                      SELECT 1 FROM relay_group_memberships group_membership
                      WHERE group_membership.organization_id = share_grant.organization_id
                        AND group_membership.group_id = share_grant.principal_id
                        AND group_membership.actor_id = $4
                    )
                  )
                )
            )
          )
      `, [organizationId, spaceId, sessionId, actorId])
      if (!session.rowCount) return null
      const rows = await client.query<SessionWorkerRow>(`
        SELECT ${sessionWorkerColumns}
        FROM relay_session_workers
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND ($4::timestamptz IS NULL OR (created_at, id) > ($4, $5))
        ORDER BY created_at, id
        LIMIT $6
      `, [
        organizationId,
        spaceId,
        sessionId,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        options.limit + 1,
      ])
      const hasMore = rows.rows.length > options.limit
      const items = rows.rows.slice(0, options.limit).map(mapSessionWorker)
      const last = hasMore ? items.at(-1) : undefined
      return {
        items,
        hasMore,
        nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    })
  }
}

export type PostgresSessionWorkerWriterRepositoryOptions = {
  createId?: () => string
  now?: () => Date
}

export class PostgresSessionWorkerWriterRepository implements SessionWorkerWriterRepository {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly pool: Pool, options: PostgresSessionWorkerWriterRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  async create(record: CreateSessionWorkerRecord): Promise<SessionWorkerDto> {
    const id = required(this.createId(), 'Session Worker id', 128)
    const name = required(record.name, 'Session Worker name', 240)
    const instructions = required(record.instructions, 'Session Worker instructions', 20_000)
    const runtimeWorkerId = required(record.runtimeWorkerId, 'Runtime Worker id', 128)
    const occurredAt = this.now().toISOString()
    try {
      return await transaction(this.pool, async (client) => {
        const lockKey = JSON.stringify([
          record.organizationId,
          record.spaceId,
          record.sessionId,
          record.parentWorkerId ?? null,
        ])
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey])
        const parent = record.parentWorkerId
          ? await client.query<{ depth: number }>(`
              SELECT depth FROM relay_session_workers
              WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
            `, [record.organizationId, record.spaceId, record.sessionId, record.parentWorkerId])
          : null
        if (record.parentWorkerId && !parent?.rowCount) {
          throw new SessionWorkerConflictError('The parent Session Worker does not exist in this Session.')
        }
        const depth = (parent?.rows[0]?.depth ?? 0) + 1
        if (depth > 16) throw new SessionWorkerConflictError('The Session Worker tree cannot exceed depth 16.')
        const ordinal = await client.query<{ ordinal: number }>(`
          SELECT COALESCE(max(ordinal), 0)::integer + 1 AS ordinal
          FROM relay_session_workers
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            AND parent_worker_id IS NOT DISTINCT FROM $4::text
        `, [record.organizationId, record.spaceId, record.sessionId, record.parentWorkerId ?? null])
        const result = await client.query<SessionWorkerRow>(`
          INSERT INTO relay_session_workers (
            organization_id, space_id, session_id, id, parent_turn_id,
            parent_worker_id, expert_revision_id, name, instructions, status,
            depth, ordinal, result_summary, created_by_worker_id,
            updated_by_worker_id, created_at, updated_at, completed_at, version
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued',
            $10, $11, NULL, $12, $12, $13, $13, NULL, 1
          )
          RETURNING ${sessionWorkerColumns}
        `, [
          record.organizationId,
          record.spaceId,
          record.sessionId,
          id,
          record.parentTurnId,
          record.parentWorkerId ?? null,
          record.expertRevisionId ?? null,
          name,
          instructions,
          depth,
          ordinal.rows[0]?.ordinal,
          runtimeWorkerId,
          occurredAt,
        ])
        return mapSessionWorker(result.rows[0]!)
      })
    } catch (error) {
      if (error instanceof SessionWorkerConflictError) throw error
      if (['23503', '23505', '23514'].includes(databaseCode(error) ?? '')) {
        throw new SessionWorkerConflictError('The Session Worker hierarchy or configuration is invalid.')
      }
      throw error
    }
  }

  async transition(record: TransitionSessionWorkerRecord): Promise<SessionWorkerDto | null> {
    const runtimeWorkerId = required(record.runtimeWorkerId, 'Runtime Worker id', 128)
    const resultSummary = record.resultSummary === undefined
      ? null
      : required(record.resultSummary, 'Session Worker result summary', 10_000)
    if (!Number.isInteger(record.expectedVersion) || record.expectedVersion < 1) {
      throw new RangeError('Session Worker expectedVersion must be a positive integer.')
    }
    const terminal = ['completed', 'failed', 'canceled'].includes(record.status)
    if (!terminal && record.resultSummary !== undefined) {
      throw new RangeError('Session Worker result summaries are only accepted for terminal states.')
    }
    const occurredAt = this.now().toISOString()
    try {
      return await transaction(this.pool, async (client) => {
        const current = await client.query<SessionWorkerRow>(`
          SELECT ${sessionWorkerColumns}
          FROM relay_session_workers
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          FOR UPDATE
        `, [record.organizationId, record.spaceId, record.sessionId, record.workerId])
        if (!current.rowCount) return null
        const existing = current.rows[0]!
        if (existing.version !== record.expectedVersion) {
          throw new SessionWorkerVersionConflictError(record.expectedVersion, existing.version)
        }
        const updated = await client.query<SessionWorkerRow>(`
          UPDATE relay_session_workers
          SET status = $5,
            result_summary = $6,
            updated_by_worker_id = $7,
            updated_at = $8,
            completed_at = CASE WHEN $9 THEN $8::timestamptz ELSE NULL END,
            version = version + 1
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          RETURNING ${sessionWorkerColumns}
        `, [
          record.organizationId,
          record.spaceId,
          record.sessionId,
          record.workerId,
          record.status,
          terminal ? resultSummary : null,
          runtimeWorkerId,
          occurredAt,
          terminal,
        ])
        return mapSessionWorker(updated.rows[0]!)
      })
    } catch (error) {
      if (error instanceof SessionWorkerVersionConflictError) throw error
      if (['23514', '55000'].includes(databaseCode(error) ?? '')) {
        throw new SessionWorkerConflictError('The Session Worker status transition is invalid.')
      }
      throw error
    }
  }
}
