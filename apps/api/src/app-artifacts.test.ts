import type { ArtifactDto, MeOrganization } from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import {
  ArtifactVersionConflictError,
  type ArtifactRepository,
} from './artifact-repository.js'
import { createDevelopmentAuthenticator } from './auth.js'
import { InMemorySessionRepository } from './session-repository.js'

const organizationId = 'relay'
const spaceId = 'platform'
const sessionId = 'session-1'
const actorId = 'user-1'
const basePath = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${sessionId}/artifacts`

const artifact: ArtifactDto = {
  organizationId,
  spaceId,
  sessionId,
  id: 'artifact-1',
  turnId: null,
  type: 'pull_request',
  provider: 'github',
  externalId: 'relay/cosmos#42',
  label: 'Production fix',
  url: 'https://github.com/relay/cosmos/pull/42',
  status: 'open',
  attributes: { draft: false },
  createdByToolCallId: null,
  createdBy: actorId,
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T01:00:00.000Z',
  removedAt: null,
  version: 1,
}

const organizations: MeOrganization[] = [{
  id: organizationId,
  name: 'Relay',
  role: 'member',
  spaces: [{ id: spaceId, name: 'Platform', role: 'member' }],
}]

function repository(overrides: Partial<ArtifactRepository> = {}): ArtifactRepository {
  return {
    async list() {
      return { items: [artifact], hasMore: false, nextCursor: null }
    },
    async create() {
      return { artifact, replayed: false }
    },
    async update() {
      return { ...artifact, status: 'merged', version: 2 }
    },
    async remove() {
      return {
        artifact: { ...artifact, removedAt: '2026-07-13T02:00:00.000Z', version: 2 },
        replayed: false,
      }
    },
    ...overrides,
  }
}

function application(
  artifactRepository: ArtifactRepository,
  authenticate = createDevelopmentAuthenticator(actorId),
) {
  return createApp({
    authenticate,
    artifactRepository,
    sessionRepository: new InMemorySessionRepository({
      actorOrganizations: { [actorId]: organizations },
    }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Artifact API', () => {
  it('returns an opaque cursor bound to the Session and type filter', async () => {
    const list = vi.fn<ArtifactRepository['list']>(async () => ({
      items: [artifact],
      hasMore: true,
      nextCursor: { createdAt: artifact.createdAt, id: artifact.id },
    }))
    const app = application(repository({ list }))
    const first = await app.inject({ method: 'GET', url: `${basePath}?limit=1&type=pull_request` })
    const cursor = first.json().page.nextCursor as string
    const second = await app.inject({
      method: 'GET',
      url: `${basePath}?limit=1&type=pull_request&cursor=${encodeURIComponent(cursor)}`,
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      organizationId,
      spaceId,
      sessionId,
      items: [{ id: artifact.id }],
      page: { hasMore: true },
    })
    expect(cursor).not.toContain(artifact.id)
    expect(second.statusCode).toBe(200)
    expect(list).toHaveBeenLastCalledWith(organizationId, spaceId, sessionId, actorId, {
      limit: 1,
      type: 'pull_request',
      cursor: { createdAt: artifact.createdAt, id: artifact.id },
    })

    const crossFilter = await app.inject({
      method: 'GET',
      url: `${basePath}?type=commit&cursor=${encodeURIComponent(cursor)}`,
    })
    expect(crossFilter.statusCode).toBe(400)
    expect(crossFilter.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    await app.close()
  })

  it('validates HTTPS create input before calling the repository', async () => {
    const create = vi.fn<ArtifactRepository['create']>()
    const app = application(repository({ create }))
    const missingKey = await app.inject({
      method: 'POST',
      url: basePath,
      payload: { type: 'link', label: 'Trace', url: 'https://example.com/trace' },
    })
    const unsafe = await app.inject({
      method: 'POST',
      url: basePath,
      headers: { 'idempotency-key': 'artifact-create-key' },
      payload: { type: 'link', label: 'Trace', url: 'http://example.com/trace' },
    })

    expect(missingKey.statusCode).toBe(400)
    expect(missingKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
    expect(unsafe.statusCode).toBe(400)
    expect(unsafe.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(create).not.toHaveBeenCalled()
    await app.close()
  })

  it('creates an Artifact with replay, location, and version headers', async () => {
    const create = vi.fn<ArtifactRepository['create']>(async () => ({ artifact, replayed: true }))
    const app = application(repository({ create }))
    const response = await app.inject({
      method: 'POST',
      url: basePath,
      headers: { 'idempotency-key': 'artifact-create-key' },
      payload: {
        type: 'pull_request',
        provider: 'github',
        externalId: 'relay/cosmos#42',
        label: 'Production fix',
        url: artifact.url,
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers.etag).toBe('"1"')
    expect(response.headers.location).toBe(`${basePath}/${artifact.id}`)
    expect(response.headers['idempotency-replayed']).toBe('true')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      actorId,
      request: expect.objectContaining({ attributes: {} }),
    }))
    await app.close()
  })

  it('requires If-Match and maps an Artifact version conflict', async () => {
    const update = vi.fn<ArtifactRepository['update']>(async () => {
      throw new ArtifactVersionConflictError(1, 2)
    })
    const app = application(repository({ update }))
    const missing = await app.inject({
      method: 'PATCH',
      url: `${basePath}/${artifact.id}`,
      payload: { status: 'merged' },
    })
    const stale = await app.inject({
      method: 'PATCH',
      url: `${basePath}/${artifact.id}`,
      headers: { 'if-match': '"1"', 'content-type': 'application/merge-patch+json' },
      payload: { status: 'merged' },
    })

    expect(missing.statusCode).toBe(428)
    expect(update).toHaveBeenCalledTimes(1)
    expect(stale.statusCode).toBe(412)
    expect(stale.json()).toMatchObject({
      code: 'PRECONDITION_FAILED',
      details: { expectedVersion: 1, currentVersion: 2 },
    })
    await app.close()
  })

  it('removes an Artifact with a bodyless 204 response and replay metadata', async () => {
    const remove = vi.fn<ArtifactRepository['remove']>(async () => ({
      artifact: { ...artifact, removedAt: '2026-07-13T02:00:00.000Z', version: 2 },
      replayed: true,
    }))
    const app = application(repository({ remove }))
    const response = await app.inject({
      method: 'DELETE',
      url: `${basePath}/${artifact.id}`,
      headers: { 'if-match': '"1"', 'idempotency-key': 'artifact-remove-key' },
    })

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers.etag).toBe('"2"')
    expect(response.headers['idempotency-replayed']).toBe('true')
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: artifact.id,
      expectedVersion: 1,
    }))
    await app.close()
  })

  it('fails closed for Service Accounts without an exact Artifact operation policy', async () => {
    const list = vi.fn<ArtifactRepository['list']>()
    const app = createApp({
      authenticate: async () => ({ id: actorId, kind: 'service_account', audience: 'relay-api' }),
      artifactRepository: repository({ list }),
      sessionRepository: new InMemorySessionRepository({
        actorOrganizations: { [actorId]: organizations },
      }),
    })
    const response = await app.inject({ method: 'GET', url: basePath })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(list).not.toHaveBeenCalled()
    await app.close()
  })
})
