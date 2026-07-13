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
      'relay',
      'platform',
      'session-1',
    )
    expect(parseSessionSharePagination(
      { cursor, limit: '10' }, 'relay', 'platform', 'session-1',
    )).toEqual({
      limit: 10,
      cursor: { createdAt: '2026-07-13T12:00:00.000Z', id: 'grant-2' },
    })
    expect(() => parseSessionSharePagination(
      { cursor }, 'relay', 'platform', 'session-2',
    )).toThrow(InvalidSessionSharePaginationError)
  })

  it('rejects malformed cursors and out-of-range limits', () => {
    expect(() => parseSessionSharePagination(
      { cursor: 'not-json' }, 'relay', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
    expect(() => parseSessionSharePagination(
      { limit: '101' }, 'relay', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
    expect(() => parseSessionSharePagination(
      { limit: 1 }, 'relay', 'platform', 'session-1',
    )).toThrow(InvalidSessionSharePaginationError)
  })
})
