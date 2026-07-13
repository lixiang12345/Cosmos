import { describe, expect, it } from 'vitest'
import {
  InvalidSessionListPaginationError,
  encodeSessionListCursor,
  parseSessionListPagination,
} from './session-list-pagination.js'

const scope = ['organization-a', 'space-a'] as const
const cursor = { lastActivityAt: '2026-07-13T08:00:00.123456Z', id: 'session-a' }

describe('Session list pagination', () => {
  it('normalizes bounded pagination and filters', () => {
    expect(parseSessionListPagination({}, ...scope)).toEqual({ limit: 25, archived: false })
    expect(parseSessionListPagination({
      limit: '100', status: 'active', archived: 'all', search: '  checkout race  ',
    }, ...scope)).toEqual({
      limit: 100, status: 'active', archived: 'all', search: 'checkout race',
    })
  })

  it.each([
    ['limit', { limit: '0' }],
    ['limit', { limit: '101' }],
    ['status', { status: 'running' }],
    ['archived', { archived: 'yes' }],
    ['search', { search: '   ' }],
  ] as const)('rejects an invalid %s', (_field, query) => {
    expect(() => parseSessionListPagination(query, ...scope))
      .toThrow(InvalidSessionListPaginationError)
  })

  it('round-trips a tenant- and filter-scoped cursor', () => {
    const options = { limit: 10, status: 'queued' as const, archived: false, search: 'checkout' }
    const encoded = encodeSessionListCursor(cursor, ...scope, options)
    expect(parseSessionListPagination({
      cursor: encoded, limit: '10', status: 'queued', archived: 'false', search: 'checkout',
    }, ...scope)).toEqual({ ...options, cursor })
  })

  it('rejects malformed, cross-tenant, and cross-filter cursors', () => {
    const options = { limit: 25, archived: false as const }
    const encoded = encodeSessionListCursor(cursor, ...scope, options)
    expect(() => parseSessionListPagination({ cursor: 'invalid!' }, ...scope)).toThrow()
    expect(() => parseSessionListPagination({ cursor: encoded }, 'organization-b', 'space-a')).toThrow()
    expect(() => parseSessionListPagination({ cursor: encoded, status: 'queued' }, ...scope)).toThrow()
    expect(() => parseSessionListPagination({ cursor: encoded, archived: 'true' }, ...scope)).toThrow()
  })
})
