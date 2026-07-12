import { describe, expect, it } from 'vitest'
import {
  InvalidCatalogPaginationError,
  encodeCatalogCursor,
  parseCatalogPagination,
} from './catalog-pagination.js'

const scope = ['experts', 'organization-a', 'space-a'] as const
const cursor = { updatedAt: '2026-07-13T08:00:00.123456Z', id: 'expert-a' }

describe('catalog pagination', () => {
  it('uses a bounded default and accepts limits through 100', () => {
    expect(parseCatalogPagination({}, ...scope)).toEqual({ limit: 25 })
    expect(parseCatalogPagination({ limit: '100' }, ...scope)).toEqual({ limit: 100 })
  })

  it.each(['0', '01', '101', '-1', '1.5', 'value'])('rejects invalid limit %s', (limit) => {
    expect(() => parseCatalogPagination({ limit }, ...scope)).toThrow(InvalidCatalogPaginationError)
  })

  it('round-trips a canonical tenant-scoped cursor', () => {
    const encoded = encodeCatalogCursor(cursor, ...scope)
    expect(parseCatalogPagination({ cursor: encoded, limit: '10' }, ...scope)).toEqual({
      limit: 10,
      cursor,
    })
  })

  it('rejects malformed, cross-resource, and cross-Workspace cursors', () => {
    const encoded = encodeCatalogCursor(cursor, ...scope)
    expect(() => parseCatalogPagination({ cursor: 'not-valid!' }, ...scope)).toThrow(InvalidCatalogPaginationError)
    expect(() => parseCatalogPagination({ cursor: encoded }, 'environments', 'organization-a', 'space-a'))
      .toThrow(InvalidCatalogPaginationError)
    expect(() => parseCatalogPagination({ cursor: encoded }, 'experts', 'organization-b', 'space-a'))
      .toThrow(InvalidCatalogPaginationError)
    expect(() => parseCatalogPagination({ cursor: encoded }, 'experts', 'organization-a', 'space-b'))
      .toThrow(InvalidCatalogPaginationError)
  })

  it('rejects a cursor with unknown fields or a non-canonical timestamp', () => {
    const extraField = Buffer.from(JSON.stringify({
      version: 1,
      resource: 'experts',
      organizationId: 'organization-a',
      spaceId: 'space-a',
      updatedAt: cursor.updatedAt,
      id: cursor.id,
      extra: true,
    })).toString('base64url')
    const nonCanonicalTime = Buffer.from(JSON.stringify({
      version: 1,
      resource: 'experts',
      organizationId: 'organization-a',
      spaceId: 'space-a',
      updatedAt: '2026-07-13T16:00:00+08:00',
      id: cursor.id,
    })).toString('base64url')

    expect(() => parseCatalogPagination({ cursor: extraField }, ...scope)).toThrow(InvalidCatalogPaginationError)
    expect(() => parseCatalogPagination({ cursor: nonCanonicalTime }, ...scope)).toThrow(InvalidCatalogPaginationError)
  })
})
