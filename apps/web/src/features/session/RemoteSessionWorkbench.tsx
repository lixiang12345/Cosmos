import type { SessionDto, SessionStatus, SessionVisibility } from '@relay/contracts'
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CircleAlert,
  FileText,
  GitBranch,
  Link2,
  Menu,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { GlobalControls } from '../../components/GlobalControls'
import { IconButton } from '../../components/ui'
import { usePreferences, type Locale } from '../../preferences'

export type RemoteSessionWorkbenchProps = {
  session: SessionDto
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
  onBack,
  onOpenNavigation,
}: RemoteSessionWorkbenchProps) {
  const { locale } = usePreferences()
  const [copyNotice, setCopyNotice] = useState('')
  const copyTimer = useRef<number | undefined>(undefined)
  const executionTitle = session.status === 'draft'
    ? text(locale, '会话草稿已保存', 'Session draft saved')
    : session.status === 'queued'
      ? text(locale, '命令已接受，但执行面未接通', 'Command accepted, but the execution plane is not connected')
      : text(locale, '执行详情尚未接通', 'Execution details are not connected')

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
        <section className="remote-session-execution-state" aria-labelledby="remote-session-execution-title">
          <CircleAlert aria-hidden="true" />
          <div>
            <h2 id="remote-session-execution-title">
              {executionTitle}
            </h2>
            <p>{text(
              locale,
              '当前仅显示服务端权威会话记录；此页面不表示代码正在执行。',
              'Only the authoritative server session record is available. This page does not indicate that code is executing.',
            )}</p>
          </div>
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
    </main>
  )
}
