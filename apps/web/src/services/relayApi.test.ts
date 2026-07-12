import type {
  CreateSessionRequestInput,
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
  SessionDto,
} from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RelayApiError,
  RELAY_API_TIMEOUT_MS,
  createSession,
  getEnvironment,
  getExpert,
  getMe,
  getSession,
  getRelayApiBaseUrl,
  listEnvironments,
  listExperts,
  listSessions,
  resolveRelayApiBaseUrl,
  resolveRelayApiRequestUrl,
} from './relayApi'

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
  id: 'session-1', organizationId: 'relay', spaceId: 'space-platform', title: createInput.title,
  summary: createInput.message.content, expertId: createInput.expertId, expertName: createInput.expertName,
  expertVersion: createInput.expertVersion, environmentId: createInput.environmentId, repository: createInput.repository,
  configurationResolutionVersion: 1, expertRevisionId: 'expert-revision-3',
  environmentRevisionId: 'environment-revision-1', repositoryId: 'repository-checkout',
  baseBranch: createInput.baseBranch, visibility: 'private', status: 'active', attachments: [], source: 'manual',
  createdAt: '2026-07-12T08:00:00.000Z', updatedAt: '2026-07-12T08:00:00.000Z',
  lastActivityAt: '2026-07-12T08:00:00.000Z', version: 1,
}

const expertRevisionSummary = {
  id: 'expert-revision-3',
  expertId: 'expert-pr-author',
  revision: 3,
  model: 'relay-default',
  environmentId: 'environment-platform',
  environmentRevisionId: 'environment-revision-1',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: true,
  createdAt: '2026-07-13T08:00:00.000Z',
  status: 'published',
} as const

const expertSummary: ExpertSummaryDto = {
  id: 'expert-pr-author',
  organizationId: 'relay',
  spaceId: 'space-platform',
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
  },
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
  organizationId: 'relay',
  spaceId: 'space-platform',
  name: 'Platform runtime',
  description: 'Isolated runtime for platform repositories.',
  status: 'ready',
  activeRevisionId: environmentRevisionSummary.id,
  activeRevision: environmentRevisionSummary,
  version: 1,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const environmentDetail: EnvironmentDetailDto = {
  ...environmentSummary,
  activeRevision: {
    ...environmentRevisionSummary,
    repositoryBindings: [defaultRepository],
  },
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

describe('Relay API client', () => {
  it('uses the same-origin API by default', () => {
    expect(getRelayApiBaseUrl()).toBe('/api')
    expect(resolveRelayApiBaseUrl(
      'https://relay.example/api/', 'https://relay.example', undefined,
    )).toBe('https://relay.example/api')
  })

  it('allows only explicitly trusted HTTPS cross-origin APIs', () => {
    expect(resolveRelayApiBaseUrl(
      'https://api.relay.example/v1/',
      'https://app.relay.example',
      'https://identity.example, https://api.relay.example',
    )).toBe('https://api.relay.example/v1')
    expect(() => resolveRelayApiBaseUrl(
      'https://api.relay.example/v1', 'https://app.relay.example', undefined,
    )).toThrow(expect.objectContaining({ code: 'API_ORIGIN_NOT_ALLOWED' }))
    expect(() => resolveRelayApiBaseUrl(
      'http://api.relay.example/v1', 'https://app.relay.example', 'http://api.relay.example',
    )).toThrow(expect.objectContaining({ code: 'API_ORIGIN_NOT_ALLOWED' }))
  })

  it('rejects an untrusted API origin before calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_BASE_URL', 'https://untrusted.example/api')
    await expect(listSessions('relay', 'space-platform', { accessToken: 'secret' }))
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
    await expect(listSessions('relay', 'space-platform', { accessToken: 'secret' }))
      .rejects.toMatchObject({ code: 'API_CONFIGURATION_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a root-only API base on the application origin', () => {
    expect(resolveRelayApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: '/', applicationOrigin: 'https://app.relay.example',
    })).toBe('/v1/sessions')
  })

  it('joins absolute root API bases without a double slash', () => {
    expect(resolveRelayApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: 'https://app.relay.example/', applicationOrigin: 'https://app.relay.example',
    })).toBe('https://app.relay.example/v1/sessions')
    expect(resolveRelayApiRequestUrl('/v1/sessions', {
      configuredBaseUrl: 'https://api.relay.example/',
      applicationOrigin: 'https://app.relay.example',
      allowedOrigins: 'https://api.relay.example',
    })).toBe('https://api.relay.example/v1/sessions')
  })

  it.each([
    'https://user:password@api.relay.example/api',
    'https://api.relay.example/api?target=other',
    'https://api.relay.example/api#fragment',
  ])('rejects unsafe absolute API configuration: %s', (baseUrl) => {
    expect(() => resolveRelayApiBaseUrl(
      baseUrl, 'https://app.relay.example', 'https://api.relay.example',
    )).toThrow(expect.objectContaining({ code: 'API_CONFIGURATION_ERROR' }))
  })

  it('creates a Session with tenant scope and an idempotency key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ session }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createSession(
      'relay', 'space-platform', createInput, 'create-session-1', { accessToken: 'access-token' },
    )).resolves.toEqual({ session })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/sessions',
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

    await expect(listSessions('relay', 'space-platform')).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/sessions',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('times out a stalled request with a retryable error', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))

    const pending = listSessions('relay', 'space-timeout')
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: true,
    })
    expect(timeoutSpy).toHaveBeenCalledWith(RELAY_API_TIMEOUT_MS)
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

    const pending = listSessions('relay', 'space-slow-body')
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

    await expect(listSessions('relay', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('gets one Session from its tenant-scoped canonical path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session, 200, {
      ETag: '"1"',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSession('relay', 'space-platform', 'session-1', {
      accessToken: 'access-token',
    })).resolves.toEqual(session)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/sessions/session-1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('rejects a detail response outside the requested tenant scope', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      ...session, organizationId: 'other-organization',
    })))

    await expect(getSession('relay', 'space-platform', 'session-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('shares an in-flight Session list request for the same token and scope', async () => {
    const response = { items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt } }
    let resolveResponse!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)

    const first = listSessions('relay', 'space-platform', { accessToken: 'same-token' })
    const second = listSessions('relay', 'space-platform', { accessToken: 'same-token' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse(jsonResponse(response))
    await expect(Promise.all([first, second])).resolves.toEqual([response, response])
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
      'relay',
      'space-platform',
      { accessToken: 'access-token' },
      controller.signal,
      { cursor: 'cursor value', limit: 25 },
    )).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/experts?cursor=cursor+value&limit=25',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  it('gets one Expert and rejects list or detail responses outside the Workspace scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(expertDetail))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getExpert(
      'relay', 'space-platform', expertDetail.id, undefined, controller.signal,
    )).resolves.toEqual(expertDetail)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/experts/expert-pr-author',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [expertSummary, { ...expertSummary, organizationId: 'other-organization' }],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: expertSummary.updatedAt },
    }))
    await expect(listExperts('relay', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...expertDetail, spaceId: 'space-other' }))
    await expect(getExpert('relay', 'space-platform', expertDetail.id)).rejects.toMatchObject({
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
      'relay', 'space-platform', { accessToken: 'access-token' }, controller.signal,
    )).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/environments',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer access-token')
  })

  it('gets one Environment and rejects list or detail responses outside the Workspace scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(environmentDetail))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(getEnvironment(
      'relay', 'space-platform', environmentDetail.id, undefined, controller.signal,
    )).resolves.toEqual(environmentDetail)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/environments/environment-platform',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [environmentSummary, { ...environmentSummary, spaceId: 'space-other' }],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: environmentSummary.updatedAt },
    }))
    await expect(listEnvironments('relay', 'space-platform')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...environmentDetail, organizationId: 'other-organization',
    }))
    await expect(getEnvironment('relay', 'space-platform', environmentDetail.id)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 200,
    })
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
    await expect(createSession('relay', 'space-platform', createInput, 'duplicate-key')).rejects.toMatchObject({
      name: 'RelayApiError', code: 'IDEMPOTENCY_KEY_REUSED', status: 409, correlationId: 'request-409', retryable: false,
    })
  })

  it('notifies the auth boundary when the API returns 401', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      correlationId: 'request-401',
    }, 401)))

    await expect(listSessions('relay', 'space-platform', {
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

    await expect(listSessions('relay', 'space-platform', {
      accessToken: 'expired-token', onUnauthorized: async () => { throw new Error('storage unavailable') },
    })).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401, correlationId: 'request-401-cleanup',
    })
  })

  it('rejects a successful response that violates the shared schema', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
      { items: 'not-an-array', page: {} }, 200, { 'x-request-id': 'request-invalid' },
    )))
    await expect(listSessions('relay', 'space-platform')).rejects.toMatchObject({
      name: 'RelayApiError', code: 'INVALID_RESPONSE', status: 200, correlationId: 'request-invalid',
    })
  })

  it('wraps fetch failures as retryable network errors', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await listSessions('relay', 'space-platform').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(RelayApiError)
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: undefined, correlationId: undefined, retryable: true })
  })
})
