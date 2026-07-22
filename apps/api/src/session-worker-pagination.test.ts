import { describe, expect, it } from 'vitest'
import {
  encodeSessionWorkerCursor,
  parseSessionWorkerPagination,
} from './session-worker-pagination.js'

describe('Session Worker pagination', () => {
  it('round-trips a cursor bound to the exact Session', () => {
    const cursor = encodeSessionWorkerCursor(
      { createdAt: '2026-07-13T08:00:00.000Z', id: 'worker-1' },
      'cosmos',
      'platform',
      'session-1',
    )
    expect(parseSessionWorkerPagination({ cursor, limit: '10' }, 'cosmos', 'platform', 'session-1')).toEqual({
      limit: 10,
      cursor: { createdAt: '2026-07-13T08:00:00.000Z', id: 'worker-1' },
    })
    expect(() => parseSessionWorkerPagination({ cursor }, 'cosmos', 'platform', 'session-2')).toThrow()
  })

  it('rejects malformed limits and cursors', () => {
    expect(() => parseSessionWorkerPagination({ limit: '0' }, 'cosmos', 'platform', 'session-1')).toThrow()
    expect(() => parseSessionWorkerPagination({ limit: '101' }, 'cosmos', 'platform', 'session-1')).toThrow()
    expect(() => parseSessionWorkerPagination({ cursor: 'not-json' }, 'cosmos', 'platform', 'session-1')).toThrow()
  })
})
