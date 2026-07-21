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
import {
  RelayApiError,
  createExpert,
  getEnvironment,
  getExpert,
  listExpertRevisions,
  publishExpert,
  updateExpert,
  type RelayApiAuthContext,
} from '../services/relayApi'
import {
  RemoteEnvironmentsPage,
  RemoteExpertDetailPage,
  RemoteExpertEditorPage,
  RemoteExpertsPage,
  type RemoteEnvironmentsPageProps,
  type RemoteExpertDetailPageProps,
} from './RemoteCatalogPages'

vi.mock('../services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/relayApi')>(),
  getEnvironment: vi.fn(),
  getExpert: vi.fn(),
  createExpert: vi.fn(),
  updateExpert: vi.fn(),
  publishExpert: vi.fn(),
  listExpertRevisions: vi.fn(),
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
    capabilities: ['code-search', 'read-code', 'git'],
    launchGuidance: 'Describe the change to review and the acceptance criteria.',
  },
  draftRevisionId: null,
  draftRevision: null,
}

const draftExpertDetail: ExpertDetailDto = {
  ...draftExpert,
  publishedRevision: null,
  draftRevisionId: null,
  draftRevision: null,
}

const createdExpertDetail: ExpertDetailDto = {
  ...draftExpertDetail,
  id: 'expert-created',
  name: 'Release Expert',
  version: 1,
  draftRevisionId: 'expert-created-revision-1',
  draftRevision: {
    id: 'expert-created-revision-1',
    expertId: 'expert-created',
    revision: 1,
    status: 'draft',
    model: 'gpt-5.6-sol',
    environmentId: 'environment-a',
    environmentRevisionId: 'environment-a-revision-1',
    allowRepositoryOverride: true,
    allowBaseBranchOverride: true,
    instructions: 'Prepare a verified release.',
    capabilities: ['code-search', 'read-code', 'git'],
    launchGuidance: '',
    createdAt: '2026-07-13T09:00:00.000Z',
  },
}

const publishedCreatedExpertDetail: ExpertDetailDto = {
  ...createdExpertDetail,
  status: 'published',
  publishedRevisionId: createdExpertDetail.draftRevisionId,
  publishedRevisionSummary: {
    id: createdExpertDetail.draftRevision!.id,
    expertId: createdExpertDetail.id,
    revision: 1,
    status: 'published',
    model: createdExpertDetail.draftRevision!.model,
    environmentId: createdExpertDetail.draftRevision!.environmentId,
    environmentRevisionId: createdExpertDetail.draftRevision!.environmentRevisionId,
    allowRepositoryOverride: createdExpertDetail.draftRevision!.allowRepositoryOverride,
    allowBaseBranchOverride: createdExpertDetail.draftRevision!.allowBaseBranchOverride,
    createdAt: createdExpertDetail.draftRevision!.createdAt,
  },
  publishedRevision: {
    ...createdExpertDetail.draftRevision!,
    status: 'published',
  },
  draftRevisionId: null,
  draftRevision: null,
  version: 2,
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
    vi.mocked(createExpert).mockReset()
    vi.mocked(updateExpert).mockReset()
    vi.mocked(publishExpert).mockReset()
    vi.mocked(listExpertRevisions).mockReset()
    vi.mocked(listExpertRevisions).mockResolvedValue({ items: [] })
  })

  it('shows management only to authorized callers and starts only a published revision', async () => {
    const user = userEvent.setup()
    const onOpenDetail = vi.fn()
    const onStartSession = vi.fn()
    const onCreate = vi.fn()
    const view = render(withPreferences(
      <RemoteExpertsPage
        items={[publishedExpert, draftExpert]}
        loading={false}
        ready
        error={null}
        onRetry={vi.fn()}
        onOpenDetail={onOpenDetail}
        onStartSession={onStartSession}
        onCreate={onCreate}
      />,
    ))

    expect(screen.queryByRole('button', { name: '新建 Expert' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
    const startButtons = screen.getAllByRole('button', { name: '新建会话' })
    expect(startButtons[0]).toBeEnabled()
    expect(startButtons[1]).toBeDisabled()

    await user.click(startButtons[0]!)
    await user.click(screen.getByRole('button', { name: /Published Expert/ }))
    expect(onStartSession).toHaveBeenCalledWith(publishedExpert.id)
    expect(onOpenDetail).toHaveBeenCalledWith(publishedExpert.id)

    view.rerender(withPreferences(
      <RemoteExpertsPage
        items={[publishedExpert, draftExpert]}
        loading={false}
        ready
        error={null}
        onRetry={vi.fn()}
        onOpenDetail={onOpenDetail}
        onStartSession={onStartSession}
        canManage
        onCreate={onCreate}
      />,
    ))
    await user.click(screen.getByRole('button', { name: '新建 Expert' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('creates and publishes an Expert from the production editor', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onCatalogChange = vi.fn()
    vi.mocked(createExpert).mockResolvedValue(createdExpertDetail)
    vi.mocked(publishExpert).mockResolvedValue(publishedCreatedExpertDetail)

    render(withPreferences(
      <RemoteExpertEditorPage
        organizationId="organization-a"
        spaceId="space-a"
        environments={[environmentA]}
        auth={auth}
        credentialVersion={1}
        onBack={vi.fn()}
        onCreated={onCreated}
        onArchived={vi.fn()}
        onCatalogChange={onCatalogChange}
      />,
    ))

    await user.type(screen.getByRole('textbox', { name: '名称' }), 'Release Expert')
    await user.type(screen.getByRole('textbox', { name: '系统指令' }), 'Prepare a verified release.')
    await user.click(screen.getByRole('button', { name: '发布' }))

    await waitFor(() => expect(createExpert).toHaveBeenCalledTimes(1))
    expect(createExpert).toHaveBeenCalledWith(
      'organization-a',
      'space-a',
      expect.objectContaining({
        name: 'Release Expert',
        instructions: 'Prepare a verified release.',
        environmentId: environmentA.id,
        environmentRevisionId: environmentA.activeRevisionId,
      }),
      expect.any(String),
      expect.objectContaining({ accessToken: 'token-a' }),
    )
    expect(publishExpert).toHaveBeenCalledWith(
      'organization-a', 'space-a', createdExpertDetail.id, createdExpertDetail.version,
      expect.any(String), expect.objectContaining({ accessToken: 'token-a' }),
    )
    expect(onCreated).toHaveBeenCalledWith(createdExpertDetail.id)
    expect(onCatalogChange).toHaveBeenCalledTimes(1)
  })

  it('offers a reload after an Expert version conflict', async () => {
    const user = userEvent.setup()
    vi.mocked(getExpert).mockResolvedValue(expertDetail)
    vi.mocked(updateExpert).mockRejectedValue(new RelayApiError('Expert changed elsewhere.', {
      code: 'PRECONDITION_FAILED',
      status: 412,
    }))

    render(withPreferences(
      <RemoteExpertEditorPage
        organizationId="organization-a"
        spaceId="space-a"
        expertId={expertDetail.id}
        environments={[environmentA]}
        auth={auth}
        credentialVersion={1}
        onBack={vi.fn()}
        onCreated={vi.fn()}
        onArchived={vi.fn()}
        onCatalogChange={vi.fn()}
      />,
    ))

    const name = await screen.findByRole('textbox', { name: '名称' })
    await user.clear(name)
    await user.type(name, 'Updated Expert')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Expert changed elsewhere.')
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(getExpert).toHaveBeenCalledTimes(2))
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
