import { describe, expect, it } from 'vitest'
import {
  InvalidSessionTimelinePaginationError,
  encodeSessionTimelineCursor,
  parseSessionTimelineCursor,
  parseSessionTimelinePagination,
} from './session-timeline-pagination.js'

const scope = {
  organizationId: 'cosmos',
  spaceId: 'platform',
  sessionId: 'session-1',
}

describe('Session timeline pagination', () => {
  it('round trips a scope-bound cursor', () => {
    const cursor = encodeSessionTimelineCursor({ ...scope, sequence: 42 })

    expect(parseSessionTimelineCursor(cursor, scope)).toBe(42)
    expect(parseSessionTimelinePagination({ cursor, limit: '25' }, scope, 100)).toEqual({
      afterSequence: 42,
      limit: 25,
    })
  })

  it('rejects a cursor replayed in another Session', () => {
    const cursor = encodeSessionTimelineCursor({ ...scope, sequence: 42 })

    expect(() => parseSessionTimelineCursor(cursor, { ...scope, sessionId: 'session-2' }))
      .toThrow(InvalidSessionTimelinePaginationError)
  })

  it.each(['', 'not+base64', 'e30'])('rejects malformed cursor %j', (cursor) => {
    expect(() => parseSessionTimelineCursor(cursor, scope))
      .toThrow(InvalidSessionTimelinePaginationError)
  })

  it.each(['0', '-1', '1.5', '101', 'not-a-number'])('rejects invalid limit %j', (limit) => {
    expect(() => parseSessionTimelinePagination({ limit }, scope, 100))
      .toThrow(InvalidSessionTimelinePaginationError)
  })
})
