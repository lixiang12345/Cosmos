import type { ShareGrantListCursor, ShareGrantListOptions } from './session-repository.js'

export type SessionShareListQuery = {
  cursor?: unknown
  limit?: unknown
}

type EncodedShareGrantCursor = {
  version: 1
  organizationId: string
  spaceId: string
  sessionId: string
  createdAt: string
  id: string
}

export class InvalidSessionSharePaginationError extends Error {
  constructor(readonly field: 'cursor' | 'limit') {
    super(`The Session ShareGrant list ${field} is invalid.`)
    this.name = 'InvalidSessionSharePaginationError'
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function readCursor(
  value: string,
  organizationId: string,
  spaceId: string,
  sessionId: string,
): ShareGrantListCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidSessionSharePaginationError('cursor')
  }
  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidSessionSharePaginationError('cursor')
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidSessionSharePaginationError('cursor')
  }
  const candidate = decoded as Partial<EncodedShareGrantCursor>
  if (
    Object.keys(candidate).sort().join(',') !== 'createdAt,id,organizationId,sessionId,spaceId,version'
    || candidate.version !== 1
    || candidate.organizationId !== organizationId
    || candidate.spaceId !== spaceId
    || candidate.sessionId !== sessionId
    || !canonicalTimestamp(candidate.createdAt)
    || typeof candidate.id !== 'string'
    || candidate.id.length < 1
    || candidate.id.length > 128
    || candidate.id.trim() !== candidate.id
  ) {
    throw new InvalidSessionSharePaginationError('cursor')
  }
  return { createdAt: candidate.createdAt, id: candidate.id }
}

export function parseSessionSharePagination(
  query: SessionShareListQuery,
  organizationId: string,
  spaceId: string,
  sessionId: string,
): ShareGrantListOptions {
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit)) {
      throw new InvalidSessionSharePaginationError('limit')
    }
    limit = Number(query.limit)
    if (limit > 100) throw new InvalidSessionSharePaginationError('limit')
  }
  if (query.cursor === undefined) return { limit }
  if (typeof query.cursor !== 'string') throw new InvalidSessionSharePaginationError('cursor')
  return { limit, cursor: readCursor(query.cursor, organizationId, spaceId, sessionId) }
}

export function encodeSessionShareCursor(
  cursor: ShareGrantListCursor,
  organizationId: string,
  spaceId: string,
  sessionId: string,
) {
  const payload: EncodedShareGrantCursor = {
    version: 1,
    organizationId,
    spaceId,
    sessionId,
    createdAt: new Date(cursor.createdAt).toISOString(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
