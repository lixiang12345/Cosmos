import type {
  ConfigurationCatalogCursor,
  ConfigurationCatalogListOptions,
} from './configuration-catalog-repository.js'

export type CatalogResource = 'experts' | 'environments'

type EncodedCatalogCursor = {
  version: 1
  resource: CatalogResource
  organizationId: string
  spaceId: string
  updatedAt: string
  id: string
}

export class InvalidCatalogPaginationError extends Error {
  constructor(readonly field: 'cursor' | 'limit') {
    super(`The catalog ${field} is invalid.`)
    this.name = 'InvalidCatalogPaginationError'
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  ) return false
  const millisecondValue = `${value.slice(0, 23)}Z`
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === millisecondValue
}

function readCursor(
  value: string,
  resource: CatalogResource,
  organizationId: string,
  spaceId: string,
): ConfigurationCatalogCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidCatalogPaginationError('cursor')
  }

  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidCatalogPaginationError('cursor')
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidCatalogPaginationError('cursor')
  }
  const candidate = decoded as Partial<EncodedCatalogCursor>
  if (
    Object.keys(candidate).sort().join(',') !== 'id,organizationId,resource,spaceId,updatedAt,version'
    || candidate.version !== 1
    || candidate.resource !== resource
    || candidate.organizationId !== organizationId
    || candidate.spaceId !== spaceId
    || !isCanonicalTimestamp(candidate.updatedAt)
    || typeof candidate.id !== 'string'
    || candidate.id.length < 1
    || candidate.id.length > 128
    || candidate.id.trim() !== candidate.id
  ) {
    throw new InvalidCatalogPaginationError('cursor')
  }

  return { updatedAt: candidate.updatedAt, id: candidate.id }
}

export function parseCatalogPagination(
  query: { cursor?: unknown; limit?: unknown },
  resource: CatalogResource,
  organizationId: string,
  spaceId: string,
): ConfigurationCatalogListOptions {
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit)) {
      throw new InvalidCatalogPaginationError('limit')
    }
    limit = Number(query.limit)
    if (limit > 100) throw new InvalidCatalogPaginationError('limit')
  }

  if (query.cursor === undefined) return { limit }
  if (typeof query.cursor !== 'string') throw new InvalidCatalogPaginationError('cursor')
  return {
    limit,
    cursor: readCursor(query.cursor, resource, organizationId, spaceId),
  }
}

export function encodeCatalogCursor(
  cursor: ConfigurationCatalogCursor,
  resource: CatalogResource,
  organizationId: string,
  spaceId: string,
): string {
  const payload: EncodedCatalogCursor = {
    version: 1,
    resource,
    organizationId,
    spaceId,
    updatedAt: cursor.updatedAt,
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
