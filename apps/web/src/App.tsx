import type { SessionDto, SessionMessageDto } from '@relay/contracts'
import { AlertTriangle, CheckCircle2, Home, LoaderCircle, Menu, RefreshCw, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './auth/context'
import { CommandPalette } from './components/CommandPalette'
import { GlobalControls } from './components/GlobalControls'
import { NewTaskDialog, type SessionCatalogStatus } from './components/NewTaskDialog'
import { Sidebar } from './components/Sidebar'
import { IconButton } from './components/ui'
import { initialRuns } from './data/mockData'
import {
  ControlPlaneProvider,
  createEmptyControlPlaneState,
  loadControlPlaneState,
  useControlPlane,
  type InjectEventResult,
} from './features/control-plane'
import { useCatalog } from './features/catalog'
import {
  createEmptyExpertStore,
  createBlankExpert,
  createExpertFromTemplate,
  getExpertVersion,
  loadExpertStore,
  saveExpertStore,
  type ExpertStore,
} from './features/experts'
import { deriveSessionTitle, detectTaskContextItems } from './features/run/sessionDraft'
import { useRemoteSessionTimeline } from './features/session/useRemoteSessionTimeline'
import { usePreferences } from './preferences'
import {
  RelayApiError,
  createSession,
  getRuntimeCapabilities,
  getSession,
  listSessions,
  sendSessionMessage,
  startSession,
} from './services/relayApi'
import type { NewTaskInput, Run, RunAttempt, TaskCreateMode } from './types'
import { canCreateSessionInWorkspace, useActiveWorkspace } from './workspace'

const RunWorkbench = lazy(() => import('./features/run/RunWorkbench').then((module) => ({ default: module.RunWorkbench })))
const RemoteSessionWorkbench = lazy(() => import('./features/session/RemoteSessionWorkbench').then((module) => ({ default: module.RemoteSessionWorkbench })))
const RunsOverview = lazy(() => import('./pages/OverviewPages').then((module) => ({ default: module.RunsOverview })))
const SessionsPage = lazy(() => import('./pages/SessionsPage').then((module) => ({ default: module.SessionsPage })))
const ExpertsPage = lazy(() => import('./pages/ExpertsPage').then((module) => ({ default: module.ExpertsPage })))
const ExpertEditorPage = lazy(() => import('./pages/ExpertsPage').then((module) => ({ default: module.ExpertEditorPage })))
const RemoteExpertsPage = lazy(() => import('./pages/RemoteCatalogPages').then((module) => ({ default: module.RemoteExpertsPage })))
const RemoteExpertDetailPage = lazy(() => import('./pages/RemoteCatalogPages').then((module) => ({ default: module.RemoteExpertDetailPage })))
const RemoteEnvironmentsPage = lazy(() => import('./pages/RemoteCatalogPages').then((module) => ({ default: module.RemoteEnvironmentsPage })))
const CosmosHomePage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosHomePage })))
const CosmosFilesPage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosFilesPage })))
const CosmosApprovalsPage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosApprovalsPage })))
const CosmosAutomationsPage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosAutomationsPage })))
const CosmosEventLogPage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosEventLogPage })))
const CosmosRunHistoryPage = lazy(() => import('./pages/CosmosOperationsPages').then((module) => ({ default: module.CosmosRunHistoryPage })))
const EnvironmentsPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.EnvironmentsPage })))
const DaemonsPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.DaemonsPage })))
const RepositoriesControlPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.RepositoriesControlPage })))
const IntegrationsControlPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.IntegrationsControlPage })))
const McpRegistryPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.McpRegistryPage })))
const WebhooksPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.WebhooksPage })))
const SecretsPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.SecretsPage })))
const SpacesPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.SpacesPage })))
const SettingsPage = lazy(() => import('./pages/CosmosConfigurationPages').then((module) => ({ default: module.SettingsPage })))

function mapSessionStatus(status: SessionDto['status']): Run['status'] {
  return status === 'active' ? 'running' : status
}

function makeSessionIdempotencyKey(scope = String(Date.now())) {
  return `session-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sessionDtoToDemoRun(session: SessionDto, locale: 'zh' | 'en'): Run {
  const isDraft = session.status === 'draft'
  const copy = locale === 'zh'
    ? { trigger: '控制台 / 手动创建', triggerStep: '触发', plan: '规划', pending: '等待中', context: '会话已从服务端恢复' }
    : { trigger: 'Console / manual', triggerStep: 'Trigger', plan: 'Plan', pending: 'Waiting', context: 'Session restored from the server' }
  return {
    id: session.id,
    spaceId: session.spaceId,
    title: session.title,
    favorite: false,
    archived: false,
    repo: session.repository,
    branch: `relay/${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'}`,
    expert: session.expertName,
    expertId: session.expertId,
    expertVersion: session.expertVersion,
    environmentId: session.environmentId,
    visibility: session.visibility,
    status: mapSessionStatus(session.status),
    source: session.source,
    trigger: copy.trigger,
    updatedAt: session.updatedAt,
    elapsed: '0s',
    progress: session.status === 'completed' ? 100 : 0,
    model: 'GPT-5.4',
    summary: session.summary,
    baseBranch: session.baseBranch,
    acceptanceCriteria: [],
    contextItems: [],
    attachments: session.attachments,
    steps: [
      { id: 'trigger', label: copy.triggerStep, detail: isDraft ? copy.pending : copy.context, status: isDraft ? 'pending' : 'completed' },
      { id: 'plan', label: copy.plan, detail: copy.pending, status: 'pending' },
      { id: 'author', label: locale === 'zh' ? '编码' : 'Author', detail: copy.pending, status: 'pending' },
      { id: 'verify', label: locale === 'zh' ? '验证' : 'Verify', detail: copy.pending, status: 'pending' },
      { id: 'approval', label: locale === 'zh' ? '审批' : 'Approval', detail: copy.pending, status: 'pending' },
      { id: 'deliver', label: locale === 'zh' ? '交付' : 'Deliver', detail: copy.pending, status: 'pending' },
    ],
    events: [{
      id: `${session.id}-request`, kind: 'request', actor: session.expertName, title: session.title,
      body: session.summary, timestamp: session.createdAt, meta: copy.context,
    }],
    files: [],
    terminal: [],
    attempts: [],
    artifacts: [],
  }
}

function sessionDtoToRun(session: SessionDto): Run {
  return {
    id: session.id,
    serverVersion: session.version,
    spaceId: session.spaceId,
    title: session.title,
    repo: session.repository,
    branch: session.baseBranch,
    expert: session.expertName,
    expertId: session.expertId,
    expertVersion: session.expertVersion,
    environmentId: session.environmentId,
    visibility: session.visibility,
    status: mapSessionStatus(session.status),
    source: session.source,
    trigger: session.source,
    updatedAt: session.updatedAt,
    elapsed: '',
    progress: 0,
    model: '',
    summary: session.summary,
    baseBranch: session.baseBranch,
    acceptanceCriteria: [],
    contextItems: [],
    attachments: session.attachments,
    steps: [],
    events: [],
    files: [],
    terminal: [],
    attempts: [],
    artifacts: [],
  }
}

function preferNewestRun(left: Run, right: Run) {
  return (right.serverVersion ?? 0) >= (left.serverVersion ?? 0) ? right : left
}

function mergeRemoteRuns(current: Run[], incoming: Run[], preserveCurrentIds: ReadonlySet<string>) {
  const incomingById = new Map(incoming.map((run) => [run.id, run]))
  const currentOnly = current.filter((run) => (
    preserveCurrentIds.has(run.id) && !incomingById.has(run.id)
  ))
  return [
    ...currentOnly,
    ...incoming.map((run) => {
      const existing = current.find((candidate) => candidate.id === run.id)
      return existing ? preferNewestRun(existing, run) : run
    }),
  ]
}

function upsertRemoteRun(current: Run[], run: Run) {
  const existing = current.find((candidate) => candidate.id === run.id)
  const selected = existing ? preferNewestRun(existing, run) : run
  return [selected, ...current.filter((candidate) => candidate.id !== run.id)]
}

function mergeDemoSessions(current: Run[], sessions: SessionDto[], locale: 'zh' | 'en') {
  const serverRuns = sessions.map((session) => sessionDtoToDemoRun(session, locale))
  const serverIds = new Set(serverRuns.map((run) => run.id))
  return [...serverRuns, ...current.filter((run) => !serverIds.has(run.id))]
}

function inferRunSpace(run: Run) {
  return run.spaceId ?? (run.repo.startsWith('platform/') ? 'space-platform' : 'space-commerce')
}

function hydrateRun(run: Run): Run {
  const seed = initialRuns.find((item) => item.id === run.id)
  const fallbackAttemptStatus: RunAttempt['status'] = run.status === 'draft'
    ? 'queued'
    : run.status === 'completed'
    ? 'succeeded'
    : run.status === 'canceled'
      ? 'cancelled'
      : run.status === 'paused'
        ? 'queued'
        : run.status
  return {
    ...seed,
    ...run,
    spaceId: inferRunSpace(run),
    source: run.source ?? (run.trigger.toLocaleLowerCase().includes('console') || run.trigger.includes('控制台') ? 'manual' : 'automation'),
    attempts: run.attempts ?? seed?.attempts ?? [{
      id: `${run.id}-attempt-1`,
      number: 1,
      status: fallbackAttemptStatus,
      startedAt: run.updatedAt,
      duration: run.elapsed,
    }],
    artifacts: run.artifacts ?? seed?.artifacts ?? [],
  }
}

function getDemoRuns() {
  try {
    const stored = window.localStorage.getItem('relay.demo.sessions')
    if (!stored) return initialRuns.map(hydrateRun)
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as Run[]).map(hydrateRun) : initialRuns.map(hydrateRun)
  } catch {
    return initialRuns.map(hydrateRun)
  }
}

function inferExpertSpace(expert: ExpertStore['experts'][number]) {
  if (expert.spaceId) return expert.spaceId
  return expert.draftConfig.repositories.some((repository) => repository.startsWith('platform/'))
    ? 'space-platform'
    : 'space-commerce'
}

function RouteFallback() {
  const { locale } = usePreferences()
  return (
    <main className="module-page session-detail-state">
      <section role="status" aria-live="polite">
        <LoaderCircle className="cosmos-spin" aria-hidden="true" />
        <p>{locale === 'zh' ? '正在加载...' : 'Loading...'}</p>
      </section>
    </main>
  )
}

function ProductionUnavailablePage({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  return (
    <main className="cosmos-page">
      <header className="cosmos-page-header remote-catalog-header">
        <div className="cosmos-page-header__identity">
          <IconButton
            icon={Menu}
            label={locale === 'zh' ? '打开导航' : 'Open navigation'}
            className="cosmos-mobile-menu"
            onClick={onOpenNavigation}
          />
          <div>
            <h1>{locale === 'zh' ? '此模块尚未开放' : 'This module is not available'}</h1>
            <p>{locale === 'zh' ? '生产模式仅开放已接入服务端权威数据的模块。' : 'Production mode exposes only server-authoritative modules.'}</p>
          </div>
        </div>
        <div className="cosmos-page-header__actions"><GlobalControls className="cosmos-global-controls" /></div>
      </header>
      <div className="cosmos-page__content">
        <section className="cosmos-panel remote-catalog-state" role="status">
          <AlertTriangle aria-hidden="true" />
          <p>{locale === 'zh'
            ? '此页面的写入 API、权限和审计链路尚未完成，因此不会显示原型操作。'
            : 'The write API, authorization, and audit path are incomplete, so prototype actions are hidden.'}</p>
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => navigate('/home')}>
            <Home aria-hidden="true" />{locale === 'zh' ? '返回首页' : 'Back to Home'}
          </button>
        </section>
      </div>
    </main>
  )
}

function SessionRoute({
  runs,
  organizationId,
  spaceId,
  accessToken,
  credentialVersion,
  requestIdentity,
  timelineTransport,
  executionEnabled,
  handleUnauthorized,
  demoMode,
  locale,
  onOpenNavigation,
  onSessionObserved,
  onSessionConcealed,
  onDecision,
  onRetry,
  onPause,
  onStop,
}: {
  runs: Run[]
  organizationId: string
  spaceId: string
  accessToken?: string
  credentialVersion: number
  requestIdentity: string
  timelineTransport?: 'polling' | 'sse'
  executionEnabled: boolean
  handleUnauthorized: (failedAccessToken: string | undefined) => Promise<void>
  demoMode: boolean
  locale: 'zh' | 'en'
  onOpenNavigation: () => void
  onSessionObserved: (session: SessionDto) => void
  onSessionConcealed: (sessionId: string) => void
  onDecision: (runId: string, decision: 'approved' | 'changes') => void
  onRetry: (runId: string) => void
  onPause: (runId: string) => void
  onStop: (runId: string) => void
}) {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [retryVersion, setRetryVersion] = useState(0)
  const [request, setRequest] = useState<{
    key: string
    status: 'loading' | 'ready' | 'error'
    session?: SessionDto
    error?: string
    notFound?: boolean
    concealed?: boolean
  }>()
  const [startMutation, setStartMutation] = useState<{
    key: string
    status: 'idle' | 'submitting' | 'error'
    error?: string
  }>()
  const [sendMutation, setSendMutation] = useState<{
    key: string
    status: 'idle' | 'submitting' | 'error'
    error?: string
  }>()
  const [acceptedMessages, setAcceptedMessages] = useState<{
    key: string
    items: SessionMessageDto[]
  }>()
  const sendIdempotency = useRef<{ sessionId?: string; content?: string; key?: string }>({})
  const startRequest: { status: 'idle' | 'submitting' | 'error'; error?: string } = startMutation
    && startMutation.key === sessionId
    ? startMutation
    : { status: 'idle' as const }
  const startIdempotencyKey = useMemo(() => makeSessionIdempotencyKey(sessionId), [sessionId])
  const sendRequest: { status: 'idle' | 'submitting' | 'error'; error?: string } = sendMutation
    && sendMutation.key === sessionId
    ? sendMutation
    : { status: 'idle' as const }
  const run = runs.find((item) => item.id === sessionId)
  const auth = useMemo(
    () => ({ accessToken, requestIdentity, onUnauthorized: handleUnauthorized }),
    [accessToken, handleUnauthorized, requestIdentity],
  )
  const requestKey = `${organizationId}\u0000${spaceId}\u0000${sessionId ?? ''}\u0000${credentialVersion}\u0000${locale}\u0000${retryVersion}`
  const detailConcealed = request?.key === requestKey && request.concealed === true
  const concealDetail = useCallback((error: string) => {
    if (!sessionId) return
    setRequest({
      key: requestKey,
      status: 'error',
      error,
      notFound: true,
      concealed: true,
    })
    onSessionConcealed(sessionId)
  }, [onSessionConcealed, requestKey, sessionId])
  const timeline = useRemoteSessionTimeline({
    organizationId,
    spaceId,
    sessionId,
    credentialVersion,
    auth,
    enabled: !demoMode && !detailConcealed && timelineTransport !== undefined,
    transport: timelineTransport ?? 'polling',
    onConcealed: concealDetail,
  })

  useEffect(() => {
    if (!sessionId || demoMode || detailConcealed) return
    const controller = new AbortController()
    let cancelled = false
    void getSession(organizationId, spaceId, sessionId, auth, controller.signal)
      .then((session) => {
        if (cancelled) return
        setRequest({ key: requestKey, status: 'ready', session })
      }, (cause: unknown) => {
        if (cancelled) return
        const concealed = cause instanceof RelayApiError
          && cause.status !== undefined
          && [401, 403, 404].includes(cause.status)
        setRequest({
          key: requestKey,
          status: 'error',
          error: cause instanceof Error ? cause.message : (locale === 'zh' ? '无法加载会话。' : 'Unable to load the Session.'),
          notFound: concealed,
          concealed,
        })
        if (concealed) concealDetail(cause instanceof Error ? cause.message : 'Session unavailable.')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [auth, concealDetail, demoMode, detailConcealed, locale, organizationId, requestKey, sessionId, spaceId])

  const currentRequest = request?.key === requestKey ? request : undefined
  const latestSessionUpdate = timeline.events.filter((event) => event.type === 'session.updated').at(-1)
  const resolvedSession = useMemo(() => (
    currentRequest?.session && latestSessionUpdate?.type === 'session.updated'
      && latestSessionUpdate.payload.version >= currentRequest.session.version
      ? {
          ...currentRequest.session,
          status: latestSessionUpdate.payload.status,
          version: latestSessionUpdate.payload.version,
          updatedAt: latestSessionUpdate.occurredAt,
          lastActivityAt: latestSessionUpdate.occurredAt,
        }
      : currentRequest?.session
  ), [currentRequest, latestSessionUpdate])
  const visibleMessages = useMemo(() => {
    const local = acceptedMessages?.key === requestKey ? acceptedMessages.items : []
    const messages = new Map(local.map((message) => [message.id, message]))
    for (const message of timeline.messages) messages.set(message.id, message)
    return [...messages.values()].sort((left, right) => left.sequence - right.sequence)
  }, [acceptedMessages, requestKey, timeline.messages])

  const startDraft = useCallback(() => {
    if (!resolvedSession || resolvedSession.status !== 'draft' || !executionEnabled) return
    setStartMutation({ key: resolvedSession.id, status: 'submitting' })
    void startSession(
      organizationId,
      spaceId,
      resolvedSession.id,
      resolvedSession.version,
      startIdempotencyKey,
      auth,
    ).then((response) => {
      setRequest((current) => current?.key === requestKey
        ? { key: requestKey, status: 'ready', session: response.session }
        : current)
      onSessionObserved(response.session)
      setStartMutation({ key: response.session.id, status: 'idle' })
    }, (cause: unknown) => {
      const message = cause instanceof Error
        ? cause.message
        : (locale === 'zh' ? '无法启动会话。' : 'Unable to start the Session.')
      if (cause instanceof RelayApiError && cause.status === 412) {
        setRetryVersion((version) => version + 1)
      }
      if (cause instanceof RelayApiError && cause.status !== undefined && [401, 403, 404].includes(cause.status)) {
        concealDetail(message)
        return
      }
      setStartMutation({ key: resolvedSession.id, status: 'error', error: message })
    })
  }, [auth, concealDetail, executionEnabled, locale, onSessionObserved, organizationId, requestKey, resolvedSession, spaceId, startIdempotencyKey])

  const sendFollowUp = useCallback(async (content: string) => {
    if (
      !resolvedSession
      || !executionEnabled
      || resolvedSession.status === 'draft'
      || resolvedSession.status === 'canceled'
    ) return
    const currentKey = sendIdempotency.current
    if (
      currentKey.sessionId !== resolvedSession.id
      || currentKey.content !== content
      || !currentKey.key
    ) {
      sendIdempotency.current = {
        sessionId: resolvedSession.id,
        content,
        key: makeSessionIdempotencyKey(resolvedSession.id),
      }
    }
    setSendMutation({ key: resolvedSession.id, status: 'submitting' })
    try {
      const response = await sendSessionMessage(
        organizationId,
        spaceId,
        resolvedSession.id,
        { content },
        sendIdempotency.current.key!,
        auth,
      )
      setRequest((current) => current?.key === requestKey
        ? { key: requestKey, status: 'ready', session: response.session }
        : current)
      const acceptedMessage: SessionMessageDto = {
        ...response.message,
        organizationId,
        spaceId,
      }
      setAcceptedMessages((current) => {
        const items = current?.key === requestKey ? current.items : []
        return {
          key: requestKey,
          items: [...items.filter((message) => message.id !== acceptedMessage.id), acceptedMessage],
        }
      })
      onSessionObserved(response.session)
      sendIdempotency.current = {}
      setSendMutation({ key: response.session.id, status: 'idle' })
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : (locale === 'zh' ? '无法发送后续消息。' : 'Unable to send the follow-up message.')
      if (cause instanceof RelayApiError && cause.status !== undefined && [401, 403, 404].includes(cause.status)) {
        concealDetail(message)
      } else {
        setSendMutation({ key: resolvedSession.id, status: 'error', error: message })
      }
      throw cause
    }
  }, [auth, concealDetail, executionEnabled, locale, onSessionObserved, organizationId, requestKey, resolvedSession, spaceId])

  useEffect(() => {
    if (!resolvedSession || resolvedSession === currentRequest?.session) return
    onSessionObserved(resolvedSession)
  }, [currentRequest?.session, onSessionObserved, resolvedSession])

  if (!sessionId) return <Navigate to="/sessions" replace />
  const resolvedRun = demoMode
    ? run
    : undefined
  if (resolvedRun) {
    return (
      <RunWorkbench
        key={resolvedRun.id}
        run={resolvedRun}
        onOpenNavigation={onOpenNavigation}
        onDecision={onDecision}
        onRetry={onRetry}
        onPause={onPause}
        onStop={onStop}
      />
    )
  }
  if (demoMode) return <Navigate to="/sessions" replace />

  if (detailConcealed || timeline.concealed) {
    return (
      <main className="module-page session-detail-state">
        <section role="alert">
          <AlertTriangle aria-hidden="true" />
          <h1>{locale === 'zh' ? '会话不存在或无权访问' : 'Session not found or unavailable'}</h1>
          <p>{locale === 'zh'
            ? '当前凭证无法继续访问此会话。'
            : 'The current credentials can no longer access this Session.'}</p>
        </section>
      </main>
    )
  }

  if (currentRequest?.status === 'ready' && resolvedSession) {
    return (
      <RemoteSessionWorkbench
        session={resolvedSession}
        messages={visibleMessages}
        events={timeline.events}
        timelineStatus={timeline.status}
        timelineError={timeline.error}
        executionEnabled={executionEnabled}
        startStatus={startRequest.status}
        startError={startRequest.error}
        onStart={startDraft}
        sendStatus={sendRequest.status}
        sendError={sendRequest.error}
        onSend={sendFollowUp}
        onOpenNavigation={onOpenNavigation}
        onBack={() => navigate('/sessions')}
      />
    )
  }
  if (currentRequest?.status === 'error') {
    return (
      <main className="module-page session-detail-state">
        <section role="alert">
          <AlertTriangle aria-hidden="true" />
          <h1>{currentRequest.notFound
            ? (locale === 'zh' ? '会话不存在或无权访问' : 'Session not found or unavailable')
            : (locale === 'zh' ? '无法加载会话' : 'Unable to load Session')}</h1>
          <p>{currentRequest.error}</p>
          {!currentRequest.notFound ? (
            <button type="button" className="button button--primary" onClick={() => setRetryVersion((value) => value + 1)}>
              <RefreshCw aria-hidden="true" />{locale === 'zh' ? '重试' : 'Retry'}
            </button>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="module-page session-detail-state">
      <section role="status" aria-live="polite">
        <LoaderCircle className="cosmos-spin" aria-hidden="true" />
        <p>{locale === 'zh' ? '正在加载会话...' : 'Loading Session...'}</p>
      </section>
    </main>
  )
}

function LegacySessionRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={sessionId ? `/sessions/${sessionId}` : '/sessions'} replace />
}

function ExpertEditorRoute({
  store,
  onStoreChange,
  onOpenNavigation,
  onBack,
  onStartSession,
  onNotify,
}: {
  store: ExpertStore
  onStoreChange: (store: ExpertStore) => void
  onOpenNavigation: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  onNotify: (message: string) => void
}) {
  const { expertId } = useParams()
  const expert = store.experts.find((item) => item.id === expertId)
  if (!expertId || !expert) return <Navigate to="/experts" replace />
  return (
    <ExpertEditorPage
      key={`${expert.id}:${expert.updatedAt}`}
      store={store}
      expertId={expertId}
      onStoreChange={onStoreChange}
      onOpenNavigation={onOpenNavigation}
      onBack={onBack}
      onStartSession={onStartSession}
      onNotify={onNotify}
    />
  )
}

function RemoteExpertRoute({
  organizationId,
  spaceId,
  accessToken,
  credentialVersion,
  requestIdentity,
  handleUnauthorized,
  onOpenNavigation,
  onBack,
  onStartSession,
  sessionCreationEnabled,
}: {
  organizationId: string
  spaceId: string
  accessToken?: string
  credentialVersion: number
  requestIdentity: string
  handleUnauthorized: (failedAccessToken: string | undefined) => Promise<void>
  onOpenNavigation: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  sessionCreationEnabled: boolean
}) {
  const { expertId } = useParams()
  const auth = useMemo(
    () => ({ accessToken, requestIdentity, onUnauthorized: handleUnauthorized }),
    [accessToken, handleUnauthorized, requestIdentity],
  )
  if (!expertId) return <Navigate to="/experts" replace />
  return (
    <RemoteExpertDetailPage
      organizationId={organizationId}
      spaceId={spaceId}
      expertId={expertId}
      auth={auth}
      credentialVersion={credentialVersion}
      onOpenNavigation={onOpenNavigation}
      onBack={onBack}
      onStartSession={onStartSession}
      sessionCreationEnabled={sessionCreationEnabled}
    />
  )
}

function ExpertEditRedirect() {
  const { expertId } = useParams()
  return <Navigate to={expertId ? `/experts/${expertId}` : '/experts'} replace />
}

function RelayApp() {
  const { accessToken, credentialVersion, demoMode, handleUnauthorized } = useAuth()
  const workspace = useActiveWorkspace()
  const { organization } = workspace
  const organizationId = organization.id
  const requestIdentity = `${workspace.me.actor.id}\u0000${credentialVersion}`
  const sessionCreationEnabled = canCreateSessionInWorkspace(workspace)
  const [runs, setRuns] = useState<Run[]>(() => demoMode ? getDemoRuns() : [])
  const [runsIdentity, setRunsIdentity] = useState(() => demoMode ? 'demo' : '')
  const runsIdentityRef = useRef(runsIdentity)
  const remoteMutationVersionRef = useRef(0)
  const remoteRunMutationVersionsRef = useRef(new Map<string, number>())
  const concealedRemoteSessionsRef = useRef<{ identity: string; ids: Set<string> }>({
    identity: '', ids: new Set(),
  })
  const [sessionsRequest, setSessionsRequest] = useState<{
    key: string
    status: 'ready' | 'error'
    error: string
  }>()
  const [sessionsRetryVersion, setSessionsRetryVersion] = useState(0)
  const [runtimeCapabilityRequest, setRuntimeCapabilityRequest] = useState<{
    key: string
    status: 'ready' | 'error'
    executionEnabled: boolean
    events?: 'polling' | 'sse'
    error?: string
  }>()
  const [runtimeCapabilityRetryVersion, setRuntimeCapabilityRetryVersion] = useState(0)
  const [expertStore, setExpertStore] = useState<ExpertStore>(() => (
    demoMode ? loadExpertStore() : createEmptyExpertStore()
  ))
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('relay.sidebarCollapsed') === 'true'
    } catch {
      return false
    }
  })
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [presetExpertId, setPresetExpertId] = useState<string>()
  const [presetPrompt, setPresetPrompt] = useState('')
  const [toast, setToast] = useState('')
  const sessionIdempotencyKeys = useRef(new Map<string, string>())
  const navigate = useNavigate()
  const location = useLocation()
  const { locale, t } = usePreferences()
  const { activeSpace, scope } = useControlPlane()
  const catalogAuth = useMemo(
    () => ({ accessToken, requestIdentity, onUnauthorized: handleUnauthorized }),
    [accessToken, handleUnauthorized, requestIdentity],
  )
  const catalog = useCatalog({
    organizationId,
    spaceId: activeSpace.id,
    accessToken,
    credentialVersion,
    onUnauthorized: handleUnauthorized,
    enabled: !demoMode,
  })
  const runtimeCapabilityKey = `${credentialVersion}\u0000${runtimeCapabilityRetryVersion}`
  const currentRuntimeCapability = runtimeCapabilityRequest?.key === runtimeCapabilityKey
    ? runtimeCapabilityRequest
    : undefined
  const productionExecutionEnabled = !demoMode
    && currentRuntimeCapability?.status === 'ready'
    && currentRuntimeCapability.executionEnabled
  const sessionsRequestKey = `${organizationId}\u0000${activeSpace.id}\u0000${requestIdentity}\u0000${locale}\u0000${sessionsRetryVersion}`
  const sessionsState = sessionsRequest?.key === sessionsRequestKey ? sessionsRequest.status : 'loading'
  const sessionsError = sessionsRequest?.key === sessionsRequestKey ? sessionsRequest.error : ''

  const scopedRuns = useMemo(
    () => (demoMode || runsIdentity === sessionsRequestKey ? runs : [])
      .filter((run) => inferRunSpace(run) === activeSpace.id),
    [activeSpace.id, demoMode, runs, runsIdentity, sessionsRequestKey],
  )
  const scopedExpertStore = useMemo<ExpertStore>(() => {
    const experts = expertStore.experts.filter((expert) => inferExpertSpace(expert) === activeSpace.id)
    const ids = new Set(experts.map((expert) => expert.id))
    return { ...expertStore, experts, versions: expertStore.versions.filter((version) => ids.has(version.expertId)) }
  }, [activeSpace.id, expertStore])

  useEffect(() => {
    if (demoMode) return
    const controller = new AbortController()
    const requestKey = runtimeCapabilityKey
    void getRuntimeCapabilities(catalogAuth, controller.signal).then((capabilities) => {
      if (controller.signal.aborted) return
      setRuntimeCapabilityRequest({
        key: requestKey,
        status: 'ready',
        executionEnabled: capabilities.execution.enabled,
        events: capabilities.execution.events,
      })
    }, (cause: unknown) => {
      if (controller.signal.aborted) return
      setRuntimeCapabilityRequest({
        key: requestKey,
        status: 'error',
        executionEnabled: false,
        error: cause instanceof Error ? cause.message : 'Unable to discover runtime capabilities.',
      })
    })
    return () => controller.abort()
  }, [catalogAuth, demoMode, runtimeCapabilityKey])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    try {
      window.localStorage.setItem('relay.sidebarCollapsed', String(sidebarCollapsed))
    } catch {
      // The collapsed state still applies for this browser session.
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!demoMode) return
    try {
      window.localStorage.setItem('relay.demo.sessions', JSON.stringify(runs))
    } catch {
      // Demo state remains available for the current browser session.
    }
  }, [demoMode, runs])

  useEffect(() => {
    if (demoMode) saveExpertStore(expertStore)
  }, [demoMode, expertStore])

  useEffect(() => {
    let cancelled = false
    const requestKey = sessionsRequestKey
    const requestMutationVersion = remoteMutationVersionRef.current
    void listSessions(organizationId, activeSpace.id, {
      accessToken,
      requestIdentity,
      onUnauthorized: handleUnauthorized,
    })
      .then(({ items }) => {
        if (cancelled) return
        if (demoMode) {
          setRuns((current) => mergeDemoSessions(current, items, locale))
        } else {
          const sameIdentity = runsIdentityRef.current === requestKey
          const preserveCurrentIds = new Set(
            [...remoteRunMutationVersionsRef.current]
              .filter(([, mutationVersion]) => mutationVersion > requestMutationVersion)
              .map(([sessionId]) => sessionId),
          )
          runsIdentityRef.current = requestKey
          const concealedIds = concealedRemoteSessionsRef.current.identity === requestKey
            ? concealedRemoteSessionsRef.current.ids
            : new Set<string>()
          setRuns((current) => mergeRemoteRuns(
            sameIdentity ? current : [],
            items.filter((session) => !concealedIds.has(session.id)).map(sessionDtoToRun),
            sameIdentity ? preserveCurrentIds : new Set(),
          ))
          for (const [sessionId, mutationVersion] of remoteRunMutationVersionsRef.current) {
            if (mutationVersion <= requestMutationVersion) {
              remoteRunMutationVersionsRef.current.delete(sessionId)
            }
          }
          setRunsIdentity(requestKey)
        }
        setSessionsRequest({ key: requestKey, status: 'ready', error: '' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (!demoMode) {
          runsIdentityRef.current = requestKey
          setRuns([])
          setRunsIdentity(requestKey)
        }
        setSessionsRequest({
          key: requestKey,
          status: 'error',
          error: error instanceof Error ? error.message : (locale === 'zh' ? '无法加载会话。' : 'Unable to load Sessions.'),
        })
      })
    return () => { cancelled = true }
  }, [accessToken, activeSpace.id, demoMode, handleUnauthorized, locale, organizationId, requestIdentity, sessionsRequestKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const mergeScopedExpertStore = (next: ExpertStore) => {
    setExpertStore((current) => {
      const currentScopedIds = new Set(current.experts.filter((expert) => inferExpertSpace(expert) === activeSpace.id).map((expert) => expert.id))
      const nextExperts = next.experts.map((expert) => ({ ...expert, spaceId: activeSpace.id }))
      return {
        ...next,
        experts: [
          ...current.experts.filter((expert) => inferExpertSpace(expert) !== activeSpace.id),
          ...nextExperts,
        ],
        versions: [
          ...current.versions.filter((version) => !currentScopedIds.has(version.expertId)),
          ...next.versions,
        ],
      }
    })
  }

  const createTask = async (input: NewTaskInput, mode: TaskCreateMode) => {
    if (!sessionCreationEnabled) {
      throw new Error(locale === 'zh' ? '你在当前 Space 中只有查看权限。' : 'You have view-only access in this Space.')
    }
    if (!input.expertId) {
      throw new Error(locale === 'zh' ? '请选择一个可用的 Expert。' : 'Choose an available Expert.')
    }
    if (!demoMode && mode === 'run' && !productionExecutionEnabled) {
      throw new Error(locale === 'zh'
        ? '执行能力尚未确认，请刷新能力状态后重试。'
        : 'Execution capability is not confirmed. Refresh capability status and retry.')
    }
    const isDraft = mode === 'draft'
    const expert = input.expertId ? scopedExpertStore.experts.find((item) => item.id === input.expertId) : undefined
    const version = expert?.publishedVersionId ? getExpertVersion(scopedExpertStore, expert.publishedVersionId) : undefined
    const model = version?.configSnapshot.model ?? expert?.draftConfig.model ?? 'GPT-5.4'
    const requestFingerprint = JSON.stringify({ spaceId: activeSpace.id, mode, input })
    const idempotencyKey = sessionIdempotencyKeys.current.get(requestFingerprint) ?? makeSessionIdempotencyKey()
    sessionIdempotencyKeys.current.set(requestFingerprint, idempotencyKey)
    const authoritativeRequest = {
      expertId: input.expertId,
      title: input.title,
      visibility: input.visibility ?? 'private',
      start: !isDraft,
      message: {
        content: input.description,
        attachments: demoMode ? input.attachments ?? [] : [],
      },
    }
    const { session } = await createSession(
      organizationId,
      activeSpace.id,
      demoMode ? {
        ...authoritativeRequest,
        expertName: input.expert,
        expertVersion: input.expertVersion,
        environmentId: input.environmentId,
        repository: input.repo,
        baseBranch: input.baseBranch,
        advancedOverrides: {
          repositoryId: input.repositoryId,
          baseBranch: input.baseBranch,
        },
      } : authoritativeRequest,
      idempotencyKey,
      { accessToken, requestIdentity, onUnauthorized: handleUnauthorized },
    )
    sessionIdempotencyKeys.current.delete(requestFingerprint)
    const id = session.id
    const now = session.updatedAt
    const copy = locale === 'zh'
      ? {
          trigger: '控制台 / 手动创建', triggerStep: '触发', triggerDetail: isDraft ? '草稿未启动' : '命令已接受',
          plan: '规划', planDetail: isDraft ? '等待启动' : '等待 Worker', author: '编码', verify: '验证', approval: '审批', deliver: '交付',
          pending: '等待中', policy: '按策略', console: '来自控制台',
        }
      : {
          trigger: 'Console / manual', triggerStep: 'Trigger', triggerDetail: isDraft ? 'Draft not started' : 'Command accepted',
          plan: 'Plan', planDetail: isDraft ? 'Waiting to start' : 'Waiting for Worker', author: 'Author', verify: 'Verify', approval: 'Approval', deliver: 'Deliver',
          pending: 'Waiting', policy: 'By policy', console: 'From console',
        }
    const run: Run = demoMode ? {
      id,
      spaceId: session.spaceId,
      title: session.title,
      favorite: false,
      archived: false,
      repo: session.repository,
      branch: `relay/${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-task'}`,
      expert: session.expertName,
      expertId: session.expertId,
      expertVersion: session.expertVersion,
      environmentId: session.environmentId,
      visibility: session.visibility,
      status: mapSessionStatus(session.status),
      source: session.source,
      trigger: copy.trigger,
      updatedAt: now,
      elapsed: '0s',
      progress: 0,
      model,
      summary: session.summary,
      baseBranch: session.baseBranch,
      acceptanceCriteria: input.acceptanceCriteria,
      contextItems: input.contextItems,
      attachments: session.attachments,
      steps: [
        { id: 'trigger', label: copy.triggerStep, detail: copy.triggerDetail, status: isDraft ? 'pending' : 'completed' },
        { id: 'plan', label: copy.plan, detail: copy.planDetail, status: 'pending' },
        { id: 'author', label: copy.author, detail: copy.pending, status: 'pending' },
        { id: 'verify', label: copy.verify, detail: copy.pending, status: 'pending' },
        { id: 'approval', label: copy.approval, detail: copy.policy, status: 'pending' },
        { id: 'deliver', label: copy.deliver, detail: copy.pending, status: 'pending' },
      ],
      events: [
        { id: `${id}-request`, kind: 'request', actor: 'User', title: session.title, body: session.summary, timestamp: session.createdAt, meta: copy.console },
      ],
      files: [],
      terminal: [],
      attempts: [],
      artifacts: [],
    } : sessionDtoToRun(session)
    if (demoMode) {
      setRuns((items) => upsertRemoteRun(items, run))
    } else {
      const sameIdentity = runsIdentityRef.current === sessionsRequestKey
      const mutationVersion = remoteMutationVersionRef.current + 1
      remoteMutationVersionRef.current = mutationVersion
      remoteRunMutationVersionsRef.current.set(run.id, mutationVersion)
      runsIdentityRef.current = sessionsRequestKey
      setRuns((items) => upsertRemoteRun(sameIdentity ? items : [], run))
      setRunsIdentity(sessionsRequestKey)
    }
    setNewTaskOpen(false)
    setPresetExpertId(undefined)
    setToast(isDraft
      ? (locale === 'zh' ? '会话草稿已保存' : 'Session draft saved')
      : (locale === 'zh' ? '会话已创建，等待 Worker 接收命令' : 'Session created and waiting for a Worker.'))
    navigate(isDraft ? '/sessions' : `/sessions/${id}`)
  }

  const decide = (runId: string, decision: 'approved' | 'changes') => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => {
      if (run.id !== runId) return run
      const approved = decision === 'approved'
      const prNumber = run.id.replace(/\D/g, '').slice(-4) || '1042'
      const artifacts = approved && !(run.artifacts ?? []).some((artifact) => artifact.type === 'pull_request')
        ? [...(run.artifacts ?? []), { id: `${run.id}-pr`, type: 'pull_request' as const, label: `PR #${prNumber}`, url: `https://github.com/acme/${run.repo}/pull/${prNumber}`, status: 'open' as const }]
        : run.artifacts
      return {
        ...run,
        status: approved ? 'completed' : 'running',
        progress: approved ? 100 : 68,
        updatedAt: locale === 'zh' ? '刚刚' : 'Just now',
        approval: run.approval ? {
          ...run.approval,
          status: approved ? 'approved' : 'changes_requested',
          decidedAt: new Date().toISOString(),
          decisionNote: approved ? 'Approved from Relay decision inbox.' : 'Changes requested from Relay decision inbox.',
        } : undefined,
        attempts: run.attempts?.map((attempt, index, all) => index === all.length - 1 ? { ...attempt, status: approved ? 'succeeded' as const : 'running' as const, finishedAt: approved ? new Date().toISOString() : undefined } : attempt),
        artifacts,
        terminal: approved ? [...run.terminal, '$ gh pr create --fill', `Created PR #${prNumber}`] : run.terminal,
        steps: run.steps.map((step) => {
          if (approved) return { ...step, status: 'completed' as const, detail: step.id === 'deliver' ? `PR #${prNumber}` : step.id === 'approval' ? '已批准' : step.detail }
          if (step.id === 'author') return { ...step, status: 'active' as const, detail: '按反馈修改' }
          if (['verify', 'approval', 'deliver'].includes(step.id)) return { ...step, status: 'pending' as const, detail: '等待中' }
          return step
        }),
        events: [
          ...run.events,
          {
            id: `${run.id}-${decision}-${Date.now()}`,
            kind: 'approval' as const,
            actor: '林澈',
            title: approved ? '已批准继续交付' : '已要求专家修改',
            body: approved ? `风险与验证证据已确认，已生成 PR #${prNumber}。` : '请按审批意见修改，并重新提交验证证据。',
            timestamp: locale === 'zh' ? '刚刚' : 'Just now',
            meta: '决策已写入审计记录',
            status: approved ? 'success' as const : 'warning' as const,
          },
        ],
      }
    }))
    setToast(decision === 'approved'
      ? (locale === 'zh' ? '审批已记录，Pull Request 已生成' : 'Approval recorded and Pull Request created.')
      : (locale === 'zh' ? '修改意见已发送给执行专家' : 'Change request sent to the execution Expert.'))
  }

  const retry = (runId: string) => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => {
      if (run.id !== runId) return run
      const attemptNumber = (run.attempts?.length ?? 0) + 1
      return {
        ...run,
        status: 'completed',
        progress: 100,
        updatedAt: locale === 'zh' ? '刚刚' : 'Just now',
        steps: run.steps.map((step) => step.id === 'verify' || step.id === 'deliver'
          ? { ...step, status: 'completed' as const, detail: step.id === 'verify' ? '重试通过' : '结果已保存' }
          : step.status === 'failed' ? { ...step, status: 'completed' as const, detail: '重试通过' } : step),
        attempts: [
          ...(run.attempts ?? []),
          { id: `${run.id}-attempt-${attemptNumber}`, number: attemptNumber, status: 'succeeded' as const, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), duration: '1m 12s' },
        ],
        terminal: [...run.terminal, '$ relay attempt retry --from verify', 'Sandbox restored', 'All checks passed'],
        events: [...run.events, {
          id: `${run.id}-retry-${attemptNumber}`,
          kind: 'result' as const,
          actor: run.expert,
          title: locale === 'zh' ? `Attempt ${attemptNumber} 已成功` : `Attempt ${attemptNumber} succeeded`,
          body: locale === 'zh' ? '已在新的隔离环境中恢复执行并通过全部验证。失败的 Attempt 仍保留在历史中。' : 'Execution resumed in a new isolated environment and all checks passed. The failed Attempt remains in history.',
          timestamp: locale === 'zh' ? '刚刚' : 'Just now',
          meta: 'Deterministic prototype retry',
          status: 'success' as const,
        }],
      }
    }))
    setToast(locale === 'zh' ? '已创建新的 Attempt，重试成功' : 'A new Attempt was created and succeeded.')
  }

  const pauseRun = (runId: string) => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => {
      if (run.id !== runId || ['completed', 'canceled', 'failed', 'waiting'].includes(run.status)) return run
      const paused = run.status === 'running'
      return {
        ...run,
        status: paused ? 'paused' : 'running',
        updatedAt: locale === 'zh' ? '刚刚' : 'Just now',
        attempts: run.attempts?.map((attempt, index, all) => index === all.length - 1 ? { ...attempt, status: paused ? 'queued' as const : 'running' as const } : attempt),
      }
    }))
    setToast(locale === 'zh' ? '会话运行状态已更新' : 'Session run state updated.')
  }

  const stopRun = (runId: string) => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => run.id === runId ? {
      ...run,
      status: 'canceled',
      updatedAt: locale === 'zh' ? '刚刚' : 'Just now',
      attempts: run.attempts?.map((attempt, index, all) => index === all.length - 1 ? { ...attempt, status: 'cancelled' as const, finishedAt: new Date().toISOString() } : attempt),
      events: [...run.events, { id: `${run.id}-stopped`, kind: 'result' as const, actor: '林澈', title: locale === 'zh' ? '会话已停止' : 'Session stopped', body: locale === 'zh' ? '当前 Attempt 已取消，历史和产物仍被保留。' : 'The current Attempt was cancelled; history and artifacts remain available.', timestamp: locale === 'zh' ? '刚刚' : 'Just now', status: 'warning' as const }],
    } : run))
    setToast(locale === 'zh' ? '会话已停止' : 'Session stopped.')
  }

  const openNewTask = (expertId?: string, initialPrompt = '') => {
    if (!sessionCreationEnabled) return
    setPresetExpertId(expertId)
    setPresetPrompt(initialPrompt)
    setNewTaskOpen(true)
  }

  const createExpert = () => {
    const repository = scope.repositories[0]?.fullName
    const environment = scope.environments.find((item) => item.status === 'ready')
    const result = createBlankExpert(scopedExpertStore, {
      config: {
        name: locale === 'zh' ? '未命名专家' : 'Untitled expert',
        model: 'GPT-5.4',
        repositories: repository ? [repository] : [],
        environment: environment ? { environmentId: environment.id, image: environment.image } : undefined,
      },
    })
    mergeScopedExpertStore({ ...result.store, experts: result.store.experts.map((expert) => expert.id === result.expert.id ? { ...expert, spaceId: activeSpace.id } : expert) })
    navigate(`/experts/${result.expert.id}/edit`)
  }

  const forkExpertTemplate = (templateId: string) => {
    const repository = scope.repositories[0]?.fullName
    const environment = scope.environments.find((item) => item.status === 'ready')
    const result = createExpertFromTemplate(scopedExpertStore, templateId, {
      config: {
        model: 'GPT-5.4',
        repositories: repository ? [repository] : [],
        capabilities: ['read-code', 'write-code', 'run-command', 'create-pr'],
        constraints: locale === 'zh' ? ['只修改任务范围内的代码', '外部写操作遵循审批策略'] : ['Only change code within task scope', 'Respect approval policy for external writes'],
        completionCriteria: locale === 'zh' ? ['相关测试通过', '输出变更摘要与验证证据'] : ['Relevant tests pass', 'Return a change summary and verification evidence'],
        context: { pathScopes: ['src/**', 'test/**'] },
        tools: [
          { id: 'github', name: 'GitHub', enabled: true, permissions: ['read', 'write'] },
          { id: 'shell', name: 'Shell', enabled: true, permissions: ['read', 'execute'] },
        ],
        environment: {
          environmentId: environment?.id,
          image: environment?.image ?? 'relay-ubuntu-22.04', timeoutMinutes: 45, networkPolicy: 'allowlist', allowedHosts: ['github.com', 'api.github.com'],
        },
        launchGuidance: locale === 'zh' ? '提供目标、约束、仓库和可验证的验收标准。' : 'Provide the goal, constraints, repository, and verifiable acceptance criteria.',
      },
    })
    mergeScopedExpertStore({ ...result.store, experts: result.store.experts.map((expert) => expert.id === result.expert.id ? { ...expert, spaceId: activeSpace.id } : expert) })
    setToast(locale === 'zh' ? '已从模板创建专家草稿' : 'Expert draft created from template')
    navigate(`/experts/${result.expert.id}/edit`)
  }

  const publishedExpertOptions = scopedExpertStore.experts.flatMap((expert) => {
    if (expert.status !== 'published' || !expert.publishedVersionId) return []
    const version = getExpertVersion(scopedExpertStore, expert.publishedVersionId)
    const config = version?.configSnapshot ?? expert.draftConfig
    const enabledTools = config.tools.filter((tool) => tool.enabled).map((tool) => tool.name)
    const approval = config.approvalPolicy.mode === 'always'
      ? (locale === 'zh' ? '所有外部写操作需审批' : 'Approve every external write')
      : config.approvalPolicy.mode === 'never'
        ? (locale === 'zh' ? '无需审批' : 'No approval required')
        : (locale === 'zh' ? '按风险策略审批' : 'Risk-based approval')
    return [{
      id: expert.id,
      version: version?.version ?? expert.latestVersion,
      name: config.name,
      description: config.description,
      launchGuidance: config.launchGuidance,
      group: config.category,
      tools: enabledTools.length ? enabledTools.join(' · ') : (locale === 'zh' ? '基础上下文工具' : 'Core context tools'),
      environment: config.environment.image || (locale === 'zh' ? '托管环境' : 'Managed environment'),
      environmentId: config.environment.environmentId,
      repository: config.repositories[0],
      approval,
      successRate: expert.latestVersion > 0 ? '96.4%' : '—',
    }]
  })

  const advisorExpertOption = {
    id: 'expert-cosmos-advisor',
    version: 1,
    name: 'Cosmos Advisor',
    description: locale === 'zh' ? '通过对话连接集成、构建环境、部署 Expert 并配置自动化。' : 'Connect integrations, build Environments, deploy Experts, and configure Automations conversationally.',
    launchGuidance: locale === 'zh' ? '描述你想搭建或诊断的 Cosmos 工作流。' : 'Describe the Cosmos workflow you want to configure or diagnose.',
    group: locale === 'zh' ? '内置 Expert' : 'Built-in Expert',
    tools: locale === 'zh' ? 'Cosmos 配置 · 诊断' : 'Cosmos configuration · Diagnostics',
    environment: locale === 'zh' ? '托管控制平面' : 'Managed control plane',
    environmentId: scope.environments.find((environment) => environment.status === 'ready')?.id,
    repository: scope.repositories[0]?.fullName,
    approval: locale === 'zh' ? '变更前确认' : 'Confirm before changes',
    successRate: '—',
    builtIn: true,
  }
  const demoSessionExpertOptions = [advisorExpertOption, ...publishedExpertOptions]
  const remoteSessionEnvironments = catalog.environments.items.map((environment) => ({
    id: environment.id,
    name: environment.name,
    image: locale === 'zh' ? '托管运行环境' : 'Managed runtime',
    ready: environment.status === 'ready' && environment.activeRevision !== null,
  }))
  const remoteSessionRepositories = [...new Map(catalog.environments.items.flatMap((environment) => {
    const repository = environment.activeRevision?.defaultRepository
    return repository ? [[repository.repositoryId, {
      id: repository.repositoryId,
      fullName: repository.repository,
      defaultBranch: repository.baseBranch,
    }] as const] : []
  })).values()]
  const remoteSessionExpertOptions = catalog.experts.items.flatMap((expert) => {
    const revision = expert.publishedRevisionSummary
    if (expert.status !== 'published' || !revision) return []
    const environment = catalog.environments.items.find((item) => (
      item.id === revision.environmentId
      && item.status === 'ready'
      && item.activeRevision?.id === revision.environmentRevisionId
    ))
    if (!environment?.activeRevision) return []
    const policy = revision.allowRepositoryOverride || revision.allowBaseBranchOverride
      ? (locale === 'zh' ? '允许受控覆盖' : 'Controlled overrides')
      : (locale === 'zh' ? '环境与分支已锁定' : 'Environment and branch locked')
    return [{
      id: expert.id,
      version: revision.revision,
      name: expert.name,
      description: expert.description,
      launchGuidance: locale === 'zh' ? '描述本次会话要完成的目标。' : 'Describe the objective for this Session.',
      group: expert.visibility === 'private'
        ? (locale === 'zh' ? '我的 Expert' : 'My Experts')
        : (locale === 'zh' ? 'Space Expert' : 'Space Experts'),
      tools: '—',
      environment: environment.name,
      environmentId: environment.id,
      repository: environment.activeRevision.defaultRepository.repository,
      approval: policy,
      successRate: '—',
    }]
  })
  const sessionExpertOptions = demoMode ? demoSessionExpertOptions : remoteSessionExpertOptions
  const runtimeCapabilityError = !demoMode && currentRuntimeCapability?.status === 'error'
    ? currentRuntimeCapability.error ?? (locale === 'zh' ? '无法确认执行能力。' : 'Unable to confirm execution capability.')
    : ''
  const sessionCatalogErrors = [catalog.experts.error, catalog.environments.error]
    .filter((error): error is Error => error !== null)
  const sessionCatalogError = [
    ...sessionCatalogErrors.map((error) => error.message),
    runtimeCapabilityError,
  ]
    .filter(Boolean)
    .join(' ')
  const sessionCatalogStatus: SessionCatalogStatus = demoMode
    ? 'ready'
    : runtimeCapabilityError || sessionCatalogErrors.length
      ? 'error'
      : currentRuntimeCapability?.status !== 'ready'
        ? 'loading'
        : catalog.experts.ready && catalog.environments.ready
        ? remoteSessionExpertOptions.length
          ? 'ready'
          : 'empty'
        : 'loading'
  const retrySessionCatalog = () => {
    if (catalog.experts.error) catalog.experts.retry()
    if (catalog.environments.error) catalog.environments.retry()
    if (currentRuntimeCapability?.status === 'error') {
      setRuntimeCapabilityRetryVersion((version) => version + 1)
    }
  }
  const sessionRepositories = demoMode
    ? scope.repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      }))
    : remoteSessionRepositories
  const sessionEnvironments = demoMode
    ? scope.environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        image: environment.image,
        ready: environment.status === 'ready',
      }))
    : remoteSessionEnvironments

  const createHomeSession = async ({
    expertId,
    prompt,
    visibility,
    attachments,
    mode,
  }: {
    expertId: string
    prompt: string
    visibility: 'private' | 'space'
    attachments: string[]
    mode: TaskCreateMode
  }) => {
    const expert = sessionExpertOptions.find((item) => item.id === expertId)
    const repository = sessionRepositories.find((item) => item.fullName === expert?.repository) ?? sessionRepositories[0]
    const environment = sessionEnvironments.find((item) => item.id === expert?.environmentId)
      ?? sessionEnvironments.find((item) => item.ready)
    if (!expert || !repository || !environment) {
      setToast(locale === 'zh' ? 'Expert 的仓库或环境尚未就绪' : 'The Expert repository or environment is not ready.')
      return
    }
    await createTask({
      title: deriveSessionTitle(prompt),
      description: prompt,
      repo: repository.fullName,
      repositoryId: repository.id,
      expert: expert.name,
      expertId: expert.id,
      expertVersion: expert.version,
      environmentId: environment.id,
      visibility,
      baseBranch: repository.defaultBranch,
      acceptanceCriteria: [],
      contextItems: detectTaskContextItems(prompt),
      attachments,
    }, mode)
  }

  const observeRemoteSession = useCallback((session: SessionDto) => {
    if (demoMode) return
    const sameIdentity = runsIdentityRef.current === sessionsRequestKey
    const mutationVersion = remoteMutationVersionRef.current + 1
    remoteMutationVersionRef.current = mutationVersion
    remoteRunMutationVersionsRef.current.set(session.id, mutationVersion)
    runsIdentityRef.current = sessionsRequestKey
    setRuns((current) => upsertRemoteRun(
      sameIdentity ? current : [],
      sessionDtoToRun(session),
    ))
    setRunsIdentity(sessionsRequestKey)
  }, [demoMode, sessionsRequestKey])

  const concealRemoteSession = useCallback((sessionId: string) => {
    if (demoMode) return
    if (concealedRemoteSessionsRef.current.identity !== sessionsRequestKey) {
      concealedRemoteSessionsRef.current = { identity: sessionsRequestKey, ids: new Set() }
    }
    concealedRemoteSessionsRef.current.ids.add(sessionId)
    remoteRunMutationVersionsRef.current.delete(sessionId)
    setRuns((current) => current.filter((run) => run.id !== sessionId))
  }, [demoMode, sessionsRequestKey])

  const renameSession = (runId: string, title: string) => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => run.id === runId ? { ...run, title, updatedAt: locale === 'zh' ? '刚刚' : 'Just now' } : run))
    setToast(locale === 'zh' ? '会话已重命名' : 'Session renamed')
  }
  const toggleFavorite = (runId: string) => {
    if (!demoMode) return
    setRuns((items) => items.map((run) => run.id === runId ? { ...run, favorite: !run.favorite } : run))
  }
  const toggleArchive = (runId: string) => {
    if (!demoMode) return
    const target = runs.find((run) => run.id === runId)
    setRuns((items) => items.map((run) => run.id === runId ? { ...run, archived: !run.archived } : run))
    if (!target?.archived && location.pathname === `/sessions/${runId}`) navigate('/sessions')
    setToast(target?.archived ? (locale === 'zh' ? '会话已恢复' : 'Session restored') : (locale === 'zh' ? '会话已归档' : 'Session archived'))
  }
  const deleteSession = (runId: string) => {
    if (!demoMode) return
    setRuns((items) => items.filter((run) => run.id !== runId))
    if (location.pathname === `/sessions/${runId}`) navigate('/sessions')
    setToast(locale === 'zh' ? '会话已删除' : 'Session deleted')
  }

  const openNavigation = () => setNavigationOpen(true)
  const openSession = (runId: string) => navigate(`/sessions/${runId}`)
  const pageProps = { runs: scopedRuns, onOpenNavigation: openNavigation, onNewTask: openNewTask }
  const productionUnavailable = <ProductionUnavailablePage onOpenNavigation={openNavigation} />

  const materializeAutomationSession = (result: InjectEventResult) => {
    if (!demoMode) return
    const draft = result.sessionDraft
    if (!draft) return
    setRuns((current) => {
      if (current.some((run) => run.sourceEventId === draft.sourceEventId)) return current
      const automation = result.matchedAutomation ?? scope.automations.find((item) => item.id === draft.automationId)
      const repository = scope.repositories.find((item) => item.id === draft.repositoryId)
      const expert = expertStore.experts.find((item) => item.id === draft.expertId)
      const expertName = expert?.draftConfig.name ?? draft.expertId
      const now = locale === 'zh' ? '刚刚' : 'Just now'
      const id = draft.id.replace('session-draft', 'run')
      const run: Run = {
        id,
        spaceId: draft.spaceId,
        sourceEventId: draft.sourceEventId,
        automationId: draft.automationId,
        source: 'automation',
        title: draft.title,
        repo: repository?.fullName ?? 'unscoped/repository',
        branch: `relay/${id}`,
        expert: expertName,
        expertId: draft.expertId,
        status: 'running',
        trigger: `${automation?.source ?? 'event'} / ${automation?.trigger ?? 'automation'}`,
        updatedAt: now,
        elapsed: '4s',
        progress: 8,
        model: expert?.draftConfig.model ?? 'GPT-5.4',
        summary: draft.summary,
        baseBranch: repository?.defaultBranch ?? 'main',
        environmentId: scope.environments.find((environment) => environment.status === 'ready')?.id,
        steps: [
          { id: 'trigger', label: locale === 'zh' ? '触发' : 'Trigger', detail: automation?.trigger ?? 'Event', status: 'completed' },
          { id: 'plan', label: locale === 'zh' ? '规划' : 'Plan', detail: locale === 'zh' ? '分析事件' : 'Analyze event', status: 'active' },
          { id: 'author', label: locale === 'zh' ? '执行' : 'Execute', detail: locale === 'zh' ? '等待中' : 'Waiting', status: 'pending' },
          { id: 'verify', label: locale === 'zh' ? '验证' : 'Verify', detail: locale === 'zh' ? '等待中' : 'Waiting', status: 'pending' },
          { id: 'approval', label: locale === 'zh' ? '审批' : 'Approval', detail: locale === 'zh' ? '按策略' : 'By policy', status: 'pending' },
          { id: 'deliver', label: locale === 'zh' ? '交付' : 'Deliver', detail: locale === 'zh' ? '等待中' : 'Waiting', status: 'pending' },
        ],
        events: [{ id: `${id}-event`, kind: 'request', actor: automation?.source ?? 'Event Router', title: locale === 'zh' ? '自动化事件已匹配' : 'Automation event matched', body: draft.summary, timestamp: now, meta: `${automation?.name ?? draft.automationId} · ${draft.sourceEventId}` }],
        files: [],
        terminal: ['$ relay automation session start', `Matched ${automation?.name ?? draft.automationId}`],
        attempts: [{ id: `${id}-attempt-1`, number: 1, status: 'running', startedAt: new Date().toISOString() }],
        artifacts: [],
      }
      return [run, ...current]
    })
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <Sidebar
        runs={scopedRuns}
        prototypeNavigation={demoMode}
        open={navigationOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setNavigationOpen(false)}
        onNewTask={() => openNewTask()}
        sessionCreationEnabled={sessionCreationEnabled}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<CosmosHomePage {...pageProps} experts={sessionExpertOptions} catalogStatus={sessionCatalogStatus} catalogError={sessionCatalogError} prototypeTools={demoMode} sessionCreationEnabled={sessionCreationEnabled} executionEnabled={demoMode || productionExecutionEnabled} onRetryCatalog={retrySessionCatalog} onOpenSession={openSession} onCreateSession={createHomeSession} />} />
        <Route path="/sessions" element={
          <SessionsPage
            runs={scopedRuns}
            loadState={sessionsState}
            loadError={sessionsError}
            managementEnabled={demoMode}
            sessionCreationEnabled={sessionCreationEnabled}
            onRetry={() => setSessionsRetryVersion((version) => version + 1)}
            onOpenNavigation={openNavigation}
            onNewTask={openNewTask}
            onOpenSession={openSession}
            onRename={renameSession}
            onToggleFavorite={toggleFavorite}
            onToggleArchive={toggleArchive}
            onDelete={deleteSession}
          />
        } />
        <Route path="/runs" element={demoMode ? <RunsOverview {...pageProps} /> : productionUnavailable} />
        <Route path="/sessions/:sessionId" element={
          <SessionRoute
            runs={scopedRuns}
            organizationId={organizationId}
            spaceId={activeSpace.id}
            accessToken={accessToken}
            credentialVersion={credentialVersion}
            requestIdentity={requestIdentity}
            timelineTransport={currentRuntimeCapability?.events ?? 'polling'}
            executionEnabled={demoMode || productionExecutionEnabled}
            handleUnauthorized={handleUnauthorized}
            demoMode={demoMode}
            locale={locale}
            onOpenNavigation={openNavigation}
            onSessionObserved={observeRemoteSession}
            onSessionConcealed={concealRemoteSession}
            onDecision={decide}
            onRetry={retry}
            onPause={pauseRun}
            onStop={stopRun}
          />
        } />
        <Route path="/runs/:sessionId" element={<LegacySessionRedirect />} />
        <Route path="/files" element={demoMode ? <Navigate to="/files/user" replace /> : productionUnavailable} />
        <Route path="/files/user" element={demoMode ? <CosmosFilesPage key="user" initialScope="user" onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/files/organization" element={demoMode ? <CosmosFilesPage key="organization" initialScope="organization" onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/approvals" element={demoMode ? <CosmosApprovalsPage runs={scopedRuns} onOpenNavigation={openNavigation} onOpenSession={openSession} onDecision={decide} /> : productionUnavailable} />
        <Route path="/automations" element={demoMode ? <CosmosAutomationsPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/automations/events" element={demoMode ? <CosmosEventLogPage onOpenNavigation={openNavigation} onSessionCreated={materializeAutomationSession} /> : productionUnavailable} />
        <Route path="/automations/history" element={demoMode ? <CosmosRunHistoryPage runs={scopedRuns} onOpenNavigation={openNavigation} onOpenSession={openSession} /> : productionUnavailable} />
        <Route path="/experts" element={
          demoMode ? (
            <ExpertsPage
              store={scopedExpertStore}
              onStoreChange={mergeScopedExpertStore}
              onOpenNavigation={openNavigation}
              onCreateBlank={createExpert}
              onForkTemplate={forkExpertTemplate}
              onEditExpert={(expertId) => navigate(`/experts/${expertId}/edit`)}
              onStartSession={openNewTask}
              onNotify={setToast}
            />
          ) : (
            <RemoteExpertsPage
              items={catalog.experts.items}
              loading={catalog.experts.loading}
              ready={catalog.experts.ready}
              error={catalog.experts.error}
              onRetry={catalog.experts.retry}
              onOpenNavigation={openNavigation}
              onOpenDetail={(expertId) => navigate(`/experts/${expertId}`)}
              onStartSession={openNewTask}
              sessionCreationEnabled={sessionCreationEnabled}
            />
          )
        } />
        <Route path="/experts/:expertId" element={demoMode
          ? <ExpertEditorRoute store={scopedExpertStore} onStoreChange={mergeScopedExpertStore} onOpenNavigation={openNavigation} onBack={() => navigate('/experts')} onStartSession={openNewTask} onNotify={setToast} />
          : <RemoteExpertRoute organizationId={organizationId} spaceId={activeSpace.id} accessToken={accessToken} credentialVersion={credentialVersion} requestIdentity={requestIdentity} handleUnauthorized={handleUnauthorized} onOpenNavigation={openNavigation} onBack={() => navigate('/experts')} onStartSession={openNewTask} sessionCreationEnabled={sessionCreationEnabled} />} />
        <Route path="/experts/:expertId/edit" element={demoMode
          ? <ExpertEditorRoute store={scopedExpertStore} onStoreChange={mergeScopedExpertStore} onOpenNavigation={openNavigation} onBack={() => navigate('/experts')} onStartSession={openNewTask} onNotify={setToast} />
          : <ExpertEditRedirect />} />
        <Route path="/environments" element={demoMode
          ? <EnvironmentsPage onOpenNavigation={openNavigation} />
          : <RemoteEnvironmentsPage
              items={catalog.environments.items}
              loading={catalog.environments.loading}
              ready={catalog.environments.ready}
              error={catalog.environments.error}
              onRetry={catalog.environments.retry}
              organizationId={organizationId}
              spaceId={activeSpace.id}
              auth={catalogAuth}
              credentialVersion={credentialVersion}
              onOpenNavigation={openNavigation}
            />} />
        <Route path="/daemons" element={demoMode ? <DaemonsPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/repositories" element={demoMode ? <RepositoriesControlPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/integrations" element={demoMode ? <IntegrationsControlPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/mcp" element={demoMode ? <McpRegistryPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/webhooks" element={demoMode ? <WebhooksPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/secrets" element={demoMode ? <SecretsPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/spaces" element={demoMode ? <SpacesPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/settings" element={demoMode ? <SettingsPage onOpenNavigation={openNavigation} /> : productionUnavailable} />
        <Route path="/governance" element={demoMode ? <Navigate to="/approvals" replace /> : productionUnavailable} />
        <Route path="/activity" element={demoMode ? <Navigate to="/automations/events" replace /> : productionUnavailable} />
        <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>

      {newTaskOpen && sessionCreationEnabled ? (
        <NewTaskDialog
          key={activeSpace.id}
          open
          initialExpertId={presetExpertId}
          initialPrompt={presetPrompt}
          experts={sessionExpertOptions}
          repositories={sessionRepositories}
          environments={sessionEnvironments}
          catalogStatus={sessionCatalogStatus}
          catalogError={sessionCatalogError}
          prototypeTools={demoMode}
          executionEnabled={demoMode || productionExecutionEnabled}
          onRetryCatalog={retrySessionCatalog}
          onClose={() => { setNewTaskOpen(false); setPresetExpertId(undefined); setPresetPrompt('') }}
          onCreate={createTask}
        />
      ) : null}

      <CommandPalette open={commandOpen} runs={scopedRuns} prototypeNavigation={demoMode} sessionCreationEnabled={sessionCreationEnabled} onClose={() => setCommandOpen(false)} onNewTask={() => openNewTask()} />

      {toast ? (
        <div className="toast" role="status">
          <CheckCircle2 aria-hidden="true" />
          <span>{toast}</span>
          <IconButton icon={X} label={t('common.close')} size="sm" onClick={() => setToast('')} />
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  const { demoMode } = useAuth()
  const { organization, space, selectSpace } = useActiveWorkspace()
  const initialState = useMemo(() => {
    if (!demoMode) return createEmptyControlPlaneState(space.id, organization.spaces)
    const demoState = loadControlPlaneState()
    return demoState.spaces.some((item) => item.id === space.id)
      ? { ...demoState, activeSpaceId: space.id }
      : demoState
  },
    [demoMode, organization.spaces, space.id],
  )
  const syncSpace = useMemo(
    () => (spaceId: string) => selectSpace(organization.id, spaceId),
    [organization.id, selectSpace],
  )
  return (
    <ControlPlaneProvider
      key={demoMode ? 'demo' : organization.id}
      initialState={initialState}
      storage={demoMode ? undefined : null}
      onActiveSpaceChange={syncSpace}
    >
      <RelayApp />
    </ControlPlaneProvider>
  )
}
