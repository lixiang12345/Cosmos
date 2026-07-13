import {
  FilePathSchema,
  FilePrefixSchema,
  FileScopeSchema,
  type FileScope,
} from '@relay/contracts'
import type {
  FileListCursor,
  FileListOptions,
  FileVersionListCursor,
  FileVersionListOptions,
} from './file-repository.js'

export type FileListQuery = {
  scope?: unknown
  ownerUserId?: unknown
  sessionId?: unknown
  prefix?: unknown
  search?: unknown
  cursor?: unknown
  limit?: unknown
}

export type FileVersionListQuery = { cursor?: unknown; limit?: unknown }
export type FileContentQuery = { version?: unknown; disposition?: unknown }

type FileFilterScope = {
  organizationId: string
  requestedSpaceId: string
  scope: FileScope
  ownerUserId: string | null
  sessionId: string | null
  prefix: string | null
  search: string | null
}

type EncodedFileCursor = FileFilterScope & {
  version: 1
  path: string
  id: string
}

type EncodedVersionCursor = {
  version: 1
  organizationId: string
  requestedSpaceId: string
  fileId: string
  fileVersion: number
  id: string
}

export class InvalidFilePaginationError extends Error {
  constructor(readonly field: keyof FileListQuery | keyof FileContentQuery) {
    super(`The File request ${field} is invalid.`)
    this.name = 'InvalidFilePaginationError'
  }
}

function decode(value: unknown, field: 'cursor') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidFilePaginationError(field)
  }
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Object required')
    return parsed as Record<string, unknown>
  } catch {
    throw new InvalidFilePaginationError(field)
  }
}

function limit(value: unknown) {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value) || Number(value) > 100) {
    throw new InvalidFilePaginationError('limit')
  }
  return Number(value)
}

function optionalIdentifier(value: unknown, field: 'ownerUserId' | 'sessionId') {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 256) {
    throw new InvalidFilePaginationError(field)
  }
  return value
}

function filterScope(
  organizationId: string,
  requestedSpaceId: string,
  actorId: string,
  query: FileListQuery,
): FileFilterScope {
  const parsedScope = FileScopeSchema.safeParse(query.scope)
  if (!parsedScope.success) throw new InvalidFilePaginationError('scope')
  const ownerUserId = optionalIdentifier(query.ownerUserId, 'ownerUserId')
  const sessionId = optionalIdentifier(query.sessionId, 'sessionId')
  if (parsedScope.data === 'workspace' && !sessionId) throw new InvalidFilePaginationError('sessionId')
  if (parsedScope.data !== 'workspace' && sessionId) throw new InvalidFilePaginationError('sessionId')
  if (parsedScope.data !== 'user' && ownerUserId) throw new InvalidFilePaginationError('ownerUserId')

  let prefix: string | undefined
  if (query.prefix !== undefined) {
    const parsed = FilePrefixSchema.safeParse(query.prefix)
    if (!parsed.success) throw new InvalidFilePaginationError('prefix')
    prefix = parsed.data.endsWith('/') ? parsed.data : `${parsed.data}/`
  }
  let search: string | undefined
  if (query.search !== undefined) {
    if (typeof query.search !== 'string') throw new InvalidFilePaginationError('search')
    search = query.search.trim()
    if (search.length < 1 || search.length > 240) throw new InvalidFilePaginationError('search')
  }
  return {
    organizationId,
    requestedSpaceId,
    scope: parsedScope.data,
    ownerUserId: parsedScope.data === 'user' ? ownerUserId ?? actorId : null,
    sessionId: sessionId ?? null,
    prefix: prefix ?? null,
    search: search ?? null,
  }
}

export function parseFilePagination(
  query: FileListQuery,
  organizationId: string,
  requestedSpaceId: string,
  actorId: string,
): FileListOptions {
  const filters = filterScope(organizationId, requestedSpaceId, actorId, query)
  let cursor: FileListCursor | undefined
  if (query.cursor !== undefined) {
    const candidate = decode(query.cursor, 'cursor')
    const expectedKeys = [
      'id', 'organizationId', 'ownerUserId', 'path', 'prefix', 'requestedSpaceId',
      'scope', 'search', 'sessionId', 'version',
    ].sort().join(',')
    const parsedPath = FilePathSchema.safeParse(candidate.path)
    if (
      Object.keys(candidate).sort().join(',') !== expectedKeys
      || candidate.version !== 1
      || Object.entries(filters).some(([key, value]) => candidate[key] !== value)
      || !parsedPath.success
      || typeof candidate.id !== 'string'
      || candidate.id.trim() !== candidate.id
      || candidate.id.length < 1
      || candidate.id.length > 128
    ) throw new InvalidFilePaginationError('cursor')
    cursor = { path: parsedPath.data, id: candidate.id }
  }
  return {
    scope: filters.scope,
    ownerUserId: filters.ownerUserId ?? undefined,
    sessionId: filters.sessionId ?? undefined,
    prefix: filters.prefix ?? undefined,
    search: filters.search ?? undefined,
    limit: limit(query.limit),
    cursor,
  }
}

export function encodeFileCursor(
  cursor: FileListCursor,
  organizationId: string,
  requestedSpaceId: string,
  options: FileListOptions,
) {
  const payload: EncodedFileCursor = {
    version: 1,
    organizationId,
    requestedSpaceId,
    scope: options.scope,
    ownerUserId: options.ownerUserId ?? null,
    sessionId: options.sessionId ?? null,
    prefix: options.prefix ?? null,
    search: options.search ?? null,
    path: cursor.path,
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function parseFileVersionPagination(
  query: FileVersionListQuery,
  organizationId: string,
  requestedSpaceId: string,
  fileId: string,
): FileVersionListOptions {
  let cursor: FileVersionListCursor | undefined
  if (query.cursor !== undefined) {
    const candidate = decode(query.cursor, 'cursor')
    if (
      Object.keys(candidate).sort().join(',')
        !== 'fileId,fileVersion,id,organizationId,requestedSpaceId,version'
      || candidate.version !== 1
      || candidate.organizationId !== organizationId
      || candidate.requestedSpaceId !== requestedSpaceId
      || candidate.fileId !== fileId
      || typeof candidate.fileVersion !== 'number'
      || !Number.isSafeInteger(candidate.fileVersion)
      || candidate.fileVersion < 1
      || typeof candidate.id !== 'string'
      || candidate.id.trim() !== candidate.id
      || candidate.id.length < 1
      || candidate.id.length > 128
    ) throw new InvalidFilePaginationError('cursor')
    cursor = { version: candidate.fileVersion, id: candidate.id }
  }
  return { limit: limit(query.limit), cursor }
}

export function encodeFileVersionCursor(
  cursor: FileVersionListCursor,
  organizationId: string,
  requestedSpaceId: string,
  fileId: string,
) {
  const payload: EncodedVersionCursor = {
    version: 1,
    organizationId,
    requestedSpaceId,
    fileId,
    fileVersion: cursor.version,
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function parseFileContentVersion(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new InvalidFilePaginationError('version')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new InvalidFilePaginationError('version')
  return parsed
}

export function parseFileContentDisposition(value: unknown): 'inline' | 'attachment' {
  if (value === undefined) return 'inline'
  if (value !== 'inline' && value !== 'attachment') {
    throw new InvalidFilePaginationError('disposition')
  }
  return value
}
