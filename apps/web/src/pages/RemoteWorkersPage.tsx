import type { SessionWorkerDto } from '@relay/contracts'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  GitFork,
  LoaderCircle,
  LockKeyhole,
  Menu,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  RelayApiError,
  listSessionWorkers,
  type RelayApiAuthContext,
} from '../services/relayApi'

export type RemoteWorkersPageProps = {
  organizationId: string
  spaceId: string
  sessionId: string
  auth: RelayApiAuthContext
  credentialVersion: number
  onOpenNavigation?: () => void
  onBackToSession: () => void
}

type WorkerSnapshot = {
  identity: string
  status: 'ready' | 'error'
  items: SessionWorkerDto[]
  nextCursor: string | null
  loadingMore: boolean
  error?: string
}

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof RelayApiError && cause.status === 404) {
    return cause.message
  }
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusView(status: SessionWorkerDto['status'], locale: Locale) {
  const views = {
    queued: { label: text(locale, '已排队', 'Queued'), icon: Clock3, tone: 'neutral' },
    running: { label: text(locale, '进行中', 'Running'), icon: LoaderCircle, tone: 'active' },
    waiting: { label: text(locale, '等待中', 'Waiting'), icon: Clock3, tone: 'waiting' },
    completed: { label: text(locale, '已完成', 'Completed'), icon: CheckCircle2, tone: 'completed' },
    failed: { label: text(locale, '失败', 'Failed'), icon: XCircle, tone: 'failed' },
    canceled: { label: text(locale, '已取消', 'Canceled'), icon: XCircle, tone: 'neutral' },
  } as const
  return views[status]
}

export function RemoteWorkersPage({
  organizationId,
  spaceId,
  sessionId,
  auth,
  credentialVersion,
  onOpenNavigation,
  onBackToSession,
}: RemoteWorkersPageProps) {
  const { locale } = usePreferences()
  const requestAuth = useMemo<RelayApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const [retryVersion, setRetryVersion] = useState(0)
  const identity = [organizationId, spaceId, sessionId, credentialVersion, retryVersion].join('\u0000')
  const [snapshot, setSnapshot] = useState<WorkerSnapshot>()
  const current = snapshot?.identity === identity ? snapshot : undefined

  useEffect(() => {
    const controller = new AbortController()
    void listSessionWorkers(
      organizationId,
      spaceId,
      sessionId,
      requestAuth,
      controller.signal,
      { limit: 50 },
    ).then((page) => {
      if (!controller.signal.aborted) setSnapshot({
        identity,
        status: 'ready',
        items: page.items,
        nextCursor: page.page.nextCursor,
        loadingMore: false,
      })
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setSnapshot({
        identity,
        status: 'error',
        items: [],
        nextCursor: null,
        loadingMore: false,
        error: errorMessage(cause, 'Unable to load Session Workers.'),
      })
    })
    return () => { controller.abort() }
  }, [identity, organizationId, requestAuth, sessionId, spaceId])

  const loadMore = useCallback(() => {
    if (!current?.nextCursor || current.loadingMore) return
    const cursor = current.nextCursor
    setSnapshot({ ...current, loadingMore: true, error: undefined })
    void listSessionWorkers(
      organizationId,
      spaceId,
      sessionId,
      requestAuth,
      undefined,
      { cursor, limit: 50 },
    ).then((page) => setSnapshot((value) => value?.identity === identity ? {
      ...value,
      items: [...value.items, ...page.items],
      nextCursor: page.page.nextCursor,
      loadingMore: false,
      error: undefined,
    } : value), (cause: unknown) => setSnapshot((value) => value?.identity === identity ? {
      ...value,
      loadingMore: false,
      error: errorMessage(cause, 'Unable to load more Session Workers.'),
    } : value))
  }, [current, identity, organizationId, requestAuth, sessionId, spaceId])

  const stats = useMemo(() => {
    const items = current?.items ?? []
    return {
      total: items.length,
      active: items.filter((worker) => ['queued', 'running', 'waiting'].includes(worker.status)).length,
      terminal: items.filter((worker) => ['completed', 'failed', 'canceled'].includes(worker.status)).length,
    }
  }, [current])

  return (
    <main className="cosmos-page remote-workers-page">
      <header className="cosmos-page-header">
        <div className="cosmos-page-header__identity">
          <IconButton icon={Menu} label={text(locale, '打开导航', 'Open navigation')} className="cosmos-mobile-menu" onClick={onOpenNavigation} />
          <span className="cosmos-page-header__icon"><GitFork aria-hidden="true" /></span>
          <div>
            <h1>{text(locale, 'Worker 树', 'Worker Tree')}</h1>
            <p>{organizationId} / {spaceId} / {sessionId}</p>
          </div>
        </div>
        <div className="cosmos-page-header__actions">
          <span className="remote-catalog-readonly"><LockKeyhole aria-hidden="true" />{text(locale, '只读', 'Read only')}</span>
          <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onBackToSession}><ArrowLeft aria-hidden="true" />{text(locale, '返回会话', 'Back to Session')}</button>
          <GlobalControls className="cosmos-global-controls" />
          <IconButton icon={RefreshCw} label={text(locale, '刷新 Worker', 'Refresh Workers')} onClick={() => setRetryVersion((value) => value + 1)} />
        </div>
      </header>

      <div className="cosmos-page__content remote-workers-content">
        <section className="remote-workers-summary" aria-label={text(locale, 'Worker 摘要', 'Worker summary')}>
          <div><span>{text(locale, '已加载', 'Loaded')}</span><strong>{stats.total}</strong></div>
          <div><span>{text(locale, '执行中', 'In progress')}</span><strong>{stats.active}</strong></div>
          <div><span>{text(locale, '已结束', 'Terminal')}</span><strong>{stats.terminal}</strong></div>
        </section>

        <section className="remote-workers-panel" aria-labelledby="remote-workers-title">
          <header>
            <GitFork aria-hidden="true" />
            <h2 id="remote-workers-title">{text(locale, '委派执行', 'Delegated execution')}</h2>
            <span>{text(locale, '父节点优先', 'Parent first')}</span>
          </header>

          {!current ? <div className="remote-workers-state" role="status"><LoaderCircle className="cosmos-spin" aria-hidden="true" />{text(locale, '正在加载 Worker…', 'Loading Workers…')}</div> : null}
          {current?.status === 'error' ? <div className="remote-workers-state remote-workers-state--error" role="alert"><AlertTriangle aria-hidden="true" /><span>{current.error}</span><button type="button" onClick={() => setRetryVersion((value) => value + 1)}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
          {current?.status === 'ready' && !current.items.length ? <div className="remote-workers-empty"><CircleDot aria-hidden="true" /><strong>{text(locale, '当前没有 Worker', 'No Workers yet')}</strong><span>{text(locale, '当 Expert 委派独立子任务时，权威执行记录会出现在这里。', 'Authoritative delegated execution records will appear here.')}</span></div> : null}
          {current?.status === 'ready' && current.items.length ? (
            <ol className="remote-workers-tree" role="tree" aria-label={text(locale, 'Session Worker 树', 'Session Worker tree')}>
              {current.items.map((worker) => {
                const view = statusView(worker.status, locale)
                const StatusIcon = view.icon
                return <li
                  key={worker.id}
                  role="treeitem"
                  aria-level={worker.depth}
                  className="remote-worker-row"
                  style={{ '--worker-indent': `${Math.min(worker.depth - 1, 8) * 28}px` } as CSSProperties}
                >
                  <span className="remote-worker-row__branch" aria-hidden="true"><GitFork /></span>
                  <div className="remote-worker-row__body">
                    <header>
                      <div><strong>{worker.name}</strong><code>{worker.id}</code></div>
                      <span className={`remote-worker-status remote-worker-status--${view.tone}`}><StatusIcon className={worker.status === 'running' ? 'cosmos-spin' : undefined} aria-hidden="true" />{view.label}</span>
                    </header>
                    <p>{worker.instructions}</p>
                    {worker.resultSummary ? <blockquote>{worker.resultSummary}</blockquote> : null}
                    <footer>
                      <span>{text(locale, '层级', 'Depth')} {worker.depth}</span>
                      <span>{text(locale, '顺序', 'Ordinal')} {worker.ordinal}</span>
                      <span>{text(locale, '父回合', 'Parent turn')} <code>{worker.parentTurnId}</code></span>
                      {worker.parentWorkerId ? <span>{text(locale, '父 Worker', 'Parent Worker')} <code>{worker.parentWorkerId}</code></span> : null}
                      {worker.expertRevisionId ? <span>{text(locale, '专家修订', 'Expert revision')} <code>{worker.expertRevisionId}</code></span> : null}
                      <time dateTime={worker.createdAt}>{formatDate(worker.createdAt, locale)}</time>
                    </footer>
                  </div>
                </li>
              })}
            </ol>
          ) : null}
          {current?.status === 'ready' && current.error ? <div className="remote-workers-page-error" role="alert"><AlertTriangle aria-hidden="true" />{current.error}</div> : null}
          {current?.nextCursor ? <button type="button" className="remote-workers-load-more" disabled={current.loadingMore} onClick={loadMore}>{current.loadingMore ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{text(locale, '加载更多 Worker', 'Load more Workers')}</button> : null}
        </section>
      </div>
    </main>
  )
}
