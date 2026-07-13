import type {
  SessionDto,
  SessionEventDto,
  SessionMessageDto,
  SessionStatus,
  SessionVisibility,
} from '@relay/contracts'
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  LoaderCircle,
  Menu,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GlobalControls } from '../../components/GlobalControls'
import { IconButton } from '../../components/ui'
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
  onBack: () => void
  onOpenNavigation?: () => void
}

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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
  return visibility === 'private'
    ? text(locale, '私有', 'Private')
    : text(locale, '空间成员', 'Space')
}

function revisionValue(value: string | undefined, locale: Locale) {
  return value ?? text(locale, '未解析（旧版会话记录）', 'Not resolved (legacy session record)')
}

function messageRoleLabel(role: SessionMessageDto['role'], locale: Locale) {
  const labels: Record<SessionMessageDto['role'], [string, string]> = {
    user: ['用户', 'User'],
    agent: ['Expert', 'Expert'],
    tool: ['工具', 'Tool'],
    system: ['系统', 'System'],
    event: ['事件', 'Event'],
  }
  return text(locale, ...labels[role])
}

function eventLabel(event: SessionEventDto, locale: Locale) {
  if (event.type === 'session.created') return text(locale, '会话已创建', 'Session created')
  if (event.type === 'session.updated') return text(
    locale,
    `会话状态已更新为${statusLabel(event.payload.status, locale)}`,
    `Session status updated to ${statusLabel(event.payload.status, locale)}`,
  )
  if (event.type === 'session.renamed') return text(locale, '会话已重命名', 'Session renamed')
  if (event.type === 'session.archived') return text(locale, '会话已归档', 'Session archived')
  if (event.type === 'session.restored') return text(locale, '会话已恢复', 'Session restored')
  if (event.type === 'message.created') return text(locale, '消息已记录', 'Message recorded')
  if (event.type === 'turn.queued') return text(locale, '任务回合已排队', 'Turn queued')
  const attempt = `${text(locale, '第', 'Attempt ')}${event.payload.number}${text(locale, ' 次尝试', '')}`
  const statuses = {
    queued: ['已排队', 'queued'],
    starting: ['正在启动', 'starting'],
    running: ['正在执行', 'running'],
    waiting: ['等待中', 'waiting'],
    paused: ['已暂停', 'paused'],
    succeeded: ['已完成', 'succeeded'],
    failed: ['失败', 'failed'],
    canceled: ['已取消', 'canceled'],
  } as const
  const status = statuses[event.payload.status]
  return `${attempt} · ${text(locale, status[0], status[1])}`
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
      description: text(
        locale,
        `第 ${number} 次尝试失败${failureCode ? `，错误代码：${failureCode}` : ''}；下一次尝试已排队。`,
        `Attempt ${number} failed${failureCode ? ` with code ${failureCode}` : ''}; the next attempt is queued.`,
      ),
    }
    if (session.status === 'canceled' && status !== 'canceled') {
      return {
        tone: 'failed',
        title: text(locale, '执行已取消', 'Execution canceled'),
        description: text(locale, '服务端会话已取消。', 'The server Session was canceled.'),
      }
    }
    if (status === 'succeeded') return {
      tone: 'completed',
      title: text(locale, '执行已完成', 'Execution completed'),
      description: text(locale, `第 ${number} 次尝试已成功完成。`, `Attempt ${number} completed successfully.`),
    }
    if (status === 'failed') return {
      tone: 'failed',
      title: text(locale, '执行失败', 'Execution failed'),
      description: text(
        locale,
        `第 ${number} 次尝试失败${failureCode ? `，错误代码：${failureCode}` : ''}。`,
        `Attempt ${number} failed${failureCode ? ` with code ${failureCode}` : ''}.`,
      ),
    }
    if (status === 'canceled') return {
      tone: 'failed',
      title: text(locale, '执行已取消', 'Execution canceled'),
      description: text(locale, `第 ${number} 次尝试已取消。`, `Attempt ${number} was canceled.`),
    }
    if (status === 'waiting' || status === 'paused') return {
      tone: 'waiting',
      title: status === 'waiting'
        ? text(locale, '执行正在等待', 'Execution is waiting')
        : text(locale, '执行已暂停', 'Execution paused'),
      description: text(locale, `第 ${number} 次尝试当前为${status === 'waiting' ? '等待' : '暂停'}状态。`, `Attempt ${number} is ${status}.`),
    }
    if (number > 1) return {
      tone: 'retrying',
      title: text(locale, '正在重试', 'Retry in progress'),
      description: text(locale, `第 ${number} 次尝试${status === 'queued' ? '正在等待执行' : '正在执行'}。`, `Attempt ${number} is ${status}.`),
    }
    return {
      tone: status === 'queued' ? 'neutral' : 'running',
      title: status === 'queued'
        ? text(locale, '执行已排队', 'Execution queued')
        : text(locale, '正在执行', 'Execution in progress'),
      description: text(locale, `第 1 次尝试${status === 'queued' ? '正在等待 Worker' : '正在执行'}。`, `Attempt 1 is ${status}.`),
    }
  }

  const fallback: Record<SessionStatus, ExecutionView> = {
    draft: { tone: 'neutral', title: text(locale, '会话草稿已保存', 'Session draft saved'), description: text(locale, '草稿尚未提交执行。', 'This draft has not been submitted for execution.') },
    queued: { tone: 'neutral', title: text(locale, '已排队，等待执行', 'Queued for execution'), description: text(locale, '命令已被服务端接受，正在等待 Worker 领取。', 'The server accepted the command and it is waiting for a Worker.') },
    active: { tone: 'running', title: text(locale, '正在执行', 'Execution in progress'), description: text(locale, '服务端会话处于进行中；正在等待最新 Attempt 事件。', 'The server Session is active; waiting for the latest Attempt event.') },
    waiting: { tone: 'waiting', title: text(locale, '执行正在等待', 'Execution is waiting'), description: text(locale, '服务端会话处于等待状态。', 'The server Session is waiting.') },
    paused: { tone: 'waiting', title: text(locale, '执行已暂停', 'Execution paused'), description: text(locale, '服务端会话处于暂停状态。', 'The server Session is paused.') },
    completed: { tone: 'completed', title: text(locale, '执行已完成', 'Execution completed'), description: text(locale, '服务端会话已完成。', 'The server Session completed.') },
    failed: { tone: 'failed', title: text(locale, '执行失败', 'Execution failed'), description: text(locale, '服务端会话已标记为失败。', 'The server Session is marked as failed.') },
    canceled: { tone: 'failed', title: text(locale, '执行已取消', 'Execution canceled'), description: text(locale, '服务端会话已取消。', 'The server Session was canceled.') },
  }
  return fallback[session.status]
}

function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { locale } = usePreferences()
  const tone = status === 'active'
    ? 'active'
    : status === 'completed'
      ? 'completed'
      : status === 'failed' || status === 'canceled'
        ? 'failed'
        : status === 'waiting' || status === 'paused'
          ? 'waiting'
          : 'neutral'

  return (
    <span className={`remote-session-status remote-session-status--${tone}`}>
      <i aria-hidden="true" />
      {statusLabel(status, locale)}
    </span>
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
  controlAction,
  controlError,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onBack,
  onOpenNavigation,
}: RemoteSessionWorkbenchProps) {
  const { locale } = usePreferences()
  const [copyNotice, setCopyNotice] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const copyTimer = useRef<number | undefined>(undefined)
  const execution = executionView(session, events, locale)
  const ExecutionIcon = execution.tone === 'completed'
    ? CheckCircle2
    : execution.tone === 'failed'
      ? XCircle
      : execution.tone === 'retrying'
        ? RotateCcw
        : execution.tone === 'running'
          ? LoaderCircle
          : execution.tone === 'waiting'
            ? Clock3
            : CircleAlert

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
  }, [])

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(window.location.href)
      setCopyNotice(text(locale, '会话链接已复制', 'Session link copied'))
    } catch {
      setCopyNotice(text(
        locale,
        '无法访问剪贴板，请复制地址栏链接',
        'Clipboard unavailable. Copy the address bar link.',
      ))
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
      // The route owns the error message; retaining the draft lets the user retry safely.
    }
  }

  const canAppendMessage = session.status !== 'draft' && session.status !== 'canceled'
  const controlSubmitting = controlStatus === 'submitting'
  const canPause = session.status === 'queued' || session.status === 'active' || session.status === 'waiting'
  const canResume = session.status === 'paused'
  const canCancel = ['draft', 'queued', 'active', 'waiting', 'paused'].includes(session.status)
  const canRetry = session.status === 'failed' && Boolean(onRetry)

  return (
    <main className="remote-session-workbench">
      <header className="remote-session-header">
        <div className="remote-session-header__identity">
          {onOpenNavigation ? (
            <IconButton
              icon={Menu}
              label={text(locale, '打开导航', 'Open navigation')}
              className="remote-session-mobile-menu"
              onClick={onOpenNavigation}
            />
          ) : null}
          <span className="remote-session-header__icon"><Bot aria-hidden="true" /></span>
          <div>
            <h1>{session.title}</h1>
            <p>{session.repository} <span aria-hidden="true">/</span> {session.baseBranch}</p>
          </div>
          <SessionStatusBadge status={session.status} />
        </div>
        <div className="remote-session-header__actions">
          <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {text(locale, '返回会话', 'Back to Sessions')}
          </button>
          <GlobalControls className="remote-session-global-controls" />
          <IconButton
            icon={Link2}
            label={text(locale, '复制链接', 'Copy link')}
            onClick={() => { void copyLink() }}
          />
        </div>
      </header>

      {copyNotice ? (
        <div className="toast remote-session-toast" role="status">
          <Link2 aria-hidden="true" /><span>{copyNotice}</span>
        </div>
      ) : null}

      <div className="remote-session-content">
        <section className={`remote-session-execution-state remote-session-execution-state--${execution.tone}`} aria-labelledby="remote-session-execution-title">
          <ExecutionIcon className={execution.tone === 'running' || execution.tone === 'retrying' ? 'cosmos-spin' : undefined} aria-hidden="true" />
          <div>
            <h2 id="remote-session-execution-title">
              {execution.title}
            </h2>
            <p>{execution.description}</p>
          </div>
          {session.status === 'draft' && onStart ? (
            <div className="remote-session-execution-state__action">
              <button
                type="button"
                className="cosmos-button cosmos-button--primary"
                disabled={!executionEnabled || startStatus === 'submitting'}
                onClick={onStart}
              >
                {startStatus === 'submitting'
                  ? <LoaderCircle className="cosmos-spin" aria-hidden="true" />
                  : <Play aria-hidden="true" />}
                {startStatus === 'submitting'
                  ? text(locale, '正在启动', 'Starting')
                  : text(locale, '开始执行', 'Start execution')}
              </button>
              {!executionEnabled ? (
                <span>{text(locale, '当前部署未开放执行。', 'Execution is unavailable in this deployment.')}</span>
              ) : null}
              {startStatus === 'error' && startError ? (
                <span role="alert">{startError}</span>
              ) : null}
            </div>
          ) : null}
          {(canPause || canResume || canCancel || canRetry) ? (
            <div className="remote-session-execution-state__action">
              {canPause && onPause ? (
                <button
                  type="button"
                  className="cosmos-button cosmos-button--secondary"
                  disabled={controlSubmitting}
                  onClick={onPause}
                >
                  {controlSubmitting && controlAction === 'pause'
                    ? <LoaderCircle className="cosmos-spin" aria-hidden="true" />
                    : <Pause aria-hidden="true" />}
                  {text(locale, '暂停', 'Pause')}
                </button>
              ) : null}
              {canResume && onResume ? (
                <button
                  type="button"
                  className="cosmos-button cosmos-button--primary"
                  disabled={controlSubmitting || !executionEnabled}
                  onClick={onResume}
                >
                  {controlSubmitting && controlAction === 'resume'
                    ? <LoaderCircle className="cosmos-spin" aria-hidden="true" />
                    : <Play aria-hidden="true" />}
                  {text(locale, '恢复', 'Resume')}
                </button>
              ) : null}
              {canRetry && onRetry ? (
                <button
                  type="button"
                  className="cosmos-button cosmos-button--primary"
                  disabled={controlSubmitting || !executionEnabled}
                  onClick={onRetry}
                >
                  {controlSubmitting && controlAction === 'retry'
                    ? <LoaderCircle className="cosmos-spin" aria-hidden="true" />
                    : <RotateCcw aria-hidden="true" />}
                  {text(locale, '重试', 'Retry')}
                </button>
              ) : null}
              {canCancel && onCancel ? (
                <button
                  type="button"
                  className="cosmos-button cosmos-button--secondary"
                  disabled={controlSubmitting}
                  onClick={onCancel}
                >
                  {controlSubmitting && controlAction === 'cancel'
                    ? <LoaderCircle className="cosmos-spin" aria-hidden="true" />
                    : <Square aria-hidden="true" />}
                  {text(locale, '取消执行', 'Cancel execution')}
                </button>
              ) : null}
              {controlStatus === 'error' && controlError ? <span role="alert">{controlError}</span> : null}
            </div>
          ) : null}
        </section>

        {timelineStatus === 'error' ? (
          <div className="remote-session-timeline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{text(locale, '实时更新暂时中断，正在自动重试。', 'Live updates are interrupted; retrying automatically.')}</span>
            {timelineError ? <code>{timelineError}</code> : null}
          </div>
        ) : null}

        <section className="remote-session-section" aria-labelledby="remote-session-messages-title">
          <header>
            <MessageSquare aria-hidden="true" />
            <h2 id="remote-session-messages-title">{text(locale, '会话消息', 'Session messages')}</h2>
            <span className="remote-session-section__count">{messages.length}</span>
          </header>
          {messages.length ? (
            <ol className="remote-session-messages">
              {messages.map((message) => (
                <li key={message.id} className={`remote-session-message remote-session-message--${message.role}`}>
                  <header>
                    <strong>{messageRoleLabel(message.role, locale)}</strong>
                    <span>#{message.sequence}</span>
                    <time dateTime={message.createdAt}>{formatDate(message.createdAt, locale)}</time>
                  </header>
                  <p>{message.content}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="remote-session-empty">{timelineStatus === 'loading'
              ? text(locale, '正在加载消息...', 'Loading messages...')
              : text(locale, '当前没有消息。', 'No messages yet.')}</p>
          )}
        </section>

        <section className="remote-session-section" aria-labelledby="remote-session-events-title">
          <header>
            <Activity aria-hidden="true" />
            <h2 id="remote-session-events-title">{text(locale, '执行动态', 'Execution activity')}</h2>
            <span className="remote-session-section__count">{events.length}</span>
          </header>
          {events.length ? (
            <ol className="remote-session-events">
              {events.map((event) => (
                <li key={event.eventId}>
                  <i aria-hidden="true" />
                  <div>
                    <strong>{eventLabel(event, locale)}</strong>
                    {event.type === 'attempt.updated' && event.payload.failureCode
                      ? <code>{event.payload.failureCode}</code>
                      : null}
                  </div>
                  <span>#{event.sequence}</span>
                  <time dateTime={event.occurredAt}>{formatDate(event.occurredAt, locale)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="remote-session-empty">{timelineStatus === 'loading'
              ? text(locale, '正在加载执行动态...', 'Loading execution activity...')
              : text(locale, '当前没有执行动态。', 'No execution activity yet.')}</p>
          )}
        </section>

        <section className="remote-session-section" aria-labelledby="remote-session-summary-title">
          <header>
            <FileText aria-hidden="true" />
            <h2 id="remote-session-summary-title">{text(locale, '会话摘要', 'Session summary')}</h2>
          </header>
          <p className="remote-session-summary">
            {session.summary || text(locale, '服务端未提供摘要。', 'No summary was provided by the server.')}
          </p>
        </section>

        <section className="remote-session-section" aria-labelledby="remote-session-facts-title">
          <header>
            <ShieldCheck aria-hidden="true" />
            <h2 id="remote-session-facts-title">{text(locale, '服务端会话事实', 'Server session facts')}</h2>
          </header>
          <dl className="remote-session-facts">
            <div>
              <dt>{text(locale, '状态', 'Status')}</dt>
              <dd>{statusLabel(session.status, locale)}</dd>
            </div>
            <div>
              <dt>{text(locale, '可见性', 'Visibility')}</dt>
              <dd>{visibilityLabel(session.visibility, locale)}</dd>
            </div>
            <div>
              <dt>{text(locale, '专家', 'Expert')}</dt>
              <dd><strong>{session.expertName}</strong><code>{session.expertId}</code></dd>
            </div>
            <div>
              <dt>{text(locale, '代码仓库', 'Repository')}</dt>
              <dd><GitBranch aria-hidden="true" /><strong>{session.repository}</strong></dd>
            </div>
            <div>
              <dt>{text(locale, '基础分支', 'Base branch')}</dt>
              <dd><code>{session.baseBranch}</code></dd>
            </div>
          </dl>
        </section>

        <section className="remote-session-section" aria-labelledby="remote-session-revisions-title">
          <header>
            <ShieldCheck aria-hidden="true" />
            <h2 id="remote-session-revisions-title">{text(locale, '权威配置引用', 'Authoritative configuration references')}</h2>
          </header>
          <dl className="remote-session-revisions">
            <div>
              <dt>{text(locale, '专家修订 ID', 'Expert revision ID')}</dt>
              <dd><code>{revisionValue(session.expertRevisionId, locale)}</code></dd>
            </div>
            <div>
              <dt>{text(locale, '环境修订 ID', 'Environment revision ID')}</dt>
              <dd><code>{revisionValue(session.environmentRevisionId, locale)}</code></dd>
            </div>
            <div>
              <dt>{text(locale, '仓库绑定 ID', 'Repository binding ID')}</dt>
              <dd><code>{revisionValue(session.repositoryId, locale)}</code></dd>
            </div>
          </dl>
        </section>

        <section className="remote-session-section" aria-labelledby="remote-session-time-title">
          <header>
            <CalendarClock aria-hidden="true" />
            <h2 id="remote-session-time-title">{text(locale, '服务端时间', 'Server timestamps')}</h2>
          </header>
          <dl className="remote-session-timestamps">
            <div>
              <dt>{text(locale, '创建时间', 'Created')}</dt>
              <dd><time dateTime={session.createdAt}>{formatDate(session.createdAt, locale)}</time></dd>
            </div>
            <div>
              <dt>{text(locale, '更新时间', 'Updated')}</dt>
              <dd><time dateTime={session.updatedAt}>{formatDate(session.updatedAt, locale)}</time></dd>
            </div>
          </dl>
        </section>
      </div>

      {canAppendMessage && onSend ? (
        <footer className="remote-session-composer">
          <form onSubmit={(event) => { void submitMessage(event) }}>
            <textarea
              aria-label={text(locale, '后续消息', 'Follow-up message')}
              placeholder={text(locale, '输入后续消息', 'Add a follow-up message')}
              value={messageDraft}
              maxLength={100_000}
              disabled={!executionEnabled || sendStatus === 'submitting'}
              onChange={(event) => setMessageDraft(event.target.value)}
            />
            <IconButton
              type="submit"
              icon={sendStatus === 'submitting' ? LoaderCircle : Send}
              label={sendStatus === 'submitting'
                ? text(locale, '正在发送', 'Sending')
                : text(locale, '发送', 'Send')}
              disabled={!messageDraft.trim() || !executionEnabled || sendStatus === 'submitting'}
            />
          </form>
          {!executionEnabled ? (
            <p>{text(locale, '当前部署未开放执行。', 'Execution is unavailable in this deployment.')}</p>
          ) : null}
          {sendStatus === 'error' && sendError ? <p role="alert">{sendError}</p> : null}
        </footer>
      ) : null}
    </main>
  )
}
