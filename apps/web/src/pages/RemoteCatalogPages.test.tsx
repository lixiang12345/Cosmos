import type {
  EnvironmentDefaultRepository,
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
} from '@relay/contracts'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { RelayApiError, getEnvironment, getExpert, type RelayApiAuthContext } from '../services/relayApi'
import {
  RemoteEnvironmentsPage,
  RemoteExpertDetailPage,
  RemoteExpertsPage,
  type RemoteEnvironmentsPageProps,
  type RemoteExpertDetailPageProps,
} from './RemoteCatalogPages'

vi.mock('../services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/relayApi')>(),
  getEnvironment: vi.fn(),
  getExpert: vi.fn(),
}))

const publishedRevision = {
  id: 'expert-revision-2',
  expertId: 'expert-published',
  revision: 2,
  model: 'relay-default',
  environmentId: 'environment-a',
  environmentRevisionId: 'environment-revision-1',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: false,
  status: 'published',
  createdAt: '2026-07-13T08:00:00.000Z',
} as const

const publishedExpert: ExpertSummaryDto = {
  id: 'expert-published',
  organizationId: 'organization-a',
  spaceId: 'space-a',
  name: 'Published Expert',
  description: 'Reviews production changes.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: publishedRevision.id,
  publishedRevisionSummary: publishedRevision,
  version: 3,
  createdAt: '2026-07-13T07:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
}

const draftExpert: ExpertSummaryDto = {
  ...publishedExpert,
  id: 'expert-draft',
  name: 'Draft Expert',
  status: 'draft',
  publishedRevisionId: null,
  publishedRevisionSummary: null,
}

const expertDetail: ExpertDetailDto = {
  ...publishedExpert,
  publishedRevision: {
    ...publishedRevision,
    instructions: 'Inspect the repository and provide verification evidence.',
  },
}

const draftExpertDetail: ExpertDetailDto = {
  ...draftExpert,
  publishedRevision: null,
}

const repositoryA = {
  repositoryId: 'repository-a',
  repository: 'relay/service-a',
  baseBranch: 'main',
  isDefault: true,
} as const

const repositoryB = {
  repositoryId: 'repository-b',
  repository: 'relay/service-b',
  baseBranch: 'release',
  isDefault: true,
} as const

function environmentSummary(
  id: string,
  name: string,
  repository: EnvironmentDefaultRepository,
): EnvironmentSummaryDto {
  return {
    id,
    organizationId: 'organization-a',
    spaceId: 'space-a',
    name,
    description: `${name} description`,
    status: 'ready',
    activeRevisionId: `${id}-revision-1`,
    activeRevision: {
      id: `${id}-revision-1`,
      environmentId: id,
      revision: 1,
      status: 'ready',
      defaultRepository: repository,
      createdAt: '2026-07-13T08:00:00.000Z',
    },
    version: 1,
    createdAt: '2026-07-13T07:00:00.000Z',
    updatedAt: '2026-07-13T08:00:00.000Z',
  }
}

function environmentDetail(summary: EnvironmentSummaryDto): EnvironmentDetailDto {
  if (!summary.activeRevision) throw new Error('Fixture requires an active revision.')
  return {
    ...summary,
    activeRevision: {
      ...summary.activeRevision,
      repositoryBindings: [summary.activeRevision.defaultRepository],
    },
  }
}

const environmentA = environmentSummary('environment-a', 'Environment A', repositoryA)
const environmentB = environmentSummary('environment-b', 'Environment B', repositoryB)

const auth: RelayApiAuthContext = {
  accessToken: 'token-a',
  onUnauthorized: vi.fn(async () => undefined),
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

function withPreferences(node: React.ReactNode) {
  return <PreferencesProvider>{node}</PreferencesProvider>
}

function expertDetailProps(overrides: Partial<RemoteExpertDetailPageProps> = {}): RemoteExpertDetailPageProps {
  return {
    organizationId: 'organization-a',
    spaceId: 'space-a',
    expertId: publishedExpert.id,
    auth,
    credentialVersion: 1,
    onBack: vi.fn(),
    onStartSession: vi.fn(),
    ...overrides,
  }
}

function environmentPageProps(overrides: Partial<RemoteEnvironmentsPageProps> = {}): RemoteEnvironmentsPageProps {
  return {
    items: [environmentA, environmentB],
    loading: false,
    ready: true,
    error: null,
    onRetry: vi.fn(),
    organizationId: 'organization-a',
    spaceId: 'space-a',
    auth,
    credentialVersion: 1,
    ...overrides,
  }
}

describe('remote Catalog pages', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    vi.mocked(getExpert).mockReset()
    vi.mocked(getEnvironment).mockReset()
  })

  it('keeps the Expert list read-only and starts only a published revision', async () => {
    const user = userEvent.setup()
    const onOpenDetail = vi.fn()
    const onStartSession = vi.fn()
    render(withPreferences(
      <RemoteExpertsPage
        items={[publishedExpert, draftExpert]}
        loading={false}
        ready
        error={null}
        onRetry={vi.fn()}
        onOpenDetail={onOpenDetail}
        onStartSession={onStartSession}
      />,
    ))

    expect(screen.getByText('只读')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建专家' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
    const startButtons = screen.getAllByRole('button', { name: '新建会话' })
    expect(startButtons[0]).toBeEnabled()
    expect(startButtons[1]).toBeDisabled()

    await user.click(startButtons[0]!)
    await user.click(screen.getByRole('button', { name: /Published Expert/ }))
    expect(onStartSession).toHaveBeenCalledWith(publishedExpert.id)
    expect(onOpenDetail).toHaveBeenCalledWith(publishedExpert.id)
  })

  it('hides Expert detail immediately and aborts the old request when credentials change', async () => {
    const user = userEvent.setup()
    const next = deferred<ExpertDetailDto>()
    vi.mocked(getExpert).mockResolvedValueOnce(expertDetail).mockReturnValueOnce(next.promise)
    const initialProps = expertDetailProps()
    const view = render(withPreferences(<RemoteExpertDetailPage {...initialProps} />))

    expect(await screen.findByText(expertDetail.publishedRevision!.instructions)).toBeInTheDocument()
    const firstSignal = vi.mocked(getExpert).mock.calls[0]?.[4]
    const nextAuth = { ...auth, accessToken: 'token-b' }
    view.rerender(withPreferences(
      <RemoteExpertDetailPage
        {...initialProps}
        spaceId="space-b"
        auth={nextAuth}
        credentialVersion={2}
      />,
    ))

    expect(firstSignal?.aborted).toBe(true)
    expect(screen.queryByText(expertDetail.publishedRevision!.instructions)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载专家详情')
    expect(getExpert).toHaveBeenLastCalledWith(
      'organization-a', 'space-b', publishedExpert.id,
      expect.objectContaining({ accessToken: 'token-b' }), expect.any(AbortSignal),
    )

    const updatedDetail: ExpertDetailDto = {
      ...expertDetail,
      publishedRevision: {
        ...expertDetail.publishedRevision!,
        instructions: 'Use the rotated credential context.',
      },
    }
    await act(async () => { next.resolve(updatedDetail) })
    expect(await screen.findByText('Use the rotated credential context.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(initialProps.onStartSession).toHaveBeenCalledWith(publishedExpert.id)
  })

  it('renders Expert 404 separately and retries the detail request', async () => {
    const user = userEvent.setup()
    vi.mocked(getExpert)
      .mockRejectedValueOnce(new RelayApiError('Expert does not exist.', { code: 'NOT_FOUND', status: 404 }))
      .mockResolvedValueOnce(draftExpertDetail)
    render(withPreferences(<RemoteExpertDetailPage {...expertDetailProps()} />))

    expect(await screen.findByText('未找到专家')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { level: 2, name: draftExpertDetail.name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建会话' })).not.toBeInTheDocument()
    expect(getExpert).toHaveBeenCalledTimes(2)
  })

  it('aborts stale Environment detail requests when selection and token scope change', async () => {
    const user = userEvent.setup()
    const first = deferred<EnvironmentDetailDto>()
    const second = deferred<EnvironmentDetailDto>()
    const rotated = deferred<EnvironmentDetailDto>()
    vi.mocked(getEnvironment)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(rotated.promise)
    const initialProps = environmentPageProps()
    const view = render(withPreferences(<RemoteEnvironmentsPage {...initialProps} />))

    expect(screen.getByRole('heading', { level: 1, name: '运行环境' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '2 个运行环境' })).toBeInTheDocument()
    await waitFor(() => expect(getEnvironment).toHaveBeenCalledTimes(1))
    const firstSignal = vi.mocked(getEnvironment).mock.calls[0]?.[4]
    const list = screen.getByRole('complementary', { name: '运行环境列表' })
    await user.click(within(list).getByRole('button', { name: /Environment B/ }))
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => { second.resolve(environmentDetail(environmentB)) })
    expect(await screen.findByRole('heading', { name: 'Environment B' })).toBeInTheDocument()
    const secondSignal = vi.mocked(getEnvironment).mock.calls[1]?.[4]
    view.rerender(withPreferences(
      <RemoteEnvironmentsPage
        {...initialProps}
        auth={{ ...auth, accessToken: 'token-b' }}
        credentialVersion={2}
      />,
    ))

    expect(secondSignal?.aborted).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Environment B' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载运行环境详情')

    await act(async () => { rotated.resolve(environmentDetail(environmentB)) })
    expect(await screen.findByRole('heading', { name: 'Environment B' })).toBeInTheDocument()
  })

  it('shows list errors in English without exposing mutation actions', async () => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'en')
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(withPreferences(
      <RemoteExpertsPage
        items={[]}
        loading={false}
        ready={false}
        error={new Error('Catalog unavailable.')}
        onRetry={onRetry}
        onOpenDetail={vi.fn()}
        onStartSession={vi.fn()}
      />,
    ))

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Experts')
    expect(screen.queryByRole('button', { name: /create|edit|publish/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
