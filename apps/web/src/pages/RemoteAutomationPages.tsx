import type {
  AutomationDto,
  AutomationEventDto,
  AutomationRunDto,
  AutomationSource,
  ExpertSummaryDto,
} from '@cosmos/contracts'
import { LoaderCircle, RefreshCw, Send, TestTube2 } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  PrototypeGitHubIcon,
  PrototypeHexIcon,
  PrototypeLinearIcon,
  PrototypeSearchIcon,
  PrototypeSlackIcon,
} from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import { usePreferences, type Locale } from '../preferences'
import {
  archiveAutomation,
  createAutomation,
  enableAutomation,
  listAutomationEvents,
  listAutomationRuns,
  listAutomations,
  listExperts,
  pauseAutomation,
  receiveAutomationEvent,
  testAutomation,
  updateAutomation,
  type CosmosApiAuthContext,
} from '../services/cosmosApi'

type CommonProps = {
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  credentialVersion: number
  canManage?: boolean
  navigationCollapsed?: boolean
  onOpenNavigation?: () => void
  onOpenCommand?: () => void
  onOpenAdvisor?: () => void
  onOpenRunHistory?: () => void
}

type AutomationFormState = {
  expertId: string
  name: string
  source: AutomationSource
  eventType: string
  filter: string
  scheduleCron: string | null
  scheduleTimezone: string | null
  maxRunsPerMinute: number
  serviceAccountId: string
  autoArchive: boolean
}

type EventInputState = {
  source: AutomationSource
  eventType: string
  externalId: string
  payload: string
}

type TriggerTypeOption = {
  value: AutomationSource
  label: string
  group: 'First-party' | 'Schedule' | 'Webhook'
  events: string[]
  sampleFilter: Record<string, unknown>
}

const triggerTypeOptions: TriggerTypeOption[] = [
  { value: 'github', label: 'GitHub', group: 'First-party', events: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'issues', 'issue_comment', 'push', 'check_suite', 'status', 'workflow_run', 'workflow_job', 'workflow_dispatch'], sampleFilter: { '==': [{ var: 'action' }, 'opened'] } },
  { value: 'linear', label: 'Linear', group: 'First-party', events: ['Issue', 'Comment', 'Project'], sampleFilter: { '==': [{ var: 'action' }, 'update'] } },
  { value: 'slack', label: 'Slack', group: 'First-party', events: ['app_mention', 'message'], sampleFilter: { '==': [{ var: 'event.type' }, 'app_mention'] } },
  { value: 'gitlab', label: 'GitLab', group: 'First-party', events: ['gitlab.push', 'gitlab.tag_push', 'gitlab.merge_request', 'gitlab.issue', 'gitlab.note', 'gitlab.pipeline'], sampleFilter: {} },
  { value: 'pagerduty', label: 'PagerDuty', group: 'First-party', events: ['incident.triggered', 'incident.acknowledged', 'incident.resolved'], sampleFilter: { '==': [{ var: 'event.event_type' }, 'incident.triggered'] } },
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

const sourceOptions = triggerTypeOptions.map(({ value, label }) => ({ value, label }))
const eventSourceOptions: Array<{ value: AutomationSource; label: string }> = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'linear', label: 'Linear' },
  { value: 'slack', label: 'Slack' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'pagerduty', label: 'PagerDuty' },
  { value: 'schedule', label: 'Schedule' },
]

const samplePayloads: Record<AutomationSource, { eventType: string; payload: Record<string, unknown> }> = {
  github: { eventType: 'pull_request', payload: { action: 'opened', repository: { full_name: 'cosmos/platform' } } },
  linear: { eventType: 'Issue', payload: { action: 'update', data: { identifier: 'COS-42' } } },
  slack: { eventType: 'app_mention', payload: { event: { type: 'app_mention', channel: 'platform', text: '@Cosmos investigate the failure' } } },
  gitlab: { eventType: 'gitlab.push', payload: { object_kind: 'push', project: { path_with_namespace: 'cosmos/platform' } } },
  pagerduty: { eventType: 'incident.triggered', payload: { event: { event_type: 'incident.triggered', data: { priority: { name: 'P1' } } } } },
  schedule: { eventType: 'cron', payload: { schedule: '0 8 * * *' } },
  webhook: { eventType: 'json_post', payload: { severity: 'high', service: 'platform', message: 'Queue is saturated' } },
}

function label(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function formatTime(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: 'numeric', minute: '2-digit',
  }).format(date)
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`.slice(0, 128)
}

function initials(name: string) {
  const value = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return value || 'EX'
}

function statusLabel(locale: Locale, status: AutomationDto['status']) {
  const copy: Record<AutomationDto['status'], [string, string]> = {
    draft: ['草稿', 'Draft'],
    paused: ['已停用', 'Disabled'],
    active: ['已启用', 'Enabled'],
    error: ['错误', 'Error'],
    archived: ['已归档', 'Archived'],
  }
  return label(locale, ...copy[status])
}

function emptyForm(experts: ExpertSummaryDto[], expertId?: string): AutomationFormState {
  return {
    expertId: expertId ?? experts[0]?.id ?? '',
    name: '',
    source: 'github',
    eventType: samplePayloads.github.eventType,
    filter: JSON.stringify({ '==': [{ var: 'action' }, 'opened'] }, null, 2),
    scheduleCron: null,
    scheduleTimezone: null,
    maxRunsPerMinute: 10,
    serviceAccountId: 'service-account-automation-local',
    autoArchive: true,
  }
}

function eventInputInitial(): EventInputState {
  return {
    source: 'github',
    eventType: samplePayloads.github.eventType,
    externalId: '',
    payload: JSON.stringify(samplePayloads.github.payload, null, 2),
  }
}

function dialogKeyDown(event: ReactKeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
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

function useInitialDialogFocus(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const body = ref.current?.querySelector<HTMLElement>('.prototype-drawer-body') ?? ref.current
    const control = body?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? body?.querySelector<HTMLElement>('button:not(:disabled)')
    control?.focus()
  }, [ref])
}

function useAutomationData(props: CommonProps) {
  const [automations, setAutomations] = useState<AutomationDto[]>([])
  const [experts, setExperts] = useState<ExpertSummaryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setLoading(true)
    })
    void Promise.all([
      listAutomations(props.organizationId, props.spaceId, props.auth, controller.signal),
      listExperts(props.organizationId, props.spaceId, props.auth, controller.signal),
    ]).then(([automationResponse, expertResponse]) => {
      if (controller.signal.aborted) return
      setAutomations(automationResponse.items)
      setExperts(expertResponse.items.filter((expert) => expert.status === 'published'))
      setError(undefined)
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error('Unable to load Automations.'))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [props.auth, props.credentialVersion, props.organizationId, props.spaceId, reloadVersion])

  return {
    automations,
    setAutomations,
    experts,
    loading,
    error,
    reload: () => setReloadVersion((value) => value + 1),
  }
}

function AutomationShell({ crumb, children, props }: { crumb: string; children: ReactNode; props: CommonProps }) {
  return <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={crumb}
      navigationCollapsed={props.navigationCollapsed}
      onOpenNavigation={props.onOpenNavigation}
      onOpenCommand={props.onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content">{children}</div>
    </div>
  </main>
}

function AutomationHeader({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return <div className="prototype-automation-header">
    <div><h1>{title}</h1><p>{description}</p></div>
    {action}
  </div>
}

function SourceIcon({ source }: { source: AutomationSource }) {
  if (source === 'github') return <PrototypeGitHubIcon aria-hidden="true" />
  if (source === 'linear') return <PrototypeLinearIcon aria-hidden="true" />
  if (source === 'slack') return <PrototypeSlackIcon aria-hidden="true" />
  return <PrototypeHexIcon aria-hidden="true" />
}

function sourceLabel(source: AutomationSource) {
  return sourceOptions.find((option) => option.value === source)?.label ?? source
}

function AutomationForm({
  experts,
  initial,
  editing,
  busy,
  onCancel,
  onSave,
  onTest,
}: {
  experts: ExpertSummaryDto[]
  initial: AutomationFormState
  editing?: AutomationDto
  busy: boolean
  onCancel: () => void
  onSave: (form: AutomationFormState) => Promise<void>
  onTest?: () => Promise<void>
}) {
  const { locale } = usePreferences()
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'overview' | 'pick' | 'configure'>(editing ? 'configure' : 'overview')
  const [staged, setStaged] = useState(Boolean(editing))
  const dialogRef = useRef<HTMLFormElement>(null)
  const selectedTriggerType = triggerTypeOptions.find((option) => option.value === form.source)!
  useInitialDialogFocus(dialogRef)

  useLayoutEffect(() => {
    const body = dialogRef.current?.querySelector<HTMLElement>('.prototype-drawer-body') ?? dialogRef.current
    const control = body?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?? body?.querySelector<HTMLElement>('button:not(:disabled)')
    control?.focus()
  }, [step])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing && !staged) return
    try {
      JSON.parse(form.filter)
      setError('')
      await onSave(form)
    } catch (cause) {
      setError(cause instanceof SyntaxError
        ? label(locale, 'Filter 必须是有效 JSON。', 'Filter must be valid JSON.')
        : cause instanceof Error ? cause.message : label(locale, '无法保存自动化。', 'Unable to save Automation.'))
    }
  }

  const chooseSource = (source: AutomationSource) => {
    const triggerType = triggerTypeOptions.find((option) => option.value === source)!
    setForm((current) => ({
      ...current,
      source,
      name: current.name || (source === 'schedule' ? 'scheduled-run' : `on-${source}`),
      eventType: triggerType.events[0] ?? samplePayloads[source].eventType,
      filter: JSON.stringify(triggerType.sampleFilter),
      scheduleCron: source === 'schedule' ? '0 8 * * *' : null,
      scheduleTimezone: source === 'schedule' ? 'America/Los_Angeles' : null,
      maxRunsPerMinute: source === 'schedule' ? 1 : 10,
    }))
    setError('')
    setStep('configure')
  }

  const stageTrigger = () => {
    try {
      if (!form.name.trim()) throw new Error(label(locale, '请输入 Trigger 名称。', 'Enter a Trigger name.'))
      if (!form.eventType.trim()) throw new Error(label(locale, '请输入事件类型。', 'Enter an Event type.'))
      if (form.source === 'schedule' && (!form.scheduleCron || !form.scheduleTimezone)) throw new Error(label(locale, 'Schedule 需要 cron 和 IANA 时区。', 'Schedule requires a cron expression and IANA timezone.'))
      if (!Number.isInteger(form.maxRunsPerMinute) || form.maxRunsPerMinute < 1 || form.maxRunsPerMinute > 120) throw new Error(label(locale, '每分钟运行上限必须是 1 到 120 的整数。', 'Maximum runs per minute must be an integer from 1 to 120.'))
      JSON.parse(form.filter)
      setError('')
      setStaged(true)
      setStep('overview')
    } catch (cause) {
      setError(cause instanceof SyntaxError ? label(locale, 'Filter 必须是有效 JSON。', 'Filter must be valid JSON.') : cause instanceof Error ? cause.message : label(locale, '无法暂存 Trigger。', 'Unable to stage Trigger.'))
    }
  }

  if (step === 'pick' && !editing) {
    return <div className="prototype-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <form ref={dialogRef} className="prototype-automation-drawer" role="dialog" aria-modal="true" aria-labelledby="prototype-trigger-type-title" onKeyDown={(event) => dialogKeyDown(event, onCancel)}>
        <header className="prototype-drawer-header"><h2 id="prototype-trigger-type-title">{label(locale, '选择 Trigger 类型', 'Choose trigger type')}</h2><button type="button" className="icon-btn" aria-label={label(locale, '关闭编辑器', 'Close editor')} onClick={onCancel}>×</button></header>
        <div className="prototype-drawer-body">
          <p className="prototype-event-input-note">{label(locale, '第一方集成 · Schedule · Webhook（docs/config-triggers）', 'First-party integrations · Schedule · Webhook (docs/config-triggers)')}</p>
          {(['First-party', 'Schedule', 'Webhook'] as const).map((group) => <Fragment key={group}>
            <span className="prototype-trigger-picker-label">{group === 'First-party' ? label(locale, '第一方', 'First-party') : group}</span>
            {triggerTypeOptions.filter((source) => source.group === group).map((source) => <button type="button" className="prototype-trigger-picker-option" key={source.value} onClick={() => chooseSource(source.value)}><span><SourceIcon source={source.value} /></span><span><strong>{source.label}</strong><small>{source.events.slice(0, 3).join(', ')}{source.events.length > 3 ? '…' : ''}</small></span></button>)}
          </Fragment>)}
        </div>
        <footer className="prototype-drawer-footer"><button type="button" className="prototype-ghost-button" onClick={() => setStep('overview')}>{label(locale, '返回', 'Back')}</button></footer>
      </form>
    </div>
  }

  return <div
    className="prototype-drawer-backdrop"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}
  >
    <form
      ref={dialogRef}
      className="prototype-automation-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prototype-automation-drawer-title"
      onKeyDown={(event) => dialogKeyDown(event, onCancel)}
      onSubmit={(event) => void submit(event)}
    >
      <header className="prototype-drawer-header">
        <h2 id="prototype-automation-drawer-title">{editing ? label(locale, '编辑 Trigger', 'Edit trigger') : label(locale, '创建自动化', 'Create automation')}</h2>
        <button type="button" className="icon-btn" aria-label={label(locale, '关闭编辑器', 'Close editor')} disabled={busy} onClick={onCancel}>×</button>
      </header>
      <div className="prototype-drawer-body">
        <label className="prototype-field-label" htmlFor="automation-expert">Expert</label>
        <select id="automation-expert" className="prototype-field-select" required disabled={Boolean(editing)} value={form.expertId} onChange={(event) => setForm({ ...form, expertId: event.target.value })}>
          {experts.map((expert) => <option key={expert.id} value={expert.id}>{expert.name}</option>)}
        </select>
        <p className="prototype-field-help">{label(locale, 'Expert 必须已发布；请先从 Experts 创建。', 'Expert must already exist; create it from Experts first.')}</p>

        {!editing ? <>
          <div className="prototype-trigger-form-heading"><span>{label(locale, '新 Trigger', 'New triggers')}</span>{!staged ? <button type="button" className="prototype-small-button" onClick={() => setStep('pick')}>+ {label(locale, '添加 Trigger', 'Add trigger')}</button> : null}</div>
          {staged ? <div className="prototype-trigger-summary"><span><strong>{form.name}</strong><small>{sourceLabel(form.source)} · {form.eventType}{form.filter !== '{}' ? ' · filter' : ''}</small></span><button type="button" className="prototype-ghost-button" onClick={() => setStaged(false)}>{label(locale, '移除', 'Remove')}</button></div> : <p className="prototype-trigger-empty">{label(locale, '尚无 Trigger；请先添加一个后再保存。', 'No triggers yet — add at least one before saving.')}</p>}
        </> : null}

        {(editing || step === 'configure') ? <>
        {error ? <p className="prototype-automation-error" role="alert">{error}</p> : null}
        <div className="prototype-trigger-form-block">
          <div className="prototype-trigger-form-heading"><span>{editing ? label(locale, 'Trigger 配置', 'Trigger configuration') : `${sourceLabel(form.source)} trigger`}</span>{!editing ? <button type="button" className="prototype-ghost-button" onClick={() => setStep('pick')}>{label(locale, '更改类型', 'Change type')}</button> : null}</div>
          <label className="prototype-field-label" htmlFor="automation-name">{label(locale, 'Trigger 名称', 'Trigger name')}</label>
          <input id="automation-name" className="prototype-field" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="on-pr-opened" />

          {form.source === 'schedule' ? <>
            <label className="prototype-field-label" htmlFor="automation-frequency">{label(locale, '频率', 'Frequency')}</label>
            <select id="automation-frequency" className="prototype-field-select" value={scheduleFrequencyOptions.find((option) => option.cron === form.scheduleCron)?.id ?? 'custom'} onChange={(event) => { const option = scheduleFrequencyOptions.find((item) => item.id === event.target.value); if (option) setForm({ ...form, scheduleCron: option.cron }) }}>
              {scheduleFrequencyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">{label(locale, '自定义 cron 表达式', 'Custom cron expression')}</option>
            </select>
            <label className="prototype-field-label" htmlFor="automation-cron">{label(locale, 'Cron 表达式（5 段）', 'Cron expression (5-field)')}</label>
            <input id="automation-cron" className="prototype-field prototype-mono-field" required value={form.scheduleCron ?? ''} onChange={(event) => setForm({ ...form, scheduleCron: event.target.value })} placeholder="0 8 * * *" />
            <label className="prototype-field-label" htmlFor="automation-timezone">{label(locale, '时区（IANA）', 'Timezone (IANA)')}</label>
            <input id="automation-timezone" className="prototype-field" required value={form.scheduleTimezone ?? ''} onChange={(event) => setForm({ ...form, scheduleTimezone: event.target.value })} placeholder="America/Los_Angeles" />
            <p className="prototype-field-help">{label(locale, '5 段 cron（无秒，不支持 @daily 等宏）。上一次仍在运行时会跳过本次触发；不会排队或补跑（docs/schedules）。', '5-field cron (no seconds, no macros like @daily). If a fire arrives while the previous run is still executing, it is skipped — runs are not queued or backfilled (docs/schedules).')}</p>
          </> : <>
            <label className="prototype-field-label" htmlFor="automation-event-type">{label(locale, '事件', 'Event')}</label>
            <select id="automation-event-type" className="prototype-field-select" required value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}>{selectedTriggerType.events.includes(form.eventType) ? null : <option value={form.eventType}>{form.eventType}</option>}{selectedTriggerType.events.map((eventType) => <option key={eventType} value={eventType}>{eventType}</option>)}</select>
            <label className="prototype-field-label" htmlFor="automation-filter">{label(locale, 'Filter（JSONLogic，可选）', 'Filter (JSONLogic, optional)')}</label>
            <textarea id="automation-filter" className="prototype-field prototype-mono-field" required rows={4} value={form.filter} onChange={(event) => setForm({ ...form, filter: event.target.value })} spellCheck={false} />
            <p className="prototype-field-help">{label(locale, '粘贴前可先在 Event Log 中检查 Filter。', 'Sanity-check filters in Event Log before pasting here.')}</p>
          </>}

          <label className="prototype-field-label" htmlFor="automation-max-runs">{label(locale, '每分钟最大运行次数', 'Maximum runs per minute')}</label>
          <input id="automation-max-runs" className="prototype-field" type="number" min={1} max={120} required value={form.maxRunsPerMinute} onChange={(event) => setForm({ ...form, maxRunsPerMinute: Number(event.target.value) })} style={{ maxWidth: 120 }} />

          <label className="prototype-automation-check"><input type="checkbox" checked={form.autoArchive} onChange={(event) => setForm({ ...form, autoArchive: event.target.checked })} />{label(locale, '自动归档此 Trigger 创建的 Session', 'Auto-archive sessions created by this trigger')}</label>
          {!editing ? <div className="prototype-trigger-form-actions"><button type="button" className="prototype-ghost-button" onClick={() => { setError(''); setStep('overview') }}>{label(locale, '取消', 'Cancel')}</button><button type="button" className="prototype-primary-button" onClick={stageTrigger}>{label(locale, '添加到自动化', 'Add to automation')}</button></div> : null}
        </div>
        </> : null}
      </div>
      <footer className="prototype-drawer-footer">
        {editing && onTest ? <button type="button" className="prototype-ghost-button" disabled={busy} onClick={() => void onTest()}><TestTube2 aria-hidden="true" />{label(locale, '测试事件', 'Test event')}</button> : null}
        <span />
        <button type="button" className="prototype-ghost-button" disabled={busy} onClick={onCancel}>{label(locale, '取消', 'Cancel')}</button>
        <button type="submit" className="prototype-primary-button" disabled={busy || !form.expertId || (!editing && !staged)} title={!editing && !staged ? label(locale, '请先添加一个 Trigger', 'Add a Trigger first') : undefined}>{busy ? label(locale, '保存中…', 'Saving…') : editing ? label(locale, '保存并暂停', 'Save paused') : label(locale, '保存自动化', 'Save automation')}</button>
      </footer>
    </form>
  </div>
}

function EventInputDrawer({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (form: EventInputState) => Promise<void> }) {
  const { locale } = usePreferences()
  const [form, setForm] = useState(eventInputInitial)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLFormElement>(null)
  useInitialDialogFocus(dialogRef)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      JSON.parse(form.payload)
      setError('')
      await onSubmit(form)
    } catch (cause) {
      setError(cause instanceof SyntaxError
        ? label(locale, 'Payload 必须是有效 JSON。', 'Payload must be valid JSON.')
        : cause instanceof Error ? cause.message : label(locale, '无法接收事件。', 'Unable to receive Event.'))
    }
  }

  return <div className="prototype-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <form ref={dialogRef} className="prototype-automation-drawer" role="dialog" aria-modal="true" aria-labelledby="prototype-event-input-title" onKeyDown={(event) => dialogKeyDown(event, onCancel)} onSubmit={(event) => void submit(event)}>
      <header className="prototype-drawer-header"><h2 id="prototype-event-input-title">{label(locale, '接收事件', 'Receive event')}</h2><button type="button" className="icon-btn" aria-label={label(locale, '关闭', 'Close')} disabled={busy} onClick={onCancel}>×</button></header>
      <div className="prototype-drawer-body">
        <p className="prototype-event-input-note">{label(locale, '受认证 manager 测试入口。事件仍由服务端完成去重、匹配、审计与 Session 创建。', 'Authenticated manager test input. Deduplication, matching, audit, and Session creation remain server-authoritative.')}</p>
        {error ? <p className="prototype-automation-error" role="alert">{error}</p> : null}
        <label className="prototype-field-label" htmlFor="event-input-source">{label(locale, '来源', 'Source')}</label>
        <select id="event-input-source" className="prototype-field-select" value={form.source} onChange={(event) => {
          const source = event.target.value as AutomationSource
          setForm({ ...form, source, eventType: samplePayloads[source].eventType, payload: JSON.stringify(samplePayloads[source].payload, null, 2) })
        }}>{sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>

        <label className="prototype-field-label" htmlFor="event-input-type">{label(locale, '事件类型', 'Event type')}</label>
        <input id="event-input-type" className="prototype-field" required value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })} />

        <label className="prototype-field-label" htmlFor="event-input-external-id">{label(locale, '外部幂等 ID', 'External idempotency ID')}</label>
        <input id="event-input-external-id" className="prototype-field prototype-mono-field" required value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} placeholder="provider-event-id" />

        <label className="prototype-field-label" htmlFor="event-input-payload">Payload</label>
        <textarea id="event-input-payload" className="prototype-field prototype-mono-field" required rows={10} value={form.payload} onChange={(event) => setForm({ ...form, payload: event.target.value })} spellCheck={false} />
      </div>
      <footer className="prototype-drawer-footer"><span /><button type="button" className="prototype-ghost-button" disabled={busy} onClick={onCancel}>{label(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button" disabled={busy}><Send aria-hidden="true" />{busy ? label(locale, '接收中…', 'Receiving…') : label(locale, '接收并匹配', 'Receive and match')}</button></footer>
    </form>
  </div>
}

export function RemoteAutomationsPage(props: CommonProps) {
  const { locale } = usePreferences()
  const { automations, setAutomations, experts, loading, error, reload } = useAutomationData(props)
  const [form, setForm] = useState<AutomationFormState | null>(null)
  const [editing, setEditing] = useState<AutomationDto>()
  const formReturnFocusRef = useRef<HTMLElement | null>(null)
  const [busyId, setBusyId] = useState<string>()
  const [notice, setNotice] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string>()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [menuId, setMenuId] = useState<string>()
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const expertById = new Map(experts.map((expert) => [expert.id, expert]))
    const expertIds = new Set([...experts.map((expert) => expert.id), ...automations.map((automation) => automation.expertId)])
    return [...expertIds].map((expertId) => {
      const expert = expertById.get(expertId)
      const triggers = automations.filter((automation) => automation.expertId === expertId)
      const name = expert?.name ?? expertId
      const description = expert?.description ?? ''
      const updatedAt = [expert?.updatedAt, ...triggers.map((trigger) => trigger.updatedAt)].filter(Boolean).sort().at(-1) ?? ''
      const lastRun = triggers.map((trigger) => trigger.lastMatchedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
      return { expertId, name, description, triggers, updatedAt, lastRun }
    }).filter((row) => scope === 'all' || row.triggers.length > 0)
      .filter((row) => {
        const value = query.trim().toLowerCase()
        if (!value) return true
        return [row.name, row.description, ...row.triggers.flatMap((trigger) => [trigger.name, trigger.source, trigger.eventType])].some((part) => part.toLowerCase().includes(value))
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [automations, experts, query, scope])

  const openCreate = (expertId?: string) => {
    formReturnFocusRef.current = document.activeElement as HTMLElement | null
    setMenuId(undefined)
    setEditing(undefined)
    setForm(emptyForm(experts, expertId))
  }

  const openEdit = (automation: AutomationDto) => {
    if (!props.canManage || automation.status === 'archived') return
    formReturnFocusRef.current = document.activeElement as HTMLElement | null
    setEditing(automation)
    setForm({
      expertId: automation.expertId,
      name: automation.name,
      source: automation.source,
      eventType: automation.eventType,
      filter: JSON.stringify(automation.filter),
      scheduleCron: automation.scheduleCron,
      scheduleTimezone: automation.scheduleTimezone,
      serviceAccountId: automation.serviceAccountId,
      maxRunsPerMinute: automation.maxRunsPerMinute,
      autoArchive: automation.autoArchive,
    })
  }

  const closeForm = () => {
    setForm(null)
    setEditing(undefined)
    const target = formReturnFocusRef.current
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
    })
  }

  const save = async (draft: AutomationFormState) => {
    setBusyId('form')
    try {
      const filter = JSON.parse(draft.filter) as Record<string, unknown>
      if (editing) {
        const next = await updateAutomation(props.organizationId, props.spaceId, editing.id, {
          name: draft.name,
          eventType: draft.eventType,
          filter,
          scheduleCron: draft.scheduleCron,
          scheduleTimezone: draft.scheduleTimezone,
          maxRunsPerMinute: draft.maxRunsPerMinute,
          autoArchive: draft.autoArchive,
        }, editing.version, idempotencyKey('automation-update'), props.auth)
        setAutomations((items) => items.map((item) => item.id === next.id ? next : item))
        setNotice(label(locale, 'Trigger 已更新并保持暂停。', 'Trigger updated and remains paused.'))
      } else {
        const next = await createAutomation(props.organizationId, props.spaceId, { ...draft, filter }, idempotencyKey('automation-create'), props.auth)
        setAutomations((items) => [next, ...items])
        setExpandedIds((ids) => new Set(ids).add(next.expertId))
        setNotice(label(locale, 'Automation 已创建并保持暂停。', 'Automation created and remains paused.'))
      }
      closeForm()
    } finally {
      setBusyId(undefined)
    }
  }

  const runTest = async (automation: AutomationDto) => {
    setBusyId(automation.id)
    try {
      const sample = samplePayloads[automation.source]
      const result = await testAutomation(props.organizationId, props.spaceId, automation.id, {
        eventType: automation.eventType,
        payload: sample.payload,
      }, automation.version, idempotencyKey('automation-test'), props.auth)
      setAutomations((items) => items.map((item) => item.id === result.automation.id ? result.automation : item))
      setEditing((current) => current?.id === result.automation.id ? result.automation : current)
      setNotice(result.matched
        ? label(locale, `测试匹配成功：${result.explanation}`, `Test matched: ${result.explanation}`)
        : label(locale, `测试未匹配：${result.explanation}`, `Test did not match: ${result.explanation}`))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : label(locale, '测试失败。', 'Test failed.'))
      throw cause
    } finally {
      setBusyId(undefined)
    }
  }

  const toggle = async (automation: AutomationDto) => {
    setBusyId(automation.id)
    try {
      const next = automation.status === 'active'
        ? await pauseAutomation(props.organizationId, props.spaceId, automation.id, automation.version, idempotencyKey('automation-pause'), props.auth)
        : await enableAutomation(props.organizationId, props.spaceId, automation.id, automation.version, idempotencyKey('automation-enable'), props.auth)
      setAutomations((items) => items.map((item) => item.id === next.id ? next : item))
      setNotice(next.status === 'active' ? label(locale, 'Trigger 已启用。', 'Trigger enabled.') : label(locale, 'Trigger 已暂停，配置已保留。', 'Trigger paused; configuration retained.'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : label(locale, '无法改变 Trigger 状态。', 'Unable to change Trigger state.'))
    } finally {
      setBusyId(undefined)
    }
  }

  const archive = async (automation: AutomationDto) => {
    if (confirmArchiveId !== automation.id) {
      setConfirmArchiveId(automation.id)
      return
    }
    setBusyId(automation.id)
    try {
      const next = await archiveAutomation(props.organizationId, props.spaceId, automation.id, automation.version, idempotencyKey('automation-archive'), props.auth)
      setAutomations((items) => items.map((item) => item.id === next.id ? next : item))
      setConfirmArchiveId(undefined)
      setNotice(label(locale, 'Trigger 已归档且不可恢复。', 'Trigger archived and cannot be restored.'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : label(locale, '无法归档 Trigger。', 'Unable to archive Trigger.'))
    } finally {
      setBusyId(undefined)
    }
  }

  const toggleExpanded = (expertId: string) => {
    setExpandedIds((ids) => {
      const next = new Set(ids)
      if (next.has(expertId)) next.delete(expertId)
      else next.add(expertId)
      return next
    })
  }

  return <AutomationShell crumb={label(locale, '自动化', 'Automations')} props={props}>
    <AutomationHeader
      title={label(locale, '自动化', 'Automations')}
      description={label(locale, '管理通过计划任务、Webhook 和集成运行的 Expert。', 'Manage experts that run from schedules, webhooks, and integrations.')}
      action={props.canManage ? <button type="button" className="prototype-primary-button" disabled={!experts.length} onClick={() => openCreate()}>{label(locale, '创建自动化', 'Create automation')}</button> : null}
    />

    <button type="button" className="prototype-advisor-banner" disabled={!props.onOpenAdvisor && !props.onOpenCommand} onClick={props.onOpenAdvisor ?? props.onOpenCommand}>
      <span className="prototype-advisor-mark" aria-hidden="true" />
      <span><strong>{label(locale, '描述工作流，让 Agent 为你完成设置 →', 'Describe your workflow and an agent will set it up →')}</strong><small>{label(locale, 'Cosmos Advisor Agent 会配置 Expert 和 Automation', 'Cosmos Advisor agent configures the experts and automations')}</small></span>
    </button>

    <div className="prototype-automation-toolbar">
      <div className="prototype-segmented" aria-label={label(locale, '自动化范围', 'Automation scope')}>
        <button type="button" className={scope === 'mine' ? 'active' : ''} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>{label(locale, '我的', 'Mine')}</button>
        <button type="button" className={scope === 'all' ? 'active' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{label(locale, '全部', 'All')}</button>
      </div>
      <label className="prototype-automation-search"><PrototypeSearchIcon aria-hidden="true" /><span className="sr-only">{label(locale, '搜索自动化', 'Search automations')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={label(locale, '搜索自动化…', 'Search automations…')} /></label>
    </div>

    <div className="prototype-automation-table-wrap">
      <table className="prototype-automation-table">
        <thead><tr><th className="col-expert">Expert</th><th className="col-last-run">{label(locale, '上次运行', 'Last run')}</th><th>{label(locale, '更新时间', 'Updated')} <span className="sort-icon">↓</span></th><th className="col-menu"><span className="sr-only">{label(locale, '操作', 'Actions')}</span></th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={4} className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{label(locale, '加载中…', 'Loading…')}</td></tr> : null}
          {!loading && error ? <tr><td colSpan={4} className="prototype-automation-state prototype-automation-state--error"><span role="alert">{error.message}</span><button type="button" onClick={reload}><RefreshCw aria-hidden="true" />{label(locale, '重试', 'Retry')}</button></td></tr> : null}
          {!loading && !error && !rows.length ? <tr><td colSpan={4} className="prototype-automation-state">{query ? label(locale, '没有匹配的自动化', 'No automations match') : label(locale, '当前 Space 尚未配置自动化。', 'No Automations are configured in this Space.')}</td></tr> : null}
          {!loading && !error ? rows.map((row) => {
            const expanded = expandedIds.has(row.expertId)
            const sources = [...new Set(row.triggers.map((trigger) => trigger.source))].slice(0, 2)
            return <Fragment key={row.expertId}>
              <tr className={expanded ? 'expanded' : ''} onClick={() => toggleExpanded(row.expertId)}>
                <td className="col-expert"><div className="prototype-automation-expert-cell">
                  <button type="button" className={`prototype-automation-expand${expanded ? ' open' : ''}`} aria-label={expanded ? label(locale, '收起 Trigger', 'Collapse triggers') : label(locale, '展开 Trigger', 'Expand triggers')} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggleExpanded(row.expertId) }}><span aria-hidden="true">{expanded ? '▾' : '›'}</span></button>
                  <span className="prototype-automation-expert-icon"><PrototypeHexIcon aria-hidden="true" /></span>
                  {sources.length ? <span className="prototype-automation-integration-stack">{sources.map((source) => <span key={source}><SourceIcon source={source} /></span>)}</span> : null}
                  <span className="prototype-automation-expert-name">{row.name}</span>
                </div></td>
                <td className="col-last-run"><span className="prototype-automation-avatar">{initials(row.name)}</span><span className="muted">{row.lastRun ? formatDate(row.lastRun, locale) : label(locale, '从未', 'Never')}</span></td>
                <td className="muted">{row.updatedAt ? formatDate(row.updatedAt, locale) : '—'}</td>
                <td className="col-menu" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="icon-btn prototype-automation-more" aria-label={label(locale, `${row.name} 更多操作`, `More actions for ${row.name}`)} aria-expanded={menuId === row.expertId} onClick={() => setMenuId((current) => current === row.expertId ? undefined : row.expertId)}>⋯</button>
                  {menuId === row.expertId ? <div className="prototype-automation-row-menu" role="menu">
                    {props.onOpenRunHistory ? <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); props.onOpenRunHistory?.() }}><strong>{label(locale, '运行历史', 'Run history')}</strong><small>{label(locale, '仅限 Trigger 启动的 Session', 'Trigger-started sessions only')}</small></button> : null}
                    {props.canManage ? <button type="button" role="menuitem" onClick={() => openCreate(row.expertId)}><strong>{label(locale, '添加 Trigger', 'Add trigger')}</strong></button> : null}
                    {props.onOpenAdvisor ? <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); props.onOpenAdvisor?.() }}><strong>{label(locale, '使用 Advisor 调整', 'Tune with Advisor')}</strong></button> : null}
                  </div> : null}
                </td>
              </tr>
              {expanded ? <tr className="prototype-automation-detail"><td colSpan={4}>
                {row.triggers.length ? row.triggers.map((automation) => {
                  const isBusy = busyId === automation.id
                  const confirming = confirmArchiveId === automation.id
                  const active = automation.status === 'active'
                  const immutable = automation.status === 'archived'
                  return <div className="prototype-automation-trigger-row" key={automation.id}>
                    <button type="button" className="prototype-automation-trigger-main" disabled={!props.canManage || immutable} onClick={() => openEdit(automation)}>
                      <span>{automation.name}</span><i>·</i><code>{sourceOptions.find((source) => source.value === automation.source)?.label ?? automation.source} {automation.triggerId}</code>
                    </button>
                    {confirming ? <div className="prototype-automation-confirm"><span>{label(locale, '确认移除？', 'Remove trigger?')}</span><button type="button" disabled={isBusy} onClick={() => setConfirmArchiveId(undefined)}>{label(locale, '取消', 'Cancel')}</button><button type="button" className="danger" disabled={isBusy} onClick={() => void archive(automation)}>{label(locale, '确认归档', 'Confirm archive')}</button></div> : <>
                      <span className={`prototype-automation-trigger-status ${active ? 'on' : automation.status}`}>{isBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : statusLabel(locale, automation.status)}</span>
                      {props.canManage && !immutable ? <button type="button" role="switch" aria-checked={active} aria-label={active ? label(locale, `停用 ${automation.name}`, `Disable ${automation.name}`) : label(locale, `启用 ${automation.name}`, `Enable ${automation.name}`)} className={`prototype-automation-toggle${active ? '' : ' off'}`} disabled={isBusy || (!active && !automation.lastTestedAt)} title={!active && !automation.lastTestedAt ? label(locale, '启用前必须先测试', 'Test the trigger before enabling') : undefined} onClick={() => void toggle(automation)}><span /></button> : null}
                      {props.canManage && !immutable ? <button type="button" className="icon-btn prototype-automation-remove" aria-label={label(locale, `归档 ${automation.name}`, `Archive ${automation.name}`)} disabled={isBusy} onClick={() => void archive(automation)}>×</button> : null}
                    </>}
                  </div>
                }) : <div className="prototype-automation-no-trigger">{label(locale, '尚无 Trigger', 'No triggers yet')}</div>}
                {props.canManage ? <button type="button" className="prototype-small-button prototype-automation-add-trigger" onClick={() => openCreate(row.expertId)}>{label(locale, '添加 Trigger', 'Add trigger')}</button> : null}
              </td></tr> : null}
            </Fragment>
          }) : null}
        </tbody>
      </table>
    </div>

    {!loading && !error ? <div className="prototype-automation-footer"><span>{rows.length} {rows.length === 1 ? label(locale, '个自动化', 'automation') : label(locale, '个自动化', 'automations')}</span><div><button type="button" disabled>‹</button><span>{label(locale, '第 1 页，共 1 页', 'Page 1 of 1')}</span><button type="button" disabled>›</button><span>{label(locale, '行数', 'Rows')}</span><select disabled aria-label={label(locale, '每页行数', 'Rows per page')}><option>25</option></select></div></div> : null}

    {notice ? <div className="prototype-automation-toast" role="status">{notice}</div> : null}
    {form ? <AutomationForm key={editing?.id ?? 'create'} experts={experts} initial={form} editing={editing} busy={busyId === 'form' || Boolean(editing && busyId === editing.id)} onCancel={() => { if (!busyId) closeForm() }} onSave={save} onTest={editing ? () => runTest(editing) : undefined} /> : null}
  </AutomationShell>
}

export function RemoteAutomationEventLogPage(props: CommonProps) {
  const { locale } = usePreferences()
  const [events, setEvents] = useState<AutomationEventDto[]>([])
  const [automationExperts, setAutomationExperts] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string>()
  const [sourceFilter, setSourceFilter] = useState<'' | AutomationSource>('')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [eventTypeDraft, setEventTypeDraft] = useState('')
  const [payloadLogic, setPayloadLogic] = useState('')
  const [payloadLogicDraft, setPayloadLogicDraft] = useState('')
  const [headerLogic, setHeaderLogic] = useState('')
  const [headerLogicDraft, setHeaderLogicDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<Error>()
  const advancedRef = useRef<HTMLFormElement>(null)
  const selected = events.find((event) => event.id === selectedId)
  const advancedActive = Boolean(eventTypeFilter || payloadLogic || headerLogic)

  const reload = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    void Promise.all([
      listAutomationEvents(props.organizationId, props.spaceId, props.auth, signal),
      listAutomations(props.organizationId, props.spaceId, props.auth, signal),
      listExperts(props.organizationId, props.spaceId, props.auth, signal),
    ]).then(([response, automationResponse, expertResponse]) => {
      if (!signal?.aborted) {
        setEvents(response.items)
        const expertNames = new Map(expertResponse.items.map((expert) => [expert.id, expert.name]))
        setAutomationExperts(Object.fromEntries(automationResponse.items.map((automation) => [automation.id, expertNames.get(automation.expertId) ?? automation.expertId])))
        setError(undefined)
      }
    }, (cause: unknown) => {
      if (!signal?.aborted) setError(cause instanceof Error ? cause : new Error('Unable to load Events.'))
    }).finally(() => {
      if (!signal?.aborted) setLoading(false)
    })
  }, [props.auth, props.organizationId, props.spaceId])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) reload(controller.signal)
    })
    return () => controller.abort()
  }, [props.credentialVersion, reload])

  useEffect(() => {
    if (!advancedOpen) return
    const frame = window.requestAnimationFrame(() => advancedRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [advancedOpen])

  const filteredEvents = useMemo(() => events.filter((event) => {
    if (sourceFilter && event.source !== sourceFilter) return false
    if (eventTypeFilter && !`${event.eventType} ${event.source}`.toLowerCase().includes(eventTypeFilter.toLowerCase())) return false
    return true
  }), [eventTypeFilter, events, sourceFilter])

  const receive = async (form: EventInputState) => {
    setBusy(true)
    try {
      const result = await receiveAutomationEvent(props.organizationId, props.spaceId, {
        source: form.source,
        eventType: form.eventType,
        externalId: form.externalId.trim(),
        headers: {},
        payload: JSON.parse(form.payload) as Record<string, unknown>,
      }, props.auth)
      setNotice(result.duplicate
        ? label(locale, '重复事件已去重，没有创建第二个 Session。', 'Duplicate Event was deduplicated; no second Session was created.')
        : result.event.status === 'dispatched'
          ? label(locale, '事件已匹配并创建 Session。', 'Event matched and created a Session.')
          : result.event.status === 'failed'
            ? result.event.errorMessage ?? label(locale, 'Session 创建失败。', 'Session creation failed.')
            : label(locale, '事件已接收。', 'Event received.'))
      setEvents((items) => [result.event, ...items.filter((item) => item.id !== result.event.id)])
      setSelectedId(result.event.id)
      setInputOpen(false)
      setError(undefined)
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error('Unable to receive Event.')
      setError(next)
      throw next
    } finally {
      setBusy(false)
    }
  }

  const openAdvanced = () => {
    setEventTypeDraft(eventTypeFilter)
    setPayloadLogicDraft(payloadLogic)
    setHeaderLogicDraft(headerLogic)
    setAdvancedOpen(true)
  }

  const copySampleFilter = async () => {
    const action = selected?.payload.action
    const sample = JSON.stringify({ '==': [{ var: 'action' }, typeof action === 'string' ? action : 'opened'] })
    try {
      await navigator.clipboard.writeText(sample)
      setNotice(label(locale, '示例 JSONLogic 已复制。', 'Sample JSONLogic copied.'))
    } catch {
      setNotice(label(locale, `示例 Filter：${sample}`, `Sample filter: ${sample}`))
    }
  }

  return <AutomationShell crumb={label(locale, '自动化 · 事件日志', 'Automations · Event Log')} props={props}>
    <AutomationHeader title={label(locale, '事件日志', 'Event Log')} description={label(locale, '查看 Cosmos 接收的每个事件；这是后端 Trigger 看到的同一表面，粘贴前可用高级 Filter / JSONLogic 检查。', 'Every event Cosmos received. Same surface backend triggers see — use Advanced Filter / JSONLogic to sanity-check before pasting into a trigger.')} />

    <div className="prototype-event-toolbar">
      <select className="prototype-field-select" aria-label={label(locale, '事件来源', 'Event source')} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as '' | AutomationSource)}><option value="">{label(locale, '全部来源', 'All sources')}</option>{eventSourceOptions.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select>
      <button type="button" className="prototype-small-button" onClick={openAdvanced}>{label(locale, '高级 Filter', 'Advanced Filter')}{advancedActive ? ` · ${label(locale, '已启用', 'active')}` : ''}</button>
      {advancedActive ? <button type="button" className="prototype-ghost-button" onClick={() => { setEventTypeFilter(''); setPayloadLogic(''); setHeaderLogic('') }}>{label(locale, '清除高级条件', 'Clear advanced')}</button> : null}
    </div>

    {error ? <div className="prototype-event-error"><span role="alert">{error.message}</span><button type="button" onClick={() => reload()}><RefreshCw aria-hidden="true" />{label(locale, '重试', 'Retry')}</button></div> : null}
    <div className="prototype-event-layout">
      <div className="prototype-event-list">
        <div className="prototype-event-row prototype-event-head"><span>{label(locale, '时间', 'Time')}</span><span>{label(locale, '事件', 'Event')}</span><span>Expert</span><span>{label(locale, '状态', 'Status')}</span></div>
        {loading ? <div className="prototype-event-empty"><LoaderCircle className="spin" aria-hidden="true" />{label(locale, '加载中…', 'Loading…')}</div> : null}
        {!loading && !filteredEvents.length ? <div className="prototype-event-empty">{label(locale, '没有符合当前 Filter 的事件', 'No events match this filter')}</div> : null}
        {!loading ? filteredEvents.map((event) => <button type="button" className={`prototype-event-row${selectedId === event.id ? ' selected' : ''}`} key={event.id} aria-pressed={selectedId === event.id} onClick={() => setSelectedId(event.id)}>
          <span className="prototype-event-time">{formatTime(event.receivedAt, locale)}</span>
          <span><i>{sourceOptions.find((source) => source.value === event.source)?.label ?? event.source}</i> · {event.eventType}</span>
          <span className="muted">{event.automationId ? automationExperts[event.automationId] ?? event.automationId : '—'}</span>
          <span><i className={`prototype-event-status ${event.status}`}>{event.status}</i></span>
        </button>) : null}
      </div>
      {selected ? <aside className="prototype-event-detail" aria-label={label(locale, '事件详情', 'Event details')}>
        <header><strong>{label(locale, '事件详情', 'Event details')}</strong><button type="button" className="icon-btn" aria-label={label(locale, '关闭详情', 'Close details')} onClick={() => setSelectedId(undefined)}>×</button></header>
        <span className="prototype-detail-label">{label(locale, '来源', 'Source')}</span><span className="prototype-detail-value">{selected.source}</span>
        <span className="prototype-detail-label">{label(locale, '事件类型', 'Event type')}</span><code className="prototype-detail-value">{selected.eventType}</code>
        <span className="prototype-detail-label">Headers</span><pre>{JSON.stringify(selected.headers, null, 2)}</pre>
        <span className="prototype-detail-label">{label(locale, 'Payload（Trigger 接收内容）', 'Payload (what triggers see)')}</span><pre>{JSON.stringify(selected.payload, null, 2)}</pre>
        <span className="prototype-detail-label">{label(locale, '匹配解释', 'Match explanation')}</span><span className="prototype-detail-value">{selected.matchExplanation || '—'}</span>
        {selected.sessionId ? <><span className="prototype-detail-label">Session</span><code className="prototype-detail-value">{selected.sessionId}</code></> : null}
        {selected.errorMessage ? <><span className="prototype-detail-label">{label(locale, '错误', 'Error')}</span><span className="prototype-detail-value danger">{selected.errorMessage}</span></> : null}
        <button type="button" className="prototype-small-button" onClick={() => void copySampleFilter()}>{label(locale, '复制示例 JSONLogic Filter', 'Copy sample JSONLogic filter')}</button>
      </aside> : null}
    </div>

    {advancedOpen ? <div className="prototype-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdvancedOpen(false) }}><form ref={advancedRef} className="prototype-automation-dialog" role="dialog" aria-modal="true" aria-labelledby="prototype-advanced-filter-title" onKeyDown={(event) => dialogKeyDown(event, () => setAdvancedOpen(false))} onSubmit={(event) => { event.preventDefault(); setEventTypeFilter(eventTypeDraft.trim()); setPayloadLogic(payloadLogicDraft.trim()); setHeaderLogic(headerLogicDraft.trim()); setAdvancedOpen(false) }}>
      <header><h2 id="prototype-advanced-filter-title">{label(locale, '高级 Filter', 'Advanced Filter')}</h2><button type="button" className="icon-btn" aria-label={label(locale, '关闭', 'Close')} onClick={() => setAdvancedOpen(false)}>×</button></header>
      <div>
        <p>{label(locale, '按 Trigger 评估 Payload 的方式筛选事件日志（docs/manage-automations）。', 'Filter Event Log the same way triggers evaluate payloads (docs/manage-automations).')}</p>
        <label className="prototype-field-label" htmlFor="advanced-event-type">{label(locale, '事件类型', 'Event type')}</label><input id="advanced-event-type" className="prototype-field" value={eventTypeDraft} onChange={(event) => setEventTypeDraft(event.target.value)} placeholder="pull_request, Issue, app_mention…" />
        <label className="prototype-field-label" htmlFor="advanced-payload-filter">JSONLogic payload filter</label><textarea id="advanced-payload-filter" className="prototype-field prototype-mono-field" rows={4} value={payloadLogicDraft} onChange={(event) => setPayloadLogicDraft(event.target.value)} placeholder='{"==":[{"var":"action"},"opened"]}' />
        <label className="prototype-field-label" htmlFor="advanced-header-filter">Header filter (JSONLogic)</label><textarea id="advanced-header-filter" className="prototype-field prototype-mono-field" rows={2} value={headerLogicDraft} onChange={(event) => setHeaderLogicDraft(event.target.value)} placeholder='{"==":[{"var":"X-GitHub-Event"},"pull_request"]}' />
        {props.canManage ? <button type="button" tabIndex={-1} className="sr-only" onClick={() => { setAdvancedOpen(false); setInputOpen(true) }}>{label(locale, '打开受认证测试入口', 'Open authenticated test input')}</button> : null}
      </div>
      <footer><button type="button" className="prototype-ghost-button" onClick={() => setAdvancedOpen(false)}>{label(locale, '取消', 'Cancel')}</button><button type="submit" className="prototype-primary-button">{label(locale, '应用 Filter', 'Apply filter')}</button></footer>
    </form></div> : null}
    {inputOpen ? <EventInputDrawer busy={busy} onCancel={() => { if (!busy) setInputOpen(false) }} onSubmit={receive} /> : null}
    {notice ? <div className="prototype-automation-toast" role="status">{notice}</div> : null}
  </AutomationShell>
}

export function RemoteAutomationRunHistoryPage({ ...props }: CommonProps & { onOpenSession: (sessionId: string) => void }) {
  const { locale } = usePreferences()
  const [runs, setRuns] = useState<AutomationRunDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setLoading(true)
    })
    void listAutomationRuns(props.organizationId, props.spaceId, props.auth, controller.signal).then((response) => {
      if (!controller.signal.aborted) {
        setRuns(response.items)
        setError(undefined)
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error('Unable to load Automation Runs.'))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [props.auth, props.credentialVersion, props.organizationId, props.spaceId])

  const openRun = (run: AutomationRunDto) => props.onOpenSession(run.session.id)

  return <AutomationShell crumb={label(locale, '自动化 · 运行历史', 'Automations · Run History')} props={props}>
    <AutomationHeader title={label(locale, '运行历史', 'Run History')} description={locale === 'zh' ? <>由 <strong>Trigger</strong> 启动的 Session，而不是手动启动的 Session。展开任意一行可打开 Session 并检查 Worker 树。</> : <>Sessions started by a <strong>trigger</strong> — not hand-launched sessions. Expand a row to open the session and inspect the worker tree.</>} />
    <div className="prototype-run-table-wrap"><table className="prototype-run-table">
      <thead><tr><th>Session</th><th>Expert</th><th>{label(locale, '状态', 'Status')}</th><th>{label(locale, '开始时间', 'Started')}</th></tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={4} className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{label(locale, '加载中…', 'Loading…')}</td></tr> : null}
        {!loading && error ? <tr><td colSpan={4} className="prototype-automation-state prototype-automation-state--error"><span role="alert">{error.message}</span></td></tr> : null}
        {!loading && !error && !runs.length ? <tr><td colSpan={4} className="prototype-automation-state">{label(locale, '还没有 Trigger 启动的 Session', 'No trigger-started sessions yet')}</td></tr> : null}
        {!loading && !error ? runs.map((run) => <tr key={run.eventId} tabIndex={0} onClick={() => openRun(run)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRun(run) } }}>
          <td>{run.session.title}</td><td className="muted">{run.session.expertName}</td><td><span className={`prototype-run-status ${run.session.status}`}>{run.session.status}</span></td><td className="muted">{formatDate(run.receivedAt, locale)}</td>
        </tr>) : null}
      </tbody>
    </table></div>
  </AutomationShell>
}
