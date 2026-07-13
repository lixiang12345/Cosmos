import {
  SessionWorkerDtoSchema,
  SessionWorkerListResponseSchema,
  type SessionWorkerDto,
} from '../src/index.js'
import { describe, expect, it } from 'vitest'

const worker: SessionWorkerDto = {
  organizationId: 'relay',
  spaceId: 'platform',
  sessionId: 'session-1',
  id: 'worker-1',
  parentTurnId: 'turn-1',
  parentWorkerId: null,
  expertRevisionId: 'expert-revision-1',
  name: 'Review implementation',
  instructions: 'Review the implementation and report concrete issues.',
  status: 'running',
  depth: 1,
  ordinal: 1,
  resultSummary: null,
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:01:00.000Z',
  completedAt: null,
  version: 2,
}

describe('Session Worker contracts', () => {
  it('accepts an active root Worker and a terminal child Worker', () => {
    expect(SessionWorkerDtoSchema.parse(worker)).toEqual(worker)
    expect(SessionWorkerDtoSchema.parse({
      ...worker,
      id: 'worker-2',
      parentWorkerId: worker.id,
      status: 'completed',
      depth: 2,
      resultSummary: 'No blocking issues found.',
      completedAt: '2026-07-13T08:02:00.000Z',
      version: 3,
    })).toMatchObject({ id: 'worker-2', status: 'completed', depth: 2 })
  })

  it('rejects inconsistent hierarchy and terminal metadata', () => {
    expect(SessionWorkerDtoSchema.safeParse({ ...worker, parentWorkerId: worker.id, depth: 1 }).success).toBe(false)
    expect(SessionWorkerDtoSchema.safeParse({ ...worker, status: 'failed' }).success).toBe(false)
    expect(SessionWorkerDtoSchema.safeParse({ ...worker, resultSummary: 'Still running.' }).success).toBe(false)
  })

  it('rejects Workers outside the response scope', () => {
    expect(SessionWorkerListResponseSchema.safeParse({
      organizationId: worker.organizationId,
      spaceId: worker.spaceId,
      sessionId: worker.sessionId,
      items: [{ ...worker, sessionId: 'session-2' }],
      page: { nextCursor: null, hasMore: false },
    }).success).toBe(false)
  })
})
