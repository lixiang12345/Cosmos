import type {
  AdvisorPlanDto,
  ApprovalDto,
  CreateSessionRequestInput,
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
  FileDto,
  FileVersionDto,
  SessionWorkerDto,
  SessionEventPage,
  SessionDto,
  SessionMessagePage,
} from '@cosmos/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CosmosApiError,
  COSMOS_API_TIMEOUT_MS,
  archiveSession,
  cancelSession,
  createSession,
  decideAdvisorPlan,
  decideApproval,
  getApproval,
  getAdvisorPlan,
  getEnvironment,
  getExpert,
  getFile,
  getFileContent,
  getMe,
  getRuntimeCapabilities,
  getSession,
  getCosmosApiBaseUrl,
  listEnvironments,
  listApprovals,
  listAdvisorPlans,
  listExperts,
  listFiles,
  listFileVersions,
  listSessionEvents,
  listSessionMessages,
  listSessionWorkers,
  listSessions,
  pauseSession,
  renameSession,
  resumeSession,
  resolveCosmosApiBaseUrl,
  resolveCosmosApiRequestUrl,
  restoreSession,
  retryAdvisorPlan,
  retrySessionTurn,
  sendSessionMessage,
  startSession,
  streamSessionEvents,
} from './cosmosApi'

const createInput = {
  title: 'Fix checkout race condition',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 3,
  environmentId: 'environment-platform',
  repository: 'platform/checkout',
  baseBranch: 'main',
  message: { content: 'Trace the duplicate reservation path and add a regression test.' },
} satisfies CreateSessionRequestInput

const session: SessionDto = {
  id: 'session-1', organizationId: 'cosmos', spaceId: 'space-platform', title: createInput.title,
  summary: createInput.message.content, expertId: createInput.expertId, expertName: createInput.expertName,
  expertVersion: createInput.expertVersion, environmentId: createInput.environmentId, repository: createInput.repository,
  configurationResolutionVersion: 1, expertRevisionId: 'expert-revision-3',
  environmentRevisionId: 'environment-revision-1', executionSnapshotId: 'execution-snapshot-1', repositoryId: 'repository-checkout',
  baseBranch: createInput.baseBranch, visibility: 'private', status: 'active', attachments: [], source: 'manual',
  createdAt: '2026-07-12T08:00:00.000Z', updatedAt: '2026-07-12T08:00:00.000Z',
  lastActivityAt: '2026-07-12T08:00:00.000Z', version: 1,
  archivedAt: null,
}

const file: FileDto = {
  organizationId: 'cosmos', spaceId: null, id: 'file-1', scope: 'user', ownerUserId: 'user-1',
  sessionId: null, path: 'knowledge/release.md', mimeType: 'text/markdown', size: 15,
  latestVersionId: 'file-version-2', lastWrittenByToolCallId: 'tool-2',
  lastWrittenByExpertId: 'expert-pr-author', createdAt: session.createdAt,
  updatedAt: session.updatedAt, archivedAt: null, version: 2,
}

const fileVersion: FileVersionDto = {
  organizationId: 'cosmos', spaceId: null, fileId: file.id, id: file.latestVersionId,
  version: 2, contentHash: 'a'.repeat(64), size: file.size,
  createdByToolCallId: file.lastWrittenByToolCallId, sourceSessionId: session.id,
  sourceTurnId: 'turn-2', createdAt: session.updatedAt,
}

const sessionWorker: SessionWorkerDto = {
  organizationId: session.organizationId,
  spaceId: session.spaceId,
  sessionId: session.id,
  id: 'session-worker-1',
  parentTurnId: 'turn-1',
  parentWorkerId: null,
  expertRevisionId: session.expertRevisionId ?? null,
  name: 'Review implementation',
  instructions: 'Review the implementation and report concrete issues.',
  status: 'running',
  depth: 1,
  ordinal: 1,
  resultSummary: null,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  completedAt: null,
  version: 2,
}

const approval: ApprovalDto = {
  organizationId: 'cosmos', spaceId: 'space-platform', id: 'approval-1',
  sessionId: session.id, turnId: 'turn-1', toolCallId: 'tool-call-1',
  action: 'Merge pull request #42', riskLevel: 'high', reasons: ['Protected branch write'],
  evidence: [{ type: 'test', label: 'CI', value: 'Required checks passed' }],
  status: 'pending', requestedBy: 'requester-1', assignedTo: ['reviewer-1'],
  requiredApprovals: 1, approvalCount: 0, actorHasDecided: false, expiresAt: '2026-07-14T01:00:00.000Z',
  decidedBy: null, decisionNote: null, decidedAt: null, createdAt: session.createdAt,
  updatedAt: session.updatedAt, version: 1,
}

const advisorPlan: AdvisorPlanDto = {
  organizationId: 'cosmos', spaceId: 'space-platform', sessionId: session.id, id: 'advisor-plan-1',
  summary: 'Update the Space description.', dependencies: [], risks: [], status: 'proposed',
  steps: [{
    id: 'advisor-step-1', ordinal: 1, kind: 'control_plane', operation: 'space.update',
    targetType: 'space', targetId: 'space-platform', rationale: 'Clarify ownership.',
    before: { name: 'Platform', description: '', defaultExpertId: null, defaultEnvironmentId: null, isDefault: true, version: 1 },
    after: { name: 'Platform', description: 'Delivery Space.', defaultExpertId: null, defaultEnvironmentId: null, isDefault: true, version: 2 },
    manualAction: null, riskLevel: 'medium', status: 'proposed', failureCode: null,
    failureMessage: null, startedAt: null, completedAt: null, version: 1,
  }],
  requestedBy: 'user-1', confirmedBy: null, confirmedAt: null,
  createdAt: session.createdAt, updatedAt: session.updatedAt, version: 1,
}

const messagePage: SessionMessagePage = {
  organizationId: 'cosmos',
  spaceId: 'space-platform',
  sessionId: session.id,
  items: [{
    id: 'message-1',
    organizationId: 'cosmos',
    spaceId: 'space-platform',
    sessionId: session.id,
    sequence: 1,
    role: 'user',
    actorId: 'user-1',
    content: 'Inspect the checkout path.',
    attachments: [],
    createdAt: session.createdAt,
  }],
  page: { nextCursor: null, hasMore: false },
}

const eventPage: SessionEventPage = {
  organizationId: 'cosmos',
  spaceId: 'space-platform',
  sessionId: session.id,
  items: [{
    eventId: 'event-2',
    organizationId: 'cosmos',
    spaceId: 'space-platform',
    sessionId: session.id,
    sequence: 2,
    type: 'attempt.updated',
    resourceType: 'attempt',
    resourceId: 'attempt-1',
    actorId: 'worker-1',
    commandId: 'command-1',
    requestId: 'request-1',
    occurredAt: session.createdAt,
    payload: {
      attemptId: 'attempt-1',
      turnId: 'turn-1',
      number: 1,
      status: 'running',
      failureCode: null,
    },
  }],
  page: { nextCursor: null, hasMore: false },
}

const expertRevisionSummary = {
  id: 'expert-revision-3',
  expertId: 'expert-pr-author',
  revision: 3,
  model: 'cosmos-default',
  environmentId: 'environment-platform',
  environmentRevisionId: 'environment-revision-1',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: true,
  createdAt: '2026-07-13T08:00:00.000Z',
  status: 'published',
} as const

const expertSummary: ExpertSummaryDto = {
  id: 'expert-pr-author',
  organizationId: 'cosmos',
  spaceId: 'space-platform',
  kind: 'custom',
  name: 'PR Author',
  description: 'Produces reviewed pull requests.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: expertRevisionSummary.id,
  publishedRevisionSummary: expertRevisionSummary,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
  version: 1,
}

const expertDetail: ExpertDetailDto = {
  ...expertSummary,
  publishedRevision: {
    ...expertRevisionSummary,
    instructions: 'Inspect the repository, implement the change, and verify it.',
    capabilities: ['code-search', 'read-code', 'git'],
    launchGuidance: 'Describe the requested implementation and its verification evidence.',
  },
  draftRevisionId: null,
  draftRevision: null,
}

const defaultRepository = {
  repositoryId: 'repository-checkout',
  repository: 'platform/checkout',
  baseBranch: 'main',
  isDefault: true,
} as const

const environmentRevisionSummary = {
  id: 'environment-revision-1',
  environmentId: 'environment-platform',
  revision: 1,
  status: 'ready',
  defaultRepository,
  createdAt: '2026-07-13T08:00:00.000Z',
} as const

const environmentSummary: EnvironmentSummaryDto = {
  id: 'environment-platform',
  organizationId: 'cosmos',
  spaceId: 'space-platform',
  type: 'cloud',
  name: 'Platform runtime',
  description: 'Isolated runtime for platform repositories.',
  visibility: 'space',
  status: 'ready',
  activeRevisionId: environmentRevisionSummary.id,
  activeRevision: environmentRevisionSummary,
  provisioning: null,
  version: 1,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const environmentDetail: EnvironmentDetailDto = {
  ...environmentSummary,
  activeRevision: {
    ...environmentRevisionSummary,
    repositoryBindings: [defaultRepository],
    image: 'ghcr.io/cosmos/runtime:stable',
    variableReferences: [],
    hooks: [],
    networkPolicy: { mode: 'restricted', allowedHosts: [] },
    sharing: 'space',
    daemonPoolId: null,
    checksum: 'a'.repeat(64),
  },
  latestRevision: {
    id: environmentRevisionSummary.id, environmentId: environmentRevisionSummary.environmentId,
    revision: environmentRevisionSummary.revision, status: 'ready', repositoryBindings: [defaultRepository],
    image: 'ghcr.io/cosmos/runtime:stable', variableReferences: [], hooks: [],
    networkPolicy: { mode: 'restricted', allowedHosts: [] }, sharing: 'space', daemonPoolId: null,
    checksum: 'a'.repeat(64), createdAt: environmentRevisionSummary.createdAt,
  },
  provisioningHistory: [],
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Cosmos API client', () => {
  it('uses the same-origin API by default', () => {
    expect(getCosmosApiBaseUrl()).toBe('/api')
    expect(resolveCosmosApiBaseUrl(
      'https://cosmos.example/api/', 'https://cosmos.example', undefined,
    )).toBe('https://cosmos.example/api')
  })

  it('allows only explicitly trusted HTTPS cross-origin APIs', () => {
    expect(resolveCosmosApiBaseUrl(
      'https://api.cosmos.example/v1/',
      'https://app.cosmos.example',
      'https://identity.example, https://api.cosmos.example',
    )).toBe('https://api.cosmos.example/v1')
    expect(() => resolveCosmosApiBaseUrl(
      'https://api.cosmos.example/v1', 'https://app.cosmos.example', undefined,
    )).toThrow(expect.objectContaining({ code: 'API_ORIGIN_NOT_ALLOWED' }))
    expect(() => resolveCosmosApiBaseUrl(
      'http://api.cosmos.example/v1', 'https://app.cosmos.example', 'http://api.cosmos.example',
    )).toThrow(expect.objectContaining({ code: 'API_ORIGIN_NOT_ALLOWED' }))
  })

  it('rejects an untrusted API origin before calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_BASE_URL', 'https://untrusted.example/api')
    await expect(listSessions('cosmos', 'space-platform', { accessToken: 'secret' }))
      .rejects.toMatchObject({ code: 'API_ORIGIN_NOT_ALLOWED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    '//evil.example/api',
    '///evil.example/api',
    '/\\evil.example/api',
    '/..//evil.example/api',
    '/.//evil.example/api',
    '/%2e%2e//evil.example/api',
    '/foo/%2e%2e//evil.example/api',
  ])('rejects ambiguous cross-origin syntax before calling fetch: %s', async (baseUrl) => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_BASE_URL', baseUrl)
    await expect(listSessions('cosmos', 'space-platform', { accessToken: 'secret' }))
      .rejects.toMatchObject({ code: 'API_CONFIGURATION_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a root-only API base on the application origin', () => {
    expect(resolveCosmosApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: '/', applicationOrigin: 'https://app.cosmos.example',
    })).toBe('/v1/sessions')
  })

  it('joins absolute root API bases without a double slash', () => {
    expect(resolveCosmosApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: 'https://app.cosmos.example/', applicationOrigin: 'https://app.cosmos.example',
    })).toBe('https://app.cosmos.example/v1/sessions')
    expect(resolveCosmosApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: 'https://api.cosmos.example/',
      applicationOrigin: 'https://app.cosmos.example',
      allowedOrigins: 'https://api.cosmos.example',
    })).toBe('https://api.cosmos.example/v1/sessions')
  })

  it.each([
    'https://user:password@api.cosmos.example/api',
    'https://api.cosmos.example/api?target=other',
    'https://api.cosmos.example/api#fragment',
  ])('rejects unsafe absolute API configuration: %s', (baseUrl) => {
    expect(() => resolveCosmosApiBaseUrl(
      baseUrl, 'https://app.cosmos.example', 'https://api.cosmos.example',
    )).toThrow(expect.objectContaining({ code: 'API_CONFIGURATION_ERROR' }))
  })

  it('creates a Session with tenant scope and an idempotency key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ session }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createSession(
      'cosmos', 'space-platform', createInput, 'create-session-1', { accessToken: 'access-token' },
    )).resolves.toEqual({ session })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions',
      expect.objectContaining({ method: 'POST', headers: expect.any(Headers) }),
    )
    const requestHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(requestHeaders.get('Idempotency-Key')).toBe('create-session-1')
    expect(requestHeaders.get('Authorization')).toBe('Bearer access-token')
  })

  it('lists Sessions and validates the page envelope', async () => {
    const response = { items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt } }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listSessions('cosmos', 'space-platform')).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('encodes Session list pagination and filters', async () => {
    const response = {
      items: [session],
      page: { nextCursor: 'next-page', hasMore: true, projectionUpdatedAt: session.updatedAt },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listSessions('cosmos', 'space-platform', undefined, {
      cursor: 'current-page',
      limit: 10,
      status: 'paused',
      archived: 'all',
      search: 'checkout flow',
    })).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions?cursor=current-page&limit=10&status=paused&archived=all&search=checkout+flow',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('times out a stalled request with a retryable error', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))

    const pending = listSessions('cosmos', 'space-timeout')
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: true,
    })
    expect(timeoutSpy).toHaveBeenCalledWith(COSMOS_API_TIMEOUT_MS)
  })

  it('classifies a stalled response body as a retryable timeout', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    } as Response)))

    const pending = listSessions('cosmos', 'space-slow-body')
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: true,
    })
  })

  it('rejects a list response containing a Session outside the requested tenant scope', async () => {
    const response = {
      items: [{ ...session, organizationId: 'other-organization' }],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response)))

    await expect(listSessions('cosmos', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('gets one Session from its tenant-scoped canonical path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session, 200, {
      ETag: '"1"',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getSession('cosmos', 'space-platform', 'session-1', {
      accessToken: 'access-token',
    }, controller.signal)).resolves.toEqual(session)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('loads a cursor-paged Worker tree bound to the exact Session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      organizationId: session.organizationId,
      spaceId: session.spaceId,
      sessionId: session.id,
      items: [sessionWorker],
      page: { nextCursor: 'worker-cursor', hasMore: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(listSessionWorkers(
      session.organizationId,
      session.spaceId,
      session.id,
      { accessToken: 'token' },
      undefined,
      { cursor: 'previous', limit: 10 },
    )).resolves.toMatchObject({ items: [{ id: sessionWorker.id }] })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/sessions/${session.id}/workers?cursor=previous&limit=10`)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      organizationId: session.organizationId,
      spaceId: session.spaceId,
      sessionId: 'session-other',
      items: [],
      page: { nextCursor: null, hasMore: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(listSessionWorkers(session.organizationId, session.spaceId, session.id))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('loads scoped File metadata, pages, and immutable versions', async () => {
    const filePage = {
      organizationId: 'cosmos', requestedSpaceId: 'space-platform', scope: 'user',
      ownerUserId: 'user-1', sessionId: null, items: [file],
      page: { nextCursor: null, hasMore: false },
    }
    const versionPage = {
      organizationId: 'cosmos', requestedSpaceId: 'space-platform', fileId: file.id,
      items: [fileVersion], page: { nextCursor: null, hasMore: false },
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(filePage))
      .mockResolvedValueOnce(jsonResponse(file))
      .mockResolvedValueOnce(jsonResponse(versionPage))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listFiles('cosmos', 'space-platform', {
      scope: 'user', search: 'release', limit: 25,
    })).resolves.toEqual(filePage)
    await expect(getFile('cosmos', 'space-platform', file.id)).resolves.toEqual(file)
    await expect(listFileVersions(
      'cosmos', 'space-platform', file.id, undefined, undefined, { limit: 25 },
    )).resolves.toEqual(versionPage)

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]), window.location.origin)
    expect(listUrl.pathname).toBe('/api/v1/organizations/cosmos/spaces/space-platform/files')
    expect(Object.fromEntries(listUrl.searchParams)).toMatchObject({
      scope: 'user', search: 'release', limit: '25',
    })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      '/api/v1/organizations/cosmos/spaces/space-platform/files/file-1',
      '/api/v1/organizations/cosmos/spaces/space-platform/files/file-1/versions?limit=25',
    ]))
  })

  it('binds Workspace File pages to the exact requested Session', async () => {
    const workspaceFile = {
      ...file,
      spaceId: 'space-platform',
      scope: 'workspace' as const,
      ownerUserId: null,
      sessionId: session.id,
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        organizationId: 'cosmos', requestedSpaceId: 'space-platform', scope: 'workspace',
        ownerUserId: null, sessionId: session.id, items: [workspaceFile],
        page: { nextCursor: null, hasMore: false },
      }))
      .mockResolvedValueOnce(jsonResponse({
        organizationId: 'cosmos', requestedSpaceId: 'space-platform', scope: 'workspace',
        ownerUserId: null, sessionId: 'session-other', items: [],
        page: { nextCursor: null, hasMore: false },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listFiles('cosmos', 'space-platform', {
      scope: 'workspace', sessionId: session.id,
    })).resolves.toMatchObject({ sessionId: session.id, items: [{ id: file.id }] })
    expect(String(fetchMock.mock.calls[0][0])).toContain(`scope=workspace&sessionId=${session.id}`)

    await expect(listFiles('cosmos', 'space-platform', {
      scope: 'workspace', sessionId: session.id,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 })
  })

  it('downloads authorized File bytes and rejects out-of-scope File pages', async () => {
    const onUnauthorized = vi.fn()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('# Release notes', {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': "attachment; filename=\"release.md\"; filename*=UTF-8''release.md",
          ETag: `"sha256:${fileVersion.contentHash}"`,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        organizationId: 'other', requestedSpaceId: 'space-platform', scope: 'user',
        ownerUserId: 'user-1', sessionId: null, items: [{ ...file, organizationId: 'other' }],
        page: { nextCursor: null, hasMore: false },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const content = await getFileContent(
      'cosmos', 'space-platform', file.id,
      { accessToken: 'access-token', onUnauthorized }, undefined,
      { version: 2, disposition: 'attachment' },
    )
    expect(await content.blob.text()).toBe('# Release notes')
    expect(content).toMatchObject({
      contentType: 'text/markdown; charset=utf-8', fileName: 'release.md',
      etag: `"sha256:${fileVersion.contentHash}"`,
    })
    const contentUrl = new URL(String(fetchMock.mock.calls[0][0]), window.location.origin)
    expect(Object.fromEntries(contentUrl.searchParams)).toEqual({ version: '2', disposition: 'attachment' })
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')

    await expect(listFiles('cosmos', 'space-platform', { scope: 'user' }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 })
    await expect(getFileContent('cosmos', 'space-platform', file.id, {
      accessToken: 'expired', onUnauthorized,
    })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledWith('expired')
  })

  it('renames a Session with its current ETag', async () => {
    const renamed = { ...session, title: 'Renamed Session', version: 2 }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(renamed))
    vi.stubGlobal('fetch', fetchMock)

    await expect(renameSession(
      'cosmos', 'space-platform', session.id, renamed.title, 1, { accessToken: 'access-token' },
    )).resolves.toEqual(renamed)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: renamed.title }) }),
    )
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('If-Match')).toBe('"1"')
    expect(headers.get('Content-Type')).toBe('application/merge-patch+json')
  })

  it('archives and restores a Session with CAS and idempotency', async () => {
    const archived = { ...session, archivedAt: session.updatedAt, version: 2 }
    const restored = { ...archived, archivedAt: null, version: 3 }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(archived))
      .mockResolvedValueOnce(jsonResponse(restored))
    vi.stubGlobal('fetch', fetchMock)

    await expect(archiveSession(
      'cosmos', 'space-platform', session.id, 1, 'archive-key', { accessToken: 'access-token' },
    )).resolves.toEqual(archived)
    await expect(restoreSession(
      'cosmos', 'space-platform', session.id, 2, 'restore-key', { accessToken: 'access-token' },
    )).resolves.toEqual(restored)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/archive', 'POST'],
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/restore', 'POST'],
    ])
    const archiveHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(archiveHeaders.get('If-Match')).toBe('"1"')
    expect(archiveHeaders.get('Idempotency-Key')).toBe('archive-key')
  })

  it('sends Session controls and Turn retries with exact CAS and idempotency headers', async () => {
    const controlCommand = (type: 'session.pause' | 'session.resume' | 'session.cancel') => ({
      id: `command-${type}`,
      type,
      status: 'succeeded' as const,
      resourceType: 'session' as const,
      resourceId: session.id,
      acceptedAt: session.updatedAt,
    })
    const paused = { session: { ...session, status: 'paused' as const, version: 2 }, command: controlCommand('session.pause') }
    const resumed = { session: { ...session, status: 'queued' as const, version: 3 }, command: controlCommand('session.resume') }
    const canceled = { session: { ...session, status: 'canceled' as const, version: 4 }, command: controlCommand('session.cancel') }
    const turnId = 'turn-1'
    const retried = {
      session: { ...session, status: 'queued' as const, version: 6 },
      attempt: {
        organizationId: session.organizationId,
        spaceId: session.spaceId,
        sessionId: session.id,
        id: 'attempt-2',
        turnId,
        number: 2,
        status: 'queued' as const,
        model: 'cosmos-default',
        providerModel: null,
        runtimeId: null,
        failureCode: null,
        createdAt: session.updatedAt,
        startedAt: null,
        finishedAt: null,
      },
      command: {
        id: 'command-retry',
        type: 'turn.retry' as const,
        status: 'queued' as const,
        resourceType: 'turn' as const,
        resourceId: turnId,
        acceptedAt: session.updatedAt,
      },
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(paused, 202))
      .mockResolvedValueOnce(jsonResponse(resumed, 202))
      .mockResolvedValueOnce(jsonResponse(canceled, 202))
      .mockResolvedValueOnce(jsonResponse(retried, 202))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pauseSession('cosmos', 'space-platform', session.id, 1, 'pause-key'))
      .resolves.toEqual(paused)
    await expect(resumeSession('cosmos', 'space-platform', session.id, 2, 'resume-key'))
      .resolves.toEqual(resumed)
    await expect(cancelSession(
      'cosmos', 'space-platform', session.id, 3, 'cancel-key', 'Operator request.',
    )).resolves.toEqual(canceled)
    await expect(retrySessionTurn(
      'cosmos', 'space-platform', session.id, turnId, 5, 'retry-key',
    )).resolves.toEqual(retried)

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/pause', 'POST'],
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/resume', 'POST'],
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/cancel', 'POST'],
      ['/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/turns/turn-1/retry', 'POST'],
    ])
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined()
    expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify({ reason: 'Operator request.' }))
    expect(fetchMock.mock.calls[3][1]?.body).toBeUndefined()
    for (const [index, [version, key]] of [[1, 'pause-key'], [2, 'resume-key'], [3, 'cancel-key'], [5, 'retry-key']].entries()) {
      const headers = new Headers(fetchMock.mock.calls[index][1]?.headers)
      expect(headers.get('If-Match')).toBe(`"${version}"`)
      expect(headers.get('Idempotency-Key')).toBe(key)
    }
  })

  it('starts a draft without resending its Message and validates the linked result', async () => {
    const queuedSession = { ...session, status: 'queued' as const, version: 2 }
    const turn = {
      id: 'turn-1', sessionId: session.id, ordinal: 1, initiatorType: 'user' as const,
      initiatorId: 'user-1', inputMessageId: 'message-1', status: 'queued' as const,
      queuedAt: session.updatedAt, version: 1,
    }
    const command = {
      id: 'command-1', type: 'session.start' as const, status: 'accepted' as const,
      resourceType: 'turn' as const, resourceId: turn.id, acceptedAt: session.updatedAt,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      session: queuedSession, turn, command,
    }, 202))
    vi.stubGlobal('fetch', fetchMock)

    await expect(startSession(
      'cosmos', 'space-platform', session.id, 1, 'start-session-1',
      { accessToken: 'access-token' },
    )).resolves.toEqual({ session: queuedSession, turn, command })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/start',
      expect.objectContaining({ method: 'POST', headers: expect.any(Headers) }),
    )
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Idempotency-Key')).toBe('start-session-1')
    expect(headers.get('If-Match')).toBe('"1"')
    expect(headers.get('Content-Type')).toBeNull()
    expect(headers.get('Authorization')).toBe('Bearer access-token')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      session: queuedSession,
      turn: { ...turn, sessionId: 'another-session' },
      command,
    }, 202))
    await expect(startSession(
      'cosmos', 'space-platform', session.id, 1, 'start-session-2',
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 202 })
  })

  it('sends a follow-up Message and validates every linked runtime record', async () => {
    const updatedSession = { ...session, status: 'queued' as const, version: 2 }
    const message = {
      id: 'message-2', sessionId: session.id, sequence: 2, role: 'user' as const,
      actorId: 'user-1', content: 'Also verify the cancellation path.', attachments: [],
      createdAt: session.updatedAt,
    }
    const turn = {
      id: 'turn-2', sessionId: session.id, ordinal: 2, initiatorType: 'user' as const,
      initiatorId: 'user-1', inputMessageId: message.id, status: 'queued' as const,
      queuedAt: session.updatedAt, version: 1,
    }
    const command = {
      id: 'command-2', type: 'session.send' as const, status: 'accepted' as const,
      resourceType: 'turn' as const, resourceId: turn.id, acceptedAt: session.updatedAt,
    }
    const result = { session: updatedSession, message, turn, command }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(result, 202))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendSessionMessage(
      'cosmos', 'space-platform', session.id,
      { content: message.content }, 'send-message-2', { accessToken: 'access-token' },
    )).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/messages',
      expect.objectContaining({ method: 'POST', headers: expect.any(Headers) }),
    )
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ content: message.content }))
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Idempotency-Key')).toBe('send-message-2')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Authorization')).toBe('Bearer access-token')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...result,
      turn: { ...turn, inputMessageId: 'another-message' },
    }, 202))
    await expect(sendSessionMessage(
      'cosmos', 'space-platform', session.id,
      { content: message.content }, 'send-message-invalid',
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 202 })
  })

  it('discovers execution capability only from a strict authenticated response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      execution: { enabled: true, events: 'polling' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getRuntimeCapabilities(
      { accessToken: 'access-token' }, controller.signal,
    )).resolves.toEqual({ execution: { enabled: true, events: 'polling' } })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/capabilities', expect.objectContaining({
      method: 'GET', signal: expect.any(AbortSignal),
    }))
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')

    fetchMock.mockResolvedValueOnce(jsonResponse({ execution: { enabled: 'yes', events: 'polling' } }))
    await expect(getRuntimeCapabilities()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('loads scoped Session messages and base64url-scoped events with recoverable cursors', async () => {
    const eventCursor = {
      organizationId: 'cosmos', spaceId: 'space-platform', sessionId: session.id, sequence: 2,
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(messagePage))
      .mockResolvedValueOnce(jsonResponse(eventPage))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(listSessionMessages(
      'cosmos', 'space-platform', session.id, { accessToken: 'access-token' }, controller.signal,
      { cursor: eventCursor, limit: 100 },
    )).resolves.toEqual(messagePage)
    await expect(listSessionEvents(
      'cosmos', 'space-platform', session.id, { accessToken: 'access-token' }, controller.signal,
      { cursor: eventCursor, limit: 500 },
    )).resolves.toEqual(eventPage)

    const messageUrl = new URL(String(fetchMock.mock.calls[0][0]), window.location.origin)
    expect(messageUrl.pathname).toBe('/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/messages')
    expect(messageUrl.searchParams.get('limit')).toBe('100')
    const encodedMessageCursor = messageUrl.searchParams.get('cursor')!
    const messageBase64 = encodedMessageCursor.replaceAll('-', '+').replaceAll('_', '/')
    expect(JSON.parse(atob(messageBase64.padEnd(Math.ceil(messageBase64.length / 4) * 4, '='))))
      .toEqual(eventCursor)
    const eventUrl = new URL(String(fetchMock.mock.calls[1][0]), window.location.origin)
    expect(eventUrl.pathname).toBe('/api/v1/organizations/cosmos/spaces/space-platform/sessions/session-1/events')
    expect(eventUrl.searchParams.get('limit')).toBe('500')
    const encodedCursor = eventUrl.searchParams.get('cursor')!
    const base64 = encodedCursor.replaceAll('-', '+').replaceAll('_', '/')
    const decodedCursor = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    expect(decodedCursor).toEqual(eventCursor)
  })

  it('rejects a valid timeline page outside the requested scope and routes timeline 401 to auth', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ...messagePage,
        organizationId: 'other-organization',
        items: messagePage.items.map((message) => ({ ...message, organizationId: 'other-organization' })),
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      }, 401)))

    await expect(listSessionMessages('cosmos', 'space-platform', session.id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
    await expect(listSessionEvents('cosmos', 'space-platform', session.id, {
      accessToken: 'expired-token', onUnauthorized,
    })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledWith('expired-token')
  })

  it('rejects a detail response outside the requested tenant scope', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...session, organizationId: 'other-organization',
    })))

    await expect(getSession('cosmos', 'space-platform', 'session-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('shares an in-flight Session list request by non-secret credential identity', async () => {
    const response = { items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt } }
    let resolveResponse!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)

    const first = listSessions('cosmos', 'space-platform', {
      accessToken: 'token-a', requestIdentity: 'credential-7',
    })
    const second = listSessions('cosmos', 'space-platform', {
      accessToken: 'token-b', requestIdentity: 'credential-7',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse(jsonResponse(response))
    await expect(Promise.all([first, second])).resolves.toEqual([response, response])
  })

  it('does not share an in-flight Session list request across actor identities', async () => {
    const response = { items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt } }
    let resolveFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    const first = listSessions('cosmos', 'space-platform', {
      accessToken: 'token-a', requestIdentity: 'actor-a\u00007',
    })
    const second = listSessions('cosmos', 'space-platform', {
      accessToken: 'token-b', requestIdentity: 'actor-b\u00007',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    resolveFirst(jsonResponse(response))
    await expect(Promise.all([first, second])).resolves.toEqual([response, response])
  })

  it('streams scoped Session events with Bearer auth and Last-Event-ID recovery', async () => {
    const event = eventPage.items[0]
    const stream = `id: cursor-42\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\nevent: reconnect\ndata: {}\n\n`
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onEvent = vi.fn()

    await expect(streamSessionEvents(
      'cosmos', 'space-platform', session.id,
      { accessToken: 'access-token' },
      new AbortController().signal,
      { lastEventId: 'cursor-41', onEvent },
    )).resolves.toEqual({ lastEventId: 'cursor-42', reconnect: true })

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token')
    expect(headers.get('Last-Event-ID')).toBe('cursor-41')
    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('rejects an SSE event outside the requested Session scope', async () => {
    const event = { ...eventPage.items[0], sessionId: 'session-other' }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )))

    await expect(streamSessionEvents(
      'cosmos', 'space-platform', session.id, {}, new AbortController().signal,
      { onEvent: vi.fn() },
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 })
  })

  it('parses CRLF event boundaries split across stream chunks', async () => {
    const event = eventPage.items[0]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`id: cursor-42\r\nevent: ${event.type}\r\ndata: ${JSON.stringify(event)}\r`))
        controller.enqueue(encoder.encode('\n\r\nevent: reconnect\r\ndata: {}\r\n\r\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    })))
    const onEvent = vi.fn()

    await expect(streamSessionEvents(
      'cosmos', 'space-platform', session.id, {}, new AbortController().signal, { onEvent },
    )).resolves.toEqual({ lastEventId: 'cursor-42', reconnect: true })
    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('lists Experts with auth and AbortSignal on the tenant-scoped path', async () => {
    const response = {
      items: [expertSummary],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: expertSummary.updatedAt },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(listExperts(
      'cosmos',
      'space-platform',
      { accessToken: 'access-token' },
      controller.signal,
      { cursor: 'cursor value', limit: 25 },
    )).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/experts?cursor=cursor+value&limit=25',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  it('gets one Expert and rejects list or detail responses outside the Workspace scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(expertDetail))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getExpert(
      'cosmos', 'space-platform', expertDetail.id, undefined, controller.signal,
    )).resolves.toEqual(expertDetail)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/experts/expert-pr-author',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [expertSummary, { ...expertSummary, organizationId: 'other-organization' }],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: expertSummary.updatedAt },
    }))
    await expect(listExperts('cosmos', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...expertDetail, spaceId: 'space-other' }))
    await expect(getExpert('cosmos', 'space-platform', expertDetail.id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('lists Environments with auth and AbortSignal on the tenant-scoped path', async () => {
    const response = {
      items: [environmentSummary],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: environmentSummary.updatedAt },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(listEnvironments(
      'cosmos', 'space-platform', { accessToken: 'access-token' }, controller.signal,
    )).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/environments',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  it('gets one Environment and rejects list or detail responses outside the Workspace scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(environmentDetail))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getEnvironment(
      'cosmos', 'space-platform', environmentDetail.id, undefined, controller.signal,
    )).resolves.toEqual(environmentDetail)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/cosmos/spaces/space-platform/environments/environment-platform',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [environmentSummary, { ...environmentSummary, spaceId: 'space-other' }],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: environmentSummary.updatedAt },
    }))
    await expect(listEnvironments('cosmos', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...environmentDetail, organizationId: 'other-organization',
    }))
    await expect(getEnvironment('cosmos', 'space-platform', environmentDetail.id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('lists, scopes, and decides Approvals with concurrency and idempotency headers', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        organizationId: approval.organizationId,
        spaceId: approval.spaceId,
        items: [approval],
        page: { nextCursor: null, hasMore: false },
      }))
      .mockResolvedValueOnce(jsonResponse(approval))
      .mockResolvedValueOnce(jsonResponse({
        ...approval,
        status: 'approved',
        approvalCount: 1,
        decidedBy: 'reviewer-1',
        decisionNote: 'Reviewed.',
        decidedAt: '2026-07-13T02:00:00.000Z',
        updatedAt: '2026-07-13T02:00:00.000Z',
        version: 2,
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listApprovals('cosmos', 'space-platform', {
      status: 'pending', assignedToMe: true, sessionId: session.id, limit: 25,
    })).resolves.toMatchObject({ items: [{ id: approval.id }] })
    await expect(getApproval('cosmos', 'space-platform', approval.id)).resolves.toEqual(approval)
    await expect(decideApproval(
      'cosmos', 'space-platform', approval.id,
      { decision: 'approved', note: 'Reviewed.' }, 1, 'approval-decision-key',
    )).resolves.toMatchObject({ status: 'approved', version: 2 })

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/organizations/cosmos/spaces/space-platform/approvals?limit=25&status=pending&assignedToMe=true&sessionId=${session.id}`,
    )
    const decisionHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers)
    expect(decisionHeaders.get('Idempotency-Key')).toBe('approval-decision-key')
    expect(decisionHeaders.get('If-Match')).toBe('"1"')
  })

  it('lists, reads, decides, and retries Advisor plans with scoped concurrency headers', async () => {
    const executing = {
      ...advisorPlan,
      status: 'executing' as const,
      confirmedBy: 'user-1',
      confirmedAt: '2026-07-12T08:01:00.000Z',
      updatedAt: '2026-07-12T08:01:00.000Z',
      version: 2,
    }
    const failed = {
      ...executing,
      status: 'failed' as const,
      steps: [{
        ...executing.steps[0], status: 'failed' as const,
        failureCode: 'version_conflict', failureMessage: 'Generate a new plan.',
        startedAt: '2026-07-12T08:01:00.000Z', completedAt: '2026-07-12T08:02:00.000Z', version: 3,
      }],
      updatedAt: '2026-07-12T08:02:00.000Z',
      version: 3,
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        organizationId: advisorPlan.organizationId,
        spaceId: advisorPlan.spaceId,
        sessionId: advisorPlan.sessionId,
        items: [advisorPlan],
      }))
      .mockResolvedValueOnce(jsonResponse(advisorPlan))
      .mockResolvedValueOnce(jsonResponse(executing))
      .mockResolvedValueOnce(jsonResponse(failed))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAdvisorPlans('cosmos', 'space-platform', session.id)).resolves.toMatchObject({
      items: [{ id: advisorPlan.id }],
    })
    await expect(getAdvisorPlan('cosmos', 'space-platform', session.id, advisorPlan.id)).resolves.toEqual(advisorPlan)
    await expect(decideAdvisorPlan(
      'cosmos', 'space-platform', session.id, advisorPlan.id,
      { decision: 'confirmed' }, 1, 'advisor-decision-key',
    )).resolves.toMatchObject({ status: 'executing', version: 2 })
    await expect(retryAdvisorPlan(
      'cosmos', 'space-platform', session.id, advisorPlan.id,
      3, 'advisor-retry-key',
    )).resolves.toMatchObject({ status: 'failed', version: 3 })

    const decisionHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers)
    expect(decisionHeaders.get('Idempotency-Key')).toBe('advisor-decision-key')
    expect(decisionHeaders.get('If-Match')).toBe('"1"')
    const retryHeaders = new Headers(fetchMock.mock.calls[3][1]?.headers)
    expect(retryHeaders.get('Idempotency-Key')).toBe('advisor-retry-key')
    expect(retryHeaders.get('If-Match')).toBe('"3"')
  })

  it('discovers the authenticated actor and authorized tenant hierarchy', async () => {
    const me = {
      actor: { id: 'user-production', kind: 'user' as const },
      organizations: [{
        id: 'organization-production', name: 'Production', role: 'member' as const,
        spaces: [{ id: 'space-production', name: 'Production Space', role: 'member' as const }],
      }],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(me))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMe({ accessToken: 'access-token' })).resolves.toEqual(me)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ method: 'GET' }))
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token')
  })

  it('preserves a contract-shaped HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: 'IDEMPOTENCY_KEY_REUSED', message: 'The idempotency key was already used.', retryable: false,
      correlationId: 'request-409',
    }, 409)))
    await expect(createSession('cosmos', 'space-platform', createInput, 'duplicate-key')).rejects.toMatchObject({
      name: 'CosmosApiError', code: 'IDEMPOTENCY_KEY_REUSED', status: 409, correlationId: 'request-409', retryable: false,
    })
  })

  it('notifies the auth boundary when the API returns 401', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      correlationId: 'request-401',
    }, 401)))

    await expect(listSessions('cosmos', 'space-platform', {
      accessToken: 'expired-token', onUnauthorized,
    })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onUnauthorized).toHaveBeenCalledWith('expired-token')
  })

  it('preserves the structured 401 when identity cleanup fails', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      correlationId: 'request-401-cleanup',
    }, 401)))

    await expect(listSessions('cosmos', 'space-platform', {
      accessToken: 'expired-token', onUnauthorized: async () => { throw new Error('storage unavailable') },
    })).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401, correlationId: 'request-401-cleanup',
    })
  })

  it('rejects a successful response that violates the shared schema', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      { items: 'not-an-array', page: {} }, 200, { 'x-request-id': 'request-invalid' },
    )))
    await expect(listSessions('cosmos', 'space-platform')).rejects.toMatchObject({
      name: 'CosmosApiError', code: 'INVALID_RESPONSE', status: 200, correlationId: 'request-invalid',
    })
  })

  it('wraps fetch failures as retryable network errors', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await listSessions('cosmos', 'space-platform').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(CosmosApiError)
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: undefined, correlationId: undefined, retryable: true })
  })
})
