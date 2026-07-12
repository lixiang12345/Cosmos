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
} from '@relay/contracts'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AuthContext, type AuthContextValue } from './auth/context'
import { initialRuns } from './data/mockData'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from './preferences'
import {
  createSession,
  getEnvironment,
  getExpert,
  getSession,
  listEnvironments,
  listExperts,
  listSessions,
} from './services/relayApi'
import { WorkspaceContext, type WorkspaceContextValue } from './workspace'

vi.mock('./services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('./services/relayApi')>(),
  createSession: vi.fn(),
  getEnvironment: vi.fn(),
  getExpert: vi.fn(),
  getSession: vi.fn(),
  listEnvironments: vi.fn(),
  listExperts: vi.fn(),
  listSessions: vi.fn(),
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
  name: 'Production runtime',
  description: 'Production execution environment.',
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
  version: 2,
  createdAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T04:00:00.000Z',
}

const productionEnvironmentDetail: EnvironmentDetailDto = {
  ...productionEnvironment,
  activeRevision: {
    ...productionEnvironment.activeRevision!,
    repositoryBindings: [productionDefaultRepository],
  },
}

const productionExpert: ExpertSummaryDto = {
  id: 'expert-production',
  organizationId: 'organization-production',
  spaceId: 'space-production',
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
    model: 'relay-production',
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
  },
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
    version: 1,
    ...overrides,
  }
}

function renderApp(route = '/runs/run-482') {
  const me: MeResponse = {
    actor: { id: 'user-local-admin', kind: 'user' },
    organizations: [{
      id: 'relay', name: 'Relay', role: 'organization_owner',
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

describe('Relay prototype', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    window.localStorage.setItem('relay.sidebarCollapsed', 'false')
    window.localStorage.removeItem('relay.sessions')
    window.localStorage.removeItem('relay.demo.sessions')
    window.localStorage.removeItem('relay.experts')
    window.localStorage.removeItem('relay.controlPlane.v1')
    vi.mocked(createSession).mockReset()
    vi.mocked(getEnvironment).mockReset()
    vi.mocked(getExpert).mockReset()
    vi.mocked(getSession).mockReset()
    vi.mocked(listEnvironments).mockReset()
    vi.mocked(listExperts).mockReset()
    vi.mocked(listSessions).mockReset()
    vi.mocked(listSessions).mockResolvedValue({
      items: [], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null },
    })
    vi.mocked(createSession).mockImplementation(async (organizationId, spaceId, input) => ({
      session: makeApiSession(organizationId, spaceId, input),
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
  })

  it('uses Home as the Expert launcher without adding a sidebar Home item', async () => {
    renderApp('/home')

    expect(await screen.findByRole('heading', { level: 1, name: '选择 Expert，开始一个会话' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '首页' })).not.toBeInTheDocument()
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
      'relay',
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
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{
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
      'relay',
      'space-commerce',
      expect.objectContaining({ expertId: 'expert-cosmos-advisor', start: true }),
      expect.any(String),
      expect.objectContaining({ accessToken: undefined, onUnauthorized: expect.any(Function) }),
    )
    const storedSessions = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{ title: string; expertId?: string }>
    expect(storedSessions.find((session) => session.title === '评估结算链路迁移方案')).toMatchObject({ expertId: 'expert-cosmos-advisor' })
  })

  it('hydrates server Sessions for the active Space without duplicating local projections', async () => {
    const serverSession = makeApiSession('relay', 'space-commerce', {
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
      'relay', 'space-commerce',
      expect.objectContaining({ accessToken: undefined, onUnauthorized: expect.any(Function) }),
    )
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{ id: string }>
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
    expect(screen.getByRole('heading', { name: '命令已接受，但执行面未接通' })).toBeInTheDocument()
    expect(screen.queryByText('GPT-5.4')).not.toBeInTheDocument()
    expect(screen.queryByText('38.2k')).not.toBeInTheDocument()
    expect(screen.queryByText('￥4.82')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    for (const action of ['暂停', '停止', '重试', '批准', '发送']) {
      expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument()
    }
    expect(getSession).toHaveBeenCalledWith(
      'organization-production',
      'space-production',
      'session-direct',
      expect.objectContaining({
        accessToken: 'production-access-token',
        onUnauthorized: expect.any(Function),
      }),
    )
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
    window.localStorage.setItem('relay.demo.sessions', JSON.stringify(initialRuns))
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
    )
    expect(JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]')).toHaveLength(initialRuns.length)
    expect(screen.queryByRole('tab', { name: /收藏|归档/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('keeps production Session rows free of local mutation controls', async () => {
    const session = makeApiSession('organization-production', 'space-production', {
      title: '只读生产会话', expertId: 'expert-authoritative', message: { content: '服务端事实。' },
    }, { id: 'session-readonly-row', status: 'draft' })
    vi.mocked(listSessions).mockResolvedValueOnce({
      items: [session], page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    })

    renderAuthenticatedApp('/sessions')

    const table = await screen.findByRole('table', { name: '会话' })
    expect(within(table).getByText('草稿')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /收藏|更多|重命名|归档|删除/ })).not.toBeInTheDocument()
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(table).queryByText(/0\/0/)).not.toBeInTheDocument()
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
    window.localStorage.setItem('relay.experts', JSON.stringify({
      schemaVersion: 1,
      experts: [{ id: 'private-expert', spaceId: 'space-production', draftConfig: { name: privateExpert } }],
      versions: [],
    }))
    const controlPlaneValue = JSON.stringify({ private: 'control-plane-state' })
    window.localStorage.setItem('relay.controlPlane.v1', controlPlaneValue)

    renderAuthenticatedApp('/experts')

    await waitFor(() => expect(listSessions).toHaveBeenCalledWith(
      'organization-production', 'space-production', expect.any(Object),
    ))
    expect(screen.queryByText(privateExpert)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('relay.controlPlane.v1')).toBe(controlPlaneValue)
    expect(window.localStorage.getItem('relay.experts')).toContain(privateExpert)
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
    await screen.findByText('Production Expert')

    await user.click(screen.getByRole('button', { name: '新建会话草稿' }))
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
    await screen.findByText('Production Expert')
    await user.click(screen.getByRole('button', { name: '新建会话草稿' }))
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
    expect(screen.queryByRole('button', { name: '新建会话草稿' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Relay' }))
    expect(await screen.findByRole('heading', { name: '选择 Expert，保存会话草稿' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '会话任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('只有查看权限')

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '搜索 Relay' })).toBeInTheDocument()
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
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
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
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
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
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
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
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f7f8f7')
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
    const storedSessions = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{ title: string; archived?: boolean }>
    expect(storedSessions.find((session) => session.title === '库存并发测试修复')).toMatchObject({ archived: true })
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect(screen.getByText('库存并发测试修复')).toBeInTheDocument()
  })

  it('prioritizes sessions that need attention', async () => {
    const completedSession = { ...initialRuns.find((run) => run.id === 'run-481')!, archived: false }
    const sessions = [completedSession, ...initialRuns.filter((run) => run.id !== 'run-481')]
    window.localStorage.setItem('relay.demo.sessions', JSON.stringify(sessions))

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
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{
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
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.demo.sessions') ?? '[]') as Array<{
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
      const state = JSON.parse(window.localStorage.getItem('relay.controlPlane.v1') ?? '{}') as {
        environments?: Array<{ name: string; status: string }>
      }
      expect(state.environments).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '支付回归验证', status: 'provisioning' }),
      ]))
    })
  })
})
