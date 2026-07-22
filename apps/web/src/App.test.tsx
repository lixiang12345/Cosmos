import type {
  CreateSessionRequestInput,
  EnvironmentDetailDto,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertSummaryDto,
  MeResponse,
  OrganizationRole,
  SessionDto,
  SpaceRole,
} from '@cosmos/contracts'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AuthContext, type AuthContextValue } from './auth/context'
import { initialRuns } from './data/mockData'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from './preferences'
import {
  CosmosApiError,
  archiveSession,
  cancelSession,
  createSession,
  getEnvironment,
  getExpert,
  getRuntimeCapabilities,
  getSession,
  listEnvironments,
  listExperts,
  listFiles,
  listSessionEvents,
  listSessionMessages,
  listSessionWorkers,
  listSessions,
  pauseSession,
  renameSession,
  resumeSession,
  sendSessionMessage,
  restoreSession,
  retrySessionTurn,
  startSession,
} from './services/cosmosApi'
import { WorkspaceContext, type WorkspaceContextValue } from './workspace'

vi.mock('./services/cosmosApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('./services/cosmosApi')>(),
  archiveSession: vi.fn(),
  cancelSession: vi.fn(),
  createSession: vi.fn(),
  getEnvironment: vi.fn(),
  getExpert: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  getSession: vi.fn(),
  listEnvironments: vi.fn(),
  listExperts: vi.fn(),
  listFiles: vi.fn(),
  listSessionEvents: vi.fn(),
  listSessionMessages: vi.fn(),
  listSessionWorkers: vi.fn(),
  listSessions: vi.fn(),
  pauseSession: vi.fn(),
  renameSession: vi.fn(),
  resumeSession: vi.fn(),
  sendSessionMessage: vi.fn(),
  restoreSession: vi.fn(),
  retrySessionTurn: vi.fn(),
  startSession: vi.fn(),
}))

const API_TIMESTAMP = '2026-07-12T04:30:00.000Z'

const productionDefaultRepository = {
  repositoryId: 'repository-production',
  repository: 'production/platform',
  baseBranch: 'main',
  isDefault: true as const,
}

const productionEnvironment: EnvironmentSummaryDto = {
  id: 'environment-production',
  organizationId: 'organization-production',
  spaceId: 'space-production',
  type: 'cloud',
  name: 'Production runtime',
  description: 'Production execution environment.',
  visibility: 'space',
  status: 'ready',
  activeRevisionId: 'environment-revision-production',
  activeRevision: {
    id: 'environment-revision-production',
    environmentId: 'environment-production',
    revision: 3,
    status: 'ready',
    defaultRepository: productionDefaultRepository,
    createdAt: '2026-07-12T04:00:00.000Z',
  },
  provisioning: null,
  version: 2,
  createdAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T04:00:00.000Z',
}

const productionEnvironmentDetail: EnvironmentDetailDto = {
  ...productionEnvironment,
  activeRevision: {
    ...productionEnvironment.activeRevision!,
    repositoryBindings: [productionDefaultRepository],
    image: 'ghcr.io/cosmos/runtime:stable',
    variableReferences: [],
    hooks: [],
    networkPolicy: { mode: 'restricted', allowedHosts: [] },
    sharing: 'space',
    daemonPoolId: null,
    checksum: 'a'.repeat(64),
  },
  latestRevision: {
    id: 'environment-revision-production', environmentId: 'environment-production', revision: 3,
    status: 'ready', repositoryBindings: [productionDefaultRepository],
    image: 'ghcr.io/cosmos/runtime:stable', variableReferences: [], hooks: [],
    networkPolicy: { mode: 'restricted', allowedHosts: [] }, sharing: 'space', daemonPoolId: null,
    checksum: 'a'.repeat(64), createdAt: '2026-07-12T04:00:00.000Z',
  },
  provisioningHistory: [],
}

const productionExpert: ExpertSummaryDto = {
  id: 'expert-production',
  organizationId: 'organization-production',
  spaceId: 'space-production',
  kind: 'custom',
  name: 'Production Expert',
  description: 'Implements production changes with verification.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: 'expert-revision-production',
  publishedRevisionSummary: {
    id: 'expert-revision-production',
    expertId: 'expert-production',
    revision: 5,
    status: 'published',
    model: 'cosmos-production',
    environmentId: productionEnvironment.id,
    environmentRevisionId: productionEnvironment.activeRevisionId!,
    allowRepositoryOverride: false,
    allowBaseBranchOverride: false,
    createdAt: '2026-07-12T04:00:00.000Z',
  },
  version: 4,
  createdAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T04:00:00.000Z',
}

const productionExpertDetail: ExpertDetailDto = {
  ...productionExpert,
  publishedRevision: {
    ...productionExpert.publishedRevisionSummary!,
    instructions: 'Implement only the requested change and verify the result.',
    capabilities: ['code-search', 'read-code', 'git'],
    launchGuidance: 'Describe the requested production change and the expected verification.',
  },
  draftRevisionId: null,
  draftRevision: null,
}

function makeApiSession(
  organizationId: string,
  spaceId: string,
  input: CreateSessionRequestInput,
  overrides: Partial<SessionDto> = {},
): SessionDto {
  return {
    id: 'session-api-1',
    organizationId,
    spaceId,
    title: input.title,
    summary: input.message.content,
    expertId: input.expertId,
    expertName: input.expertName ?? 'Authoritative Expert',
    expertVersion: input.expertVersion,
    environmentId: input.environmentId ?? 'environment-authoritative',
    configurationResolutionVersion: 1,
    expertRevisionId: 'expert-revision-authoritative',
    environmentRevisionId: 'environment-revision-authoritative',
    executionSnapshotId: 'execution-snapshot-authoritative',
    repositoryId: input.advancedOverrides?.repositoryId ?? 'repository-authoritative',
    repository: input.repository ?? 'authoritative/repository',
    baseBranch: input.advancedOverrides?.baseBranch ?? input.baseBranch ?? 'main',
    visibility: input.visibility ?? 'private',
    status: input.start === false ? 'draft' : 'queued',
    attachments: input.message.attachments ?? [],
    source: 'manual',
    createdAt: API_TIMESTAMP,
    updatedAt: API_TIMESTAMP,
    lastActivityAt: API_TIMESTAMP,
    archivedAt: null,
    version: 1,
    ...overrides,
  }
}

function renderApp(route = '/runs/run-482') {
  const me: MeResponse = {
    actor: { id: 'user-local-admin', kind: 'user' },
    organizations: [{
      id: 'cosmos', name: 'Cosmos', role: 'organization_owner',
      spaces: [
        { id: 'space-commerce', name: 'Commerce Engineering', role: 'space_manager' },
        { id: 'space-platform', name: 'Platform Engineering', role: 'space_manager' },
      ],
    }],
  }
  const workspace: WorkspaceContextValue = {
    status: 'ready', me,
    activeOrganization: me.organizations[0],
    activeSpace: me.organizations[0].spaces[0],
    selectSpace: () => undefined,
    refresh: () => undefined,
  }
  return render(
    <PreferencesProvider>
      <AuthProvider>
        <WorkspaceContext.Provider value={workspace}>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </PreferencesProvider>
  )
}

type WorkspaceRoles = {
  organizationRole?: OrganizationRole
  spaceRole?: SpaceRole
}

function authenticatedAppTree(route: string, auth: AuthContextValue, roles: WorkspaceRoles = {}) {
  const me: MeResponse = {
    actor: { id: auth.actorId ?? 'user-production', kind: 'user' },
    organizations: [{
      id: 'organization-production', name: 'Production', role: roles.organizationRole ?? 'member',
      spaces: [{ id: 'space-production', name: 'Production Space', role: roles.spaceRole ?? 'member' }],
    }],
  }
  const workspace: WorkspaceContextValue = {
    status: 'ready', me,
    activeOrganization: me.organizations[0],
    activeSpace: me.organizations[0].spaces[0],
    selectSpace: () => undefined,
    refresh: () => undefined,
  }
  return (
    <PreferencesProvider>
      <AuthContext.Provider value={auth}>
        <WorkspaceContext.Provider value={workspace}>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </PreferencesProvider>
  )
}

function renderAuthenticatedApp(
  route: string,
  overrides: Partial<AuthContextValue> = {},
  roles: WorkspaceRoles = {},
) {
  let auth: AuthContextValue = {
    status: 'authenticated',
    mode: 'oidc',
    actorId: 'user-production',
    displayName: 'Production User',
    demoMode: false,
    accessToken: 'production-access-token',
    credentialVersion: 1,
    handleUnauthorized: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
    ...overrides,
  }
  const result = render(authenticatedAppTree(route, auth, roles))
  return {
    ...result,
    rerenderAuth(next: Partial<AuthContextValue>) {
      auth = { ...auth, ...next }
      result.rerender(authenticatedAppTree(route, auth, roles))
    },
  }
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

async function openTemplateLibrary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: /工作流模板/ }))
}

async function forkTemplate(user: ReturnType<typeof userEvent.setup>, templateName: string) {
  await openTemplateLibrary(user)
  const search = screen.getByRole('textbox', { name: '搜索工作流名称或能力' })
  await user.type(search, templateName)
  expect(screen.getByRole('heading', { name: templateName })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '基于模板创建' }))
  await screen.findByRole('textbox', { name: '显示名称' })
}

afterEach(() => vi.useRealTimers())

describe('Cosmos prototype', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    window.localStorage.setItem('cosmos.sidebarCollapsed', 'false')
    window.localStorage.removeItem('cosmos.sessions')
    window.localStorage.removeItem('cosmos.demo.sessions')
    window.localStorage.removeItem('cosmos.experts')
    window.localStorage.removeItem('cosmos.controlPlane.v1')
    vi.mocked(archiveSession).mockReset()
    vi.mocked(cancelSession).mockReset()
    vi.mocked(createSession).mockReset()
    vi.mocked(getEnvironment).mockReset()
    vi.mocked(getExpert).mockReset()
    vi.mocked(getRuntimeCapabilities).mockReset()
    vi.mocked(getSession).mockReset()
    vi.mocked(listEnvironments).mockReset()
    vi.mocked(listExperts).mockReset()
    vi.mocked(listFiles).mockReset()
    vi.mocked(listSessionEvents).mockReset()
    vi.mocked(listSessionMessages).mockReset()
    vi.mocked(listSessionWorkers).mockReset()
    vi.mocked(listSessions).mockReset()
    vi.mocked(pauseSession).mockReset()
    vi.mocked(renameSession).mockReset()
    vi.mocked(resumeSession).mockReset()
    vi.mocked(restoreSession).mockReset()
    vi.mocked(retrySessionTurn).mockReset()
    vi.mocked(sendSessionMessage).mockReset()
    vi.mocked(startSession).mockReset()
    vi.mocked(listSessions).mockResolvedValue({
      items: [], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null },
    })
    vi.mocked(createSession).mockImplementation(async (organizationId, spaceId, input) => ({
      session: makeApiSession(organizationId, spaceId, input),
    }))
    vi.mocked(getRuntimeCapabilities).mockResolvedValue({
      execution: { enabled: false, events: 'polling' },
    })
    vi.mocked(listSessionMessages).mockImplementation(async (organizationId, spaceId, sessionId) => ({
      organizationId,
      spaceId,
      sessionId,
      items: [],
      page: { nextCursor: null, hasMore: false },
    }))
    vi.mocked(listSessionEvents).mockImplementation(async (organizationId, spaceId, sessionId) => ({
      organizationId,
      spaceId,
      sessionId,
      items: [],
      page: { nextCursor: null, hasMore: false },
    }))
    vi.mocked(listSessionWorkers).mockImplementation(async (organizationId, spaceId, sessionId) => ({
      organizationId,
      spaceId,
      sessionId,
      items: [],
      page: { nextCursor: null, hasMore: false },
    }))
    vi.mocked(listExperts).mockResolvedValue({
      items: [productionExpert],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: productionExpert.updatedAt },
    })
    vi.mocked(getExpert).mockResolvedValue(productionExpertDetail)
    vi.mocked(listEnvironments).mockResolvedValue({
      items: [productionEnvironment],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: productionEnvironment.updatedAt },
    })
    vi.mocked(getEnvironment).mockResolvedValue(productionEnvironmentDetail)
    vi.mocked(listFiles).mockImplementation(async (organizationId, spaceId, options) => ({
      organizationId,
      requestedSpaceId: spaceId,
      scope: options.scope,
      ownerUserId: options.scope === 'user' ? 'user-production' : null,
      sessionId: options.scope === 'workspace' ? (options.sessionId ?? null) : null,
      items: [],
      page: { nextCursor: null, hasMore: false },
    }))
  })

  it('uses Home as the Expert launcher without adding a sidebar Home item', async () => {
    renderApp('/home')

    expect(await screen.findByRole('heading', { level: 1, name: '选择 Expert，开始一个会话' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '首页' })).not.toBeInTheDocument()
  })

  it('exposes only production-backed resources in the production sidebar', async () => {
    renderAuthenticatedApp('/context')

    expect(await screen.findByRole('heading', { level: 1, name: '代码上下文' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '专家' })).toHaveAttribute('href', '/experts')
    expect(screen.getByRole('link', { name: '环境' })).toHaveAttribute('href', '/environments')
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '组织' })).toHaveAttribute('href', '/files/organization')
    expect(screen.getByRole('link', { name: '个人' })).toHaveAttribute('href', '/files/user')
    expect(screen.queryByRole('button', { name: '配置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '集成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '密钥' })).not.toBeInTheDocument()
  })

  it('supports the Cosmos global navigation shortcuts', async () => {
    renderApp('/home')

    await screen.findByRole('heading', { level: 1, name: '选择 Expert，开始一个会话' })
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('heading', { level: 1, name: '会话' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('heading', { level: 1, name: '个人文件' })).toBeInTheDocument()
  })

  it('switches between run evidence views', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByRole('heading', { level: 1, name: '升级支付服务重试策略' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /变更/ }))

    expect(screen.getByRole('button', { name: /src\/retry\/retry-policy\.ts/ })).toBeInTheDocument()
    expect(screen.getByLabelText('代码差异')).toBeInTheDocument()

    const sessionViews = screen.getByRole('navigation', { name: '会话视图' })
    await user.click(within(sessionViews).getByRole('button', { name: /文件/ }))
    expect(screen.getByRole('tab', { name: /工作区/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: /组织/ }))
    expect(screen.getByRole('button', { name: /standards\/engineering\.md/ })).toBeInTheDocument()
  })

  it('records an approval decision and continues the run', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: /审批/ }))
    await user.click(screen.getByRole('button', { name: '批准并继续' }))

    expect(screen.getByText('决策已记录，正在创建 PR')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('审批已记录')
  })

  it('creates a new run from the task dialog', async () => {
    const user = userEvent.setup()
    const prompt = '修复优惠券并发核销。确保同一张优惠券只能成功核销一次，并补充并发测试。参考 https://github.com/acme/commerce/issues/42'
    renderApp('/runs')

    await user.click(screen.getAllByRole('button', { name: '新建会话' })[0])
    await user.type(screen.getByLabelText('会话任务'), prompt)
    expect(screen.getByText('GitHub · acme/commerce/issues/42')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('heading', { level: 1, name: '修复优惠券并发核销' })).toBeInTheDocument()
    expect(createSession).toHaveBeenCalledWith(
      'cosmos',
      'space-commerce',
      expect.objectContaining({
        expertId: 'expert-cosmos-advisor',
        title: '修复优惠券并发核销',
        start: true,
        message: { content: prompt, attachments: [] },
      }),
      expect.any(String),
      expect.objectContaining({ accessToken: undefined, onUnauthorized: expect.any(Function) }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('等待 Worker 接收命令')
    expect(screen.queryByText('正在建立任务上下文')).not.toBeInTheDocument()
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{
        id: string
        title: string
        status: string
        updatedAt: string
        baseBranch?: string
        contextItems?: Array<{ kind: string }>
      }>
      expect(storedSessions.find((session) => session.title === '修复优惠券并发核销')).toMatchObject({
        id: 'session-api-1',
        status: 'queued',
        updatedAt: API_TIMESTAMP,
        baseBranch: 'main',
        contextItems: [{ kind: 'github' }],
      })
    })
  })

  it('starts a Session directly from Home with the selected Expert and first prompt', async () => {
    const user = userEvent.setup()
    renderApp('/home')

    await user.type(screen.getByLabelText('会话任务'), '评估结算链路迁移方案')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('heading', { level: 1, name: '评估结算链路迁移方案' })).toBeInTheDocument()
    expect(createSession).toHaveBeenCalledWith(
      'cosmos',
      'space-commerce',
      expect.objectContaining({ expertId: 'expert-cosmos-advisor', start: true }),
      expect.any(String),
      expect.objectContaining({ accessToken: undefined, onUnauthorized: expect.any(Function) }),
    )
    const storedSessions = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{ title: string; expertId?: string }>
    expect(storedSessions.find((session) => session.title === '评估结算链路迁移方案')).toMatchObject({ expertId: 'expert-cosmos-advisor' })
  })

  it('hydrates server Sessions for the active Space without duplicating local projections', async () => {
    const serverSession = makeApiSession('cosmos', 'space-commerce', {
      title: '服务端持久化会话', expertId: 'expert-pr-author', expertName: 'PR Author',
      repository: 'commerce/checkout', baseBranch: 'main',
      message: { content: '从 PostgreSQL 恢复的会话。' },
    }, { id: 'session-persisted' })
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [serverSession],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: serverSession.updatedAt },
    })

    renderApp('/sessions')

    expect((await screen.findAllByText('服务端持久化会话')).length).toBeGreaterThan(0)
    expect(listSessions).toHaveBeenCalledWith(
      'cosmos', 'space-commerce',
      expect.objectContaining({ accessToken: undefined, onUnauthorized: expect.any(Function) }),
      { archived: 'all', limit: 50 },
    )
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{ id: string }>
      expect(stored.filter((run) => run.id === 'session-persisted')).toHaveLength(1)
    })
  })

  it('loads a canonical Session detail directly without waiting for the list projection', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '直接恢复的生产会话',
      expertId: 'expert-authoritative',
      message: { content: '从详情 API 恢复。' },
    }, { id: 'session-direct' })
    vi.mocked(getSession).mockResolvedValue(detail)

    renderAuthenticatedApp('/sessions/session-direct')

    expect(await screen.findByRole('heading', { level: 1, name: '直接恢复的生产会话' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(screen.queryByText('gpt-5.6-sol')).not.toBeInTheDocument()
    expect(screen.queryByText('38.2k')).not.toBeInTheDocument()
    expect(screen.queryByText('￥4.82')).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['对话', '文件', 'Workers'])
    expect(screen.queryByRole('tab', { name: /产物|Changes|终端|审批/ })).not.toBeInTheDocument()
    for (const action of ['停止', '重试', '批准']) {
      expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: '后续消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.getByText('当前部署未开放执行。')).toBeInTheDocument()
    expect(getSession).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      'session-direct',
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
      expect.any(AbortSignal),
    )
  })

  it('navigates from a production Session to its exact Workspace Files scope and back', async () => {
    const user = userEvent.setup()
    const detail = makeApiSession('organization-production', 'space-production', {
      title: 'Workspace file session', expertId: 'expert-production', start: true,
      message: { content: 'Inspect generated files.' },
    }, { id: 'session-workspace-files', status: 'active' })
    vi.mocked(getSession).mockResolvedValue(detail)

    renderAuthenticatedApp(`/sessions/${detail.id}`)

    await screen.findByRole('heading', { name: detail.title })
    await user.click(screen.getByRole('tab', { name: '文件' }))
    expect(await screen.findByRole('heading', { name: '会话工作区文件' })).toBeInTheDocument()
    expect(listFiles).toHaveBeenCalledWith(
      detail.organizationId,
      detail.spaceId,
      { scope: 'workspace', sessionId: detail.id, search: undefined, limit: 100 },
      expect.objectContaining({ accessToken: 'production-access-token' }),
      expect.any(AbortSignal),
    )

    await user.click(screen.getByRole('button', { name: '返回会话' }))
    expect(await screen.findByRole('heading', { name: detail.title })).toBeInTheDocument()
  })

  it('navigates from a production Session to its exact Worker tree and back', async () => {
    const user = userEvent.setup()
    const detail = makeApiSession('organization-production', 'space-production', {
      title: 'Worker tree session', expertId: 'expert-production', start: true,
      message: { content: 'Delegate independent review.' },
    }, { id: 'session-worker-tree', status: 'active' })
    vi.mocked(getSession).mockResolvedValue(detail)

    renderAuthenticatedApp(`/sessions/${detail.id}`)

    await screen.findByRole('heading', { name: detail.title })
    await user.click(screen.getByRole('tab', { name: 'Workers' }))
    expect(await screen.findByRole('heading', { name: 'Worker 树' })).toBeInTheDocument()
    expect(listSessionWorkers).toHaveBeenCalledWith(
      detail.organizationId,
      detail.spaceId,
      detail.id,
      expect.objectContaining({ accessToken: 'production-access-token' }),
      expect.any(AbortSignal),
      { limit: 50 },
    )

    await user.click(screen.getByRole('button', { name: '返回会话' }))
    expect(await screen.findByRole('heading', { name: detail.title })).toBeInTheDocument()
  })

  it('applies production Session controls with the latest canonical version', async () => {
    const user = userEvent.setup()
    const queued = makeApiSession('organization-production', 'space-production', {
      title: '可控制的生产会话',
      expertId: 'expert-authoritative',
      message: { content: '验证执行控制。' },
    }, { id: 'session-controls', status: 'queued', version: 2 })
    const command = (
      type: 'session.pause' | 'session.resume' | 'session.cancel',
      status: 'paused' | 'queued' | 'canceled',
      version: number,
    ) => ({
      session: { ...queued, status, version },
      command: {
        id: `command-${type}`,
        type,
        status: 'succeeded' as const,
        resourceType: 'session' as const,
        resourceId: queued.id,
        acceptedAt: queued.updatedAt,
      },
    })
    const paused = command('session.pause', 'paused', 3)
    const resumed = command('session.resume', 'queued', 4)
    const canceled = command('session.cancel', 'canceled', 5)
    vi.mocked(getRuntimeCapabilities).mockResolvedValueOnce({
      execution: { enabled: true, events: 'polling' },
    })
    vi.mocked(getSession).mockResolvedValue(queued)
    vi.mocked(pauseSession).mockResolvedValueOnce(paused)
    vi.mocked(resumeSession).mockResolvedValueOnce(resumed)
    vi.mocked(cancelSession).mockResolvedValueOnce(canceled)

    renderAuthenticatedApp('/sessions/session-controls')
    await user.click(await screen.findByRole('button', { name: '暂停' }))
    expect(await screen.findByRole('heading', { name: '执行已暂停' })).toBeInTheDocument()
    expect(pauseSession).toHaveBeenCalledWith(
      'organization-production', 'space-production', queued.id, 2, expect.any(String),
      expect.objectContaining({ accessToken: 'production-access-token' }),
    )

    await user.click(screen.getByRole('button', { name: '恢复' }))
    expect(await screen.findByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(resumeSession).toHaveBeenCalledWith(
      'organization-production', 'space-production', queued.id, 3, expect.any(String),
      expect.objectContaining({ accessToken: 'production-access-token' }),
    )

    await user.click(screen.getByRole('button', { name: '取消执行' }))
    expect(await screen.findByRole('heading', { name: '执行已取消' })).toBeInTheDocument()
    expect(cancelSession).toHaveBeenCalledWith(
      'organization-production', 'space-production', queued.id, 4, expect.any(String), undefined,
      expect.objectContaining({ accessToken: 'production-access-token' }),
    )
  })

  it('retries the failed Turn identified by the authoritative Attempt event', async () => {
    const user = userEvent.setup()
    const failed = makeApiSession('organization-production', 'space-production', {
      title: '需要人工重试的会话',
      expertId: 'expert-authoritative',
      message: { content: '验证失败 Turn 重试。' },
    }, { id: 'session-manual-retry', status: 'failed', version: 5 })
    const turnId = 'turn-failed'
    const retried = {
      session: { ...failed, status: 'queued' as const, version: 6 },
      attempt: {
        organizationId: failed.organizationId,
        spaceId: failed.spaceId,
        sessionId: failed.id,
        id: 'attempt-retry-2',
        turnId,
        number: 2,
        status: 'queued' as const,
        model: 'cosmos-production',
        providerModel: null,
        runtimeId: null,
        failureCode: null,
        createdAt: failed.updatedAt,
        startedAt: null,
        finishedAt: null,
      },
      command: {
        id: 'command-retry-2',
        type: 'turn.retry' as const,
        status: 'queued' as const,
        resourceType: 'turn' as const,
        resourceId: turnId,
        acceptedAt: failed.updatedAt,
      },
    }
    vi.mocked(getRuntimeCapabilities).mockResolvedValueOnce({
      execution: { enabled: true, events: 'polling' },
    })
    vi.mocked(getSession).mockResolvedValue(failed)
    vi.mocked(listSessionEvents).mockResolvedValue({
      organizationId: failed.organizationId,
      spaceId: failed.spaceId,
      sessionId: failed.id,
      items: [{
        eventId: 'event-attempt-failed',
        organizationId: failed.organizationId,
        spaceId: failed.spaceId,
        sessionId: failed.id,
        sequence: 7,
        type: 'attempt.updated',
        resourceType: 'attempt',
        resourceId: 'attempt-1',
        actorId: 'worker-1',
        commandId: 'command-1',
        requestId: 'request-1',
        occurredAt: failed.updatedAt,
        payload: {
          attemptId: 'attempt-1', turnId, number: 1, status: 'failed', failureCode: 'provider_timeout',
        },
      }],
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(retrySessionTurn).mockResolvedValueOnce(retried)

    renderAuthenticatedApp('/sessions/session-manual-retry')
    await user.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '正在等待重试' })).toBeInTheDocument()
    expect(retrySessionTurn).toHaveBeenCalledWith(
      'organization-production', 'space-production', failed.id, turnId, 5, expect.any(String),
      expect.objectContaining({ accessToken: 'production-access-token' }),
    )
  })

  it('starts a canonical draft with its current version when execution is available', async () => {
    const user = userEvent.setup()
    const draft = makeApiSession('organization-production', 'space-production', {
      title: '待启动的生产草稿',
      expertId: 'expert-authoritative',
      start: false,
      message: { content: '复用已保存的首条消息。' },
    }, { id: 'session-draft-start', status: 'draft', version: 1 })
    const queued = {
      ...draft,
      status: 'queued' as const,
      version: 2,
      updatedAt: '2026-07-12T04:31:00.000Z',
      lastActivityAt: '2026-07-12T04:31:00.000Z',
    }
    const turn = {
      id: 'turn-draft-start', sessionId: draft.id, ordinal: 1, initiatorType: 'user' as const,
      initiatorId: 'user-production', inputMessageId: 'message-draft-start', status: 'queued' as const,
      queuedAt: queued.updatedAt, version: 1,
    }
    const command = {
      id: 'command-draft-start', type: 'session.start' as const, status: 'accepted' as const,
      resourceType: 'turn' as const, resourceId: turn.id, acceptedAt: queued.updatedAt,
    }
    vi.mocked(getRuntimeCapabilities).mockResolvedValueOnce({
      execution: { enabled: true, events: 'polling' },
    })
    vi.mocked(getSession).mockResolvedValue(draft)
    vi.mocked(startSession).mockResolvedValue({ session: queued, turn, command })

    renderAuthenticatedApp('/sessions/session-draft-start')

    const startButton = await screen.findByRole('button', { name: '开始执行' })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    await waitFor(() => expect(startSession).toHaveBeenCalledOnce())
    expect(startSession).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      draft.id,
      1,
      expect.stringMatching(/^session-/),
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
    )
    expect(await screen.findByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始执行' })).not.toBeInTheDocument()
  })

  it('sends a follow-up Message and immediately merges the accepted record', async () => {
    const user = userEvent.setup()
    const active = makeApiSession('organization-production', 'space-production', {
      title: '可继续对话的生产会话',
      expertId: 'expert-authoritative',
      message: { content: '先检查结算主路径。' },
    }, { id: 'session-send-follow-up', status: 'active', version: 3 })
    const queued = {
      ...active,
      status: 'queued' as const,
      version: 4,
      updatedAt: '2026-07-12T04:32:00.000Z',
      lastActivityAt: '2026-07-12T04:32:00.000Z',
    }
    const message = {
      id: 'message-follow-up', sessionId: active.id, sequence: 2, role: 'user' as const,
      actorId: 'user-production', content: '再检查取消路径。', attachments: [],
      createdAt: queued.updatedAt,
    }
    const turn = {
      id: 'turn-follow-up', sessionId: active.id, ordinal: 2, initiatorType: 'user' as const,
      initiatorId: 'user-production', inputMessageId: message.id, status: 'queued' as const,
      queuedAt: queued.updatedAt, version: 1,
    }
    const command = {
      id: 'command-follow-up', type: 'session.send' as const, status: 'accepted' as const,
      resourceType: 'turn' as const, resourceId: turn.id, acceptedAt: queued.updatedAt,
    }
    vi.mocked(getRuntimeCapabilities).mockResolvedValueOnce({
      execution: { enabled: true, events: 'polling' },
    })
    vi.mocked(getSession).mockResolvedValue(active)
    vi.mocked(sendSessionMessage).mockResolvedValue({ session: queued, message, turn, command })

    renderAuthenticatedApp('/sessions/session-send-follow-up')

    const input = await screen.findByRole('textbox', { name: '后续消息' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, message.content)
    await user.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(sendSessionMessage).toHaveBeenCalledOnce())
    expect(sendSessionMessage).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      active.id,
      { content: message.content },
      expect.stringMatching(/^session-/),
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
    )
    expect(await screen.findByText(message.content)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('does not render or retain a stale list projection as canonical Session detail', async () => {
    const stale = makeApiSession('organization-production', 'space-production', {
      title: '列表中的旧标题', expertId: 'expert-authoritative', message: { content: '旧投影。' },
    }, { id: 'session-authoritative', version: 1 })
    const current = { ...stale, title: '详情接口的新标题', summary: '权威详情。', version: 2 }
    const detailResponse = deferred<SessionDto>()
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [stale], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: stale.updatedAt },
    })
    vi.mocked(getSession).mockReturnValueOnce(detailResponse.promise)

    const firstView = renderAuthenticatedApp('/sessions/session-authoritative')

    await waitFor(() => expect(listSessions).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { level: 1, name: '列表中的旧标题' })).not.toBeInTheDocument()
    await act(async () => { detailResponse.resolve(current) })
    expect(await screen.findByRole('heading', { level: 1, name: '详情接口的新标题' })).toBeInTheDocument()
    firstView.unmount()

    const delayedList = deferred<Awaited<ReturnType<typeof listSessions>>>()
    vi.mocked(listSessions).mockReturnValueOnce(delayedList.promise)
    vi.mocked(getSession).mockResolvedValueOnce(current)
    const secondView = renderAuthenticatedApp('/sessions/session-authoritative')
    expect(await screen.findAllByRole('heading', { level: 1, name: '详情接口的新标题' })).toHaveLength(1)
    await act(async () => {
      delayedList.resolve({
        items: [stale], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: stale.updatedAt },
      })
    })
    expect(screen.getAllByRole('heading', { level: 1, name: '详情接口的新标题' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 1, name: '列表中的旧标题' })).not.toBeInTheDocument()
    secondView.unmount()
  })

  it('conceals the sidebar and aborts a hanging timeline when Session detail returns 404 first', async () => {
    const stale = makeApiSession('organization-production', 'space-production', {
      title: '详情撤权前的侧栏标题', expertId: 'expert-authoritative',
      message: { content: '不可保留。' },
    }, { id: 'session-detail-revoked' })
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [stale], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: stale.updatedAt },
    })
    const delayedDetail = deferred<SessionDto>()
    vi.mocked(getSession).mockReturnValueOnce(delayedDetail.promise)
    vi.mocked(listSessionMessages).mockImplementationOnce(() => new Promise(() => undefined))
    vi.mocked(listSessionEvents).mockImplementationOnce(() => new Promise(() => undefined))

    renderAuthenticatedApp('/sessions/session-detail-revoked')

    await waitFor(() => {
      expect(listSessionMessages).toHaveBeenCalledOnce()
      expect(listSessionEvents).toHaveBeenCalledOnce()
    })
    await act(async () => { delayedDetail.reject(new CosmosApiError('Session unavailable.', {
      code: 'RESOURCE_NOT_FOUND', status: 404,
    })) })

    expect(await screen.findByRole('alert')).toHaveTextContent('会话不存在或无权访问')
    expect(screen.queryByText(stale.title)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(vi.mocked(listSessionMessages).mock.calls[0][4]?.aborted).toBe(true)
      expect(vi.mocked(listSessionEvents).mock.calls[0][4]?.aborted).toBe(true)
    })
  })

  it('does not restore a concealed Session when a stale detail response resolves late', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '迟到且不可恢复的标题', expertId: 'expert-authoritative',
      message: { content: '迟到且不可恢复的摘要。' },
    }, { id: 'session-late-detail' })
    const delayedDetail = deferred<SessionDto>()
    vi.mocked(getSession).mockReturnValueOnce(delayedDetail.promise)
    vi.mocked(listSessionMessages).mockRejectedValueOnce(new CosmosApiError('Session unavailable.', {
      code: 'RESOURCE_NOT_FOUND', status: 404,
    }))
    vi.mocked(listSessionEvents).mockImplementationOnce(() => new Promise(() => undefined))

    renderAuthenticatedApp('/sessions/session-late-detail')
    expect(await screen.findByRole('alert')).toHaveTextContent('会话不存在或无权访问')
    const detailSignal = vi.mocked(getSession).mock.calls[0][4]!
    await waitFor(() => expect(detailSignal.aborted).toBe(true))

    await act(async () => { delayedDetail.resolve(detail) })

    expect(screen.queryByText(detail.title)).not.toBeInTheDocument()
    expect(screen.queryByText(detail.summary)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('会话不存在或无权访问')
  })

  it('hides a verified Session when credentials rotate until the new credential is authorized', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: 'Token A 可见的会话', expertId: 'expert-authoritative', message: { content: '受限内容。' },
    }, { id: 'session-rotation' })
    vi.mocked(getSession)
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('Token B is not authorized.'))

    const view = renderAuthenticatedApp('/sessions/session-rotation', {
      accessToken: 'token-a', credentialVersion: 1,
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Token A 可见的会话' })).toBeInTheDocument()

    view.rerenderAuth({ accessToken: 'token-b', credentialVersion: 2 })

    expect(screen.queryByRole('heading', { level: 1, name: 'Token A 可见的会话' })).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Token B is not authorized.')
  })

  it('hides Session list snapshots immediately when credentials rotate', async () => {
    const tokenASession = makeApiSession('organization-production', 'space-production', {
      title: 'Token A 列表中的会话', expertId: 'expert-authoritative', message: { content: '受限列表内容。' },
    }, { id: 'session-list-rotation' })
    const tokenBList = deferred<Awaited<ReturnType<typeof listSessions>>>()
    vi.mocked(listSessions)
      .mockResolvedValueOnce({
        items: [tokenASession],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: tokenASession.updatedAt },
      })
      .mockReturnValueOnce(tokenBList.promise)

    const view = renderAuthenticatedApp('/sessions', { accessToken: 'token-a', credentialVersion: 1 })
    expect((await screen.findAllByText('Token A 列表中的会话')).length).toBeGreaterThan(0)

    view.rerenderAuth({ accessToken: 'token-b', credentialVersion: 2 })

    expect(screen.queryByText('Token A 列表中的会话')).not.toBeInTheDocument()
    await act(async () => {
      tokenBList.resolve({ items: [], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null } })
    })
    expect(within(await screen.findByRole('table', { name: '会话' })).getByText('暂无活跃会话')).toBeInTheDocument()
  })

  it('ignores demo Session storage for an authenticated production identity', async () => {
    window.localStorage.setItem('cosmos.demo.sessions', JSON.stringify(initialRuns))
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null },
    })

    renderAuthenticatedApp('/sessions')

    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).queryByText('升级支付服务重试策略')).not.toBeInTheDocument()
    expect(within(table).getByText('暂无活跃会话')).toBeInTheDocument()
    expect(listSessions).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
      { archived: 'all', limit: 50 },
    )
    expect(JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]')).toHaveLength(initialRuns.length)
    expect(screen.queryByRole('tab', { name: /收藏/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /已归档/ })).toBeInTheDocument()
  })

  it('shows only authoritative production Session mutation controls', async () => {
    const user = userEvent.setup()
    const session = makeApiSession('organization-production', 'space-production', {
      title: '只读生产会话', expertId: 'expert-authoritative', message: { content: '服务端事实。' },
    }, { id: 'session-readonly-row', status: 'draft' })
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    })

    renderAuthenticatedApp('/sessions')

    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).getByText('草稿')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /收藏/ })).not.toBeInTheDocument()
    await user.click(within(table).getByRole('button', { name: /只读生产会话.*会话操作/ }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '归档' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '删除' })).not.toBeInTheDocument()
  })

  it('renames and archives a production Session through the authoritative API', async () => {
    const user = userEvent.setup()
    const session = makeApiSession('organization-production', 'space-production', {
      title: '生产元数据会话', expertId: 'expert-authoritative', message: { content: '服务端事实。' },
    }, { id: 'session-production-metadata', status: 'draft' })
    const renamed = { ...session, title: '权威重命名', version: 2, updatedAt: '2026-07-12T05:00:00.000Z' }
    const archived = {
      ...renamed,
      archivedAt: '2026-07-12T05:01:00.000Z',
      version: 3,
      updatedAt: '2026-07-12T05:01:00.000Z',
    }
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    })
    vi.mocked(renameSession).mockResolvedValueOnce(renamed)
    vi.mocked(archiveSession).mockResolvedValueOnce(archived)

    renderAuthenticatedApp('/sessions')
    const table = await screen.findByRole('table', { name: '会话' })
    await user.click(within(table).getByRole('button', { name: /生产元数据会话.*会话操作/ }))
    await user.click(screen.getByRole('menuitem', { name: '重命名' }))
    const titleInput = screen.getByRole('textbox', { name: '会话名称' })
    await user.clear(titleInput)
    await user.type(titleInput, '权威重命名')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(renameSession).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      session.id,
      '权威重命名',
      1,
      expect.objectContaining({ accessToken: 'production-access-token' }),
    ))
    expect((await screen.findAllByText('权威重命名')).length).toBeGreaterThan(0)

    await user.click(within(table).getByRole('button', { name: /权威重命名.*会话操作/ }))
    await user.click(screen.getByRole('menuitem', { name: '归档' }))
    await waitFor(() => expect(archiveSession).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      session.id,
      2,
      expect.any(String),
      expect.objectContaining({ accessToken: 'production-access-token' }),
    ))
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect((await screen.findAllByText('权威重命名')).length).toBeGreaterThan(0)
  })

  it('loads the next production Session page without replacing the first page', async () => {
    const user = userEvent.setup()
    const first = makeApiSession('organization-production', 'space-production', {
      title: '第一页会话', expertId: 'expert-authoritative', message: { content: 'First.' },
    }, { id: 'session-page-first' })
    const second = makeApiSession('organization-production', 'space-production', {
      title: '第二页会话', expertId: 'expert-authoritative', message: { content: 'Second.' },
    }, { id: 'session-page-second' })
    vi.mocked(listSessions)
      .mockResolvedValueOnce({
        items: [first], page: { nextCursor: 'next-page', hasMore: true, projectionUpdatedAt: first.updatedAt },
      })
      .mockResolvedValueOnce({
        items: [second], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: second.updatedAt },
      })

    renderAuthenticatedApp('/sessions')
    expect((await screen.findAllByText('第一页会话')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: '加载更多' }))
    expect((await screen.findAllByText('第二页会话')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('第一页会话').length).toBeGreaterThan(0)
    expect(listSessions).toHaveBeenLastCalledWith(
      'organization-production',
      'space-production',
      expect.any(Object),
      { archived: 'all', limit: 50, cursor: 'next-page' },
    )
  })

  it('retries a failed production Session list request', async () => {
    const user = userEvent.setup()
    vi.mocked(listSessions)
      .mockRejectedValueOnce(new Error('Session projection unavailable.'))
      .mockResolvedValueOnce({
        items: [], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null },
      })

    renderAuthenticatedApp('/sessions')

    expect(await screen.findByRole('alert')).toHaveTextContent('Session projection unavailable.')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(within(await screen.findByRole('table', { name: '会话' })).getByText('暂无活跃会话')).toBeInTheDocument()
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('does not read or overwrite prototype stores for a production identity', async () => {
    const privateExpert = 'PRIVATE EXPERT FROM ANOTHER USER'
    window.localStorage.setItem('cosmos.experts', JSON.stringify({
      schemaVersion: 2,
      experts: [{ id: 'private-expert', spaceId: 'space-production', draftConfig: { name: privateExpert } }],
      versions: [],
    }))
    const controlPlaneValue = JSON.stringify({ private: 'control-plane-state' })
    window.localStorage.setItem('cosmos.controlPlane.v1', controlPlaneValue)

    renderAuthenticatedApp('/experts')

    await waitFor(() => expect(listSessions).toHaveBeenCalledWith(
      'organization-production', 'space-production', expect.any(Object),
      { archived: 'all', limit: 50 },
    ))
    expect(screen.queryByText(privateExpert)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('cosmos.controlPlane.v1')).toBe(controlPlaneValue)
    expect(window.localStorage.getItem('cosmos.experts')).toContain(privateExpert)
  })

  it('renders production Experts from the tenant-scoped API and opens canonical detail', async () => {
    const user = userEvent.setup()
    renderAuthenticatedApp('/experts')

    expect((await screen.findAllByText('Production Expert')).length).toBeGreaterThan(0)
    expect(listExperts).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
      expect.any(AbortSignal),
      { limit: 100 },
    )
    expect(screen.queryByRole('button', { name: '创建专家' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /工作流模板/ })).not.toBeInTheDocument()

    await user.click(screen.getByText('Production Expert'))

    expect(await screen.findByText('Implement only the requested change and verify the result.')).toBeInTheDocument()
    expect(getExpert).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      'expert-production',
      expect.objectContaining({ accessToken: 'production-access-token' }),
      expect.any(AbortSignal),
    )
  })

  it('renders production Environments and repository bindings from canonical detail', async () => {
    renderAuthenticatedApp('/environments')

    expect((await screen.findAllByText('Production runtime')).length).toBeGreaterThan(0)
    await waitFor(() => expect(getEnvironment).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      'environment-production',
      expect.objectContaining({ accessToken: 'production-access-token' }),
      expect.any(AbortSignal),
    ))
    expect((await screen.findAllByText('production/platform')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '创建环境' })).not.toBeInTheDocument()
  })

  it('saves a production Session draft with only authoritative input fields', async () => {
    const user = userEvent.setup()
    vi.mocked(createSession).mockImplementationOnce(async (organizationId, spaceId, input) => {
      return { session: makeApiSession(organizationId, spaceId, input, { id: 'session-production-create' }) }
    })
    renderAuthenticatedApp('/experts')
    const expertRow = (await screen.findByText('Production Expert')).closest('article')
    if (!expertRow) throw new Error('Expected the production Expert row.')

    await user.click(within(expertRow).getByRole('button', { name: '新建会话' }))
    expect(screen.queryByText('Cosmos Advisor')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加文件或图片' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '增强提示词' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('会话任务'), '修复生产环境中的结算竞态')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(vi.mocked(createSession).mock.calls[0][0]).toBe('organization-production')
    expect(vi.mocked(createSession).mock.calls[0][1]).toBe('space-production')
    expect(vi.mocked(createSession).mock.calls[0][2]).toEqual({
      expertId: 'expert-production',
      title: '修复生产环境中的结算竞态',
      visibility: 'private',
      start: false,
      message: { content: '修复生产环境中的结算竞态', attachments: [] },
    })
    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).getByText('修复生产环境中的结算竞态')).toBeInTheDocument()
    expect(within(table).getByText('草稿')).toBeInTheDocument()
  })

  it('starts a production Session only after the backend explicitly enables execution', async () => {
    const user = userEvent.setup()
    const created = makeApiSession('organization-production', 'space-production', {
      expertId: 'expert-production',
      title: '验证生产执行能力发现',
      visibility: 'private',
      start: true,
      message: { content: '验证生产执行能力发现', attachments: [] },
    })
    vi.mocked(getRuntimeCapabilities).mockResolvedValueOnce({
      execution: { enabled: true, events: 'polling' },
    })
    vi.mocked(createSession).mockResolvedValueOnce({ session: created })
    vi.mocked(getSession).mockResolvedValueOnce(created)
    renderAuthenticatedApp('/home')

    expect(await screen.findByRole('heading', { name: '选择 Expert，开始一个会话' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('会话任务'), '验证生产执行能力发现')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(vi.mocked(createSession).mock.calls[0][2]).toEqual({
      expertId: 'expert-production',
      title: '验证生产执行能力发现',
      visibility: 'private',
      start: true,
      message: { content: '验证生产执行能力发现', attachments: [] },
    })
  })

  it('saves a Home draft when the backend explicitly disables execution', async () => {
    const user = userEvent.setup()
    renderAuthenticatedApp('/home')

    expect(await screen.findByRole('heading', { name: '选择 Expert，保存会话草稿' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('会话任务'), '记录一个稍后执行的任务')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(createSession).toHaveBeenCalled())
    expect(vi.mocked(createSession).mock.calls[0][2]).toEqual(expect.objectContaining({ start: false }))
  })

  it('blocks creation while execution capability discovery is unresolved', async () => {
    const capability = deferred<Awaited<ReturnType<typeof getRuntimeCapabilities>>>()
    vi.mocked(getRuntimeCapabilities).mockReturnValueOnce(capability.promise)
    renderAuthenticatedApp('/home')

    expect(await screen.findByRole('heading', { name: '选择 Expert，保存会话草稿' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载可用 Expert 与运行环境')
    expect(screen.queryByRole('textbox', { name: '会话任务' })).not.toBeInTheDocument()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('shows a retryable error instead of silently saving a draft when capability discovery fails', async () => {
    vi.mocked(getRuntimeCapabilities).mockRejectedValueOnce(new Error('Capability service unavailable.'))
    renderAuthenticatedApp('/home')

    expect(await screen.findByRole('alert')).toHaveTextContent('Capability service unavailable.')
    expect(screen.queryByRole('textbox', { name: '会话任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('keeps the canonical Session timeline on polling when capability discovery fails', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '能力降级会话', expertId: 'expert-production', start: true,
      message: { content: '继续读取权威时间线。' },
    }, { id: 'session-capability-fallback', status: 'active' })
    vi.mocked(getRuntimeCapabilities).mockRejectedValueOnce(new Error('Capability service unavailable.'))
    vi.mocked(getSession).mockResolvedValue(detail)
    vi.mocked(listSessionMessages).mockResolvedValue({
      organizationId: detail.organizationId,
      spaceId: detail.spaceId,
      sessionId: detail.id,
      items: [],
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(listSessionEvents).mockResolvedValue({
      organizationId: detail.organizationId,
      spaceId: detail.spaceId,
      sessionId: detail.id,
      items: [],
      page: { nextCursor: null, hasMore: false },
    })

    renderAuthenticatedApp('/sessions/session-capability-fallback')

    await waitFor(() => expect(listSessionMessages).toHaveBeenCalled())
    expect(listSessionEvents).toHaveBeenCalled()
    expect(await screen.findByText('能力降级会话')).toBeInTheDocument()
  })

  it('aborts stale capability discovery when the access token rotates', async () => {
    vi.mocked(getRuntimeCapabilities).mockImplementation(() => new Promise(() => undefined))
    const view = renderAuthenticatedApp('/home', { accessToken: 'token-a', credentialVersion: 1 })
    await waitFor(() => expect(getRuntimeCapabilities).toHaveBeenCalledTimes(1))
    const tokenASignal = vi.mocked(getRuntimeCapabilities).mock.calls[0][1]!

    view.rerenderAuth({ accessToken: 'token-b', credentialVersion: 2 })

    expect(tokenASignal.aborted).toBe(true)
    await waitFor(() => expect(getRuntimeCapabilities).toHaveBeenCalledTimes(2))
    expect(vi.mocked(getRuntimeCapabilities).mock.calls[1][0]).toEqual(expect.objectContaining({ accessToken: 'token-b' }))
  })

  it('renders production messages and Attempt events from the canonical timeline', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '真实执行时间线', expertId: 'expert-production', start: true,
      message: { content: '检查订单服务。' },
    }, { id: 'session-timeline', status: 'active' })
    vi.mocked(getSession).mockResolvedValue(detail)
    vi.mocked(listSessionMessages).mockResolvedValue({
      organizationId: detail.organizationId,
      spaceId: detail.spaceId,
      sessionId: detail.id,
      items: [{
        id: 'message-timeline-1', organizationId: detail.organizationId, spaceId: detail.spaceId,
        sessionId: detail.id, sequence: 1, role: 'user', actorId: 'user-production',
        content: '检查订单服务。', attachments: [], createdAt: detail.createdAt,
      }],
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(listSessionEvents).mockResolvedValue({
      organizationId: detail.organizationId,
      spaceId: detail.spaceId,
      sessionId: detail.id,
      items: [{
        eventId: 'event-attempt-2', organizationId: detail.organizationId, spaceId: detail.spaceId,
        sessionId: detail.id, sequence: 4, type: 'attempt.updated', resourceType: 'attempt',
        resourceId: 'attempt-2', actorId: 'worker-1', commandId: 'command-1', requestId: 'request-2',
        occurredAt: detail.updatedAt,
        payload: { attemptId: 'attempt-2', turnId: 'turn-1', number: 2, status: 'running', failureCode: null },
      }],
      page: { nextCursor: null, hasMore: false },
    })

    renderAuthenticatedApp('/sessions/session-timeline')

    expect(await screen.findByRole('heading', { name: '正在重试' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '会话消息' })).toHaveTextContent('检查订单服务。')
    expect(screen.getByRole('region', { name: '执行动态' })).toHaveTextContent('第2 次尝试 · 正在执行')
  })

  it('applies a canonical session.updated event to detail and the Session list', async () => {
    const user = userEvent.setup()
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '状态事件驱动会话', expertId: 'expert-production', start: true,
      message: { content: '等待服务端完成。' },
    }, { id: 'session-status-event', status: 'active', version: 1 })
    vi.mocked(getSession).mockResolvedValue(detail)
    vi.mocked(listSessionEvents).mockResolvedValue({
      organizationId: detail.organizationId,
      spaceId: detail.spaceId,
      sessionId: detail.id,
      items: [{
        eventId: 'event-session-completed', organizationId: detail.organizationId, spaceId: detail.spaceId,
        sessionId: detail.id, sequence: 5, type: 'session.updated', resourceType: 'session',
        resourceId: detail.id, actorId: 'worker-1', commandId: 'command-1', requestId: 'request-completed',
        occurredAt: '2026-07-12T04:31:00.000Z', payload: { status: 'completed', version: 2 },
      }],
      page: { nextCursor: null, hasMore: false },
    })

    renderAuthenticatedApp('/sessions/session-status-event')

    expect(await screen.findByRole('heading', { name: '执行已完成' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回会话' }))
    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).getByText('状态事件驱动会话')).toBeInTheDocument()
    expect(within(table).getByText('已完成')).toBeInTheDocument()
  })

  it('removes all Session metadata when timeline access is revoked after initial load', async () => {
    vi.useFakeTimers()
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '撤权前可见标题', expertId: 'expert-production', start: true,
      message: { content: '撤权后不可保留的私有摘要。' },
    }, { id: 'session-revoked', status: 'active' })
    vi.mocked(getSession).mockResolvedValue(detail)
    vi.mocked(listSessionMessages)
      .mockResolvedValueOnce({
        organizationId: detail.organizationId,
        spaceId: detail.spaceId,
        sessionId: detail.id,
        items: [{
          id: 'message-revoked', organizationId: detail.organizationId, spaceId: detail.spaceId,
          sessionId: detail.id, sequence: 1, role: 'user', actorId: 'user-production',
          content: '撤权后不可保留的私有正文。', attachments: [], createdAt: detail.createdAt,
        }],
        page: { nextCursor: null, hasMore: false },
      })
      .mockRejectedValueOnce(new CosmosApiError('Session unavailable.', {
        code: 'RESOURCE_NOT_FOUND', status: 404,
      }))
    vi.mocked(listSessionEvents).mockImplementation(async (organizationId, spaceId, sessionId) => ({
      organizationId, spaceId, sessionId, items: [], page: { nextCursor: null, hasMore: false },
    }))

    renderAuthenticatedApp('/sessions/session-revoked')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: detail.title })).toBeInTheDocument()
    expect(screen.getByText('撤权后不可保留的私有正文。')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('会话不存在或无权访问')
    expect(screen.queryByText(detail.title)).not.toBeInTheDocument()
    expect(screen.queryByText(detail.summary)).not.toBeInTheDocument()
    expect(screen.queryByText('撤权后不可保留的私有正文。')).not.toBeInTheDocument()
  })

  it('aborts stale Session detail and timeline requests when credentials rotate', async () => {
    const detail = makeApiSession('organization-production', 'space-production', {
      title: '令牌轮换执行', expertId: 'expert-production', start: true,
      message: { content: '仅当前凭证可见。' },
    }, { id: 'session-runtime-rotation' })
    vi.mocked(getSession).mockResolvedValue(detail)
    vi.mocked(listSessionMessages)
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementation(async (organizationId, spaceId, sessionId) => ({
        organizationId, spaceId, sessionId, items: [], page: { nextCursor: null, hasMore: false },
      }))
    vi.mocked(listSessionEvents)
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementation(async (organizationId, spaceId, sessionId) => ({
        organizationId, spaceId, sessionId, items: [], page: { nextCursor: null, hasMore: false },
      }))
    const view = renderAuthenticatedApp('/sessions/session-runtime-rotation', {
      accessToken: 'token-a', credentialVersion: 1,
    })
    await screen.findByRole('heading', { name: detail.title })
    const detailSignal = vi.mocked(getSession).mock.calls[0][4]!
    const messageSignal = vi.mocked(listSessionMessages).mock.calls[0][4]!
    const eventSignal = vi.mocked(listSessionEvents).mock.calls[0][4]!

    view.rerenderAuth({ accessToken: 'token-b', credentialVersion: 2 })

    expect(detailSignal.aborted).toBe(true)
    expect(messageSignal.aborted).toBe(true)
    expect(eventSignal.aborted).toBe(true)
    await waitFor(() => expect(vi.mocked(getSession).mock.calls.at(-1)?.[3]).toEqual(
      expect.objectContaining({ accessToken: 'token-b' }),
    ))
  })

  it('keeps a newly created Session when an older list response arrives later', async () => {
    const user = userEvent.setup()
    const delayedList = deferred<Awaited<ReturnType<typeof listSessions>>>()
    const createInput: CreateSessionRequestInput = {
      expertId: 'expert-production',
      title: '新的权威标题',
      visibility: 'private',
      start: false,
      message: { content: '新的权威标题', attachments: [] },
    }
    const created = makeApiSession('organization-production', 'space-production', createInput, {
      id: 'session-race', version: 2,
    })
    vi.mocked(listSessions).mockReturnValueOnce(delayedList.promise)
    vi.mocked(createSession).mockResolvedValueOnce({ session: created })

    renderAuthenticatedApp('/experts')
    const expertRow = (await screen.findByText('Production Expert')).closest('article')
    if (!expertRow) throw new Error('Expected the production Expert row.')
    await user.click(within(expertRow).getByRole('button', { name: '新建会话' }))
    await user.type(screen.getByLabelText('会话任务'), createInput.message.content)
    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(createSession).toHaveBeenCalled())

    await act(async () => {
      delayedList.resolve({
        items: [],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null },
      })
    })

    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).getAllByText('新的权威标题')).toHaveLength(1)
  })

  it.each([
    ['organization viewer', { organizationRole: 'viewer' as const }],
    ['space viewer', { spaceRole: 'viewer' as const }],
  ])('hides every production Session creation entry for a %s', async (_name, roles) => {
    const user = userEvent.setup()
    renderAuthenticatedApp('/experts', {}, roles)

    expect(await screen.findByText('Production Expert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建会话' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建会话' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Cosmos' }))
    expect(await screen.findByRole('heading', { name: '选择 Expert，保存会话草稿' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '会话任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('只有查看权限')

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '搜索 Cosmos' })).toBeInTheDocument()
    expect(screen.queryByText('手动创建')).not.toBeInTheDocument()
  })

  it('hides prototype navigation and tools throughout production mode', async () => {
    renderAuthenticatedApp('/daemons')

    expect(await screen.findByRole('heading', { name: '此模块尚未开放' })).toBeInTheDocument()
    const navigation = screen.getByRole('navigation')
    expect(within(navigation).queryByRole('link', { name: '守护进程' })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: '文件' })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: '自动化' })).not.toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: '专家' })).toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: '环境' })).toBeInTheDocument()
  })

  it('does not expose filename attachments or prompt simulation on production Home', async () => {
    renderAuthenticatedApp('/home')

    expect(await screen.findByRole('heading', { name: '选择 Expert，保存会话草稿' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '增强提示词' })).not.toBeInTheDocument()
  })

  it('keeps production Home in a loading state until both Session Catalog resources are ready', async () => {
    const user = userEvent.setup()
    const expertsRequest = deferred<Awaited<ReturnType<typeof listExperts>>>()
    const environmentsRequest = deferred<Awaited<ReturnType<typeof listEnvironments>>>()
    vi.mocked(listExperts).mockReturnValueOnce(expertsRequest.promise)
    vi.mocked(listEnvironments).mockReturnValueOnce(environmentsRequest.promise)

    renderAuthenticatedApp('/home')

    expect(await screen.findByText('正在加载可用 Expert 与运行环境…')).toBeInTheDocument()
    expect(screen.queryByText('当前 Space 没有可用 Expert')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '会话任务' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建会话' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('正在加载可用 Expert 与运行环境…')).toBeInTheDocument()
    expect(within(dialog).queryByText('当前 Space 没有可用 Expert')).not.toBeInTheDocument()

    await act(async () => {
      expertsRequest.resolve({
        items: [productionExpert],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: productionExpert.updatedAt },
      })
    })
    expect(within(dialog).getByText('正在加载可用 Expert 与运行环境…')).toBeInTheDocument()

    await act(async () => {
      environmentsRequest.resolve({
        items: [productionEnvironment],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: productionEnvironment.updatedAt },
      })
    })
    expect(await within(dialog).findByRole('radio', { name: /Production Expert/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: '会话任务' })).toBeInTheDocument()
  })

  it('shows a production Home Catalog error and retries the failed resource', async () => {
    const user = userEvent.setup()
    vi.mocked(listExperts)
      .mockRejectedValueOnce(new Error('Expert Catalog unavailable.'))
      .mockResolvedValueOnce({
        items: [productionExpert],
        page: { nextCursor: null, hasMore: false, projectionUpdatedAt: productionExpert.updatedAt },
      })

    renderAuthenticatedApp('/home')

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('无法加载会话目录')
    expect(error).toHaveTextContent('Expert Catalog unavailable.')
    expect(screen.queryByText('当前 Space 没有可用 Expert')).not.toBeInTheDocument()

    await user.click(within(error).getByRole('button', { name: '重试' }))

    expect((await screen.findAllByText('Production Expert')).length).toBeGreaterThan(0)
    expect(listExperts).toHaveBeenCalledTimes(2)
    expect(listEnvironments).toHaveBeenCalledTimes(1)
  })

  it('keeps the task dialog input open and retryable when Session creation fails', async () => {
    const user = userEvent.setup()
    vi.mocked(createSession).mockRejectedValueOnce(new Error('服务暂时不可用，请稍后重试。'))
    renderApp('/runs')

    await user.click(screen.getAllByRole('button', { name: '新建会话' })[0])
    const task = screen.getByLabelText('会话任务')
    await user.type(task, '保留这段会话任务')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用，请稍后重试。')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(task).toHaveValue('保留这段会话任务')
    expect(screen.getByRole('button', { name: '开始会话' })).toBeEnabled()
    expect(createSession).toHaveBeenCalledTimes(1)

    const firstIdempotencyKey = vi.mocked(createSession).mock.calls[0][3]
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('heading', { level: 1, name: '保留这段会话任务' })).toBeInTheDocument()
    expect(vi.mocked(createSession).mock.calls[1][3]).toBe(firstIdempotencyKey)
  })

  it('keeps the Home composer input retryable when Session creation fails', async () => {
    const user = userEvent.setup()
    vi.mocked(createSession).mockRejectedValueOnce(new Error('创建会话失败，请重试。'))
    renderApp('/home')

    const task = screen.getByLabelText('会话任务')
    await user.type(task, 'Home 中需要保留的任务')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('创建会话失败，请重试。')
    expect(task).toHaveValue('Home 中需要保留的任务')
    expect(screen.getByRole('button', { name: '开始会话' })).toBeEnabled()
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('filters the template library by category', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await openTemplateLibrary(user)

    expect(screen.getByText('62 个工作流模板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ticket or task to a merged PR' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /QA\s*7/ }))

    expect(screen.getByRole('heading', { name: 'E2E Playwright verification on every PR' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ticket or task to a merged PR' })).not.toBeInTheDocument()
  })

  it('forks the Figma template into an editable draft', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')

    expect(screen.getByRole('heading', { level: 1, name: 'Figma design to production code' })).toBeInTheDocument()
    expect(screen.getByText(/草稿 · v0/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('Figma design to production code')
  })

  it('saves and publishes an Expert as a persisted version', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')
    const name = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(name)
    await user.type(name, 'Figma 生产实现专家')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(screen.getByRole('status')).toHaveTextContent('配置已保存')
    await user.click(screen.getByRole('button', { name: '发布专家' }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已发布')

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('cosmos.experts') ?? '{}') as {
        experts?: Array<{ sourceTemplateId?: string; status: string; latestVersion: number; draftConfig: { name: string } }>
        versions?: Array<{ expertId: string; version: number }>
      }
      const expert = store.experts?.find((item) => item.sourceTemplateId === 'figma-to-code')
      expect(expert).toMatchObject({
        status: 'published',
        latestVersion: 1,
        draftConfig: { name: 'Figma 生产实现专家' },
      })
      expect(store.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: 1 }),
      ]))
    })
  })

  it('disables and re-enables a published Expert from the list', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    const expertName = 'Ticket or task to a merged PR'
    await user.click(await screen.findByRole('button', { name: `停用: ${expertName}` }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已停用')
    expect(screen.getByRole('button', { name: `启用: ${expertName}` })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `启用: ${expertName}` }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已重新启用')
    expect(screen.getByRole('button', { name: `停用: ${expertName}` })).toBeInTheDocument()

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('cosmos.experts') ?? '{}') as {
        experts?: Array<{ id: string; status: string }>
      }
      expect(store.experts?.find((expert) => expert.id === 'expert-seed-pr-author')).toMatchObject({ status: 'published' })
    })
  })

  it('starts a Session with the published Expert id and name preselected', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    const expertName = 'Ticket or task to a merged PR'
    await user.click(await screen.findByRole('button', { name: `发起会话: ${expertName}` }))

    expect(screen.getByRole('radio', { name: new RegExp(expertName) })).toHaveAttribute('aria-checked', 'true')
  })

  it('rolls back a published Expert by creating a new version', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')
    const name = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(name)
    await user.type(name, 'Figma Expert v1')
    await user.click(screen.getByRole('button', { name: '发布专家' }))

    const publishedName = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(publishedName)
    await user.type(publishedName, 'Figma Expert v2')
    await user.click(screen.getByRole('button', { name: '发布新版本' }))
    await user.click(screen.getByRole('button', { name: '回滚到此版本' }))

    expect(screen.getByRole('status')).toHaveTextContent('已回滚并发布为新版本')
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('Figma Expert v1')

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('cosmos.experts') ?? '{}') as {
        experts?: Array<{ sourceTemplateId?: string; latestVersion: number; draftConfig: { name: string } }>
        versions?: Array<{ version: number; rolledBackFromVersionId?: string }>
      }
      const expert = store.experts?.find((item) => item.sourceTemplateId === 'figma-to-code')
      expect(expert).toMatchObject({ latestVersion: 3, draftConfig: { name: 'Figma Expert v1' } })
      expect(store.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: 3, rolledBackFromVersionId: expect.any(String) }),
      ]))
    })
  })

  it('switches theme and application language', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await screen.findByRole('table', { name: '会话' })
    const sessionsPage = screen.getByRole('main')

    await user.click(within(sessionsPage).getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f5f5')
    expect(window.localStorage.getItem(PREFERENCE_STORAGE_KEYS.theme)).toBe('light')

    await user.click(within(sessionsPage).getByRole('button', { name: '切换到英文' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBeInTheDocument()
    expect(within(sessionsPage).getByRole('button', { name: 'Switch to Chinese' })).toBeInTheDocument()
    expect(window.localStorage.getItem(PREFERENCE_STORAGE_KEYS.locale)).toBe('en')
  })

  it('renames and archives a managed session', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await screen.findByRole('table', { name: '会话' })

    await user.click(screen.getByRole('button', { name: '补齐库存预占链路测试 · 会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '重命名' }))
    const nameInput = screen.getByLabelText('会话名称')
    await user.clear(nameInput)
    await user.type(nameInput, '库存并发测试修复')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('库存并发测试修复')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '库存并发测试修复 · 会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '归档' }))
    expect(screen.queryByText('库存并发测试修复')).not.toBeInTheDocument()
    const storedSessions = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{ title: string; archived?: boolean }>
    expect(storedSessions.find((session) => session.title === '库存并发测试修复')).toMatchObject({ archived: true })
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect(screen.getByText('库存并发测试修复')).toBeInTheDocument()
  })

  it('prioritizes sessions that need attention', async () => {
    const completedSession = { ...initialRuns.find((run) => run.id === 'run-481')!, archived: false }
    const sessions = [completedSession, ...initialRuns.filter((run) => run.id !== 'run-481')]
    window.localStorage.setItem('cosmos.demo.sessions', JSON.stringify(sessions))

    renderApp('/sessions')

    const rows = within(await screen.findByRole('table', { name: '会话' })).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('升级支付服务重试策略')
    expect(rows[1]).toHaveTextContent('补齐库存预占链路测试')
    expect(rows[2]).toHaveTextContent('审查身份服务依赖升级')
    expect(rows[3]).toHaveTextContent('修复账单导出时区偏差')
  })

  it('finds sessions by PR details and source filters', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await screen.findByRole('table', { name: '会话' })

    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    const search = screen.getByLabelText('搜索标题、仓库、分支、触发器、步骤或 PR')
    await user.type(search, 'PR #913')
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('修复账单导出时区偏差')).toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: '筛选' }))
    const filterDialog = screen.getByRole('dialog', { name: '筛选' })
    await user.selectOptions(within(filterDialog).getByLabelText('来源'), 'Jira')
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('修复账单导出时区偏差')).toBeInTheDocument()
  })

  it('archives multiple selected sessions in one action', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await screen.findByRole('table', { name: '会话' })

    await user.click(screen.getByRole('checkbox', { name: '选择会话: 补齐库存预占链路测试' }))
    await user.click(screen.getByRole('checkbox', { name: '选择会话: 审查身份服务依赖升级' }))
    await user.click(screen.getByRole('button', { name: '批量归档 (2)' }))

    expect(screen.queryByText('补齐库存预占链路测试')).not.toBeInTheDocument()
    expect(screen.queryByText('审查身份服务依赖升级')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect(screen.getByText('补齐库存预占链路测试')).toBeInTheDocument()
    expect(screen.getByText('审查身份服务依赖升级')).toBeInTheDocument()
  })

  it('materializes a matched inbound event as an automation Session', async () => {
    const user = userEvent.setup()
    renderApp('/automations/events')

    await user.click(await screen.findByRole('button', { name: 'Slack' }))
    await user.click(screen.getByRole('button', { name: '注入并匹配' }))

    expect(screen.getByRole('status')).toHaveTextContent('事件已匹配 Payments alert investigation')
    expect(screen.getByText('@Cosmos investigate payment timeouts')).toBeInTheDocument()
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{
        title: string
        source: string
        automationId?: string
        sourceEventId?: string
      }>
      expect(storedSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          title: '@Cosmos investigate payment timeouts',
          source: 'automation',
          automationId: 'automation-slack-incident',
          sourceEventId: expect.any(String),
        }),
      ]))
    })
  })

  it('creates a new Attempt on retry while preserving the failed Attempt', async () => {
    const user = userEvent.setup()
    renderApp('/runs/run-479')

    await user.click(await screen.findByRole('button', { name: '重试步骤' }))

    expect(screen.getByRole('status')).toHaveTextContent('已创建新的 Attempt，重试成功')
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('cosmos.demo.sessions') ?? '[]') as Array<{
        id: string
        status: string
        attempts?: Array<{ number: number; status: string }>
      }>
      expect(storedSessions.find((session) => session.id === 'run-479')).toMatchObject({
        status: 'completed',
        attempts: [
          { number: 1, status: 'failed' },
          { number: 2, status: 'succeeded' },
        ],
      })
    })
  })

  it('creates a provisioning environment through the three-step wizard', async () => {
    const user = userEvent.setup()
    renderApp('/environments')

    await user.click(await screen.findByRole('button', { name: '创建环境' }))
    await user.type(screen.getByRole('textbox', { name: '环境名称' }), '支付回归验证')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '创建并模拟配置' }))

    expect(screen.getByRole('button', { name: /支付回归验证/ })).toBeInTheDocument()
    await waitFor(() => {
      const state = JSON.parse(window.localStorage.getItem('cosmos.controlPlane.v1') ?? '{}') as {
        environments?: Array<{ name: string; status: string }>
      }
      expect(state.environments).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '支付回归验证', status: 'provisioning' }),
      ]))
    })
  })
})
