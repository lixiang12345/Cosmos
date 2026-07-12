import { createHash, randomUUID } from 'node:crypto'
import {
  SessionDtoSchema,
  type SessionDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  IdempotencyConflictError,
  createSessionDto,
  type CreateSessionRecord,
  type CreateSessionResult,
  type SessionRepository,
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

  async listBySpace(organizationId: string, spaceId: string): Promise<SessionDto[]> {
    const result = await this.pool.query<SessionRow>(`
      SELECT ${sessionColumns}
      FROM relay_sessions
      WHERE organization_id = $1 AND space_id = $2
      ORDER BY last_activity_at DESC, id DESC
    `, [organizationId, spaceId])
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
    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson(record.request))
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([record.organizationId, record.spaceId, keyHash]),
    ])

    const now = this.now()
    const existing = await client.query<{ request_hash: string; session_id: string }>(`
      SELECT request_hash, session_id
      FROM relay_idempotency_records
      WHERE organization_id = $1 AND space_id = $2 AND idempotency_key_hash = $3
        AND expires_at > $4
    `, [record.organizationId, record.spaceId, keyHash, now.toISOString()])

    if (existing.rowCount) {
      if (existing.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError()
      return { session: await this.getSession(client, existing.rows[0].session_id), replayed: true }
    }

    await client.query(`
      DELETE FROM relay_idempotency_records
      WHERE organization_id = $1 AND space_id = $2 AND idempotency_key_hash = $3
        AND expires_at <= $4
    `, [record.organizationId, record.spaceId, keyHash, now.toISOString()])
    const session = createSessionDto(record, { id: this.createId(), timestamp: now.toISOString() })
    await client.query(`
      INSERT INTO relay_sessions (
        ${sessionColumns}
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14::jsonb, $15, $16, $17, $18, $19
      )
    `, [
      session.id, session.organizationId, session.spaceId, session.title, session.summary,
      session.expertId, session.expertName, session.expertVersion ?? null,
      session.environmentId ?? null, session.repository, session.baseBranch, session.visibility,
      session.status, JSON.stringify(session.attachments), session.source, session.createdAt,
      session.updatedAt, session.lastActivityAt, session.version,
    ])
    await client.query(`
      INSERT INTO relay_idempotency_records (
        organization_id, space_id, idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      record.organizationId, record.spaceId, keyHash, requestHash, session.id,
      new Date(now.getTime() + this.idempotencyTtlMs).toISOString(),
    ])
    return { session, replayed: false }
  }

  private async getSession(client: PoolClient, sessionId: string) {
    const result = await client.query<SessionRow>(`
      SELECT ${sessionColumns} FROM relay_sessions WHERE id = $1
    `, [sessionId])
    if (!result.rowCount) throw new Error('The idempotent Session no longer exists.')
    return mapSession(result.rows[0])
  }
}
