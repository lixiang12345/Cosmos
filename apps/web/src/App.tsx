import type { SessionDto } from '@relay/contracts'
import { CheckCircle2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './auth/context'
import { CommandPalette } from './components/CommandPalette'
import { NewTaskDialog } from './components/NewTaskDialog'
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
import {
  createEmptyExpertStore,
  createBlankExpert,
  createExpertFromTemplate,
  getExpertVersion,
  loadExpertStore,
  saveExpertStore,
  type ExpertStore,
} from './features/experts'
import { RunWorkbench } from './features/run/RunWorkbench'
import { deriveSessionTitle, detectTaskContextItems } from './features/run/sessionDraft'
import {
  DaemonsPage,
  EnvironmentsPage,
  IntegrationsControlPage,
  McpRegistryPage,
  RepositoriesControlPage,
  SecretsPage,
  SettingsPage,
  SpacesPage,
  WebhooksPage,
} from './pages/CosmosConfigurationPages'
import {
  CosmosApprovalsPage,
  CosmosAutomationsPage,
  CosmosEventLogPage,
  CosmosFilesPage,
  CosmosHomePage,
  CosmosRunHistoryPage,
} from './pages/CosmosOperationsPages'
import { ExpertEditorPage, ExpertsPage } from './pages/ExpertsPage'
import { RunsOverview } from './pages/OverviewPages'
import { SessionsPage } from './pages/SessionsPage'
import { usePreferences } from './preferences'
import { createSession, listSessions } from './services/relayApi'
import type { NewTaskInput, Run, RunAttempt, TaskCreateMode } from './types'
import { useActiveWorkspace } from './workspace'

function mapSessionStatus(status: SessionDto['status']): Run['status'] {
  return status === 'draft' ? 'queued' : status === 'active' ? 'running' : status
}

function makeSessionIdempotencyKey() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sessionDtoToRun(session: SessionDto, locale: 'zh' | 'en'): Run {
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

function mergeDemoSessions(current: Run[], sessions: SessionDto[], locale: 'zh' | 'en') {
  const serverRuns = sessions.map((session) => sessionDtoToRun(session, locale))
  const serverIds = new Set(serverRuns.map((run) => run.id))
  return [...serverRuns, ...current.filter((run) => !serverIds.has(run.id))]
}

function inferRunSpace(run: Run) {
  return run.spaceId ?? (run.repo.startsWith('platform/') ? 'space-platform' : 'space-commerce')
}

function hydrateRun(run: Run): Run {
  const seed = initialRuns.find((item) => item.id === run.id)
  const fallbackAttemptStatus: RunAttempt['status'] = run.status === 'completed'
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

function RunRoute({
  runs,
  onOpenNavigation,
  onDecision,
  onRetry,
  onPause,
  onStop,
}: {
  runs: Run[]
  onOpenNavigation: () => void
  onDecision: (runId: string, decision: 'approved' | 'changes') => void
  onRetry: (runId: string) => void
  onPause: (runId: string) => void
  onStop: (runId: string) => void
}) {
  const { runId } = useParams()
  const run = runs.find((item) => item.id === runId)
  if (!run) return <Navigate to="/sessions" replace />
  return (
    <RunWorkbench
      key={run.id}
      run={run}
      onOpenNavigation={onOpenNavigation}
      onDecision={onDecision}
      onRetry={onRetry}
      onPause={onPause}
      onStop={onStop}
    />
  )
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

function RelayApp() {
  const { accessToken, demoMode, handleUnauthorized } = useAuth()
  const { organization } = useActiveWorkspace()
  const organizationId = organization.id
  const [runs, setRuns] = useState<Run[]>(() => demoMode ? getDemoRuns() : [])
  const [sessionsRequest, setSessionsRequest] = useState<{
    key: string
    status: 'ready' | 'error'
    error: string
  }>()
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
  const sessionsRequestKey = `${organizationId}\u0000${activeSpace.id}\u0000${locale}`
  const sessionsState = sessionsRequest?.key === sessionsRequestKey ? sessionsRequest.status : 'loading'
  const sessionsError = sessionsRequest?.key === sessionsRequestKey ? sessionsRequest.error : ''

  const scopedRuns = useMemo(
    () => runs.filter((run) => inferRunSpace(run) === activeSpace.id),
    [activeSpace.id, runs],
  )
  const scopedExpertStore = useMemo<ExpertStore>(() => {
    const experts = expertStore.experts.filter((expert) => inferExpertSpace(expert) === activeSpace.id)
    const ids = new Set(experts.map((expert) => expert.id))
    return { ...expertStore, experts, versions: expertStore.versions.filter((version) => ids.has(version.expertId)) }
  }, [activeSpace.id, expertStore])

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
    const requestKey = `${organizationId}\u0000${activeSpace.id}\u0000${locale}`
    void listSessions(organizationId, activeSpace.id, { accessToken, onUnauthorized: handleUnauthorized })
      .then(({ items }) => {
        if (cancelled) return
        setRuns((current) => demoMode
          ? mergeDemoSessions(current, items, locale)
          : items.map((session) => sessionDtoToRun(session, locale)))
        setSessionsRequest({ key: requestKey, status: 'ready', error: '' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (!demoMode) setRuns([])
        setSessionsRequest({
          key: requestKey,
          status: 'error',
          error: error instanceof Error ? error.message : (locale === 'zh' ? '无法加载会话。' : 'Unable to load Sessions.'),
        })
      })
    return () => { cancelled = true }
  }, [accessToken, activeSpace.id, demoMode, handleUnauthorized, locale, organizationId])

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
    if (!input.expertId) {
      throw new Error(locale === 'zh' ? '请选择一个可用的 Expert。' : 'Choose an available Expert.')
    }
    const isDraft = mode === 'draft'
    const expert = input.expertId ? scopedExpertStore.experts.find((item) => item.id === input.expertId) : undefined
    const version = expert?.publishedVersionId ? getExpertVersion(scopedExpertStore, expert.publishedVersionId) : undefined
    const model = version?.configSnapshot.model ?? expert?.draftConfig.model ?? 'GPT-5.4'
    const requestFingerprint = JSON.stringify({ spaceId: activeSpace.id, mode, input })
    const idempotencyKey = sessionIdempotencyKeys.current.get(requestFingerprint) ?? makeSessionIdempotencyKey()
    sessionIdempotencyKeys.current.set(requestFingerprint, idempotencyKey)
    const { session } = await createSession(organizationId, activeSpace.id, {
      expertId: input.expertId,
      expertName: input.expert,
      expertVersion: input.expertVersion,
      environmentId: input.environmentId,
      title: input.title,
      visibility: input.visibility ?? 'private',
      start: !isDraft,
      message: {
        content: input.description,
        attachments: input.attachments ?? [],
      },
      repository: input.repo,
      baseBranch: input.baseBranch,
    }, idempotencyKey, { accessToken, onUnauthorized: handleUnauthorized })
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
    const run: Run = {
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
    }
    setRuns((items) => [run, ...items])
    setNewTaskOpen(false)
    setPresetExpertId(undefined)
    setToast(isDraft
      ? (locale === 'zh' ? '会话草稿已保存' : 'Session draft saved')
      : (locale === 'zh' ? '会话已创建，等待 Worker 接收命令' : 'Session created and waiting for a Worker.'))
    navigate(isDraft ? '/sessions' : `/runs/${id}`)
  }

  const decide = (runId: string, decision: 'approved' | 'changes') => {
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
  const sessionExpertOptions = [advisorExpertOption, ...publishedExpertOptions]

  const createHomeSession = async ({
    expertId,
    prompt,
    visibility,
    attachments,
  }: {
    expertId: string
    prompt: string
    visibility: 'private' | 'space'
    attachments: string[]
  }) => {
    const expert = sessionExpertOptions.find((item) => item.id === expertId)
    const repository = scope.repositories.find((item) => item.fullName === expert?.repository) ?? scope.repositories[0]
    const environment = scope.environments.find((item) => item.id === expert?.environmentId)
      ?? scope.environments.find((item) => item.status === 'ready')
    if (!expert || !repository || !environment) {
      setToast(locale === 'zh' ? 'Expert 的仓库或环境尚未就绪' : 'The Expert repository or environment is not ready.')
      return
    }
    await createTask({
      title: deriveSessionTitle(prompt),
      description: prompt,
      repo: repository.fullName,
      expert: expert.name,
      expertId: expert.id,
      expertVersion: expert.version,
      environmentId: environment.id,
      visibility,
      baseBranch: repository.defaultBranch,
      acceptanceCriteria: [],
      contextItems: detectTaskContextItems(prompt),
      attachments,
    }, 'run')
  }

  const renameSession = (runId: string, title: string) => {
    setRuns((items) => items.map((run) => run.id === runId ? { ...run, title, updatedAt: locale === 'zh' ? '刚刚' : 'Just now' } : run))
    setToast(locale === 'zh' ? '会话已重命名' : 'Session renamed')
  }
  const toggleFavorite = (runId: string) => setRuns((items) => items.map((run) => run.id === runId ? { ...run, favorite: !run.favorite } : run))
  const toggleArchive = (runId: string) => {
    const target = runs.find((run) => run.id === runId)
    setRuns((items) => items.map((run) => run.id === runId ? { ...run, archived: !run.archived } : run))
    if (!target?.archived && location.pathname === `/runs/${runId}`) navigate('/sessions')
    setToast(target?.archived ? (locale === 'zh' ? '会话已恢复' : 'Session restored') : (locale === 'zh' ? '会话已归档' : 'Session archived'))
  }
  const deleteSession = (runId: string) => {
    setRuns((items) => items.filter((run) => run.id !== runId))
    if (location.pathname === `/runs/${runId}`) navigate('/sessions')
    setToast(locale === 'zh' ? '会话已删除' : 'Session deleted')
  }

  const openNavigation = () => setNavigationOpen(true)
  const openSession = (runId: string) => navigate(`/runs/${runId}`)
  const pageProps = { runs: scopedRuns, onOpenNavigation: openNavigation, onNewTask: openNewTask }

  const materializeAutomationSession = (result: InjectEventResult) => {
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
        open={navigationOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setNavigationOpen(false)}
        onNewTask={() => openNewTask()}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<CosmosHomePage {...pageProps} experts={sessionExpertOptions} onOpenSession={openSession} onCreateSession={createHomeSession} />} />
        <Route path="/sessions" element={
          <SessionsPage
            runs={scopedRuns}
            loadState={sessionsState}
            loadError={sessionsError}
            onOpenNavigation={openNavigation}
            onNewTask={openNewTask}
            onOpenSession={openSession}
            onRename={renameSession}
            onToggleFavorite={toggleFavorite}
            onToggleArchive={toggleArchive}
            onDelete={deleteSession}
          />
        } />
        <Route path="/runs" element={<RunsOverview {...pageProps} />} />
        <Route path="/runs/:runId" element={<RunRoute runs={scopedRuns} onOpenNavigation={openNavigation} onDecision={decide} onRetry={retry} onPause={pauseRun} onStop={stopRun} />} />
        <Route path="/files" element={<Navigate to="/files/user" replace />} />
        <Route path="/files/user" element={<CosmosFilesPage key="user" initialScope="user" onOpenNavigation={openNavigation} />} />
        <Route path="/files/organization" element={<CosmosFilesPage key="organization" initialScope="organization" onOpenNavigation={openNavigation} />} />
        <Route path="/approvals" element={<CosmosApprovalsPage runs={scopedRuns} onOpenNavigation={openNavigation} onOpenSession={openSession} onDecision={decide} />} />
        <Route path="/automations" element={<CosmosAutomationsPage onOpenNavigation={openNavigation} />} />
        <Route path="/automations/events" element={<CosmosEventLogPage onOpenNavigation={openNavigation} onSessionCreated={materializeAutomationSession} />} />
        <Route path="/automations/history" element={<CosmosRunHistoryPage runs={scopedRuns} onOpenNavigation={openNavigation} onOpenSession={openSession} />} />
        <Route path="/experts" element={
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
        } />
        <Route path="/experts/:expertId" element={<ExpertEditorRoute store={scopedExpertStore} onStoreChange={mergeScopedExpertStore} onOpenNavigation={openNavigation} onBack={() => navigate('/experts')} onStartSession={openNewTask} onNotify={setToast} />} />
        <Route path="/experts/:expertId/edit" element={<ExpertEditorRoute store={scopedExpertStore} onStoreChange={mergeScopedExpertStore} onOpenNavigation={openNavigation} onBack={() => navigate('/experts')} onStartSession={openNewTask} onNotify={setToast} />} />
        <Route path="/environments" element={<EnvironmentsPage onOpenNavigation={openNavigation} />} />
        <Route path="/daemons" element={<DaemonsPage onOpenNavigation={openNavigation} />} />
        <Route path="/repositories" element={<RepositoriesControlPage onOpenNavigation={openNavigation} />} />
        <Route path="/integrations" element={<IntegrationsControlPage onOpenNavigation={openNavigation} />} />
        <Route path="/mcp" element={<McpRegistryPage onOpenNavigation={openNavigation} />} />
        <Route path="/webhooks" element={<WebhooksPage onOpenNavigation={openNavigation} />} />
        <Route path="/secrets" element={<SecretsPage onOpenNavigation={openNavigation} />} />
        <Route path="/spaces" element={<SpacesPage onOpenNavigation={openNavigation} />} />
        <Route path="/settings" element={<SettingsPage onOpenNavigation={openNavigation} />} />
        <Route path="/governance" element={<Navigate to="/approvals" replace />} />
        <Route path="/activity" element={<Navigate to="/automations/events" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>

      {newTaskOpen ? (
        <NewTaskDialog
          key={activeSpace.id}
          open
          initialExpertId={presetExpertId}
          initialPrompt={presetPrompt}
          experts={sessionExpertOptions}
          repositories={scope.repositories.map((repository) => ({ id: repository.id, fullName: repository.fullName, defaultBranch: repository.defaultBranch }))}
          environments={scope.environments.map((environment) => ({ id: environment.id, name: environment.name, image: environment.image, ready: environment.status === 'ready' }))}
          onClose={() => { setNewTaskOpen(false); setPresetExpertId(undefined); setPresetPrompt('') }}
          onCreate={createTask}
        />
      ) : null}

      <CommandPalette open={commandOpen} runs={scopedRuns} onClose={() => setCommandOpen(false)} onNewTask={() => openNewTask()} />

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
