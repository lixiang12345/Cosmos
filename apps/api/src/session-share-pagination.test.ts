import { describe, expect, it } from 'vitest'
import {
  InvalidSessionSharePaginationError,
  encodeSessionShareCursor,
  parseSessionSharePagination,
} from './session-share-pagination.js'

describe('Session ShareGrant pagination', () => {
  it('round-trips a cursor only within its Organization, Space, and Session scope', () => {
    const cursor = encodeSessionShareCursor(
      { createdAt: '2026-07-13T12:00:00.000Z', id: 'grant-2' },
      'cosmos',
      'platform',
      'session-1',
    )
    expect(parseSessionSharePagination(
      { cursor, limit: '10' }, 'cosmos', 'platform', 'session-1',
    )).toEqual({
      limit: 10,
      cursor: { createdAt: '2026-07-13T12:00:00.000Z', id: 'grant-2' },
    })
    expect(() => parseSessionSharePagination(
      { cursor }, 'cosmos', 'platform', 'session-2',
    )).toThrow(InvalidSessionSharePaginationError)
  })

  it('rejects malformed cursors and out-of-range limits', () => {
    expect(() => parseSessionSharePagination(
      { cursor: 'not-json' }, 'cosmos', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
    expect(() => parseSessionSharePagination(
      { limit: '101' }, 'cosmos', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
    expect(() => parseSessionSharePagination(
      { limit: 1 }, 'cosmos', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
  })
})
