import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { PrototypePlusCompactIcon } from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import { usePreferences, type Locale } from '../preferences'
import type { Run, RunStatus } from '../types'

type SessionsPageProps = {
  runs: Run[]
  spaceName?: string
  loadState?: 'loading' | 'ready' | 'error'
  loadError?: string
  managementEnabled?: boolean
  favoritesEnabled?: boolean
  deletionEnabled?: boolean
  sessionCreationEnabled?: boolean
  navigationCollapsed?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onRetry?: () => void
  onOpenNavigation: () => void
  onOpenCommand?: () => void
  onNewTask: (expert?: string) => void
  onOpenSession: (id: string) => void
  onRename: (id: string, title: string) => boolean | Promise<boolean>
  onToggleFavorite: (id: string) => void
  onToggleArchive: (id: string) => boolean | Promise<boolean>
  onDelete: (id: string) => void
}

type SessionFilter = 'all' | 'running' | 'pinned' | 'private' | 'tunnel' | 'unread'

const filters: Array<{ id: SessionFilter; en: string; zh: string }> = [
  { id: 'all', en: 'All', zh: '全部' },
  { id: 'running', en: 'Running', zh: '运行中' },
  { id: 'pinned', en: 'Pinned', zh: '已置顶' },
  { id: 'private', en: 'Private', zh: '私有' },
  { id: 'tunnel', en: 'Tunnels', zh: '隧道' },
  { id: 'unread', en: 'Unread', zh: '未读' },
]

function localize(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function statusView(status: RunStatus, locale: Locale) {
  const labels: Record<RunStatus, [string, string]> = {
    draft: ['草稿', 'draft'],
    queued: ['排队中', 'queued'],
    running: ['运行中', 'running'],
    paused: ['已暂停', 'paused'],
    waiting: ['等待中', 'waiting'],
    completed: ['已完成', 'done'],
    failed: ['失败', 'failed'],
    canceled: ['已取消', 'canceled'],
  }
  const [zh, en] = labels[status]
  return { className: status === 'completed' ? 'done' : status, label: localize(locale, zh, en) }
}

function relativeUpdatedAt(updatedAt: string, locale: Locale) {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return updatedAt
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return localize(locale, '刚刚', 'Just now')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return localize(locale, `${minutes} 分钟前`, `${minutes}m ago`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return localize(locale, `${hours} 小时前`, `${hours}h ago`)
  const days = Math.floor(hours / 24)
  if (days < 7) return localize(locale, `${days} 天前`, `${days}d ago`)
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }).format(timestamp)
}

export function SessionsPage({
  runs,
  spaceName = 'Engineering',
  loadState = 'ready',
  loadError = '',
  managementEnabled = true,
  favoritesEnabled = true,
  deletionEnabled = true,
  sessionCreationEnabled = true,
  navigationCollapsed = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRetry,
  onOpenNavigation,
  onOpenCommand,
  onNewTask,
  onOpenSession,
  onRename,
  onToggleFavorite,
  onToggleArchive,
  onDelete,
}: SessionsPageProps) {
  const { locale } = usePreferences()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [menuRunId, setMenuRunId] = useState<string>()
  const [renameTarget, setRenameTarget] = useState<Run>()
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Run>()
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const restoreMenuFocus = () => window.requestAnimationFrame(() => menuTriggerRef.current?.focus())

  const visibleRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return runs.filter((run) => {
      const matchesQuery = !normalizedQuery || `${run.title} ${run.expert}`.toLocaleLowerCase().includes(normalizedQuery)
      if (!matchesQuery) return false
      if (filter === 'running') return run.status === 'running'
      if (filter === 'pinned') return Boolean(run.favorite)
      if (filter === 'private') return run.visibility === 'private'
      if (filter === 'tunnel') return /(^|\W)tunnel(\W|$)/i.test(run.trigger)
      if (filter === 'unread') return false
      return true
    })
  }, [filter, query, runs])

  useEffect(() => {
    if (!menuRunId) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuRunId(undefined)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuRunId])

  useEffect(() => {
    if (renameTarget) renameInputRef.current?.focus()
    else if (deleteTarget) deleteCancelRef.current?.focus()
  }, [deleteTarget, renameTarget])

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Tab' && (renameTarget || deleteTarget)) {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [])
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
      const hadOverlay = Boolean(menuRunId || renameTarget || deleteTarget)
      setMenuRunId(undefined)
      setRenameTarget(undefined)
      setDeleteTarget(undefined)
      if (hadOverlay) window.requestAnimationFrame(() => menuTriggerRef.current?.focus())
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [deleteTarget, menuRunId, renameTarget])

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, runId: string) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onOpenSession(runId)
  }

  const stopRowClick = (event: MouseEvent<HTMLElement>) => event.stopPropagation()

  const toggleArchive = async (run: Run) => {
    setMenuRunId(undefined)
    setPendingIds((current) => new Set(current).add(run.id))
    await onToggleArchive(run.id)
    setPendingIds((current) => {
      const next = new Set(current)
      next.delete(run.id)
      return next
    })
  }

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = renameValue.trim()
    if (!renameTarget || !title) return
    if (title === renameTarget.title) {
      setRenameTarget(undefined)
      return
    }
    setPendingIds((current) => new Set(current).add(renameTarget.id))
    const completed = await onRename(renameTarget.id, title)
    setPendingIds((current) => {
      const next = new Set(current)
      next.delete(renameTarget.id)
      return next
    })
    if (completed) {
      setRenameTarget(undefined)
      restoreMenuFocus()
    }
  }

  return (
    <main className="prototype-sessions-page">
      <PrototypePageTopbar
        crumb={localize(locale, '会话', 'Sessions')}
        navigationCollapsed={navigationCollapsed}
        onOpenNavigation={onOpenNavigation}
        onOpenCommand={onOpenCommand}
      />
      <div className="prototype-sessions-viewport">
        <section className="prototype-sessions-content" aria-labelledby="prototype-sessions-title">
          <div className="prototype-sessions-header">
            <div>
              <h1 id="prototype-sessions-title">{localize(locale, '会话', 'Sessions')}</h1>
              <p>{localize(
                locale,
                `${spaceName} 中的交互式和自动化会话。对话将无限期保存；环境在闲置后会暂停（文档）。`,
                `Interactive and automation sessions in ${spaceName}. Conversations are saved indefinitely; environments pause after inactivity (docs).`,
              )}</p>
            </div>
            {sessionCreationEnabled ? (
              <button type="button" className="prototype-primary-button" onClick={() => onNewTask()}>
                <PrototypePlusCompactIcon aria-hidden="true" />
                {localize(locale, '新建会话', 'New session')}
              </button>
            ) : null}
          </div>

          <div className="prototype-sessions-toolbar">
            <input
              className="prototype-sessions-filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={localize(locale, '筛选会话', 'Filter sessions')}
              placeholder={localize(locale, '筛选会话…', 'Filter sessions…')}
            />
            <div className="prototype-segmented" aria-label={localize(locale, '会话筛选', 'Session filters')}>
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? 'active' : undefined}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {locale === 'zh' ? item.zh : item.en}
                </button>
              ))}
            </div>
          </div>

          <table className="prototype-sessions-table" aria-label={localize(locale, '会话', 'Sessions')}>
            <thead><tr>
              <th>{localize(locale, '标题', 'Title')}</th>
              <th>{localize(locale, '专家', 'Expert')}</th>
              <th>{localize(locale, '状态', 'Status')}</th>
              <th>{localize(locale, '可见性', 'Visibility')}</th>
              <th>{localize(locale, '更新时间', 'Updated')}</th>
            </tr></thead>
            <tbody>
              {loadState === 'loading' ? (
                <tr><td colSpan={5} className="prototype-sessions-state" role="status">{localize(locale, '正在加载会话…', 'Loading sessions…')}</td></tr>
              ) : loadState === 'error' ? (
                <tr><td colSpan={5} className="prototype-sessions-state prototype-sessions-state--error" role="alert">
                  <span>{loadError || localize(locale, '无法加载会话。', 'Unable to load sessions.')}</span>
                  {onRetry ? <button type="button" onClick={onRetry}>{localize(locale, '重试', 'Retry')}</button> : null}
                </td></tr>
              ) : visibleRuns.length ? visibleRuns.map((run) => {
                const status = statusView(run.status, locale)
                return (
                  <tr
                    key={run.id}
                    tabIndex={0}
                    draggable
                    onClick={() => onOpenSession(run.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, run.id)}
                    onDragStart={(event) => event.dataTransfer.setData('text/session', run.id)}
                    aria-label={`${localize(locale, '打开会话', 'Open session')}: ${run.title}`}
                  >
                    <td className="prototype-session-title-cell">
                      {run.favorite ? '★ ' : ''}{run.title}
                      {managementEnabled ? (
                        <span className="prototype-session-row-actions" onClick={stopRowClick}>
                          <button
                            type="button"
                            className="prototype-session-row-menu"
                            aria-label={`${run.title} · ${localize(locale, '会话操作', 'Session actions')}`}
                            aria-haspopup="menu"
                            aria-expanded={menuRunId === run.id}
                            onClick={(event) => {
                              menuTriggerRef.current = event.currentTarget
                              setMenuRunId((current) => current === run.id ? undefined : run.id)
                            }}
                          >⋯</button>
                          {menuRunId === run.id ? (
                            <div ref={menuRef} className="prototype-session-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => { setRenameValue(run.title); setRenameTarget(run); setMenuRunId(undefined) }}>{localize(locale, '重命名', 'Rename')}</button>
                              {favoritesEnabled ? <button type="button" role="menuitem" onClick={() => { onToggleFavorite(run.id); setMenuRunId(undefined) }}>{run.favorite ? localize(locale, '取消置顶', 'Unpin') : localize(locale, '置顶', 'Pin')}</button> : null}
                              <button type="button" role="menuitem" disabled={pendingIds.has(run.id)} onClick={() => { void toggleArchive(run) }}>{run.archived ? localize(locale, '恢复', 'Restore') : localize(locale, '归档', 'Archive')}</button>
                              {deletionEnabled ? <button type="button" role="menuitem" className="danger" onClick={() => { setDeleteTarget(run); setMenuRunId(undefined) }}>{localize(locale, '删除', 'Delete')}</button> : null}
                            </div>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                    <td className="muted">{run.expert || '—'}</td>
                    <td><span className={`prototype-session-status ${status.className}`}>{status.label}</span></td>
                    <td className="muted">{run.visibility === 'private' ? localize(locale, '🔒 私有', '🔒 Private') : localize(locale, '共享', 'Shared')}</td>
                    <td className="muted"><time dateTime={Number.isFinite(Date.parse(run.updatedAt)) ? run.updatedAt : undefined}>{relativeUpdatedAt(run.updatedAt, locale)}</time></td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={5} className="prototype-sessions-state">{query || filter !== 'all' ? localize(locale, '没有匹配的会话。', 'No matching sessions.') : localize(locale, '暂无会话。', 'No sessions yet.')}</td></tr>
              )}
            </tbody>
          </table>
          <div className="prototype-sessions-footer">
            <span>{visibleRuns.length} {localize(locale, '个会话', visibleRuns.length === 1 ? 'session' : 'sessions')}</span>
            {hasMore && onLoadMore ? <button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? localize(locale, '加载中…', 'Loading…') : localize(locale, '加载更多', 'Load more')}</button> : null}
          </div>
        </section>
      </div>

      {renameTarget ? (
        <div className="prototype-session-dialog-backdrop" role="presentation">
          <section ref={dialogRef} className="prototype-session-dialog" role="dialog" aria-modal="true" aria-labelledby="prototype-session-rename-title">
            <h2 id="prototype-session-rename-title">{localize(locale, '重命名会话', 'Rename session')}</h2>
            <form onSubmit={(event) => { void submitRename(event) }}>
              <input ref={renameInputRef} value={renameValue} maxLength={240} onChange={(event) => setRenameValue(event.target.value)} aria-label={localize(locale, '会话名称', 'Session name')} />
              <div><button type="button" onClick={() => { setRenameTarget(undefined); restoreMenuFocus() }}>{localize(locale, '取消', 'Cancel')}</button><button type="submit" className="primary" disabled={!renameValue.trim() || pendingIds.has(renameTarget.id)}>{localize(locale, '保存', 'Save')}</button></div>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="prototype-session-dialog-backdrop" role="presentation">
          <section ref={dialogRef} className="prototype-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="prototype-session-delete-title" aria-describedby="prototype-session-delete-description">
            <h2 id="prototype-session-delete-title">{localize(locale, '删除会话？', 'Delete session?')}</h2>
            <p id="prototype-session-delete-description">{localize(locale, '此操作不可撤销。', 'This action cannot be undone.')}</p>
            <div><button ref={deleteCancelRef} type="button" onClick={() => { setDeleteTarget(undefined); restoreMenuFocus() }}>{localize(locale, '取消', 'Cancel')}</button><button type="button" className="danger" onClick={() => { onDelete(deleteTarget.id); setDeleteTarget(undefined); restoreMenuFocus() }}>{localize(locale, '删除', 'Delete')}</button></div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
