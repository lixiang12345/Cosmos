import type {
  AdvisorPlanDto,
  ArtifactDto,
  SessionDto,
  SessionEventDto,
  SessionMessageDto,
  SessionStatus,
  SessionVisibility,
  ShareGrantDto,
} from '@cosmos/contracts'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  PrototypeAgentIcon,
  PrototypeChevronDownLargeIcon,
  PrototypeCopyIcon,
  PrototypeFolderIcon,
  PrototypeHexIcon,
  PrototypePanelRightIcon,
  PrototypePaperclipIcon,
  PrototypeSubscriptionsIcon,
  PrototypeTerminalIcon,
} from '../../components/PrototypeIcons'
import { PrototypePageTopbar } from '../../components/PrototypePageTopbar'
import { usePreferences, type Locale } from '../../preferences'

export type RemoteSessionWorkbenchProps = {
  session: SessionDto
  messages?: SessionMessageDto[]
  events?: SessionEventDto[]
  timelineStatus?: 'loading' | 'ready' | 'error'
  timelineError?: string
  executionEnabled?: boolean
  startStatus?: 'idle' | 'submitting' | 'error'
  startError?: string
  onStart?: () => void
  sendStatus?: 'idle' | 'submitting' | 'error'
  sendError?: string
  onSend?: (content: string) => Promise<void>
  controlStatus?: 'idle' | 'submitting' | 'error'
  controlAction?: 'pause' | 'resume' | 'cancel' | 'retry'
  controlError?: string
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
  onRetry?: () => void
  initialMessageDraft?: string
  onOpenFiles?: () => void
  onOpenWorkers?: () => void
  onBack: () => void
  onOpenNavigation?: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
  embeddedPanel?: ReactNode
  localFiles?: Array<{ path: string; detail: string }>
  localArtifacts?: Array<{ id: string; label: string; type: string; status?: string | null }>
  terminalLines?: string[]
  advisorPlans?: AdvisorPlanDto[]
  advisorPlansStatus?: 'idle' | 'loading' | 'ready' | 'error'
  advisorPlansError?: string
  advisorManagementEnabled?: boolean
  advisorMutationPlanId?: string
  onAdvisorDecision?: (plan: AdvisorPlanDto, decision: 'confirmed' | 'rejected') => void
  serverArtifacts?: ArtifactDto[]
  onAddArtifactLink?: (input: { label: string; url: string }) => Promise<void>
  onRemoveArtifact?: (artifact: ArtifactDto) => Promise<void>
  shares?: ShareGrantDto[]
  sharesStatus?: 'idle' | 'loading' | 'ready' | 'error'
  sharesError?: string
  onCreateShare?: (input: { principalType: 'user' | 'group'; principalId: string; role: 'viewer' | 'collaborator' }) => Promise<void>
  onRevokeShare?: (share: ShareGrantDto) => Promise<void>
  onAdvisorRetry?: (plan: AdvisorPlanDto) => void
}

type WorkbenchTab = 'agent' | 'terminal' | 'files' | 'subscriptions'

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function shortTime(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusLabel(status: SessionStatus, locale: Locale) {
  const labels: Record<SessionStatus, [string, string]> = {
    draft: ['草稿', 'Draft'],
    queued: ['已排队', 'Queued'],
    active: ['进行中', 'Active'],
    waiting: ['等待中', 'Waiting'],
    paused: ['已暂停', 'Paused'],
    completed: ['已完成', 'Completed'],
    failed: ['失败', 'Failed'],
    canceled: ['已取消', 'Canceled'],
  }
  return text(locale, ...labels[status])
}

function visibilityLabel(visibility: SessionVisibility, locale: Locale) {
  return visibility === 'private' ? text(locale, '私有', 'Private') : text(locale, '空间成员', 'Space')
}

function revisionValue(value: string | undefined, locale: Locale) {
  return value ?? text(locale, '未解析（旧版会话记录）', 'Not resolved (legacy session record)')
}

function messageRoleLabel(role: SessionMessageDto['role'], locale: Locale) {
  if (role === 'user') return text(locale, '用户', 'User')
  if (role === 'agent') return 'Expert'
  if (role === 'tool') return text(locale, '工具', 'Tool')
  if (role === 'system') return text(locale, '系统', 'System')
  return text(locale, '事件', 'Event')
}

type ExecutionView = {
  tone: 'neutral' | 'running' | 'retrying' | 'completed' | 'failed' | 'waiting'
  title: string
  description: string
}

function executionView(session: SessionDto, events: SessionEventDto[], locale: Locale): ExecutionView {
  const latestAttempt = events.filter((event) => event.type === 'attempt.updated').at(-1)
  if (latestAttempt?.type === 'attempt.updated') {
    const { number, status, failureCode } = latestAttempt.payload
    if (session.status === 'queued' && status === 'failed') return {
      tone: 'retrying',
      title: text(locale, '正在等待重试', 'Waiting to retry'),
      description: text(locale, `第 ${number} 次尝试失败${failureCode ? `，错误代码：${failureCode}` : ''}；下一次尝试已排队。`, `Attempt ${number} failed${failureCode ? ` with code ${failureCode}` : ''}; the next attempt is queued.`),
    }
    if (status === 'succeeded') return { tone: 'completed', title: text(locale, '执行已完成', 'Execution completed'), description: text(locale, `第 ${number} 次尝试已成功完成。`, `Attempt ${number} completed successfully.`) }
    if (status === 'failed') return { tone: 'failed', title: text(locale, '执行失败', 'Execution failed'), description: text(locale, `第 ${number} 次尝试失败${failureCode ? `，错误代码：${failureCode}` : ''}。`, `Attempt ${number} failed${failureCode ? ` with code ${failureCode}` : ''}.`) }
    if (status === 'canceled') return { tone: 'failed', title: text(locale, '执行已取消', 'Execution canceled'), description: text(locale, `第 ${number} 次尝试已取消。`, `Attempt ${number} was canceled.`) }
    if (status === 'waiting' || status === 'paused') return { tone: 'waiting', title: status === 'waiting' ? text(locale, '执行正在等待', 'Execution is waiting') : text(locale, '执行已暂停', 'Execution paused'), description: text(locale, `第 ${number} 次尝试当前为${status === 'waiting' ? '等待' : '暂停'}状态。`, `Attempt ${number} is ${status}.`) }
    if (number > 1) return { tone: 'retrying', title: text(locale, '正在重试', 'Retry in progress'), description: text(locale, `第 ${number} 次尝试${status === 'queued' ? '正在等待执行' : '正在执行'}。`, `Attempt ${number} is ${status}.`) }
    return { tone: status === 'queued' ? 'neutral' : 'running', title: status === 'queued' ? text(locale, '执行已排队', 'Execution queued') : text(locale, '正在执行', 'Execution in progress'), description: text(locale, `第 1 次尝试${status === 'queued' ? '正在等待 Worker' : '正在执行'}。`, `Attempt 1 is ${status}.`) }
  }

  const fallback: Record<SessionStatus, ExecutionView> = {
    draft: { tone: 'neutral', title: text(locale, '会话草稿已保存', 'Session draft saved'), description: text(locale, '服务端尚未开始执行。', 'Execution has not started on the server.') },
    queued: { tone: 'neutral', title: text(locale, '已排队，等待执行', 'Queued for execution'), description: text(locale, '命令已被服务端接受，正在等待 Worker 领取。', 'The command was accepted by the server and is waiting for a Worker.') },
    active: { tone: 'running', title: text(locale, '正在执行', 'Execution in progress'), description: text(locale, 'Worker 正在处理当前会话。', 'A Worker is processing this Session.') },
    waiting: { tone: 'waiting', title: text(locale, '执行正在等待', 'Execution is waiting'), description: text(locale, '当前回合正在等待审批或外部条件。', 'The current turn is waiting for approval or an external condition.') },
    paused: { tone: 'waiting', title: text(locale, '执行已暂停', 'Execution paused'), description: text(locale, '服务端已暂停当前会话。', 'The server paused this Session.') },
    completed: { tone: 'completed', title: text(locale, '执行已完成', 'Execution completed'), description: text(locale, '服务端会话已完成。', 'The server Session completed.') },
    failed: { tone: 'failed', title: text(locale, '执行失败', 'Execution failed'), description: text(locale, '服务端报告执行失败。', 'The server reported an execution failure.') },
    canceled: { tone: 'failed', title: text(locale, '执行已取消', 'Execution canceled'), description: text(locale, '服务端会话已取消。', 'The server Session was canceled.') },
  }
  return fallback[session.status]
}

function eventLabel(event: SessionEventDto, locale: Locale) {
  if (event.type === 'session.created') return text(locale, '会话已创建', 'Session created')
  if (event.type === 'session.updated') return text(locale, `会话状态已更新为${statusLabel(event.payload.status, locale)}`, `Session status updated to ${statusLabel(event.payload.status, locale)}`)
  if (event.type === 'message.created') return text(locale, '消息已记录', 'Message recorded')
  if (event.type === 'turn.queued') return text(locale, '任务回合已排队', 'Turn queued')
  if (event.type === 'artifact.created' || event.type === 'artifact.updated' || event.type === 'artifact.removed') return `${text(locale, '产物', 'Artifact')}: ${event.payload.label}`
  if (event.type === 'file.version.created') return `${text(locale, '文件已写入', 'File written')}: ${event.payload.path}`
  if (event.type === 'tool_call.updated') return `${event.payload.toolName}.${event.payload.operation} · ${event.payload.status}`
  if (event.type === 'approval.requested') return `${text(locale, '等待审批', 'Approval requested')}: ${event.payload.action}`
  if (event.type === 'approval.decided') return `${text(locale, '审批已记录', 'Approval recorded')}: ${event.payload.recordedDecision}`
  if (event.type === 'attempt.updated') return `${text(locale, '尝试', 'Attempt')} ${event.payload.number} · ${event.payload.status}`
  return event.type
}

function AdvisorPlanPanel({
  plans,
  status,
  error,
  managementEnabled,
  mutationPlanId,
  onDecision,
  onRetry,
}: {
  plans: AdvisorPlanDto[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  managementEnabled: boolean
  mutationPlanId?: string
  onDecision?: (plan: AdvisorPlanDto, decision: 'confirmed' | 'rejected') => void
  onRetry?: (plan: AdvisorPlanDto) => void
}) {
  const { locale } = usePreferences()
  if (status === 'idle') return null
  return (
    <section className="prototype-advisor-plans" aria-label={text(locale, 'Advisor 计划与变更', 'Advisor plans and changes')}>
      {status === 'loading' ? <p>{text(locale, '正在加载计划…', 'Loading plans…')}</p> : null}
      {status === 'error' ? <p role="alert">{error ?? text(locale, '计划暂时不可用。', 'Plans are temporarily unavailable.')}</p> : null}
      {status === 'ready' && !plans.length ? <p>{text(locale, 'Advisor 尚未提出计划。', 'Advisor has not proposed a plan yet.')}</p> : null}
      {plans.map((plan) => {
        const busy = mutationPlanId === plan.id
        return (
          <article key={plan.id}>
            <strong>{plan.summary}</strong>
            <span>{plan.status}</span>
            <ol>{plan.steps.map((step) => <li key={step.id}>{step.ordinal}. {step.kind === 'control_plane' ? step.operation : step.manualAction?.label}</li>)}</ol>
            {managementEnabled && onDecision && plan.status === 'proposed' ? <footer><button type="button" disabled={busy} onClick={() => onDecision(plan, 'confirmed')}>{text(locale, '确认并执行', 'Confirm and execute')}</button><button type="button" disabled={busy} onClick={() => onDecision(plan, 'rejected')}>{text(locale, '拒绝计划', 'Reject plan')}</button></footer> : null}
            {managementEnabled && onRetry && plan.status === 'failed' ? <footer><button type="button" disabled={busy} onClick={() => onRetry(plan)}>{text(locale, '安全重试', 'Retry safely')}</button></footer> : null}
          </article>
        )
      })}
    </section>
  )
}

export function RemoteSessionWorkbench({
  session,
  messages = [],
  events = [],
  timelineStatus = 'loading',
  timelineError,
  executionEnabled = false,
  startStatus = 'idle',
  startError,
  onStart,
  sendStatus = 'idle',
  sendError,
  onSend,
  controlStatus = 'idle',
  controlError,
  onPause,
  onResume,
  onCancel,
  onRetry,
  initialMessageDraft = '',
  onOpenFiles,
  onOpenWorkers,
  onBack,
  onOpenNavigation,
  navigationCollapsed = false,
  onOpenCommand,
  embeddedPanel,
  localFiles = [],
  localArtifacts = [],
  terminalLines = [],
  advisorPlans = [],
  advisorPlansStatus = 'idle',
  advisorPlansError,
  advisorManagementEnabled = false,
  advisorMutationPlanId,
  onAdvisorDecision,
  serverArtifacts = [],
  onAddArtifactLink,
  onRemoveArtifact,
  shares = [],
  sharesStatus = 'idle',
  sharesError,
  onCreateShare,
  onRevokeShare,
  onAdvisorRetry,
}: RemoteSessionWorkbenchProps) {
  const { locale } = usePreferences()
  const [copyNotice, setCopyNotice] = useState('')
  const [messageDraft, setMessageDraft] = useState(initialMessageDraft)
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('agent')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const messagesRef = useRef<HTMLElement>(null)
  const stopDialogRef = useRef<HTMLElement>(null)
  const stopCancelRef = useRef<HTMLButtonElement>(null)
  const stopReturnRef = useRef<HTMLButtonElement>(null)
  const execution = executionView(session, events, locale)
  const canAppendMessage = session.status !== 'draft' && session.status !== 'canceled'
  const controlSubmitting = controlStatus === 'submitting'
  const canPause = session.status === 'queued' || session.status === 'active' || session.status === 'waiting'
  const canResume = session.status === 'paused'
  const canCancel = ['draft', 'queued', 'active', 'waiting', 'paused'].includes(session.status)
  const canRetry = session.status === 'failed' && Boolean(onRetry)
  const artifacts = useMemo(() => {
    const server = serverArtifacts.filter((artifact) => artifact.removedAt === null)
    const serverLabels = new Set(server.map((artifact) => artifact.label))
    const derived = events.flatMap((event) => {
      if (event.type !== 'artifact.created' && event.type !== 'artifact.updated') return []
      if (serverLabels.has(event.payload.label)) return []
      return [{ id: event.eventId, label: event.payload.label, type: event.payload.type, status: event.payload.status }]
    })
    return [
      ...localArtifacts,
      ...server.map((artifact) => ({ id: artifact.id, label: artifact.label, type: artifact.type, status: artifact.status, url: artifact.url, server: artifact })),
      ...derived,
    ] as Array<{ id: string; label: string; type: string; status?: string | null; url?: string; server?: ArtifactDto }>
  }, [events, localArtifacts, serverArtifacts])
  const [artifactFormOpen, setArtifactFormOpen] = useState(false)
  const [artifactDraft, setArtifactDraft] = useState({ label: '', url: '' })
  const [artifactBusy, setArtifactBusy] = useState(false)
  const [artifactError, setArtifactError] = useState('')
  const [shareDraft, setShareDraft] = useState<{ principalType: 'user' | 'group'; principalId: string; role: 'viewer' | 'collaborator' }>({ principalType: 'user', principalId: '', role: 'viewer' })
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState('')
  const [autoScrollTerminal, setAutoScrollTerminal] = useState(true)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [clearedTerminal, setClearedTerminal] = useState(false)

  const submitArtifactLink = async () => {
    if (!onAddArtifactLink) return
    setArtifactBusy(true)
    setArtifactError('')
    try {
      await onAddArtifactLink({ label: artifactDraft.label.trim(), url: artifactDraft.url.trim() })
      setArtifactDraft({ label: '', url: '' })
      setArtifactFormOpen(false)
    } catch (cause) {
      setArtifactError(cause instanceof Error ? cause.message : text(locale, '无法添加产物链接。', 'Unable to add the artifact link.'))
    } finally {
      setArtifactBusy(false)
    }
  }

  const submitShare = async () => {
    if (!onCreateShare) return
    setShareBusy(true)
    setShareError('')
    try {
      await onCreateShare({ ...shareDraft, principalId: shareDraft.principalId.trim() })
      setShareDraft({ principalType: 'user', principalId: '', role: 'viewer' })
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : text(locale, '无法创建分享。', 'Unable to create the share.'))
    } finally {
      setShareBusy(false)
    }
  }

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const closeMenu = (event: PointerEvent) => {
      if (menuOpen && !menuRef.current?.contains(event.target as Node) && event.target !== menuTriggerRef.current) {
        setMenuOpen(false)
      }
    }
    const closeOverlay = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Tab' && stopConfirmationOpen) {
        const focusable = Array.from(stopDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      if (event.key !== 'Escape') return
      if (menuOpen) {
        setMenuOpen(false)
        window.requestAnimationFrame(() => menuTriggerRef.current?.focus())
      }
      if (stopConfirmationOpen) {
        setStopConfirmationOpen(false)
        window.requestAnimationFrame(() => stopReturnRef.current?.focus())
      }
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOverlay)
    if (stopConfirmationOpen) stopCancelRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOverlay)
    }
  }, [menuOpen, stopConfirmationOpen])

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(window.location.href)
      setCopyNotice(text(locale, '会话链接已复制', 'Session link copied'))
    } catch {
      setCopyNotice(text(locale, '无法访问剪贴板，请复制地址栏链接', 'Clipboard unavailable. Copy the address bar link.'))
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopyNotice(''), 2400)
  }

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = messageDraft.trim()
    if (!content || !onSend || !executionEnabled || sendStatus === 'submitting') return
    try {
      await onSend(content)
      setMessageDraft('')
    } catch {
      // Retain the draft so the server-authoritative request can be retried safely.
    }
  }

  const confirmStop = () => {
    setStopConfirmationOpen(false)
    onCancel?.()
    window.requestAnimationFrame(() => stopReturnRef.current?.focus())
  }

  const openStopConfirmation = (trigger: HTMLButtonElement) => {
    stopReturnRef.current = trigger
    setStopConfirmationOpen(true)
  }

  const scrollMessages = (top: number) => {
    messagesRef.current?.scrollBy({
      top,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  return (
    <main className="prototype-session-shell">
      <div className="prototype-session-center">
        <PrototypePageTopbar compact navigationCollapsed={navigationCollapsed} onOpenNavigation={onOpenNavigation} onOpenCommand={onOpenCommand} />
        <div className="prototype-session-view">
          <header className="prototype-session-header">
            <div className="prototype-session-title-wrap">
              <h1 title={session.title}>{session.title}</h1>
              <span className="prototype-visually-hidden">{session.repository} / {session.baseBranch}</span>
              <span className="prototype-session-menu-wrap">
                <button ref={menuTriggerRef} type="button" className="prototype-icon-button" aria-label={text(locale, '更多', 'More')} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>⋯</button>
                {menuOpen ? <div ref={menuRef} className="prototype-workbench-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onBack() }}>{text(locale, '返回会话', 'Back to Sessions')}</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void copyLink() }}>{text(locale, '复制链接', 'Copy link')}</button>
                  {canPause && onPause ? <button type="button" role="menuitem" disabled={controlSubmitting} onClick={() => { setMenuOpen(false); onPause() }}>{text(locale, '暂停', 'Pause')}</button> : null}
                  {canResume && onResume ? <button type="button" role="menuitem" disabled={controlSubmitting || !executionEnabled} onClick={() => { setMenuOpen(false); onResume() }}>{text(locale, '恢复', 'Resume')}</button> : null}
                  {canRetry && onRetry ? <button type="button" role="menuitem" disabled={controlSubmitting || !executionEnabled} onClick={() => { setMenuOpen(false); onRetry() }}>{text(locale, '重试', 'Retry')}</button> : null}
                  {canCancel && onCancel ? <button type="button" role="menuitem" className="danger" disabled={controlSubmitting} onClick={(event) => { setMenuOpen(false); openStopConfirmation(menuTriggerRef.current ?? event.currentTarget) }}>{text(locale, '取消执行', 'Cancel execution')}</button> : null}
                </div> : null}
              </span>
            </div>
            <div className="prototype-session-header-actions">
              {canCancel && onCancel ? <button type="button" className="prototype-ghost-button" disabled={controlSubmitting} onClick={(event) => openStopConfirmation(event.currentTarget)}>{text(locale, '停止', 'Stop')}</button> : null}
              <button type="button" className="prototype-icon-button" aria-label={inspectorOpen ? text(locale, '隐藏面板', 'Hide panel') : text(locale, '显示面板', 'Show panel')} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><PrototypePanelRightIcon aria-hidden="true" /></button>
            </div>
          </header>

          <nav className="prototype-session-tabs" aria-label={text(locale, '会话视图', 'Session views')}>
            <button type="button" role="tab" className={activeTab === 'agent' ? 'active' : undefined} aria-selected={activeTab === 'agent'} onClick={() => setActiveTab('agent')}><PrototypeAgentIcon aria-hidden="true" />Agent</button>
            <button type="button" role="tab" className={activeTab === 'terminal' ? 'active' : undefined} aria-selected={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')}><PrototypeTerminalIcon aria-hidden="true" />{text(locale, '终端', 'Terminal')}</button>
            <button type="button" role="tab" className={activeTab === 'files' ? 'active' : undefined} aria-selected={activeTab === 'files'} onClick={() => { if (onOpenFiles) onOpenFiles(); else setActiveTab('files') }}><PrototypeFolderIcon aria-hidden="true" />{text(locale, '文件', 'Files')}</button>
            <button type="button" role="tab" className={activeTab === 'subscriptions' ? 'active' : undefined} aria-selected={activeTab === 'subscriptions'} onClick={() => setActiveTab('subscriptions')}><PrototypeSubscriptionsIcon aria-hidden="true" />{text(locale, '订阅', 'Subscriptions')}</button>
          </nav>

          <div className="prototype-session-body">
            {activeTab === 'agent' ? <div className="prototype-session-agent-pane">
              <div className="prototype-session-messages-wrap">
                <section ref={messagesRef} className="prototype-session-messages" aria-label={text(locale, '会话消息', 'Session messages')}>
                  <article className={`prototype-execution-message ${execution.tone}`}>
                    <h2>{execution.title}</h2>
                    <p>{execution.description}</p>
                    {session.status === 'draft' && onStart ? <div><button type="button" disabled={!executionEnabled || startStatus === 'submitting'} onClick={onStart}>{startStatus === 'submitting' ? text(locale, '正在启动', 'Starting') : text(locale, '开始执行', 'Start execution')}</button>{!executionEnabled ? <span>{text(locale, '当前部署未开放执行。', 'Execution is unavailable in this deployment.')}</span> : null}{startStatus === 'error' && startError ? <span role="alert">{startError}</span> : null}</div> : null}
                    {controlStatus === 'error' && controlError ? <span role="alert">{controlError}</span> : null}
                  </article>

                  {timelineStatus === 'error' ? <div className="prototype-timeline-error" role="alert"><span>{text(locale, '实时更新暂时中断，正在自动重试。', 'Live updates are interrupted; retrying automatically.')}</span>{timelineError ? <code>{timelineError}</code> : null}</div> : null}

                  {messages.map((message) => message.role === 'user' ? (
                    <article className="prototype-message prototype-message--user" key={message.id}>
                      <span className="prototype-visually-hidden">{messageRoleLabel(message.role, locale)}</span>
                      <div className="prototype-user-bubble">{message.content}</div>
                      <footer><span>{shortTime(message.createdAt, locale)}</span></footer>
                    </article>
                  ) : message.role === 'tool' ? (
                    <article className="prototype-message" key={message.id}>
                      <details className="prototype-tool-call"><summary>⚙ {message.content.split('\n')[0] || messageRoleLabel(message.role, locale)}</summary>{message.content.includes('\n') ? <pre>{message.content.split('\n').slice(1).join('\n')}</pre> : null}</details>
                      <footer><span>{shortTime(message.createdAt, locale)}</span><button type="button" className="prototype-icon-button" aria-label={text(locale, '复制', 'Copy')} onClick={() => { void navigator.clipboard?.writeText(message.content) }}><PrototypeCopyIcon aria-hidden="true" /></button><button type="button" className="prototype-icon-button" aria-label={text(locale, '更多', 'More')}>⋯</button></footer>
                    </article>
                  ) : (
                    <article className={`prototype-message prototype-message--${message.role}`} key={message.id}>
                      <div className="prototype-article-body"><p>{message.content}</p></div>
                      <footer><span>{shortTime(message.createdAt, locale)}</span><button type="button" className="prototype-icon-button" aria-label={text(locale, '复制', 'Copy')} onClick={() => { void navigator.clipboard?.writeText(message.content) }}><PrototypeCopyIcon aria-hidden="true" /></button><button type="button" className="prototype-icon-button" aria-label={text(locale, '更多', 'More')}>⋯</button></footer>
                    </article>
                  ))}

                  {!messages.length ? <p className="prototype-session-empty">{timelineStatus === 'loading' ? text(locale, '正在加载消息…', 'Loading messages…') : text(locale, '当前没有消息。', 'No messages yet.')}</p> : null}

                  <AdvisorPlanPanel plans={advisorPlans} status={advisorPlansStatus} error={advisorPlansError} managementEnabled={advisorManagementEnabled} mutationPlanId={advisorMutationPlanId} onDecision={onAdvisorDecision} onRetry={onAdvisorRetry} />
                  {embeddedPanel}
                  <section className="prototype-visually-hidden" aria-label={text(locale, '执行动态', 'Execution activity')}>{events.map((event) => <span key={event.eventId}>#{event.sequence} {eventLabel(event, locale)}</span>)}</section>
                </section>
                <div className="prototype-message-scroll-rail">
                  <button type="button" aria-label={text(locale, '向上滚动消息', 'Scroll messages up')} onClick={() => scrollMessages(-180)}>⌃</button>
                  <button type="button" aria-label={text(locale, '向下滚动消息', 'Scroll messages down')} onClick={() => scrollMessages(180)}>⌄</button>
                </div>
              </div>

              {canAppendMessage && onSend ? <footer className="prototype-session-composer">
                <form className="prototype-session-composer-card" onSubmit={(event) => { void submitMessage(event) }}>
                  <div className="prototype-session-chips"><span><PrototypeHexIcon aria-hidden="true" />{session.expertName}</span><span>⎇ {session.baseBranch}</span></div>
                  <textarea rows={2} aria-label={text(locale, '后续消息', 'Follow-up message')} placeholder={session.status === 'active' ? text(locale, 'Agent 工作时排队发送另一条消息…', 'Queue another message while the agent is working…') : text(locale, '询问任何问题，或输入 / 查看命令', 'Ask anything or type / for commands')} value={messageDraft} maxLength={100_000} disabled={!executionEnabled || sendStatus === 'submitting'} onChange={(event) => setMessageDraft(event.target.value)} />
                  <div className="prototype-session-composer-bar">
                    <button type="button" className="prototype-composer-attach" aria-label={text(locale, '附件', 'Attach')} disabled title={text(locale, '后续消息暂不支持附件', 'Attachments are unavailable for follow-up messages')}><PrototypePaperclipIcon aria-hidden="true" /></button>
                    <button type="button" className="prototype-composer-model" aria-disabled="true">Opus 4.7<PrototypeChevronDownLargeIcon aria-hidden="true" /></button>
                    <button type="button" className="prototype-composer-sparkle" aria-label={text(locale, '增强', 'Enhance')} disabled>✦</button>
                    <button type="submit" className="prototype-composer-send" aria-label={sendStatus === 'submitting' ? text(locale, '正在发送', 'Sending') : text(locale, '发送', 'Send')} disabled={!messageDraft.trim() || !executionEnabled || sendStatus === 'submitting'}>{sendStatus === 'submitting' ? '◌' : '↑'}</button>
                  </div>
                </form>
                {!executionEnabled ? <p>{text(locale, '当前部署未开放执行。', 'Execution is unavailable in this deployment.')}</p> : null}
                {sendStatus === 'error' && sendError ? <p role="alert">{sendError}</p> : null}
              </footer> : null}
            </div> : null}

            {activeTab === 'terminal' ? (
              <section className="prototype-session-pane" aria-label={text(locale, '终端', 'Terminal')}>
                <div className="prototype-terminal-window">
                  <header>
                    <span>{text(locale, '会话日志终端 · 实时流', 'Session Terminal · Live Stream')}</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="prototype-ghost-button"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        onClick={() => setClearedTerminal((val) => !val)}
                      >
                        {clearedTerminal ? text(locale, '恢复视图', 'Restore') : text(locale, '清屏', 'Clear')}
                      </button>
                      <button
                        type="button"
                        className="prototype-ghost-button"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        onClick={() => setAutoScrollTerminal((val) => !val)}
                      >
                        {autoScrollTerminal ? text(locale, '已开启自动滚动', 'Auto-scroll ON') : text(locale, '已暂停自动滚动', 'Auto-scroll OFF')}
                      </button>
                    </div>
                  </header>
                  <pre style={{ overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6' }}>
                    {clearedTerminal ? (
                      text(locale, '终端输出已清除。', 'Terminal output cleared.')
                    ) : terminalLines.length ? (
                      terminalLines.map((line, idx) => `${String(idx + 1).padStart(3, ' ')} │ ${line}`).join('\n')
                    ) : events.length ? (
                      events.map((event, idx) => `${String(idx + 1).padStart(3, ' ')} │ ${shortTime(event.occurredAt, locale)}  [${event.type}] ${eventLabel(event, locale)}`).join('\n')
                    ) : (
                      text(locale, '当前没有执行输出。', 'No execution output is available.')
                    )}
                  </pre>
                </div>
                {onOpenWorkers ? <button type="button" className="prototype-pane-action" onClick={onOpenWorkers}>{text(locale, '打开 Worker 详情', 'Open Worker details')}</button> : null}
              </section>
            ) : null}

            {activeTab === 'files' ? (
              <section className="prototype-session-pane" aria-label={text(locale, '文件', 'Files')}>
                <div style={{ display: 'grid', gridTemplateColumns: localFiles.length ? '260px 1fr' : '1fr', gap: '16px', minHeight: '320px' }}>
                  <div style={{ borderRight: localFiles.length ? '1px solid var(--color-border)' : 'none', paddingRight: '12px' }}>
                    <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '8px' }}>
                      {text(locale, '改动文件列表', 'Modified Files')} ({localFiles.length})
                    </h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {localFiles.length ? localFiles.map((file) => (
                        <li key={file.path} style={{ marginBottom: '4px' }}>
                          <button
                            type="button"
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '6px 8px',
                              borderRadius: '4px',
                              border: 'none',
                              background: selectedFilePath === file.path ? 'var(--color-surface-hover)' : 'transparent',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                            }}
                            onClick={() => setSelectedFilePath(file.path)}
                          >
                            <span>{file.path}</span>
                            <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>{file.detail}</span>
                          </button>
                        </li>
                      )) : (
                        <p style={{ color: 'var(--color-muted)', fontSize: '13px' }}>{text(locale, '暂无变更文件', 'No modified files')}</p>
                      )}
                    </ul>
                  </div>
                  <div style={{ background: 'var(--color-surface-card)', padding: '12px', borderRadius: '6px' }}>
                    <h3 style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                      {selectedFilePath ? `${text(locale, '正在预览', 'Previewing')}: ${selectedFilePath}` : text(locale, '选择文件以查看 Diff 代码对比', 'Select a file to inspect code diff')}
                    </h3>
                    <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.5', overflowX: 'auto' }}>
                      {selectedFilePath ? (
                        localFiles.find((f) => f.path === selectedFilePath)?.detail ?? text(locale, '文件未修改', 'Unmodified file')
                      ) : (
                        text(locale, '点击左侧文件查看详细修改行与变更快照。', 'Click a file on the left to inspect detailed line changes.')
                      )}
                    </pre>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'subscriptions' ? (
              <section className="prototype-session-pane prototype-subscriptions" aria-label={text(locale, '执行动态', 'Execution activity')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2>{events.length ? text(locale, '会话事件与订阅路由', 'Session Events & Triggers') : text(locale, '没有订阅', 'No subscriptions')}</h2>
                  <span className="prototype-expert-pill">{events.length} {text(locale, '条记录', 'records')}</span>
                </div>
                {events.length ? (
                  <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {events.map((event) => (
                      <li key={event.eventId} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{eventLabel(event, locale)}</strong>
                          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>#{event.sequence}</span>
                        </div>
                        <time dateTime={event.occurredAt} style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{shortTime(event.occurredAt, locale)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>{text(locale, '当前会话尚无实时订阅事件。', 'No live events are available for this Session.')}</p>
                )}
              </section>
            ) : null}
          </div>
        </div>
        {copyNotice ? <div className="prototype-session-toast" role="status">{copyNotice}</div> : null}
      </div>

      {inspectorOpen ? <aside className="prototype-session-inspector" aria-label={text(locale, '会话详情', 'Session details')}>
        <header><span>{text(locale, '会话', 'SESSION')}</span><div><button type="button" onClick={() => { void copyLink() }}>↗ {text(locale, '复制链接', 'Copy link')}</button><button type="button" onClick={onBack}>← {text(locale, '返回', 'Back')}</button></div></header>
        <div className="prototype-inspector-scroll">
          <dl className="prototype-inspector-facts">
            <div><dt>{text(locale, '会话名称', 'Session name')}</dt><dd>{session.title}</dd></div>
            <div><dt>{text(locale, '会话 ID', 'Session ID')}</dt><dd><code>{session.id}</code><button type="button" className="prototype-icon-button" aria-label={text(locale, '复制会话 ID', 'Copy Session ID')} onClick={() => { void navigator.clipboard?.writeText(session.id) }}><PrototypeCopyIcon aria-hidden="true" /></button></dd></div>
            <div><dt>{text(locale, '最近活动', 'Last active')}</dt><dd><time dateTime={session.lastActivityAt}>{formatDate(session.lastActivityAt, locale)}</time></dd></div>
            <div><dt>{text(locale, '创建时间', 'Created')}</dt><dd><time dateTime={session.createdAt}>{formatDate(session.createdAt, locale)}</time></dd></div>
            <div><dt>{text(locale, '更新时间', 'Updated')}</dt><dd><time dateTime={session.updatedAt}>{formatDate(session.updatedAt, locale)}</time></dd></div>
          </dl>
          <section className="prototype-inspector-section"><h2>{text(locale, '配置', 'Configuration')}</h2><dl>
            <div><dt>{text(locale, '专家', 'Expert')}</dt><dd><span className="prototype-expert-pill"><PrototypeHexIcon aria-hidden="true" />{session.expertName}</span><code>{session.expertId}</code></dd></div>
            <div><dt>{text(locale, '代码仓库', 'Repository')}</dt><dd>{session.repository}</dd></div>
            <div><dt>{text(locale, '基础分支', 'Base branch')}</dt><dd><code>{session.baseBranch}</code></dd></div>
            <div><dt>{text(locale, '可见性', 'Visibility')}</dt><dd>{visibilityLabel(session.visibility, locale)}</dd></div>
            <div><dt>{text(locale, '专家修订 ID', 'Expert revision ID')}</dt><dd><code>{revisionValue(session.expertRevisionId, locale)}</code></dd></div>
            <div><dt>{text(locale, '环境修订 ID', 'Environment revision ID')}</dt><dd><code>{revisionValue(session.environmentRevisionId, locale)}</code></dd></div>
            <div><dt>{text(locale, '仓库绑定 ID', 'Repository binding ID')}</dt><dd><code>{revisionValue(session.repositoryId, locale)}</code></dd></div>
          </dl></section>
          <section className="prototype-inspector-section">
            <h2>{text(locale, '产物', 'Artifacts')}<span>{artifacts.length}</span>{onAddArtifactLink ? <button type="button" className="prototype-inspector-add" aria-expanded={artifactFormOpen} onClick={() => setArtifactFormOpen((open) => !open)}>＋ {text(locale, '链接', 'Link')}</button> : null}</h2>
            {artifactFormOpen && onAddArtifactLink ? <form className="prototype-inspector-form" onSubmit={(event) => { event.preventDefault(); void submitArtifactLink() }}>
              <input className="prototype-field" required maxLength={240} placeholder={text(locale, '标签', 'Label')} value={artifactDraft.label} onChange={(event) => setArtifactDraft({ ...artifactDraft, label: event.target.value })} />
              <input className="prototype-field prototype-mono-field" required type="url" placeholder="https://…" value={artifactDraft.url} onChange={(event) => setArtifactDraft({ ...artifactDraft, url: event.target.value })} />
              {artifactError ? <p className="prototype-automation-error" role="alert">{artifactError}</p> : null}
              <div><button type="button" className="prototype-ghost-button" disabled={artifactBusy} onClick={() => setArtifactFormOpen(false)}>{text(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button" disabled={artifactBusy}>{artifactBusy ? text(locale, '添加中…', 'Adding…') : text(locale, '添加', 'Add')}</button></div>
            </form> : null}
            {artifacts.length ? artifacts.map((artifact) => <article className="prototype-inspector-artifact" key={artifact.id}>
              <small>{artifact.type.replace('_', ' ')}</small>
              {artifact.url ? <a href={artifact.url} target="_blank" rel="noreferrer"><strong>{artifact.label}</strong></a> : <strong>{artifact.label}</strong>}
              {artifact.status ? <span>{artifact.status}</span> : null}
              {artifact.server && onRemoveArtifact ? <button type="button" className="prototype-inspector-remove" aria-label={text(locale, `移除 ${artifact.label}`, `Remove ${artifact.label}`)} onClick={() => { void onRemoveArtifact(artifact.server!) }}>×</button> : null}
            </article>) : <p>{text(locale, '尚未生成产物', 'No artifacts yet')}</p>}
          </section>
          {sharesStatus !== 'idle' ? <section className="prototype-inspector-section">
            <h2>{text(locale, '分享', 'Sharing')}<span>{shares.filter((share) => share.revokedAt === null).length}</span></h2>
            {sharesStatus === 'loading' ? <p>{text(locale, '加载中…', 'Loading…')}</p> : null}
            {sharesStatus === 'error' ? <p role="alert">{sharesError ?? text(locale, '无法加载分享。', 'Unable to load shares.')}</p> : null}
            {sharesStatus === 'ready' ? <>
              {shares.filter((share) => share.revokedAt === null).map((share) => <article className="prototype-inspector-artifact" key={share.id}>
                <small>{share.principalType} · {share.role === 'collaborator' ? text(locale, '协作者', 'collaborator') : text(locale, '只读', 'viewer')}</small>
                <strong>{share.principalId}</strong>
                {share.expiresAt ? <span>{text(locale, '到期', 'expires')} {new Date(share.expiresAt).toLocaleDateString()}</span> : null}
                {onRevokeShare ? <button type="button" className="prototype-inspector-remove" aria-label={text(locale, `撤销 ${share.principalId} 的分享`, `Revoke share for ${share.principalId}`)} onClick={() => { void onRevokeShare(share) }}>×</button> : null}
              </article>)}
              {!shares.filter((share) => share.revokedAt === null).length ? <p>{text(locale, '尚未分享', 'Not shared yet')}</p> : null}
              {onCreateShare ? <form className="prototype-inspector-form" onSubmit={(event) => { event.preventDefault(); void submitShare() }}>
                <input className="prototype-field prototype-mono-field" required maxLength={128} placeholder={text(locale, '用户或用户组 ID', 'User or group id')} value={shareDraft.principalId} onChange={(event) => setShareDraft({ ...shareDraft, principalId: event.target.value })} />
                <div className="prototype-inspector-form-row">
                  <select className="prototype-field-select" aria-label={text(locale, '主体类型', 'Principal type')} value={shareDraft.principalType} onChange={(event) => setShareDraft({ ...shareDraft, principalType: event.target.value as 'user' | 'group' })}><option value="user">{text(locale, '用户', 'User')}</option><option value="group">{text(locale, '用户组', 'Group')}</option></select>
                  <select className="prototype-field-select" aria-label={text(locale, '角色', 'Role')} value={shareDraft.role} onChange={(event) => setShareDraft({ ...shareDraft, role: event.target.value as 'viewer' | 'collaborator' })}><option value="viewer">{text(locale, '只读', 'Viewer')}</option><option value="collaborator">{text(locale, '协作者', 'Collaborator')}</option></select>
                </div>
                {shareError ? <p className="prototype-automation-error" role="alert">{shareError}</p> : null}
                <div><button type="submit" className="prototype-primary-button" disabled={shareBusy || !shareDraft.principalId.trim()}>{shareBusy ? text(locale, '分享中…', 'Sharing…') : text(locale, '分享', 'Share')}</button></div>
              </form> : null}
            </> : null}
          </section> : null}
          <section className="prototype-inspector-section"><h2>{text(locale, '摘要', 'Summary')}</h2><p>{session.summary || text(locale, '服务端未提供摘要。', 'No summary was provided by the server.')}</p>{onOpenFiles ? <button type="button" className="prototype-pane-action" onClick={onOpenFiles}>{text(locale, '打开文件', 'Open Files')}</button> : null}{onOpenWorkers ? <button type="button" className="prototype-pane-action" onClick={onOpenWorkers}>{text(locale, '打开 Workers', 'Open Workers')}</button> : null}</section>
        </div>
      </aside> : null}

      {stopConfirmationOpen ? <div className="prototype-session-dialog-backdrop" role="presentation"><section ref={stopDialogRef} className="prototype-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="prototype-stop-title" aria-describedby="prototype-stop-description"><h2 id="prototype-stop-title">{text(locale, '停止当前执行？', 'Stop this execution?')}</h2><p id="prototype-stop-description">{text(locale, '服务端将取消当前会话；已经提交的产物不会被删除。', 'The server will cancel this Session; existing artifacts will not be deleted.')}</p><div><button ref={stopCancelRef} type="button" onClick={() => { setStopConfirmationOpen(false); window.requestAnimationFrame(() => stopReturnRef.current?.focus()) }}>{text(locale, '返回', 'Back')}</button><button type="button" className="danger" onClick={confirmStop}>{text(locale, '取消执行', 'Cancel execution')}</button></div></section></div> : null}
    </main>
  )
}
