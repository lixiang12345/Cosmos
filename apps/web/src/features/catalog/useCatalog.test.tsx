import type {
  EnvironmentListResponse,
  EnvironmentSummaryDto,
  ExpertListResponse,
  ExpertSummaryDto,
} from '@relay/contracts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { listEnvironments, listExperts } from '../../services/relayApi'
import { useCatalog, type CatalogRequestInput } from './useCatalog'

vi.mock('../../services/relayApi', () => ({
  listEnvironments: vi.fn(),
  listExperts: vi.fn(),
}))

const expertRevision = {
  id: 'expert-revision-1',
  expertId: 'expert-platform',
  revision: 1,
  model: 'relay-default',
  environmentId: 'environment-platform',
  environmentRevisionId: 'environment-revision-1',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: true,
  createdAt: '2026-07-13T08:00:00.000Z',
  status: 'published',
} as const

const expert: ExpertSummaryDto = {
  id: 'expert-platform',
  organizationId: 'organization-alpha',
  spaceId: 'space-alpha',
  name: 'Platform Expert',
  description: 'Maintains platform services.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: expertRevision.id,
  publishedRevisionSummary: expertRevision,
  version: 1,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const defaultRepository = {
  repositoryId: 'repository-platform',
  repository: 'relay/platform',
  baseBranch: 'main',
  isDefault: true,
} as const

const environment: EnvironmentSummaryDto = {
  id: 'environment-platform',
  organizationId: 'organization-alpha',
  spaceId: 'space-alpha',
  type: 'cloud',
  name: 'Platform runtime',
  description: 'Isolated platform runtime.',
  visibility: 'space',
  status: 'ready',
  activeRevisionId: 'environment-revision-1',
  activeRevision: {
    id: 'environment-revision-1',
    environmentId: 'environment-platform',
    revision: 1,
    status: 'ready',
    defaultRepository,
    createdAt: '2026-07-13T08:00:00.000Z',
  },
  provisioning: null,
  version: 1,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const expertResponse: ExpertListResponse = {
  items: [expert],
  page: { nextCursor: null, hasMore: false, projectionUpdatedAt: expert.updatedAt },
}

const environmentResponse: EnvironmentListResponse = {
  items: [environment],
  page: { nextCursor: null, hasMore: false, projectionUpdatedAt: environment.updatedAt },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function input(overrides: Partial<CatalogRequestInput> = {}): CatalogRequestInput {
  return {
    organizationId: 'organization-alpha',
    spaceId: 'space-alpha',
    accessToken: 'token-alpha',
    credentialVersion: 1,
    onUnauthorized: vi.fn(async () => undefined),
    enabled: true,
    ...overrides,
  }
}

describe('useCatalog', () => {
  beforeEach(() => {
    vi.mocked(listExperts).mockReset()
    vi.mocked(listEnvironments).mockReset()
  })

  it('loads Experts and Environments in parallel with independent ready states', async () => {
    const experts = deferred<ExpertListResponse>()
    const environments = deferred<EnvironmentListResponse>()
    vi.mocked(listExperts).mockReturnValue(experts.promise)
    vi.mocked(listEnvironments).mockReturnValue(environments.promise)
    const request = input()
    const { result } = renderHook(() => useCatalog(request))

    expect(result.current.experts).toMatchObject({ status: 'loading', loading: true, ready: false, items: [] })
    expect(result.current.environments).toMatchObject({ status: 'loading', loading: true, ready: false, items: [] })
    expect(listExperts).toHaveBeenCalledWith(
      request.organizationId,
      request.spaceId,
      expect.objectContaining({ accessToken: request.accessToken, onUnauthorized: expect.any(Function) }),
      expect.any(AbortSignal),
      { limit: 100 },
    )
    expect(listEnvironments).toHaveBeenCalledTimes(1)

    await act(async () => { experts.resolve(expertResponse) })
    await waitFor(() => expect(result.current.experts.status).toBe('ready'))
    expect(result.current.experts.items).toEqual([expert])
    expect(result.current.environments.status).toBe('loading')

    await act(async () => { environments.resolve(environmentResponse) })
    await waitFor(() => expect(result.current.environments.status).toBe('ready'))
    expect(result.current.environments.items).toEqual([environment])
  })

  it('follows opaque cursors and de-duplicates Catalog resources', async () => {
    const nextExpert = {
      ...expert,
      id: 'expert-platform-reviewer',
      name: 'Platform Reviewer',
      publishedRevisionId: 'expert-revision-2',
      publishedRevisionSummary: {
        ...expertRevision,
        id: 'expert-revision-2',
        expertId: 'expert-platform-reviewer',
        revision: 2,
      },
    }
    vi.mocked(listExperts)
      .mockResolvedValueOnce({
        items: [expert],
        page: { nextCursor: 'expert-cursor-1', hasMore: true, projectionUpdatedAt: expert.updatedAt },
      })
      .mockResolvedValueOnce({
        items: [expert, nextExpert],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: nextExpert.updatedAt },
      })
    vi.mocked(listEnvironments).mockResolvedValue(environmentResponse)

    const request = input()
    const { result } = renderHook(() => useCatalog(request))

    await waitFor(() => expect(result.current.experts.status).toBe('ready'))
    expect(result.current.experts.items.map((item) => item.id)).toEqual([
      'expert-platform',
      'expert-platform-reviewer',
    ])
    expect(listExperts).toHaveBeenNthCalledWith(
      2,
      'organization-alpha',
      'space-alpha',
      expect.any(Object),
      expect.any(AbortSignal),
      { limit: 100, cursor: 'expert-cursor-1' },
    )
  })

  it('exposes an error and retries only the failed resource', async () => {
    vi.mocked(listExperts)
      .mockRejectedValueOnce(new Error('Expert Catalog unavailable.'))
      .mockResolvedValueOnce(expertResponse)
    vi.mocked(listEnvironments).mockResolvedValue(environmentResponse)
    const request = input()
    const { result } = renderHook(() => useCatalog(request))

    await waitFor(() => expect(result.current.experts.status).toBe('error'))
    expect(result.current.experts.items).toEqual([])
    expect(result.current.experts.error?.message).toBe('Expert Catalog unavailable.')
    expect(result.current.environments.status).toBe('ready')

    act(() => { result.current.experts.retry() })
    expect(result.current.experts).toMatchObject({ status: 'loading', items: [] })
    await waitFor(() => expect(result.current.experts.status).toBe('ready'))
    expect(result.current.experts.items).toEqual([expert])
    expect(listExperts).toHaveBeenCalledTimes(2)
    expect(listEnvironments).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Space', { spaceId: 'space-beta' }],
    ['access token', { accessToken: 'token-beta' }],
    ['credential version', { credentialVersion: 2 }],
  ] as const)('hides old snapshots and aborts requests on %s changes', async (_label, change) => {
    const nextExperts = deferred<ExpertListResponse>()
    const nextEnvironments = deferred<EnvironmentListResponse>()
    vi.mocked(listExperts).mockResolvedValueOnce(expertResponse).mockReturnValueOnce(nextExperts.promise)
    vi.mocked(listEnvironments).mockResolvedValueOnce(environmentResponse).mockReturnValueOnce(nextEnvironments.promise)
    const initial = input()
    const { result, rerender } = renderHook(
      (request: CatalogRequestInput) => useCatalog(request),
      { initialProps: initial },
    )
    await waitFor(() => expect(result.current.experts.status).toBe('ready'))
    await waitFor(() => expect(result.current.environments.status).toBe('ready'))
    const expertSignal = vi.mocked(listExperts).mock.calls[0]?.[3]
    const environmentSignal = vi.mocked(listEnvironments).mock.calls[0]?.[3]

    rerender({ ...initial, ...change })

    expect(result.current.experts).toMatchObject({ status: 'loading', items: [] })
    expect(result.current.environments).toMatchObject({ status: 'loading', items: [] })
    expect(expertSignal?.aborted).toBe(true)
    expect(environmentSignal?.aborted).toBe(true)
    expect(listExperts).toHaveBeenCalledTimes(2)
    expect(listEnvironments).toHaveBeenCalledTimes(2)
  })

  it('clears items when a 401 invokes the unauthorized boundary', async () => {
    const onUnauthorized = vi.fn(async () => undefined)
    vi.mocked(listExperts)
      .mockResolvedValueOnce(expertResponse)
      .mockImplementationOnce(async (_organizationId, _spaceId, auth) => {
        await auth?.onUnauthorized?.(auth.accessToken)
        throw Object.assign(new Error('Sign in again.'), { status: 401 })
      })
    vi.mocked(listEnvironments).mockResolvedValue(environmentResponse)
    const { result } = renderHook(() => useCatalog(input({ onUnauthorized })))
    await waitFor(() => expect(result.current.experts.status).toBe('ready'))

    act(() => { result.current.experts.retry() })
    expect(result.current.experts.items).toEqual([])
    await waitFor(() => expect(result.current.experts.status).toBe('idle'))
    expect(result.current.experts.items).toEqual([])
    expect(result.current.environments.items).toEqual([])
    expect(onUnauthorized).toHaveBeenCalledWith('token-alpha')
  })

  it('does not request remote Catalog data while disabled', () => {
    const { result } = renderHook(() => useCatalog(input({ enabled: false })))

    expect(result.current.experts).toMatchObject({ status: 'idle', loading: false, ready: false, items: [] })
    expect(result.current.environments).toMatchObject({ status: 'idle', loading: false, ready: false, items: [] })
    act(() => { result.current.experts.retry(); result.current.environments.retry() })
    expect(listExperts).not.toHaveBeenCalled()
    expect(listEnvironments).not.toHaveBeenCalled()
  })
})
