import type { MeOrganization, SessionWorkerDto } from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator } from './auth.js'
import type { SessionWorkerRepository } from './session-worker-repository.js'
import { InMemorySessionRepository } from './session-repository.js'

const organizationId = 'relay'
const spaceId = 'platform'
const sessionId = 'session-1'
const actorId = 'user-1'
const worker: SessionWorkerDto = {
  organizationId,
  spaceId,
  sessionId,
  id: 'worker-1',
  parentTurnId: 'turn-1',
  parentWorkerId: null,
  expertRevisionId: null,
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
const organizations: MeOrganization[] = [{
  id: organizationId,
  name: 'Relay',
  role: 'member',
  spaces: [{ id: spaceId, name: 'Platform', role: 'member' }],
}]

function application(repository: SessionWorkerRepository) {
  return createApp({
    authenticate: createDevelopmentAuthenticator(actorId),
    sessionWorkerRepository: repository,
    sessionRepository: new InMemorySessionRepository({
      actorOrganizations: { [actorId]: organizations },
    }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Session Worker API', () => {
  it('returns a scope-bound opaque page cursor', async () => {
    const list = vi.fn<SessionWorkerRepository['list']>(async () => ({
      items: [worker],
      hasMore: true,
      nextCursor: { createdAt: worker.createdAt, id: worker.id },
    }))
    const app = application({ list })
    const base = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${sessionId}/workers`
    const first = await app.inject({ method: 'GET', url: `${base}?limit=1` })
    const cursor = first.json().page.nextCursor as string
    const next = await app.inject({ method: 'GET', url: `${base}?limit=1&cursor=${encodeURIComponent(cursor)}` })
    const wrongSession = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/session-2/workers?cursor=${encodeURIComponent(cursor)}`,
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      organizationId, spaceId, sessionId, items: [{ id: worker.id }], page: { hasMore: true },
    })
    expect(cursor).not.toContain(worker.id)
    expect(next.statusCode).toBe(200)
    expect(wrongSession.statusCode).toBe(400)
    expect(list).toHaveBeenLastCalledWith(organizationId, spaceId, sessionId, actorId, {
      limit: 1,
      cursor: { createdAt: worker.createdAt, id: worker.id },
    })
    await app.close()
  })

  it('conceals an inaccessible or missing Session', async () => {
    const list = vi.fn<SessionWorkerRepository['list']>(async () => null)
    const app = application({ list })
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${sessionId}/workers`,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await app.close()
  })
})
