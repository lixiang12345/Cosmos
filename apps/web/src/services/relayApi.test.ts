import type { CreateSessionRequestInput, SessionDto } from '@relay/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayApiError, createSession, getRelayApiBaseUrl, listSessions } from './relayApi'

const createInput: CreateSessionRequestInput = {
  title: 'Fix checkout race condition',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 3,
  environmentId: 'environment-platform',
  repository: 'platform/checkout',
  baseBranch: 'main',
  message: { content: 'Trace the duplicate reservation path and add a regression test.' },
}

const session: SessionDto = {
  id: 'session-1', organizationId: 'relay', spaceId: 'space-platform', title: createInput.title,
  summary: createInput.message.content, expertId: createInput.expertId, expertName: createInput.expertName,
  expertVersion: createInput.expertVersion, environmentId: createInput.environmentId, repository: createInput.repository,
  baseBranch: createInput.baseBranch, visibility: 'private', status: 'active', attachments: [], source: 'manual',
  createdAt: '2026-07-12T08:00:00.000Z', updatedAt: '2026-07-12T08:00:00.000Z',
  lastActivityAt: '2026-07-12T08:00:00.000Z', version: 1,
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Relay API client', () => {
  it('uses the same-origin API by default and trims a configured trailing slash', () => {
    expect(getRelayApiBaseUrl()).toBe('/api')
    vi.stubEnv('VITE_API_BASE_URL', 'https://relay.example/api/')
    expect(getRelayApiBaseUrl()).toBe('https://relay.example/api')
  })

  it('creates a Session with tenant scope and an idempotency key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ session }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createSession('relay', 'space-platform', createInput, 'create-session-1')).resolves.toEqual({ session })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations/relay/spaces/space-platform/sessions',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'create-session-1' }) }),
    )
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

  it('preserves a contract-shaped HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: 'IDEMPOTENCY_KEY_REUSED', message: 'The idempotency key was already used.', retryable: false,
      correlationId: 'request-409',
    }, 409)))
    await expect(createSession('relay', 'space-platform', createInput, 'duplicate-key')).rejects.toMatchObject({
      name: 'RelayApiError', code: 'IDEMPOTENCY_KEY_REUSED', status: 409, correlationId: 'request-409', retryable: false,
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
