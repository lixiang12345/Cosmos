import { Send } from 'lucide-react'
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PrototypeGitHubIcon,
  PrototypeHexIcon,
  PrototypeLinearIcon,
  PrototypeSearchIcon,
  PrototypeSlackIcon,
} from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import {
  useControlPlane,
  type Automation,
  type AutomationSource,
  type InjectEventResult,
  type JsonValue,
} from '../features/control-plane'
import { usePreferences, type Locale } from '../preferences'
import type { Run } from '../types'

type DemoPageProps = {
  navigationCollapsed?: boolean
  onOpenNavigation?: () => void
  onOpenCommand?: () => void
}

type DemoSource = Extract<AutomationSource, 'github' | 'linear' | 'slack' | 'gitlab' | 'pagerduty' | 'webhook' | 'schedule'>

type DemoAutomationDraft = {
  name: string
  expertId: string
  source: DemoSource
  eventType: string
  filter: string
  scheduleCron: string | null
  scheduleTimezone: string | null
  maxRunsPerMinute: number
  autoArchive: boolean
}

type DemoEventDraft = {
  source: Exclude<DemoSource, 'schedule'>
  eventType: string
  externalId: string
  payload: string
}

const demoExperts = [
  { id: 'expert-seed-pr-author', name: 'PR Author' },
  { id: 'expert-seed-deep-code-reviewer', name: 'Deep Code Reviewer' },
  { id: 'expert-seed-incident-investigator', name: 'Incident Investigator' },
  { id: 'expert-seed-project-builder', name: 'Project Builder' },
]

const automationSources: Array<{
  value: DemoSource
  label: string
  group: 'First-party' | 'Schedule' | 'Webhook'
  events: string[]
  sampleFilter: Record<string, string>
}> = [
  { value: 'github', label: 'GitHub', group: 'First-party', events: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'issues', 'issue_comment', 'push', 'check_suite', 'status', 'workflow_run', 'workflow_job', 'workflow_dispatch'], sampleFilter: { action: 'opened' } },
  { value: 'linear', label: 'Linear', group: 'First-party', events: ['Issue', 'Comment', 'Project'], sampleFilter: { action: 'update' } },
  { value: 'slack', label: 'Slack', group: 'First-party', events: ['app_mention', 'message'], sampleFilter: { 'event.type': 'app_mention' } },
  { value: 'gitlab', label: 'GitLab', group: 'First-party', events: ['gitlab.push', 'gitlab.tag_push', 'gitlab.merge_request', 'gitlab.issue', 'gitlab.note', 'gitlab.pipeline'], sampleFilter: {} },
  { value: 'pagerduty', label: 'PagerDuty', group: 'First-party', events: ['incident.triggered', 'incident.acknowledged', 'incident.resolved'], sampleFilter: { 'event.event_type': 'incident.triggered' } },
  { value: 'schedule', label: 'Scheduled', group: 'Schedule', events: ['cron'], sampleFilter: {} },
  { value: 'webhook', label: 'Webhook', group: 'Webhook', events: ['json_post'], sampleFilter: {} },
]

const scheduleFrequencyOptions = [
  { id: 'every_5', label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { id: 'hourly', label: 'Hourly', cron: '0 * * * *' },
  { id: 'daily', label: 'Daily at 08:00', cron: '0 8 * * *' },
  { id: 'weekdays', label: 'Weekdays 09:00', cron: '0 9 * * MON-FRI' },
  { id: 'weekly', label: 'Weekly (Sunday midnight)', cron: '0 0 * * 0' },
  { id: 'monthly', label: 'Monthly (1st midnight)', cron: '0 0 1 * *' },
] as const

const eventSamples: Record<DemoEventDraft['source'], { eventType: string; payload: Record<string, JsonValue> }> = {
  github: {
    eventType: 'pull_request',
    payload: { action: 'opened', repository: { full_name: 'commerce/payment-service' }, pull_request: { number: 913, draft: false, base: { ref: 'main' } } },
  },
  slack: {
    eventType: 'message.posted',
    payload: { channel: 'payments-alerts', mentionsCosmos: 'true', text: '@Cosmos investigate payment timeouts' },
  },
  webhook: {
    eventType: 'json_post',
    payload: { alert_type: 'error', severity: 'P1', service: 'payment-service', message: 'Retry queue saturation' },
  },
  linear: {
    eventType: 'Issue',
    payload: { action: 'update', data: { identifier: 'COS-42' } },
  },
  gitlab: {
    eventType: 'gitlab.push',
    payload: { object_kind: 'push', project: { path_with_namespace: 'cosmos/platform' } },
  },
  pagerduty: {
    eventType: 'incident.triggered',
    payload: { event: { event_type: 'incident.triggered', data: { priority: { name: 'P1' } } } },
  },
}

function localize(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function formatTimestamp(value: string | undefined, locale: Locale) {
  if (!value) return localize(locale, '从未', 'Never')
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'EX'
}

function expertName(expertId: string) {
  return demoExperts.find((expert) => expert.id === expertId)?.name ?? expertId
}

function sourceLabel(source: AutomationSource) {
  return automationSources.find((option) => option.value === source)?.label ?? source
}

function SourceIcon({ source }: { source: AutomationSource }) {
  if (source === 'github') return <PrototypeGitHubIcon aria-hidden="true" />
  if (source === 'linear') return <PrototypeLinearIcon aria-hidden="true" />
  if (source === 'slack') return <PrototypeSlackIcon aria-hidden="true" />
  return <PrototypeHexIcon aria-hidden="true" />
}

function dialogKeyDown(event: ReactKeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
  ))
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function useDialogFocus(ref: React.RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    const body = ref.current?.querySelector<HTMLElement>('.prototype-drawer-body') ?? ref.current
    const control = body?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? body?.querySelector<HTMLElement>('button:not(:disabled)')
    control?.focus()
  }, [open, ref])
}

function DemoShell({ crumb, children, props }: { crumb: string; children: ReactNode; props: DemoPageProps }) {
  return <main className="prototype-automation-page">
    <PrototypePageTopbar crumb={crumb} navigationCollapsed={props.navigationCollapsed} onOpenNavigation={props.onOpenNavigation} onOpenCommand={props.onOpenCommand} />
    <div className="prototype-automation-viewport"><div className="prototype-automation-content">{children}</div></div>
  </main>
}

function DemoHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="prototype-automation-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function DemoDisclaimer({ locale }: { locale: Locale }) {
  return <p className="prototype-demo-disclaimer">{localize(locale, '原型模拟，不会触发真实外部行为', 'Prototype simulation; no external action will be performed')}</p>
}

function emptyAutomationDraft(expertId = demoExperts[0].id): DemoAutomationDraft {
  return {
    name: '',
    expertId,
    source: 'github',
    eventType: automationSources[0].events[0]!,
    filter: JSON.stringify(automationSources[0].sampleFilter),
    scheduleCron: null,
    scheduleTimezone: null,
    maxRunsPerMinute: 10,
    autoArchive: true,
  }
}

function parseAutomationFilter(value: string) {
  if (!value.trim()) return {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Filter must be a JSON object')
  const entries = Object.entries(parsed)
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('Filter values must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}

export type DemoAutomationsPageProps = DemoPageProps

export function DemoAutomationsPage(props: DemoAutomationsPageProps) {
  const { locale } = usePreferences()
  const { scope, actions } = useControlPlane()
  const navigate = useNavigate()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [scopeFilter, setScopeFilter] = useState<'mine' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerStep, setDrawerStep] = useState<'overview' | 'pick' | 'configure'>('overview')
  const [staged, setStaged] = useState(false)
  const [draft, setDraft] = useState(() => emptyAutomationDraft())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuId, setMenuId] = useState<string>()
  const drawerRef = useRef<HTMLFormElement>(null)
  useDialogFocus(drawerRef, drawerOpen)
  useLayoutEffect(() => {
    if (!drawerOpen) return
    const body = drawerRef.current?.querySelector<HTMLElement>('.prototype-drawer-body') ?? drawerRef.current
    const control = body?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? body?.querySelector<HTMLElement>('button:not(:disabled)')
    control?.focus()
  }, [drawerOpen, drawerStep])

  const groups = useMemo(() => demoExperts.map((expert) => {
    const triggers = scope.automations.filter((automation) => automation.expertId === expert.id)
    const updatedAt = [undefined, ...triggers.map((trigger) => trigger.updatedAt)].filter((value): value is string => Boolean(value)).sort().at(-1)
    const lastRun = triggers.map((trigger) => trigger.lastMatchedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
    return { ...expert, triggers, updatedAt, lastRun }
  }).filter((group) => scopeFilter === 'all' || group.triggers.length > 0)
    .filter((group) => `${group.name} ${group.triggers.map((trigger) => `${trigger.name} ${trigger.source} ${trigger.trigger}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [query, scope.automations, scopeFilter])

  const openCreate = (expertId?: string) => {
    setMenuId(undefined)
    setDraft(emptyAutomationDraft(expertId))
    setError('')
    setDrawerStep('overview')
    setStaged(false)
    setDrawerOpen(true)
  }

  const closeCreate = () => {
    setDrawerOpen(false)
    setDrawerStep('overview')
    setStaged(false)
    setError('')
  }

  const chooseSource = (source: DemoSource) => {
    const type = automationSources.find((option) => option.value === source)!
    setDraft((current) => ({
      ...current,
      source,
      name: current.name || (source === 'schedule' ? 'scheduled-run' : `on-${source}`),
      eventType: type.events[0]!,
      filter: JSON.stringify(type.sampleFilter),
      scheduleCron: source === 'schedule' ? '0 8 * * *' : null,
      scheduleTimezone: source === 'schedule' ? 'America/Los_Angeles' : null,
      maxRunsPerMinute: source === 'schedule' ? 1 : 10,
    }))
    setError('')
    setDrawerStep('configure')
  }

  const stageTrigger = () => {
    try {
      if (!draft.name.trim()) throw new Error(localize(locale, '请输入 Trigger 名称。', 'Enter a Trigger name.'))
      if (!draft.eventType.trim()) throw new Error(localize(locale, '请输入事件类型。', 'Enter an Event type.'))
      if (draft.source === 'schedule' && (!draft.scheduleCron || !draft.scheduleTimezone)) throw new Error(localize(locale, 'Schedule 需要 cron 和 IANA 时区。', 'Schedule requires a cron expression and IANA timezone.'))
      if (!Number.isInteger(draft.maxRunsPerMinute) || draft.maxRunsPerMinute < 1 || draft.maxRunsPerMinute > 120) throw new Error(localize(locale, '每分钟运行上限必须是 1 到 120 的整数。', 'Maximum runs per minute must be an integer from 1 to 120.'))
      parseAutomationFilter(draft.filter)
      setError('')
      setStaged(true)
      setDrawerStep('overview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : localize(locale, '无法暂存 Trigger。', 'Unable to stage Trigger.'))
    }
  }

  const createAutomation = (event: FormEvent) => {
    event.preventDefault()
    try {
      if (!staged) throw new Error(localize(locale, '请先添加一个 Trigger。', 'Add a Trigger first.'))
      actions.createAutomation({
        name: draft.name.trim(),
        description: '',
        source: draft.source,
        trigger: draft.eventType.trim(),
        filter: parseAutomationFilter(draft.filter),
        scheduleCron: draft.scheduleCron ?? undefined,
        scheduleTimezone: draft.scheduleTimezone ?? undefined,
        maxRunsPerMinute: draft.maxRunsPerMinute,
        autoArchive: draft.autoArchive,
        enabled: false,
        expertId: draft.expertId,
      })
      setExpandedIds((ids) => new Set(ids).add(draft.expertId))
      closeCreate()
      setNotice(localize(locale, '自动化已写入当前 Demo Space，Trigger 默认关闭。', 'Automation saved to the current Demo Space with its trigger disabled.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : localize(locale, '自动化创建失败', 'Failed to create automation'))
    }
  }

  const toggleAutomation = (automation: Automation) => {
    try {
      actions.toggleAutomation(automation.id, !automation.enabled)
      setNotice(automation.enabled ? localize(locale, 'Trigger 已暂停。', 'Trigger paused.') : localize(locale, 'Trigger 已启用。', 'Trigger enabled.'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : localize(locale, '自动化更新失败', 'Failed to update automation'))
    }
  }

  const toggleExpanded = (expertId: string) => setExpandedIds((ids) => {
    const next = new Set(ids)
    if (next.has(expertId)) next.delete(expertId)
    else next.add(expertId)
    return next
  })

  return <DemoShell crumb={localize(locale, '自动化', 'Automations')} props={props}>
    <DemoHeader title={localize(locale, '自动化', 'Automations')} description={localize(locale, '管理通过计划任务、Webhook 和集成运行的 Expert。', 'Manage experts that run from schedules, webhooks, and integrations.')} action={<button type="button" className="prototype-primary-button" onClick={() => openCreate()}>{localize(locale, '创建自动化', 'Create automation')}</button>} />
    <DemoDisclaimer locale={locale} />
    <button type="button" className="prototype-advisor-banner" onClick={() => navigate('/home')}><span className="prototype-advisor-mark" aria-hidden="true" /><span><strong>{localize(locale, '描述工作流，让 Agent 为你完成设置 →', 'Describe your workflow and an agent will set it up →')}</strong><small>{localize(locale, 'Cosmos Advisor Agent 会配置 Expert 和 Automation', 'Cosmos Advisor agent configures the experts and automations')}</small></span></button>
    <div className="prototype-automation-toolbar"><div className="prototype-segmented" aria-label={localize(locale, '自动化范围', 'Automation scope')}><button type="button" className={scopeFilter === 'mine' ? 'active' : ''} aria-pressed={scopeFilter === 'mine'} onClick={() => setScopeFilter('mine')}>{localize(locale, '我的', 'Mine')}</button><button type="button" className={scopeFilter === 'all' ? 'active' : ''} aria-pressed={scopeFilter === 'all'} onClick={() => setScopeFilter('all')}>{localize(locale, '全部', 'All')}</button></div><label className="prototype-automation-search"><PrototypeSearchIcon aria-hidden="true" /><span className="sr-only">{localize(locale, '搜索自动化', 'Search automations')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={localize(locale, '搜索自动化…', 'Search automations…')} /></label></div>
    <div className="prototype-automation-table-wrap"><table className="prototype-automation-table"><thead><tr><th className="col-expert">Expert</th><th className="col-last-run">{localize(locale, '上次运行', 'Last run')}</th><th>{localize(locale, '更新时间', 'Updated')} <span className="sort-icon">↓</span></th><th className="col-menu" /></tr></thead><tbody>
      {groups.map((group) => {
        const expanded = expandedIds.has(group.id)
        const sources = [...new Set(group.triggers.map((trigger) => trigger.source))].slice(0, 2)
        return <Fragment key={group.id}><tr className={expanded ? 'expanded' : ''} onClick={() => toggleExpanded(group.id)}><td className="col-expert"><div className="prototype-automation-expert-cell"><button type="button" className={`prototype-automation-expand${expanded ? ' open' : ''}`} aria-label={expanded ? localize(locale, '收起 Trigger', 'Collapse triggers') : localize(locale, '展开 Trigger', 'Expand triggers')} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggleExpanded(group.id) }}><span aria-hidden="true">{expanded ? '▾' : '›'}</span></button><span className="prototype-automation-expert-icon"><PrototypeHexIcon aria-hidden="true" /></span>{sources.length ? <span className="prototype-automation-integration-stack">{sources.map((source) => <span key={source}><SourceIcon source={source} /></span>)}</span> : null}<span className="prototype-automation-expert-name">{group.name}</span></div></td><td className="col-last-run"><span className="prototype-automation-avatar">{initials(group.name)}</span><span className="muted">{formatTimestamp(group.lastRun, locale)}</span></td><td className="muted">{formatTimestamp(group.updatedAt, locale)}</td><td className="col-menu" onClick={(event) => event.stopPropagation()}><button type="button" className="icon-btn prototype-automation-more" aria-label={localize(locale, `${group.name} 更多操作`, `More actions for ${group.name}`)} aria-expanded={menuId === group.id} onClick={() => setMenuId((current) => current === group.id ? undefined : group.id)}>⋯</button>{menuId === group.id ? <div className="prototype-automation-row-menu" role="menu"><button type="button" role="menuitem" onClick={() => navigate('/automations/history')}><strong>{localize(locale, '运行历史', 'Run history')}</strong><small>{localize(locale, '仅限 Trigger 启动的 Session', 'Trigger-started sessions only')}</small></button><button type="button" role="menuitem" onClick={() => openCreate(group.id)}><strong>{localize(locale, '添加 Trigger', 'Add trigger')}</strong></button><button type="button" role="menuitem" onClick={() => navigate('/home')}><strong>{localize(locale, '使用 Advisor 调整', 'Tune with Advisor')}</strong></button></div> : null}</td></tr>
          {expanded ? <tr className="prototype-automation-detail"><td colSpan={4}>{group.triggers.length ? group.triggers.map((automation) => <div className="prototype-automation-trigger-row" key={automation.id}><button type="button" className="prototype-automation-trigger-main" onClick={() => setNotice(`${automation.name}: ${automation.enabled ? 'enabled' : 'disabled'} · ${automation.source}${Object.keys(automation.filter).length ? ' · filter' : ''}`)}><span>{automation.name}</span><i>·</i><code>{sourceLabel(automation.source)} {automation.id}</code></button><span className={`prototype-automation-trigger-status ${automation.enabled ? 'on' : 'paused'}`}>{automation.enabled ? localize(locale, '已启用', 'Enabled') : localize(locale, '已停用', 'Disabled')}</span><button type="button" role="switch" aria-checked={automation.enabled} aria-label={automation.enabled ? localize(locale, `停用 ${automation.name}`, `Disable ${automation.name}`) : localize(locale, `启用 ${automation.name}`, `Enable ${automation.name}`)} className={`prototype-automation-toggle${automation.enabled ? '' : ' off'}`} onClick={() => toggleAutomation(automation)}><span /></button><button type="button" className="icon-btn prototype-automation-remove" aria-label={localize(locale, 'Demo 不支持删除 Trigger', 'Trigger removal is unavailable in Demo mode')} disabled title={localize(locale, 'Demo 控制面不提供删除操作', 'The Demo control plane does not expose deletion')}>×</button></div>) : <div className="prototype-automation-no-trigger">{localize(locale, '尚无 Trigger', 'No triggers yet')}</div>}<button type="button" className="prototype-small-button prototype-automation-add-trigger" onClick={() => openCreate(group.id)}>{localize(locale, '添加 Trigger', 'Add trigger')}</button></td></tr> : null}</Fragment>
      })}
      {!groups.length ? <tr><td colSpan={4} className="prototype-automation-state">{localize(locale, '没有匹配的自动化', 'No automations match')}</td></tr> : null}
    </tbody></table></div>
    <div className="prototype-automation-footer"><span>{groups.length} {groups.length === 1 ? 'automation' : 'automations'}</span><div><button type="button" disabled>‹</button><span>{localize(locale, '第 1 页，共 1 页', 'Page 1 of 1')}</span><button type="button" disabled>›</button><span>{localize(locale, '行数', 'Rows')}</span><select disabled aria-label={localize(locale, '每页行数', 'Rows per page')}><option>25</option></select></div></div>
    {notice ? <div className="prototype-automation-toast" role="status">{notice}</div> : null}
    {drawerOpen ? <div className="prototype-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate() }}>
      <form ref={drawerRef} className="prototype-automation-drawer" role="dialog" aria-modal="true" aria-labelledby="demo-automation-drawer-title" onKeyDown={(event) => dialogKeyDown(event, closeCreate)} onSubmit={createAutomation}>
        <header className="prototype-drawer-header"><h2 id="demo-automation-drawer-title">{drawerStep === 'pick' ? localize(locale, '选择 Trigger 类型', 'Choose trigger type') : localize(locale, '创建自动化', 'Create automation')}</h2><button type="button" className="icon-btn" aria-label={localize(locale, '关闭', 'Close')} onClick={closeCreate}>×</button></header>
        <div className="prototype-drawer-body">
          {drawerStep === 'pick' ? <>
            <p className="prototype-event-input-note">{localize(locale, '第一方集成 · Schedule · Webhook（docs/config-triggers）', 'First-party integrations · Schedule · Webhook (docs/config-triggers)')}</p>
            {(['First-party', 'Schedule', 'Webhook'] as const).map((group) => <Fragment key={group}>
              <span className="prototype-trigger-picker-label">{group === 'First-party' ? localize(locale, '第一方', 'First-party') : group}</span>
              {automationSources.filter((source) => source.group === group).map((source) => <button type="button" className="prototype-trigger-picker-option" key={source.value} onClick={() => chooseSource(source.value)}><span><SourceIcon source={source.value} /></span><span><strong>{source.label}</strong><small>{source.events.slice(0, 3).join(', ')}{source.events.length > 3 ? '…' : ''}</small></span></button>)}
            </Fragment>)}
          </> : <>
            <label className="prototype-field-label" htmlFor="demo-automation-expert">Expert</label>
            <select id="demo-automation-expert" className="prototype-field-select" value={draft.expertId} onChange={(event) => setDraft({ ...draft, expertId: event.target.value })}>{demoExperts.map((expert) => <option key={expert.id} value={expert.id}>{expert.name}</option>)}</select>
            <p className="prototype-field-help">{localize(locale, 'Expert 必须已存在；请先从 Experts 创建。', 'Expert must already exist; create it from Experts first.')}</p>
            <div className="prototype-trigger-form-heading"><span>{localize(locale, '新 Trigger', 'New triggers')}</span>{!staged ? <button type="button" className="prototype-small-button" onClick={() => setDrawerStep('pick')}>+ {localize(locale, '添加 Trigger', 'Add trigger')}</button> : null}</div>
            {staged ? <div className="prototype-trigger-summary"><span><strong>{draft.name}</strong><small>{sourceLabel(draft.source)} · {draft.eventType}{draft.filter !== '{}' ? ' · filter' : ''}</small></span><button type="button" className="prototype-ghost-button" onClick={() => setStaged(false)}>{localize(locale, '移除', 'Remove')}</button></div> : <p className="prototype-trigger-empty">{localize(locale, '尚无 Trigger；请先添加一个后再保存。', 'No triggers yet — add at least one before saving.')}</p>}
            {drawerStep === 'configure' ? <>
              {error ? <p className="prototype-automation-error" role="alert">{error}</p> : null}
              <div className="prototype-trigger-form-block">
                <div className="prototype-trigger-form-heading"><span>{sourceLabel(draft.source)} trigger</span><button type="button" className="prototype-ghost-button" onClick={() => setDrawerStep('pick')}>{localize(locale, '更改类型', 'Change type')}</button></div>
                <label className="prototype-field-label" htmlFor="demo-automation-name">{localize(locale, 'Trigger 名称', 'Trigger name')}</label>
                <input id="demo-automation-name" className="prototype-field" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="on-pr-opened" />
                {draft.source === 'schedule' ? <>
                  <label className="prototype-field-label" htmlFor="demo-automation-frequency">{localize(locale, '频率', 'Frequency')}</label>
                  <select id="demo-automation-frequency" className="prototype-field-select" value={scheduleFrequencyOptions.find((option) => option.cron === draft.scheduleCron)?.id ?? 'custom'} onChange={(event) => { const option = scheduleFrequencyOptions.find((item) => item.id === event.target.value); if (option) setDraft({ ...draft, scheduleCron: option.cron }) }}>
                    {scheduleFrequencyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">{localize(locale, '自定义 cron 表达式', 'Custom cron expression')}</option>
                  </select>
                  <label className="prototype-field-label" htmlFor="demo-automation-cron">{localize(locale, 'Cron 表达式（5 段）', 'Cron expression (5-field)')}</label>
                  <input id="demo-automation-cron" className="prototype-field prototype-mono-field" required value={draft.scheduleCron ?? ''} onChange={(event) => setDraft({ ...draft, scheduleCron: event.target.value })} placeholder="0 8 * * *" />
                  <label className="prototype-field-label" htmlFor="demo-automation-timezone">{localize(locale, '时区（IANA）', 'Timezone (IANA)')}</label>
                  <input id="demo-automation-timezone" className="prototype-field" required value={draft.scheduleTimezone ?? ''} onChange={(event) => setDraft({ ...draft, scheduleTimezone: event.target.value })} placeholder="America/Los_Angeles" />
                  <p className="prototype-field-help">{localize(locale, '5 段 cron（无秒，不支持 @daily 等宏）。上一次仍在运行时会跳过本次触发；不会排队或补跑（docs/schedules）。', '5-field cron (no seconds, no macros like @daily). If a fire arrives while the previous run is still executing, it is skipped — runs are not queued or backfilled (docs/schedules).')}</p>
                </> : <>
                  <label className="prototype-field-label" htmlFor="demo-automation-event">{localize(locale, '事件', 'Event')}</label>
                  <select id="demo-automation-event" className="prototype-field-select" required value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}>{automationSources.find((source) => source.value === draft.source)!.events.map((eventType) => <option key={eventType} value={eventType}>{eventType}</option>)}</select>
                  <label className="prototype-field-label" htmlFor="demo-automation-filter">Filter (JSON)</label>
                  <textarea id="demo-automation-filter" className="prototype-field prototype-mono-field" rows={4} value={draft.filter} onChange={(event) => setDraft({ ...draft, filter: event.target.value })} spellCheck={false} />
                  <p className="prototype-field-help">{localize(locale, '粘贴前可先在 Event Log 中检查 Filter。', 'Sanity-check filters in Event Log before pasting here.')}</p>
                </>}
                <label className="prototype-field-label" htmlFor="demo-automation-max-runs">{localize(locale, '每分钟最大运行次数', 'Maximum runs per minute')}</label>
                <input id="demo-automation-max-runs" className="prototype-field" type="number" min={1} max={120} required value={draft.maxRunsPerMinute} onChange={(event) => setDraft({ ...draft, maxRunsPerMinute: Number(event.target.value) })} style={{ maxWidth: 120 }} />
                <label className="prototype-automation-check"><input type="checkbox" checked={draft.autoArchive} onChange={(event) => setDraft({ ...draft, autoArchive: event.target.checked })} />{localize(locale, '自动归档此 Trigger 创建的 Session', 'Auto-archive sessions created by this trigger')}</label>
                <div className="prototype-trigger-form-actions"><button type="button" className="prototype-ghost-button" onClick={() => { setError(''); setDrawerStep('overview') }}>{localize(locale, '取消', 'Cancel')}</button><button type="button" className="prototype-primary-button" onClick={stageTrigger}>{localize(locale, '添加到自动化', 'Add to automation')}</button></div>
              </div>
            </> : null}
          </>}
        </div>
        <footer className="prototype-drawer-footer">{drawerStep === 'pick' ? <button type="button" className="prototype-ghost-button" onClick={() => setDrawerStep('overview')}>{localize(locale, '返回', 'Back')}</button> : <><span /><button type="button" className="prototype-ghost-button" onClick={closeCreate}>{localize(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button" disabled={!staged}>{localize(locale, '保存自动化', 'Save automation')}</button></>}</footer>
      </form>
    </div> : null}
  </DemoShell>
}

function initialEventDraft(): DemoEventDraft {
  return { source: 'github', eventType: eventSamples.github.eventType, externalId: makeId('prototype-github'), payload: JSON.stringify(eventSamples.github.payload, null, 2) }
}

export type DemoEventLogPageProps = DemoPageProps & { onSessionCreated?: (result: InjectEventResult) => void }

export function DemoEventLogPage({ onSessionCreated, ...props }: DemoEventLogPageProps) {
  const { locale } = usePreferences()
  const { scope, actions } = useControlPlane()
  const [sourceFilter, setSourceFilter] = useState<'all' | DemoEventDraft['source']>('all')
  const [eventFilter, setEventFilter] = useState('')
  const [eventFilterDraft, setEventFilterDraft] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string>()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [draft, setDraft] = useState(initialEventDraft)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const advancedRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLFormElement>(null)
  useDialogFocus(advancedRef, advancedOpen)
  useDialogFocus(inputRef, inputOpen)
  const selected = scope.inboundEvents.find((event) => event.id === selectedEventId)
  const filteredEvents = scope.inboundEvents.filter((event) => (sourceFilter === 'all' || event.source === sourceFilter) && (!eventFilter || `${event.trigger} ${event.source}`.toLowerCase().includes(eventFilter.toLowerCase())))

  const injectEvent = (event: FormEvent) => {
    event.preventDefault()
    try {
      const parsed: unknown = JSON.parse(draft.payload)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Payload must be an object')
      const result = actions.injectEvent({ source: draft.source, trigger: draft.eventType.trim(), externalId: draft.externalId.trim(), payload: parsed as Record<string, JsonValue> })
      onSessionCreated?.(result)
      setSelectedEventId(result.event.id)
      setInputOpen(false)
      setError('')
      setNotice(result.duplicate
        ? localize(locale, '该事件已去重。', 'The Event was deduplicated.')
        : result.matchedAutomation
          ? localize(locale, `事件已匹配 ${result.matchedAutomation.name} 并创建 Demo Session 草稿。`, `Event matched ${result.matchedAutomation.name} and created a Demo Session draft.`)
          : localize(locale, '事件已接收，但没有 Automation 匹配。', 'Event received, but no Automation matched.'))
    } catch {
      setError(localize(locale, 'Payload 必须是有效 JSON 对象。', 'Payload must be a valid JSON object.'))
    }
  }

  return <DemoShell crumb={localize(locale, '自动化 / 事件日志', 'Automations / Event Log')} props={props}>
    <DemoHeader title={localize(locale, '事件日志', 'Event Log')} description={localize(locale, '查看 Cosmos 接收的每个事件；粘贴到 Trigger 前可先用高级 Filter 检查。', 'Every event Cosmos received. Use Advanced Filter / JSONLogic to sanity-check before pasting into a trigger.')} />
    <DemoDisclaimer locale={locale} />
    <div className="prototype-event-toolbar"><select className="prototype-field-select" aria-label={localize(locale, '事件来源', 'Event source')} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | DemoEventDraft['source'])}><option value="all">{localize(locale, '全部来源', 'All sources')}</option><option value="github">GitHub</option><option value="slack">Slack</option><option value="webhook">Webhook</option></select><button type="button" className="prototype-small-button" onClick={() => { setEventFilterDraft(eventFilter); setAdvancedOpen(true) }}>{localize(locale, '高级 Filter', 'Advanced Filter')}{eventFilter ? ` · ${localize(locale, '已启用', 'active')}` : ''}</button>{eventFilter ? <button type="button" className="prototype-ghost-button" onClick={() => setEventFilter('')}>{localize(locale, '清除高级条件', 'Clear advanced')}</button> : null}</div>
    <div className="prototype-event-layout"><div className="prototype-event-list"><div className="prototype-event-row prototype-event-head"><span>{localize(locale, '时间', 'Time')}</span><span>{localize(locale, '事件', 'Event')}</span><span>Expert</span><span>{localize(locale, '状态', 'Status')}</span></div>{filteredEvents.map((event) => <button type="button" className={`prototype-event-row${selectedEventId === event.id ? ' selected' : ''}`} aria-pressed={selectedEventId === event.id} key={event.id} onClick={() => setSelectedEventId(event.id)}><span className="prototype-event-time">{formatTime(event.receivedAt, locale)}</span><span><i>{sourceLabel(event.source)}</i> · {event.trigger}</span><span className="muted">{event.matchedAutomationId ? expertName(scope.automations.find((automation) => automation.id === event.matchedAutomationId)?.expertId ?? '') : '—'}</span><span><i className={`prototype-event-status ${event.status}`}>{event.status}</i></span></button>)}{!filteredEvents.length ? <div className="prototype-event-empty">{localize(locale, '没有符合当前 Filter 的事件', 'No events match this filter')}</div> : null}</div>{selected ? <aside className="prototype-event-detail" aria-label={localize(locale, '事件详情', 'Event details')}><header><strong>{localize(locale, '事件详情', 'Event details')}</strong><button type="button" className="icon-btn" aria-label={localize(locale, '关闭详情', 'Close details')} onClick={() => setSelectedEventId(undefined)}>×</button></header><span className="prototype-detail-label">{localize(locale, '来源', 'Source')}</span><span className="prototype-detail-value">{selected.source}</span><span className="prototype-detail-label">{localize(locale, '事件类型', 'Event type')}</span><code className="prototype-detail-value">{selected.trigger}</code><span className="prototype-detail-label">Headers</span><pre>{JSON.stringify({ 'X-Cosmos-Source': selected.source, 'X-Received-At': selected.receivedAt }, null, 2)}</pre><span className="prototype-detail-label">{localize(locale, 'Payload（Trigger 接收内容）', 'Payload (what triggers see)')}</span><pre>{JSON.stringify(selected.payload, null, 2)}</pre><span className="prototype-detail-label">{localize(locale, '匹配结果', 'Match result')}</span><span className="prototype-detail-value">{selected.matchedAutomationId ? scope.automations.find((automation) => automation.id === selected.matchedAutomationId)?.name ?? selected.matchedAutomationId : localize(locale, '未匹配', 'Unmatched')}</span>{selected.matchedSessionId ? <><span className="prototype-detail-label">Session</span><code className="prototype-detail-value">{selected.matchedSessionId}</code></> : null}</aside> : null}</div>
    {advancedOpen ? <div className="prototype-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdvancedOpen(false) }}><form ref={advancedRef} className="prototype-automation-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-advanced-filter-title" onKeyDown={(event) => dialogKeyDown(event, () => setAdvancedOpen(false))} onSubmit={(event) => { event.preventDefault(); setEventFilter(eventFilterDraft.trim()); setAdvancedOpen(false) }}><header><h2 id="demo-advanced-filter-title">{localize(locale, '高级 Filter', 'Advanced Filter')}</h2><button type="button" className="icon-btn" aria-label={localize(locale, '关闭', 'Close')} onClick={() => setAdvancedOpen(false)}>×</button></header><div><p>{localize(locale, '此 Filter 仅影响 Demo 事件日志视图。', 'This filter affects only the Demo Event Log view.')}</p><label className="prototype-field-label" htmlFor="demo-event-filter">{localize(locale, '事件类型', 'Event type')}</label><input id="demo-event-filter" className="prototype-field" value={eventFilterDraft} onChange={(event) => setEventFilterDraft(event.target.value)} placeholder="pull_request, app_mention…" /><button type="button" className="prototype-event-input-link" onClick={() => { setDraft(initialEventDraft()); setAdvancedOpen(false); setInputOpen(true) }}><Send aria-hidden="true" />{localize(locale, '打开 Demo 测试入口', 'Open Demo test input')}</button></div><footer><button type="button" className="prototype-ghost-button" onClick={() => setAdvancedOpen(false)}>{localize(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button">{localize(locale, '应用 Filter', 'Apply filter')}</button></footer></form></div> : null}
    {inputOpen ? <div className="prototype-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInputOpen(false) }}><form ref={inputRef} className="prototype-automation-drawer" role="dialog" aria-modal="true" aria-labelledby="demo-event-input-title" onKeyDown={(event) => dialogKeyDown(event, () => setInputOpen(false))} onSubmit={injectEvent}><header className="prototype-drawer-header"><h2 id="demo-event-input-title">{localize(locale, '注入模拟事件', 'Inject simulated event')}</h2><button type="button" className="icon-btn" aria-label={localize(locale, '关闭', 'Close')} onClick={() => setInputOpen(false)}>×</button></header><div className="prototype-drawer-body"><p className="prototype-event-input-note">{localize(locale, '此操作只修改浏览器内的 Demo 控制面。', 'This action changes only the in-browser Demo control plane.')}</p>{error ? <p className="prototype-automation-error" role="alert">{error}</p> : null}<label className="prototype-field-label" htmlFor="demo-event-source">{localize(locale, '来源', 'Source')}</label><select id="demo-event-source" className="prototype-field-select" value={draft.source} onChange={(event) => { const source = event.target.value as DemoEventDraft['source']; setDraft({ source, eventType: eventSamples[source].eventType, externalId: makeId(`prototype-${source}`), payload: JSON.stringify(eventSamples[source].payload, null, 2) }) }}><option value="github">GitHub</option><option value="slack">Slack</option><option value="webhook">Webhook</option></select><label className="prototype-field-label" htmlFor="demo-event-type">{localize(locale, '事件类型', 'Event type')}</label><input id="demo-event-type" className="prototype-field" required value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })} /><label className="prototype-field-label" htmlFor="demo-event-id">{localize(locale, '外部幂等 ID', 'External idempotency ID')}</label><input id="demo-event-id" className="prototype-field prototype-mono-field" required value={draft.externalId} onChange={(event) => setDraft({ ...draft, externalId: event.target.value })} /><label className="prototype-field-label" htmlFor="demo-event-payload">Payload</label><textarea id="demo-event-payload" className="prototype-field prototype-mono-field" required rows={10} value={draft.payload} onChange={(event) => setDraft({ ...draft, payload: event.target.value })} spellCheck={false} /></div><footer className="prototype-drawer-footer"><span /><button type="button" className="prototype-ghost-button" onClick={() => setInputOpen(false)}>{localize(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button"><Send aria-hidden="true" />{localize(locale, '注入并匹配', 'Inject and match')}</button></footer></form></div> : null}
    {notice ? <div className="prototype-automation-toast" role="status">{notice}</div> : null}
  </DemoShell>
}

function isAutomationTriggeredRun(run: Run) {
  const trigger = run.trigger.trim()
  return Boolean(trigger) && !/(manual|console|控制台|手动|worker|manager|子任务)/i.test(trigger)
}

export type DemoRunHistoryPageProps = DemoPageProps & { runs?: Run[]; onOpenSession?: (runId: string) => void }

export function DemoRunHistoryPage({ runs = [], onOpenSession, ...props }: DemoRunHistoryPageProps) {
  const { locale } = usePreferences()
  const automationRuns = useMemo(() => runs.filter(isAutomationTriggeredRun), [runs])
  const [notice, setNotice] = useState('')
  const openRun = (runId: string) => onOpenSession ? onOpenSession(runId) : setNotice(localize(locale, `Demo 将打开 Session ${runId}`, `Demo would open Session ${runId}`))

  return <DemoShell crumb={localize(locale, '自动化 / 运行历史', 'Automations / Run History')} props={props}>
    <DemoHeader title={localize(locale, '运行历史', 'Run History')} description={localize(locale, '由 Trigger 启动的 Session，而不是手动启动的 Session。打开任意一行可查看 Session 和 Worker 树。', 'Sessions started by a trigger, not hand-launched sessions. Open a row to inspect the Session and worker tree.')} />
    <DemoDisclaimer locale={locale} />
    <div className="prototype-run-table-wrap"><table className="prototype-run-table"><thead><tr><th>Session</th><th>Expert</th><th>{localize(locale, '状态', 'Status')}</th><th>{localize(locale, '开始时间', 'Started')}</th></tr></thead><tbody>{automationRuns.map((run) => <tr key={run.id} tabIndex={0} onClick={() => openRun(run.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRun(run.id) } }}><td>{run.title}</td><td className="muted">{run.expert}</td><td><span className={`prototype-run-status ${run.status}`}>{run.status}</span></td><td className="muted">{run.updatedAt}</td></tr>)}{!automationRuns.length ? <tr><td colSpan={4} className="prototype-automation-state">{localize(locale, '还没有 Trigger 启动的 Session', 'No trigger-started sessions yet')}</td></tr> : null}</tbody></table></div>
    {notice ? <div className="prototype-automation-toast" role="status">{notice}</div> : null}
  </DemoShell>
}
