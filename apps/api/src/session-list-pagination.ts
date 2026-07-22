import { createHash } from 'node:crypto'
import type { SessionStatus } from '@cosmos/contracts'
import type { SessionListCursor, SessionListOptions } from './session-repository.js'

export type SessionListQuery = {
  cursor?: unknown
  limit?: unknown
  status?: unknown
  archived?: unknown
  search?: unknown
}

type EncodedSessionListCursor = {
  version: 1
  organizationId: string
  spaceId: string
  filters: string
  lastActivityAt: string
  id: string
}

const sessionStatuses = new Set<SessionStatus>([
  'draft', 'queued', 'active', 'waiting', 'paused', 'completed', 'failed', 'canceled',
])

export class InvalidSessionListPaginationError extends Error {
  constructor(readonly field: 'cursor' | 'limit' | 'status' | 'archived' | 'search') {
    super(`The Session list ${field} is invalid.`)
    this.name = 'InvalidSessionListPaginationError'
  }
}

function canonicalTimestamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
    const millisecondValue = `${value.slice(0, 23)}Z`
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString() === millisecondValue) return value
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new InvalidSessionListPaginationError('cursor')
  return parsed.toISOString().replace(/Z$/, '000Z')
}

function filterFingerprint(options: SessionListOptions) {
  return createHash('sha256').update(JSON.stringify({
    status: options.status ?? null,
    archived: options.archived ?? false,
    search: options.search ?? null,
  })).digest('base64url')
}

function readCursor(
  value: string,
  organizationId: string,
  spaceId: string,
  options: SessionListOptions,
): SessionListCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidSessionListPaginationError('cursor')
  }

  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidSessionListPaginationError('cursor')
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidSessionListPaginationError('cursor')
  }
  const candidate = decoded as Partial<EncodedSessionListCursor>
  if (
    Object.keys(candidate).sort().join(',') !== 'filters,id,lastActivityAt,organizationId,spaceId,version'
    || candidate.version !== 1
    || candidate.organizationId !== organizationId
    || candidate.spaceId !== spaceId
    || candidate.filters !== filterFingerprint(options)
    || typeof candidate.lastActivityAt !== 'string'
    || canonicalTimestamp(candidate.lastActivityAt) !== candidate.lastActivityAt
    || typeof candidate.id !== 'string'
    || candidate.id.length < 1
    || candidate.id.length > 128
    || candidate.id.trim() !== candidate.id
  ) {
    throw new InvalidSessionListPaginationError('cursor')
  }
  return { lastActivityAt: candidate.lastActivityAt, id: candidate.id }
}

export function parseSessionListPagination(
  query: SessionListQuery,
  organizationId: string,
  spaceId: string,
): SessionListOptions {
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit)) {
      throw new InvalidSessionListPaginationError('limit')
    }
    limit = Number(query.limit)
    if (limit > 100) throw new InvalidSessionListPaginationError('limit')
  }

  let status: SessionStatus | undefined
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !sessionStatuses.has(query.status as SessionStatus)) {
      throw new InvalidSessionListPaginationError('status')
    }
    status = query.status as SessionStatus
  }

  let archived: boolean | 'all' = false
  if (query.archived !== undefined) {
    if (query.archived === 'true') archived = true
    else if (query.archived === 'false') archived = false
    else if (query.archived === 'all') archived = 'all'
    else throw new InvalidSessionListPaginationError('archived')
  }

  let search: string | undefined
  if (query.search !== undefined) {
    if (typeof query.search !== 'string') throw new InvalidSessionListPaginationError('search')
    search = query.search.trim()
    if (search.length < 1 || search.length > 200) throw new InvalidSessionListPaginationError('search')
  }

  const options: SessionListOptions = { limit, archived }
  if (status) options.status = status
  if (search) options.search = search
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string') throw new InvalidSessionListPaginationError('cursor')
    options.cursor = readCursor(query.cursor, organizationId, spaceId, options)
  }
  return options
}

export function encodeSessionListCursor(
  cursor: SessionListCursor,
  organizationId: string,
  spaceId: string,
  options: SessionListOptions,
) {
  const payload: EncodedSessionListCursor = {
    version: 1,
    organizationId,
    spaceId,
    filters: filterFingerprint(options),
    lastActivityAt: canonicalTimestamp(cursor.lastActivityAt),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
