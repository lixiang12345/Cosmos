import type { FileDto, FileVersionDto, MeOrganization } from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator } from './auth.js'
import type { FileRepository } from './file-repository.js'
import { ObjectStorageError } from './object-storage.js'
import { InMemorySessionRepository } from './session-repository.js'

const organizationId = 'relay'
const spaceId = 'platform'
const actorId = 'user-1'
const fileId = 'file-1'
const basePath = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/files`

const file: FileDto = {
  organizationId,
  spaceId: null,
  id: fileId,
  scope: 'user',
  ownerUserId: actorId,
  sessionId: null,
  path: 'knowledge/release.md',
  mimeType: 'text/markdown; charset=utf-8',
  size: 15,
  latestVersionId: 'file-version-2',
  lastWrittenByToolCallId: 'tool-call-2',
  lastWrittenByExpertId: 'expert-1',
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T02:00:00.000Z',
  archivedAt: null,
  version: 2,
}

const version: FileVersionDto = {
  organizationId,
  spaceId: null,
  fileId,
  id: 'file-version-2',
  version: 2,
  contentHash: 'a'.repeat(64),
  size: 15,
  createdByToolCallId: 'tool-call-2',
  sourceSessionId: 'session-1',
  sourceTurnId: 'turn-2',
  createdAt: '2026-07-13T02:00:00.000Z',
}

const organizations: MeOrganization[] = [{
  id: organizationId,
  name: 'Relay',
  role: 'member',
  spaces: [{ id: spaceId, name: 'Platform', role: 'member' }],
}]

function repository(overrides: Partial<FileRepository> = {}): FileRepository {
  return {
    async list() {
      return { items: [file], hasMore: false, nextCursor: null }
    },
    async get() {
      return file
    },
    async listVersions() {
      return { file, items: [version], hasMore: false, nextCursor: null }
    },
    async getContent() {
      return { file, version, content: Buffer.from('# Release notes') }
    },
    ...overrides,
  }
}

function application(fileRepository: FileRepository) {
  return createApp({
    authenticate: createDevelopmentAuthenticator(actorId),
    fileRepository,
    sessionRepository: new InMemorySessionRepository({
      actorOrganizations: { [actorId]: organizations },
    }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('File API', () => {
  it('lists a scope with an opaque cursor bound to its complete filter set', async () => {
    const list = vi.fn<FileRepository['list']>(async () => ({
      items: [file],
      hasMore: true,
      nextCursor: { path: file.path, id: file.id },
    }))
    const app = application(repository({ list }))
    const first = await app.inject({
      method: 'GET',
      url: `${basePath}?scope=user&prefix=knowledge&search=release&limit=1`,
    })
    const cursor = first.json().page.nextCursor as string
    const second = await app.inject({
      method: 'GET',
      url: `${basePath}?scope=user&prefix=knowledge&search=release&limit=1&cursor=${encodeURIComponent(cursor)}`,
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      organizationId,
      requestedSpaceId: spaceId,
      scope: 'user',
      ownerUserId: actorId,
      items: [{ id: fileId }],
      page: { hasMore: true },
    })
    expect(cursor).not.toContain(file.path)
    expect(second.statusCode).toBe(200)
    expect(list).toHaveBeenLastCalledWith(organizationId, spaceId, actorId, {
      scope: 'user',
      ownerUserId: actorId,
      prefix: 'knowledge/',
      search: 'release',
      limit: 1,
      cursor: { path: file.path, id: file.id },
    })

    const crossScope = await app.inject({
      method: 'GET',
      url: `${basePath}?scope=organization&cursor=${encodeURIComponent(cursor)}`,
    })
    expect(crossScope.statusCode).toBe(400)
    expect(crossScope.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    await app.close()
  })

  it('returns metadata and immutable version pages with ETags', async () => {
    const app = application(repository())
    const metadata = await app.inject({ method: 'GET', url: `${basePath}/${fileId}` })
    const versions = await app.inject({ method: 'GET', url: `${basePath}/${fileId}/versions?limit=1` })

    expect(metadata.statusCode).toBe(200)
    expect(metadata.headers.etag).toBe('"2"')
    expect(metadata.json()).toMatchObject({ id: fileId, path: file.path, version: 2 })
    expect(versions.statusCode).toBe(200)
    expect(versions.json()).toMatchObject({
      organizationId,
      requestedSpaceId: spaceId,
      fileId,
      items: [{ id: version.id, version: 2 }],
      page: { hasMore: false, nextCursor: null },
    })
    await app.close()
  })

  it('downloads exact versions with defensive content headers', async () => {
    const getContent = vi.fn<FileRepository['getContent']>(async () => ({
      file: { ...file, path: 'exports/report.html', mimeType: 'text/html' },
      version,
      content: Buffer.from('<script>alert(1)</script>'),
    }))
    const app = application(repository({ getContent }))
    const response = await app.inject({
      method: 'GET',
      url: `${basePath}/${fileId}/content?version=2&disposition=inline`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.toString('utf8')).toBe('<script>alert(1)</script>')
    expect(response.headers['content-type']).toMatch(/^text\/html/)
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="report\.html"/)
    expect(response.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers.etag).toBe(`"sha256:${version.contentHash}"`)
    expect(getContent).toHaveBeenCalledWith(organizationId, spaceId, fileId, actorId, 2)

    const invalid = await app.inject({
      method: 'GET',
      url: `${basePath}/${fileId}/content?disposition=preview`,
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
    await app.close()
  })

  it('returns a safe retryable response when object content is unavailable', async () => {
    const app = application(repository({
      async getContent() { throw new ObjectStorageError('bucket/key/provider detail') },
    }))
    const response = await app.inject({ method: 'GET', url: `${basePath}/${fileId}/content` })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      code: 'OBJECT_STORAGE_UNAVAILABLE',
      message: 'File content storage is temporarily unavailable.',
      retryable: true,
    })
    expect(JSON.stringify(response.json())).not.toContain('bucket/key/provider')
    await app.close()
  })

  it('fails closed for Service Accounts before File repository access', async () => {
    const list = vi.fn<FileRepository['list']>()
    const app = createApp({
      authenticate: async () => ({ id: actorId, kind: 'service_account', audience: 'relay-api' }),
      fileRepository: repository({ list }),
      sessionRepository: new InMemorySessionRepository({
        actorOrganizations: { [actorId]: organizations },
      }),
    })
    const response = await app.inject({ method: 'GET', url: `${basePath}?scope=user` })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(list).not.toHaveBeenCalled()
    await app.close()
  })
})
