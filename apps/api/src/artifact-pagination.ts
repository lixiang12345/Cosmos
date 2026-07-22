import { ArtifactTypeSchema, type ArtifactType } from '@cosmos/contracts'
import type { ArtifactListCursor, ArtifactListOptions } from './artifact-repository.js'

export type ArtifactListQuery = {
  cursor?: unknown
  limit?: unknown
  type?: unknown
}

type EncodedArtifactCursor = {
  version: 1
  organizationId: string
  spaceId: string
  sessionId: string
  type: ArtifactType | null
  createdAt: string
  id: string
}

export class InvalidArtifactPaginationError extends Error {
  constructor(readonly field: 'cursor' | 'limit' | 'type') {
    super(`The Artifact list ${field} is invalid.`)
    this.name = 'InvalidArtifactPaginationError'
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
  type: ArtifactType | undefined,
): ArtifactListCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) throw new InvalidArtifactPaginationError('cursor')
  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidArtifactPaginationError('cursor')
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidArtifactPaginationError('cursor')
  }
  const candidate = decoded as Partial<EncodedArtifactCursor>
  const cursorType = candidate.type === null
    ? null
    : ArtifactTypeSchema.safeParse(candidate.type)
  if (
    Object.keys(candidate).sort().join(',')
      !== 'createdAt,id,organizationId,sessionId,spaceId,type,version'
    || candidate.version !== 1
    || candidate.organizationId !== organizationId
    || candidate.spaceId !== spaceId
    || candidate.sessionId !== sessionId
    || cursorType === undefined
    || (cursorType !== null && !cursorType.success)
    || (cursorType === null ? null : cursorType.data) !== (type ?? null)
    || !canonicalTimestamp(candidate.createdAt)
    || typeof candidate.id !== 'string'
    || candidate.id.length < 1
    || candidate.id.length > 128
    || candidate.id.trim() !== candidate.id
  ) {
    throw new InvalidArtifactPaginationError('cursor')
  }
  return { createdAt: candidate.createdAt, id: candidate.id }
}

export function parseArtifactPagination(
  query: ArtifactListQuery,
  organizationId: string,
  spaceId: string,
  sessionId: string,
): ArtifactListOptions {
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit)) {
      throw new InvalidArtifactPaginationError('limit')
    }
    limit = Number(query.limit)
    if (limit > 100) throw new InvalidArtifactPaginationError('limit')
  }
  const parsedType = query.type === undefined ? undefined : ArtifactTypeSchema.safeParse(query.type)
  if (parsedType !== undefined && !parsedType.success) {
    throw new InvalidArtifactPaginationError('type')
  }
  const type = parsedType?.data
  if (query.cursor === undefined) return { limit, type }
  if (typeof query.cursor !== 'string') throw new InvalidArtifactPaginationError('cursor')
  return {
    limit,
    type,
    cursor: readCursor(query.cursor, organizationId, spaceId, sessionId, type),
  }
}

export function encodeArtifactCursor(
  cursor: ArtifactListCursor,
  organizationId: string,
  spaceId: string,
  sessionId: string,
  type: ArtifactType | undefined,
) {
  const payload: EncodedArtifactCursor = {
    version: 1,
    organizationId,
    spaceId,
    sessionId,
    type: type ?? null,
    createdAt: new Date(cursor.createdAt).toISOString(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
