import type { SessionWorkerListCursor, SessionWorkerListOptions } from './session-worker-repository.js'

export type SessionWorkerListQuery = {
  cursor?: unknown
  limit?: unknown
}

type EncodedSessionWorkerCursor = {
  version: 1
  organizationId: string
  spaceId: string
  sessionId: string
  createdAt: string
  id: string
}

export class InvalidSessionWorkerPaginationError extends Error {
  constructor(readonly field: 'cursor' | 'limit') {
    super(`The Session Worker list ${field} is invalid.`)
    this.name = 'InvalidSessionWorkerPaginationError'
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
): SessionWorkerListCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidSessionWorkerPaginationError('cursor')
  }
  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidSessionWorkerPaginationError('cursor')
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidSessionWorkerPaginationError('cursor')
  }
  const candidate = decoded as Partial<EncodedSessionWorkerCursor>
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
    throw new InvalidSessionWorkerPaginationError('cursor')
  }
  return { createdAt: candidate.createdAt, id: candidate.id }
}

export function parseSessionWorkerPagination(
  query: SessionWorkerListQuery,
  organizationId: string,
  spaceId: string,
  sessionId: string,
): SessionWorkerListOptions {
  let limit = 50
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit)) {
      throw new InvalidSessionWorkerPaginationError('limit')
    }
    limit = Number(query.limit)
    if (limit > 100) throw new InvalidSessionWorkerPaginationError('limit')
  }
  if (query.cursor === undefined) return { limit }
  if (typeof query.cursor !== 'string') throw new InvalidSessionWorkerPaginationError('cursor')
  return { limit, cursor: readCursor(query.cursor, organizationId, spaceId, sessionId) }
}

export function encodeSessionWorkerCursor(
  cursor: SessionWorkerListCursor,
  organizationId: string,
  spaceId: string,
  sessionId: string,
) {
  const payload: EncodedSessionWorkerCursor = {
    version: 1,
    organizationId,
    spaceId,
    sessionId,
    createdAt: new Date(cursor.createdAt).toISOString(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
