import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  Clock3,
  Filter,
  FolderGit2,
  GitPullRequest,
  Inbox,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  Plus,
  RadioTower,
  Search,
  ShieldAlert,
  SquareTerminal,
  Star,
  TicketCheck,
  Trash2,
  Webhook,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale, type TranslationKey } from '../preferences'
import type { Run, RunStatus } from '../types'

type SessionsPageProps = {
  runs: Run[]
  loadState?: 'loading' | 'ready' | 'error'
  loadError?: string
  onOpenNavigation: () => void
  onNewTask: (expert?: string) => void
  onOpenSession: (id: string) => void
  onRename: (id: string, title: string) => void
  onToggleFavorite: (id: string) => void
  onToggleArchive: (id: string) => void
  onDelete: (id: string) => void
}

type SessionView = 'active' | 'favorites' | 'archived'
type StatusFilter = 'all' | RunStatus
type TimeFilter = 'all' | 'hour' | 'day' | 'week'

type SourceInfo = {
  name: string
  detail: string
}

type IndexedSession = {
  run: Run
  originalIndex: number
  source: SourceInfo
  prReferences: string[]
  searchText: string
}

type FilterOption = {
  value: string
  label: string
}

const statusOptions: RunStatus[] = ['queued', 'running', 'paused', 'waiting', 'completed', 'failed', 'canceled']

const statusPriority: Record<RunStatus, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  paused: 3,
  queued: 4,
  completed: 5,
  canceled: 6,
}

const statusCopyKeys: Record<RunStatus, TranslationKey> = {
  queued: 'sessions.status.queued',
  running: 'sessions.status.running',
  paused: 'status.paused',
  waiting: 'sessions.status.waiting',
  completed: 'sessions.status.completed',
  failed: 'sessions.status.failed',
  canceled: 'status.canceled',
}

const viewCopyKeys: Record<SessionView, TranslationKey> = {
  active: 'sessions.active',
  favorites: 'sessions.favorites',
  archived: 'sessions.archived',
}

function getSource(trigger: string): SourceInfo {
  const [name, ...detailParts] = trigger.split('/')
  return {
    name: name.trim() || trigger,
    detail: detailParts.join('/').trim(),
  }
}

function getSourceIcon(sourceName: string): LucideIcon {
  const source = sourceName.toLocaleLowerCase()
  if (source.includes('github') || source.includes('gitlab') || source.includes('gitee')) return GitPullRequest
  if (source.includes('jira')) return TicketCheck
  if (source.includes('飞书') || source.includes('feishu') || source.includes('slack')) return MessageSquareText
  if (source.includes('控制台') || source.includes('console') || source.includes('cli')) return SquareTerminal
  if (source.includes('webhook')) return Webhook
  return RadioTower
}

function getSourceLabel(sourceName: string, locale: Locale) {
  if (locale === 'en' && sourceName.includes('飞书')) return 'Feishu'
  if (locale === 'en' && sourceName.includes('控制台')) return 'Console'
  return sourceName
}

function getPrReferences(run: Run) {
  const references = new Set<string>()
  const candidates = [
    ...run.steps.flatMap((step) => [step.label, step.detail]),
    ...run.events.flatMap((event) => [event.title, event.body, event.meta]),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    for (const match of candidate.matchAll(/(?:\bPR|pull request)\s*#?\s*(\d+)/gi)) {
      references.add(`PR #${match[1]}`)
    }
  }

  return [...references]
}

function getAgeMinutes(updatedAt: string) {
  const value = updatedAt.trim().toLocaleLowerCase()
  if (value.includes('刚刚') || value.includes('just now')) return 0
  if (value.includes('今天') || value.includes('today')) return 12 * 60
  if (value.includes('昨天') || value.includes('yesterday')) return 24 * 60

  const patterns: Array<[RegExp, number]> = [
    [/(\d+)\s*分钟/, 1],
    [/(\d+)\s*(?:minutes?|mins?|m)\b/i, 1],
    [/(\d+)\s*小时/, 60],
    [/(\d+)\s*(?:hours?|hrs?|h)\b/i, 60],
    [/(\d+)\s*天/, 24 * 60],
    [/(\d+)\s*(?:days?|d)\b/i, 24 * 60],
    [/(\d+)\s*周/, 7 * 24 * 60],
    [/(\d+)\s*(?:weeks?|w)\b/i, 7 * 24 * 60],
  ]

  for (const [pattern, multiplier] of patterns) {
    const match = value.match(pattern)
    if (match) return Number(match[1]) * multiplier
  }

  return Number.POSITIVE_INFINITY
}

function matchesTimeFilter(updatedAt: string, filter: TimeFilter) {
  if (filter === 'all') return true
  const age = getAgeMinutes(updatedAt)
  if (filter === 'hour') return age <= 60
  if (filter === 'day') return age <= 24 * 60
  return age <= 7 * 24 * 60
}

function unique(values: string[]) {
  return [...new Set(values)].sort((first, second) => first.localeCompare(second))
}

function FilterSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: LucideIcon
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}) {
  return (
    <label className="session-status-filter session-filter-select">
      <Icon aria-hidden="true" />
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  )
}

export function SessionsPage({
  runs,
  loadState = 'ready',
  loadError = '',
  onOpenNavigation,
  onNewTask,
  onOpenSession,
  onRename,
  onToggleFavorite,
  onToggleArchive,
  onDelete,
}: SessionsPageProps) {
  const { locale, t } = usePreferences()
  const [view, setView] = useState<SessionView>('active')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expertFilter, setExpertFilter] = useState('all')
  const [repositoryFilter, setRepositoryFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [menuRunId, setMenuRunId] = useState<string>()
  const [renameTarget, setRenameTarget] = useState<Run>()
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Run>()
  const filterRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const indexedSessions = useMemo<IndexedSession[]>(() => runs.map((run, originalIndex) => {
    const source = getSource(run.trigger)
    const prReferences = getPrReferences(run)
    const searchText = [
      run.title,
      run.repo,
      run.expert,
      run.branch,
      run.trigger,
      ...run.steps.flatMap((step) => [step.label, step.detail]),
      ...prReferences,
    ].join('\n').toLocaleLowerCase()

    return { run, originalIndex, source, prReferences, searchText }
  }), [runs])

  const viewCounts = useMemo(() => ({
    active: runs.filter((run) => !run.archived).length,
    favorites: runs.filter((run) => run.favorite && !run.archived).length,
    archived: runs.filter((run) => run.archived).length,
  }), [runs])

  const filterOptions = useMemo(() => ({
    experts: unique(runs.map((run) => run.expert)),
    repositories: unique(runs.map((run) => run.repo)),
    sources: unique(indexedSessions.map((session) => session.source.name)),
  }), [indexedSessions, runs])

  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return indexedSessions
      .filter(({ run, source, searchText }) => {
        const matchesView = view === 'active'
          ? !run.archived
          : view === 'favorites'
            ? Boolean(run.favorite && !run.archived)
            : Boolean(run.archived)
        const matchesStatus = statusFilter === 'all' || run.status === statusFilter
        const matchesExpert = expertFilter === 'all' || run.expert === expertFilter
        const matchesRepository = repositoryFilter === 'all' || run.repo === repositoryFilter
        const matchesSource = sourceFilter === 'all' || source.name === sourceFilter
        const matchesTime = matchesTimeFilter(run.updatedAt, timeFilter)
        const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery)
        return matchesView && matchesStatus && matchesExpert && matchesRepository
          && matchesSource && matchesTime && matchesQuery
      })
      .sort((first, second) => {
        const priorityDifference = statusPriority[first.run.status] - statusPriority[second.run.status]
        return priorityDifference || first.originalIndex - second.originalIndex
      })
  }, [expertFilter, indexedSessions, query, repositoryFilter, sourceFilter, statusFilter, timeFilter, view])

  const visibleIds = useMemo(() => new Set(visibleSessions.map(({ run }) => run.id)), [visibleSessions])
  const visibleSelectedIds = useMemo(
    () => new Set([...selectedIds].filter((id) => visibleIds.has(id))),
    [selectedIds, visibleIds],
  )
  const allVisibleSelected = visibleSessions.length > 0
    && visibleSessions.every(({ run }) => visibleSelectedIds.has(run.id))
  const someVisibleSelected = visibleSelectedIds.size > 0
  const selectedArchivableIds = useMemo(() => [...visibleSelectedIds].filter((id) => {
    const run = runs.find((item) => item.id === id)
    return run && !run.archived
  }), [runs, visibleSelectedIds])

  const hasActiveFilters = Boolean(query.trim())
    || statusFilter !== 'all'
    || expertFilter !== 'all'
    || repositoryFilter !== 'all'
    || sourceFilter !== 'all'
    || timeFilter !== 'all'
  const activeFilterCount = [statusFilter, expertFilter, repositoryFilter, sourceFilter, timeFilter]
    .filter((filter) => filter !== 'all').length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
    }
  }, [allVisibleSelected, someVisibleSelected])

  useEffect(() => {
    if (!filterOpen) return
    const closeFilter = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('pointerdown', closeFilter)
    return () => document.removeEventListener('pointerdown', closeFilter)
  }, [filterOpen])

  useEffect(() => {
    if (!menuRunId) return
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuRunId(undefined)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [menuRunId])

  useEffect(() => {
    const closeOverlay = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setFilterOpen(false)
      setMenuRunId(undefined)
      setRenameTarget(undefined)
      setDeleteTarget(undefined)
    }
    document.addEventListener('keydown', closeOverlay)
    return () => document.removeEventListener('keydown', closeOverlay)
  }, [])

  const openRename = (run: Run) => {
    setMenuRunId(undefined)
    setRenameValue(run.title)
    setRenameTarget(run)
  }

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = renameValue.trim()
    if (!renameTarget || !title) return
    if (title !== renameTarget.title) onRename(renameTarget.id, title)
    setRenameTarget(undefined)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    onDelete(deleteTarget.id)
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(deleteTarget.id)
      return next
    })
    setDeleteTarget(undefined)
  }

  const stopRowClick = (event: MouseEvent<HTMLElement>) => event.stopPropagation()

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, runId: string) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onOpenSession(runId)
  }

  const toggleSelection = (runId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleSessions.forEach(({ run }) => next.delete(run.id))
      else visibleSessions.forEach(({ run }) => next.add(run.id))
      return next
    })
  }

  const toggleArchive = (run: Run) => {
    onToggleArchive(run.id)
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(run.id)
      return next
    })
    setMenuRunId(undefined)
  }

  const bulkArchive = () => {
    selectedArchivableIds.forEach(onToggleArchive)
    setSelectedIds(new Set())
  }

  const clearFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setExpertFilter('all')
    setRepositoryFilter('all')
    setSourceFilter('all')
    setTimeFilter('all')
    setFilterOpen(false)
  }

  const emptyMessage = hasActiveFilters
    ? t('sessions.noResults')
    : view === 'active'
      ? t('sessions.emptyActive')
      : view === 'favorites'
        ? t('sessions.emptyFavorites')
        : t('sessions.emptyArchived')

  return (
    <main className="module-page sessions-page">
      <header className="module-header">
        <div className="module-header__copy">
          <IconButton icon={Menu} label={t('workbench.openNavigation')} className="mobile-menu" onClick={onOpenNavigation} />
          <div>
            <h1>{t('sessions.title')}</h1>
            <p>{t('sessions.description')}</p>
          </div>
        </div>
        <div className="module-header__actions">
          <GlobalControls />
          <button type="button" className="button button--primary" onClick={() => onNewTask()}>
            <Plus aria-hidden="true" />
            {t('sessions.new')}
          </button>
        </div>
      </header>

      <div className="module-scroll">
        <section className="data-section sessions-section" aria-label={t('sessions.title')}>
          <div className="sessions-control-row">
            <div className="template-filters sessions-tabs" role="tablist" aria-label={t('sessions.title')}>
              {(['active', 'favorites', 'archived'] as const).map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === item}
                  className={view === item ? 'template-filter template-filter--active' : 'template-filter'}
                  key={item}
                  onClick={() => {
                    setView(item)
                    setFilterOpen(false)
                    setMenuRunId(undefined)
                  }}
                >
                  {t(viewCopyKeys[item])} <span>{viewCounts[item]}</span>
                </button>
              ))}
            </div>

            <div className="table-tools sessions-control-row__tools">
              <label className="search-field sessions-search">
                <Search aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t('sessions.searchPlaceholder')}
                  placeholder={t('sessions.searchPlaceholder')}
                />
              </label>

              <div className="session-filter-bar" aria-label={t('common.filter')}>
            <div className="session-filter-popover-shell" ref={filterRef}>
              <button
                type="button"
                className={`button button--ghost button--compact session-filter-trigger${activeFilterCount ? ' session-filter-trigger--active' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={filterOpen}
                onClick={() => {
                  setFilterOpen((open) => !open)
                  setMenuRunId(undefined)
                }}
              >
                <Filter aria-hidden="true" />
                {t('common.filter')}
                {activeFilterCount ? <span>{activeFilterCount}</span> : null}
              </button>
              {filterOpen ? (
                <div className="session-filter-popover" role="dialog" aria-label={t('common.filter')}>
                  <FilterSelect
                    icon={Filter}
                    label={t('sessions.status')}
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value as StatusFilter)}
                    options={[
                      { value: 'all', label: t('sessions.allStatuses') },
                      ...statusOptions.map((status) => ({ value: status, label: t(statusCopyKeys[status]) })),
                    ]}
                  />
                  <FilterSelect
                    icon={Bot}
                    label={t('sessions.expert')}
                    value={expertFilter}
                    onChange={setExpertFilter}
                    options={[
                      { value: 'all', label: t('sessions.allExperts') },
                      ...filterOptions.experts.map((expert) => ({ value: expert, label: expert })),
                    ]}
                  />
                  <FilterSelect
                    icon={FolderGit2}
                    label={t('newTask.repository')}
                    value={repositoryFilter}
                    onChange={setRepositoryFilter}
                    options={[
                      { value: 'all', label: t('sessions.allRepositories') },
                      ...filterOptions.repositories.map((repository) => ({ value: repository, label: repository })),
                    ]}
                  />
                  <FilterSelect
                    icon={RadioTower}
                    label={t('sessions.source')}
                    value={sourceFilter}
                    onChange={setSourceFilter}
                    options={[
                      { value: 'all', label: t('sessions.allSources') },
                      ...filterOptions.sources.map((source) => ({ value: source, label: getSourceLabel(source, locale) })),
                    ]}
                  />
                  <FilterSelect
                    icon={Clock3}
                    label={t('sessions.updated')}
                    value={timeFilter}
                    onChange={(value) => setTimeFilter(value as TimeFilter)}
                    options={[
                      { value: 'all', label: t('sessions.allTimes') },
                      { value: 'hour', label: t('sessions.lastHour') },
                      { value: 'day', label: t('sessions.lastDay') },
                      { value: 'week', label: t('sessions.lastWeek') },
                    ]}
                  />
                  <button type="button" className="button button--ghost button--compact session-filter-clear" onClick={clearFilters} disabled={!activeFilterCount}>
                    <X aria-hidden="true" />{t('common.clear')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
            </div>
          </div>

          {loadState === 'loading' ? (
            <div className="sessions-load-state" role="status">
              <span className="auth-spinner" aria-hidden="true" />
              <p>{locale === 'zh' ? '正在加载会话...' : 'Loading Sessions...'}</p>
            </div>
          ) : loadState === 'error' ? (
            <div className="sessions-load-state sessions-load-state--error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{locale === 'zh' ? '无法加载会话' : 'Unable to load Sessions'}</strong>
                <p>{loadError}</p>
              </div>
            </div>
          ) : null}

          {loadState === 'ready' && visibleSelectedIds.size > 0 ? (
            <div className="session-bulk-bar" role="toolbar" aria-label={t('sessions.bulkArchive')}>
              <strong>{visibleSelectedIds.size} {t('sessions.selected')}</strong>
              <div>
                <button
                  type="button"
                  className="button button--ghost button--compact"
                  onClick={bulkArchive}
                  disabled={selectedArchivableIds.length === 0}
                >
                  <Archive aria-hidden="true" />{t('sessions.bulkArchive')} ({selectedArchivableIds.length})
                </button>
                <IconButton icon={X} label={t('sessions.clearSelection')} size="sm" onClick={() => setSelectedIds(new Set())} />
              </div>
            </div>
          ) : null}

          {loadState === 'ready' ? <div className="data-table session-table session-table--managed" role="table" aria-label={t('sessions.title')}>
            <div className="data-table__row data-table__head" role="row">
              <span role="columnheader" className="session-task-heading">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="session-select-checkbox session-select-checkbox--all"
                  checked={allVisibleSelected}
                  disabled={visibleSessions.length === 0}
                  aria-label={t('sessions.selectAll')}
                  onChange={toggleSelectAll}
                />
                {t('sessions.task')}
              </span>
              <span role="columnheader">{t('sessions.status')}</span>
              <span role="columnheader">{t('sessions.expert')}</span>
              <span role="columnheader">{t('sessions.sourceArtifacts')}</span>
              <span role="columnheader">{t('sessions.updated')}</span>
              <span role="columnheader" aria-label={t('sessions.menuLabel')} />
            </div>

            {visibleSessions.map(({ run, source, prReferences }) => {
              const SourceIcon = getSourceIcon(source.name)
              const needsApproval = run.status === 'waiting'
                || run.steps.some((step) => step.id === 'approval' && step.status === 'active')
              const attention = ['running', 'waiting', 'failed'].includes(run.status)
              const completedSteps = run.steps.filter((step) => step.status === 'completed').length
              const currentStep = run.steps.find((step) => step.status === 'active')
                ?? run.steps.find((step) => step.status === 'failed')
                ?? run.steps.find((step) => step.status === 'pending')
                ?? run.steps.at(-1)

              return (
                <div
                  className={`data-table__row session-table__row${attention ? ' session-table__row--attention' : ''}`}
                  role="row"
                  tabIndex={0}
                  key={run.id}
                  onClick={() => onOpenSession(run.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, run.id)}
                  aria-label={`${t('sessions.open')}: ${run.title}`}
                >
                  <span className="session-task-cell" role="cell">
                    <input
                      type="checkbox"
                      className="session-select-checkbox"
                      checked={selectedIds.has(run.id)}
                      aria-label={`${t('sessions.selectSession')}: ${run.title}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleSelection(run.id)}
                    />
                    <span className="table-primary">
                      <strong>{run.title}</strong>
                      <small>{run.repo} · {run.branch}</small>
                    </span>
                  </span>
                  <span role="cell" className="session-status-cell" data-label={t('sessions.status')}>
                    <span className={`status-badge status-badge--${run.status}`}>
                      <span className="status-badge__dot" aria-hidden="true" />
                      {t(statusCopyKeys[run.status])}
                    </span>
                    <small className="session-status-progress">
                      {completedSteps}/{run.steps.length} · {currentStep?.detail ?? '—'}
                    </small>
                  </span>
                  <span role="cell" className="session-expert-cell" data-label={t('sessions.expert')}>{run.expert}</span>
                  <span role="cell" className="session-context-cell session-updated-cell" data-label={t('sessions.sourceArtifacts')}>
                    <span className="session-source-cell">
                      <SourceIcon aria-hidden="true" />
                      <span>
                        <strong>{getSourceLabel(source.name, locale)}</strong>
                        {source.detail ? <small>{source.detail}</small> : null}
                      </span>
                    </span>
                    <span className="session-signal-list">
                      {prReferences.slice(0, 1).map((reference) => (
                        <span className="state-label session-signal session-signal--pr" key={reference}>
                          <GitPullRequest aria-hidden="true" />{reference}
                        </span>
                      ))}
                      {prReferences.length > 1 ? <small>+{prReferences.length - 1}</small> : null}
                      {needsApproval ? (
                        <span className="state-label state-label--warning session-signal">
                          <ShieldAlert aria-hidden="true" />{t('sessions.approvalNeeded')}
                        </span>
                      ) : null}
                      {prReferences.length === 0 && !needsApproval ? <span className="session-signal-empty">—</span> : null}
                    </span>
                  </span>
                  <time role="cell" className="session-updated-cell" data-label={t('sessions.updated')}>{run.updatedAt}</time>
                  <span className="session-row__actions" role="cell" onClick={stopRowClick}>
                    <button
                      type="button"
                      className={`icon-button icon-button--sm${run.favorite ? ' session-favorite--active' : ''}`}
                      aria-label={t(run.favorite ? 'sessions.unfavorite' : 'sessions.favorite')}
                      data-tooltip={t(run.favorite ? 'sessions.unfavorite' : 'sessions.favorite')}
                      aria-pressed={Boolean(run.favorite)}
                      onClick={() => onToggleFavorite(run.id)}
                    >
                      <Star aria-hidden="true" fill={run.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <div className="session-menu-shell" ref={menuRunId === run.id ? menuRef : undefined}>
                      <IconButton
                        icon={MoreHorizontal}
                        label={`${run.title} · ${t('sessions.more')}`}
                        size="sm"
                        aria-haspopup="menu"
                        aria-expanded={menuRunId === run.id}
                        onClick={() => {
                          setFilterOpen(false)
                          setMenuRunId((current) => current === run.id ? undefined : run.id)
                        }}
                      />
                      {menuRunId === run.id ? (
                        <div className="session-menu" role="menu" aria-label={t('sessions.menuLabel')}>
                          <button type="button" role="menuitem" onClick={() => openRename(run)}>
                            <PencilLine aria-hidden="true" />{t('sessions.rename')}
                          </button>
                          <button type="button" role="menuitem" onClick={() => toggleArchive(run)}>
                            {run.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                            {t(run.archived ? 'sessions.restore' : 'sessions.archive')}
                          </button>
                          <button type="button" role="menuitem" className="session-menu__danger" onClick={() => {
                            setDeleteTarget(run)
                            setMenuRunId(undefined)
                          }}>
                            <Trash2 aria-hidden="true" />{t('sessions.delete')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </span>
                </div>
              )
            })}

            {visibleSessions.length === 0 ? (
              <div className="session-empty">
                <Inbox aria-hidden="true" />
                <p>{emptyMessage}</p>
                {hasActiveFilters ? (
                  <button type="button" className="button button--ghost button--compact" onClick={clearFilters}>
                    <X aria-hidden="true" />{t('sessions.clearSearch')}
                  </button>
                ) : view === 'active' ? (
                  <button type="button" className="button button--primary button--compact" onClick={() => onNewTask()}>
                    <Plus aria-hidden="true" />{t('sessions.new')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div> : null}
        </section>
      </div>

      {renameTarget ? (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setRenameTarget(undefined)
        }}>
          <form className="dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-session-title" onSubmit={submitRename}>
            <header className="dialog__header">
              <div>
                <p className="dialog__eyebrow">{t('sessions.entity')}</p>
                <h2 id="rename-session-title">{t('sessions.renameTitle')}</h2>
              </div>
              <IconButton icon={X} label={t('sessions.cancel')} onClick={() => setRenameTarget(undefined)} />
            </header>
            <div className="dialog__body">
              <p className="session-dialog__description">{t('sessions.renameDescription')}</p>
              <label className="field">
                <span>{t('sessions.sessionName')}</span>
                <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={120} />
              </label>
            </div>
            <footer className="dialog__footer">
              <span />
              <div className="dialog__actions">
                <button type="button" className="button button--ghost" onClick={() => setRenameTarget(undefined)}>{t('sessions.cancel')}</button>
                <button type="submit" className="button button--primary" disabled={!renameValue.trim()}>{t('sessions.save')}</button>
              </div>
            </footer>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDeleteTarget(undefined)
        }}>
          <section className="dialog session-dialog session-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-session-title" aria-describedby="delete-session-description">
            <header className="dialog__header">
              <div>
                <p className="dialog__eyebrow">{t('sessions.entity')}</p>
                <h2 id="delete-session-title">{t('sessions.deleteTitle')}</h2>
              </div>
              <IconButton icon={X} label={t('sessions.cancel')} onClick={() => setDeleteTarget(undefined)} />
            </header>
            <div className="dialog__body">
              <div className="session-delete-dialog__warning">
                <AlertTriangle aria-hidden="true" />
                <div>
                  <strong>{deleteTarget.title}</strong>
                  <p id="delete-session-description">{t('sessions.deleteDescription')}</p>
                </div>
              </div>
            </div>
            <footer className="dialog__footer">
              <span />
              <div className="dialog__actions">
                <button type="button" className="button button--ghost" onClick={() => setDeleteTarget(undefined)}>{t('sessions.cancel')}</button>
                <button type="button" className="button button--warning session-delete-button" onClick={confirmDelete}>
                  <Trash2 aria-hidden="true" />{t('sessions.deleteConfirm')}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}
