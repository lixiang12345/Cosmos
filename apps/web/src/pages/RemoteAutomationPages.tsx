import type {
  AutomationDto,
  AutomationEventDto,
  AutomationRunDto,
  AutomationSource,
  ExpertSummaryDto,
} from '@relay/contracts'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  TestTube2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
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
  type RelayApiAuthContext,
} from '../services/relayApi'

type CommonProps = {
  organizationId: string
  spaceId: string
  auth: RelayApiAuthContext
  credentialVersion: number
  canManage?: boolean
  onOpenNavigation?: () => void
}

type AutomationFormState = {
  expertId: string
  name: string
  source: AutomationSource
  eventType: string
  filter: string
  serviceAccountId: string
  autoArchive: boolean
}

const sourceOptions: Array<{ value: AutomationSource; label: string }> = [
  { value: 'github', label: 'GitHub' },
  { value: 'slack', label: 'Slack' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'schedule', label: 'Schedule' },
]

const samplePayloads: Record<AutomationSource, { eventType: string; payload: Record<string, unknown> }> = {
  github: { eventType: 'pull_request.opened', payload: { action: 'opened', repository: { full_name: 'relay/platform' } } },
  slack: { eventType: 'message.posted', payload: { channel: 'platform', text: '@Relay investigate the failure' } },
  webhook: { eventType: 'alert.created', payload: { severity: 'high', service: 'platform', message: 'Queue is saturated' } },
  schedule: { eventType: 'schedule.tick', payload: { schedule: 'daily-platform-check' } },
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

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`.slice(0, 128)
}

function statusLabel(locale: Locale, status: AutomationDto['status']) {
  const copy: Record<AutomationDto['status'], [string, string]> = {
    draft: ['草稿', 'Draft'], paused: ['已暂停', 'Paused'], active: ['已启用', 'Active'], error: ['错误', 'Error'],
  }
  return label(locale, ...copy[status])
}

function statusIcon(status: AutomationDto['status']) {
  if (status === 'active') return <CheckCircle2 aria-hidden="true" />
  if (status === 'error') return <XCircle aria-hidden="true" />
  if (status === 'paused') return <CirclePause aria-hidden="true" />
  return <AlertTriangle aria-hidden="true" />
}

function emptyForm(experts: ExpertSummaryDto[]): AutomationFormState {
  return {
    expertId: experts[0]?.id ?? '',
    name: '',
    source: 'github',
    eventType: samplePayloads.github.eventType,
    filter: JSON.stringify({ '==': [{ var: 'action' }, 'opened'] }, null, 2),
    serviceAccountId: 'service-account-automation-local',
    autoArchive: false,
  }
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
  return { automations, setAutomations, experts, loading, error, reload: () => setReloadVersion((value) => value + 1) }
}

function PageHeader({ title, description, onOpenNavigation }: { title: string; description: string; onOpenNavigation?: () => void }) {
  const { locale } = usePreferences()
  return <header className="cosmos-page-header">
    <div className="cosmos-page-header__leading">
      <IconButton icon={Workflow} label={label(locale, '打开导航', 'Open navigation')} onClick={onOpenNavigation} />
      <div><p>Relay · Control Plane</p><h1>{title}</h1><span>{description}</span></div>
    </div>
    <GlobalControls />
  </header>
}

function AutomationForm({
  experts,
  initial,
  editing,
  busy,
  onCancel,
  onSave,
}: {
  experts: ExpertSummaryDto[]
  initial: AutomationFormState
  editing?: AutomationDto
  busy: boolean
  onCancel: () => void
  onSave: (form: AutomationFormState) => Promise<void>
}) {
  const { locale } = usePreferences()
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      JSON.parse(form.filter)
      setError('')
      await onSave(form)
    } catch (cause) {
      setError(cause instanceof SyntaxError ? label(locale, 'Filter 必须是有效 JSON。', 'Filter must be valid JSON.') : cause instanceof Error ? cause.message : label(locale, '无法保存自动化。', 'Unable to save Automation.'))
    }
  }
  return <form className="remote-automation-editor" onSubmit={(event) => void submit(event)}>
    <header><div><p>{editing ? label(locale, '编辑 Trigger', 'Edit Trigger') : label(locale, '新建 Trigger', 'New Trigger')}</p><h2>{editing?.name ?? label(locale, '创建自动化', 'Create Automation')}</h2></div><IconButton icon={XCircle} label={label(locale, '关闭编辑器', 'Close editor')} onClick={onCancel} /></header>
    {error ? <p className="cosmos-field-error" role="alert">{error}</p> : null}
    <div className="remote-automation-form-grid">
      <label><span>{label(locale, 'Expert', 'Expert')}</span><select required disabled={Boolean(editing)} value={form.expertId} onChange={(event) => setForm({ ...form, expertId: event.target.value })}>{experts.map((expert) => <option key={expert.id} value={expert.id}>{expert.name}</option>)}</select></label>
      <label><span>{label(locale, '名称', 'Name')}</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label><span>{label(locale, '来源', 'Source')}</span><select disabled={Boolean(editing)} value={form.source} onChange={(event) => { const source = event.target.value as AutomationSource; setForm({ ...form, source, eventType: samplePayloads[source].eventType }) }}>{sourceOptions.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>
      <label><span>{label(locale, '事件类型', 'Event type')}</span><input required value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })} /></label>
      <label className="remote-automation-form-wide"><span>{label(locale, 'ServiceAccount ID', 'ServiceAccount ID')}</span><input required disabled={Boolean(editing)} value={form.serviceAccountId} onChange={(event) => setForm({ ...form, serviceAccountId: event.target.value })} /><small>{label(locale, '仅引用服务端 ServiceAccount，不接收密钥。', 'References a server-side ServiceAccount; no secret is accepted.')}</small></label>
      <label className="remote-automation-form-wide"><span>{label(locale, '受限 Filter（JSONLogic）', 'Restricted filter (JSONLogic)')}</span><textarea required rows={7} value={form.filter} onChange={(event) => setForm({ ...form, filter: event.target.value })} spellCheck={false} /><small>{label(locale, '支持 var、==、!=、in、and、or；不允许任意代码。', 'Supports var, ==, !=, in, and, or; arbitrary code is not allowed.')}</small></label>
      <label className="remote-automation-check"><input type="checkbox" checked={form.autoArchive} onChange={(event) => setForm({ ...form, autoArchive: event.target.checked })} />{label(locale, 'Session 完成后自动归档', 'Auto-archive the Session after completion')}</label>
    </div>
    <footer className="cosmos-form-actions"><button type="button" className="cosmos-button cosmos-button--ghost" onClick={onCancel}>{label(locale, '取消', 'Cancel')}</button><button type="submit" className="cosmos-button cosmos-button--primary" disabled={busy || !form.expertId}><SaveIcon />{busy ? label(locale, '保存中…', 'Saving…') : label(locale, '保存并暂停', 'Save paused')}</button></footer>
  </form>
}

function SaveIcon() { return <CheckCircle2 aria-hidden="true" /> }

function AutomationCard({
  automation,
  expertName,
  canManage,
  busy,
  onEdit,
  onTest,
  onToggle,
}: {
  automation: AutomationDto
  expertName: string
  canManage: boolean
  busy: boolean
  onEdit: () => void
  onTest: () => void
  onToggle: () => void
}) {
  const { locale } = usePreferences()
  return <article className="cosmos-panel remote-automation-card">
    <header><div className="remote-automation-card__title"><Workflow aria-hidden="true" /><div><h2>{automation.name}</h2><p>{expertName} · {automation.source} · <code>{automation.eventType}</code></p></div></div><span className={`remote-automation-status remote-automation-status--${automation.status}`}>{statusIcon(automation.status)}{statusLabel(locale, automation.status)}</span></header>
    <dl><div><dt>{label(locale, 'Filter', 'Filter')}</dt><dd><code>{JSON.stringify(automation.filter)}</code></dd></div><div><dt>{label(locale, '匹配次数', 'Matches')}</dt><dd>{automation.matchCount}</dd></div><div><dt>{label(locale, '最后测试', 'Last test')}</dt><dd>{automation.lastTestedAt ? formatDate(automation.lastTestedAt, locale) : label(locale, '尚未测试', 'Not tested')}</dd></div></dl>
    {canManage ? <footer className="cosmos-form-actions"><button type="button" className="cosmos-button cosmos-button--secondary" disabled={busy} onClick={onEdit}>{label(locale, '编辑', 'Edit')}</button><button type="button" className="cosmos-button cosmos-button--secondary" disabled={busy} onClick={onTest}><TestTube2 aria-hidden="true" />{label(locale, '测试事件', 'Test event')}</button>{automation.status === 'active' ? <button type="button" className="cosmos-button cosmos-button--ghost" disabled={busy} onClick={onToggle}><Pause aria-hidden="true" />{label(locale, '暂停', 'Pause')}</button> : <button type="button" className="cosmos-button cosmos-button--primary" disabled={busy || !automation.lastTestedAt} onClick={onToggle}><Play aria-hidden="true" />{label(locale, '启用', 'Enable')}</button>}</footer> : null}
  </article>
}

export function RemoteAutomationsPage(props: CommonProps) {
  const { locale } = usePreferences()
  const { automations, setAutomations, experts, loading, error, reload } = useAutomationData(props)
  const [form, setForm] = useState<AutomationFormState | null>(null)
  const [editing, setEditing] = useState<AutomationDto>()
  const [busyId, setBusyId] = useState<string>()
  const [notice, setNotice] = useState('')
  const save = async (draft: AutomationFormState) => {
    setBusyId('form')
    try {
      const filter = JSON.parse(draft.filter) as Record<string, unknown>
      if (editing) {
        const next = await updateAutomation(props.organizationId, props.spaceId, editing.id, { name: draft.name, eventType: draft.eventType, filter, autoArchive: draft.autoArchive }, editing.version, idempotencyKey('automation-update'), props.auth)
        setAutomations((items) => items.map((item) => item.id === next.id ? next : item))
        setNotice(label(locale, 'Trigger 已更新并保持暂停。', 'Trigger updated and remains paused.'))
      } else {
        const next = await createAutomation(props.organizationId, props.spaceId, { ...draft, filter }, idempotencyKey('automation-create'), props.auth)
        setAutomations((items) => [next, ...items])
        setNotice(label(locale, 'Automation 已创建并保持暂停。', 'Automation created and remains paused.'))
      }
      setForm(null); setEditing(undefined)
    } finally { setBusyId(undefined) }
  }
  const runTest = async (automation: AutomationDto) => {
    setBusyId(automation.id)
    try {
      const sample = samplePayloads[automation.source]
      const result = await testAutomation(props.organizationId, props.spaceId, automation.id, { eventType: sample.eventType, payload: sample.payload }, automation.version, idempotencyKey('automation-test'), props.auth)
      setAutomations((items) => items.map((item) => item.id === result.automation.id ? result.automation : item))
      setNotice(result.matched ? label(locale, `测试匹配成功：${result.explanation}`, `Test matched: ${result.explanation}`) : label(locale, `测试未匹配：${result.explanation}`, `Test did not match: ${result.explanation}`))
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : label(locale, '测试失败。', 'Test failed.')) } finally { setBusyId(undefined) }
  }
  const toggle = async (automation: AutomationDto) => {
    setBusyId(automation.id)
    try {
      const next = automation.status === 'active'
        ? await pauseAutomation(props.organizationId, props.spaceId, automation.id, automation.version, idempotencyKey('automation-pause'), props.auth)
        : await enableAutomation(props.organizationId, props.spaceId, automation.id, automation.version, idempotencyKey('automation-enable'), props.auth)
      setAutomations((items) => items.map((item) => item.id === next.id ? next : item))
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : label(locale, '无法改变 Trigger 状态。', 'Unable to change Trigger state.')) } finally { setBusyId(undefined) }
  }
  return <main className="cosmos-page remote-automation-page"><PageHeader title={label(locale, '自动化', 'Automations')} description={label(locale, 'Expert Trigger 的服务端权威投影', 'Server-authoritative projections of Expert Triggers')} onOpenNavigation={props.onOpenNavigation} /><div className="cosmos-page__content">{notice ? <p className="cosmos-notice" role="status">{notice}</p> : null}{error ? <p className="cosmos-field-error" role="alert">{error.message}</p> : null}<section className="cosmos-section-heading"><div><p>Expert + Trigger</p><h2>{label(locale, '已配置自动化', 'Configured automations')}</h2></div>{props.canManage ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { setEditing(undefined); setForm(emptyForm(experts)) }}><Plus aria-hidden="true" />{label(locale, '创建自动化', 'Create Automation')}</button> : null}</section>{form ? <AutomationForm experts={experts} initial={form} editing={editing} busy={busyId === 'form'} onCancel={() => { setForm(null); setEditing(undefined) }} onSave={save} /> : null}{loading ? <p className="cosmos-empty-state"><LoaderCircle className="spin" aria-hidden="true" />{label(locale, '加载中…', 'Loading…')}</p> : !automations.length ? <p className="cosmos-empty-state">{label(locale, '当前 Space 尚未配置自动化。', 'No Automations are configured in this Space.')}</p> : <div className="remote-automation-list">{automations.map((automation) => <AutomationCard key={automation.id} automation={automation} expertName={experts.find((expert) => expert.id === automation.expertId)?.name ?? automation.expertId} canManage={Boolean(props.canManage)} busy={busyId === automation.id} onEdit={() => { setEditing(automation); setForm({ expertId: automation.expertId, name: automation.name, source: automation.source, eventType: automation.eventType, filter: JSON.stringify(automation.filter, null, 2), serviceAccountId: automation.serviceAccountId, autoArchive: automation.autoArchive }) }} onTest={() => void runTest(automation)} onToggle={() => void toggle(automation)} />)}</div>}{!loading ? <button type="button" className="cosmos-button cosmos-button--ghost" onClick={reload}><RefreshCw aria-hidden="true" />{label(locale, '刷新', 'Refresh')}</button> : null}</div></main>
}

export function RemoteAutomationEventLogPage(props: CommonProps) {
  const { locale } = usePreferences()
  const [events, setEvents] = useState<AutomationEventDto[]>([])
  const [source, setSource] = useState<AutomationSource>('github')
  const [eventType, setEventType] = useState(samplePayloads.github.eventType)
  const [externalId, setExternalId] = useState('')
  const [payload, setPayload] = useState(JSON.stringify(samplePayloads.github.payload, null, 2))
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<Error>()
  const selected = events.find((event) => event.id === selectedId) ?? events[0]
  const reload = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    void listAutomationEvents(props.organizationId, props.spaceId, props.auth, signal).then((response) => {
      if (!signal?.aborted) { setEvents(response.items); setError(undefined) }
    }, (cause: unknown) => {
      if (!signal?.aborted) setError(cause instanceof Error ? cause : new Error('Unable to load Events.'))
    }).finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [props.auth, props.organizationId, props.spaceId])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) reload(controller.signal)
    })
    return () => controller.abort()
  }, [props.credentialVersion, reload])
  const chooseSource = (next: AutomationSource) => { setSource(next); setEventType(samplePayloads[next].eventType); setPayload(JSON.stringify(samplePayloads[next].payload, null, 2)) }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    void (async () => {
      try {
        const result = await receiveAutomationEvent(props.organizationId, props.spaceId, { source, eventType, externalId: externalId.trim() || `manual-${Date.now()}`, headers: {}, payload: JSON.parse(payload) }, props.auth)
        setNotice(result.duplicate ? label(locale, '重复事件已去重，没有创建第二个 Session。', 'Duplicate Event was deduplicated; no second Session was created.') : result.event.status === 'dispatched' ? label(locale, '事件已匹配并创建 Session。', 'Event matched and created a Session.') : result.event.status === 'failed' ? result.event.errorMessage ?? label(locale, 'Session 创建失败。', 'Session creation failed.') : label(locale, '事件已接收。', 'Event received.'))
        setEvents((items) => [result.event, ...items.filter((item) => item.id !== result.event.id)])
        setSelectedId(result.event.id); setExternalId('')
      } catch (cause) { setError(cause instanceof Error ? cause : new Error('Unable to receive Event.')) } finally { setBusy(false) }
    })()
  }
  return <main className="cosmos-page remote-automation-page"><PageHeader title={label(locale, '事件日志', 'Event Log')} description={label(locale, '查看来源、Payload、匹配解释与 Session 关联', 'Inspect source, payload, match explanation, and Session linkage')} onOpenNavigation={props.onOpenNavigation} /><div className="cosmos-page__content">{notice ? <p className="cosmos-notice" role="status">{notice}</p> : null}{error ? <p className="cosmos-field-error" role="alert">{error.message}</p> : null}{props.canManage ? <form className="remote-event-injector" onSubmit={submit}><div className="cosmos-section-heading"><div><p>{label(locale, '受认证测试入口', 'Authenticated test input')}</p><h2>{label(locale, '接收事件', 'Receive Event')}</h2></div></div><div className="remote-event-source-picker">{sourceOptions.map((item) => <button type="button" key={item.value} aria-pressed={source === item.value} onClick={() => chooseSource(item.value)}>{item.label}</button>)}</div><label><span>{label(locale, '事件类型', 'Event type')}</span><input required value={eventType} onChange={(event) => setEventType(event.target.value)} /></label><label><span>{label(locale, '外部幂等 ID', 'External idempotency ID')}</span><input required value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="provider-event-id" /></label><label><span>Payload</span><textarea required rows={8} value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} /></label><button type="submit" className="cosmos-button cosmos-button--primary" disabled={busy}><Send aria-hidden="true" />{busy ? label(locale, '接收中…', 'Receiving…') : label(locale, '接收并匹配', 'Receive and match')}</button></form> : null}<section className="remote-event-layout"><div className="remote-event-list cosmos-panel"><header><h2>{label(locale, '最近事件', 'Recent events')}</h2><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => reload()}><RefreshCw aria-hidden="true" />{label(locale, '刷新', 'Refresh')}</button></header>{loading ? <p className="cosmos-empty-state">{label(locale, '加载中…', 'Loading…')}</p> : !events.length ? <p className="cosmos-empty-state">{label(locale, '还没有事件。', 'No Events yet.')}</p> : events.map((item) => <button type="button" className={`remote-event-row${item.id === selected?.id ? ' remote-event-row--active' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><Activity aria-hidden="true" /><span><strong>{item.eventType}</strong><small>{item.source} · {formatDate(item.receivedAt, locale)}</small></span><span className={`remote-event-status remote-event-status--${item.status}`}>{item.status}</span><ChevronRight aria-hidden="true" /></button>)}</div><div className="remote-event-detail cosmos-panel">{selected ? <><header><div><p>{selected.id}</p><h2>{selected.source} · {selected.eventType}</h2><span>{formatDate(selected.receivedAt, locale)}</span></div></header><dl><div><dt>{label(locale, '状态', 'Status')}</dt><dd>{selected.status}</dd></div><div><dt>{label(locale, '外部 ID', 'External ID')}</dt><dd><code>{selected.externalId}</code></dd></div><div><dt>{label(locale, '匹配解释', 'Match explanation')}</dt><dd>{selected.matchExplanation}</dd></div>{selected.sessionId ? <div><dt>Session</dt><dd><code>{selected.sessionId}</code></dd></div> : null}{selected.errorMessage ? <div><dt>{label(locale, '错误', 'Error')}</dt><dd>{selected.errorMessage}</dd></div> : null}</dl><h3>Payload</h3><pre className="remote-payload-viewer">{JSON.stringify(selected.payload, null, 2)}</pre></> : <p className="cosmos-empty-state">{label(locale, '选择事件查看详情。', 'Select an Event to inspect details.')}</p>}</div></section></div></main>
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
    void listAutomationRuns(props.organizationId, props.spaceId, props.auth, controller.signal).then((response) => { if (!controller.signal.aborted) { setRuns(response.items); setError(undefined) } }, (cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error('Unable to load Automation Runs.')) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [props.auth, props.credentialVersion, props.organizationId, props.spaceId])
  return <main className="cosmos-page remote-automation-page"><PageHeader title={label(locale, '运行历史', 'Run History')} description={label(locale, '从 Event → Trigger → Session 的同一事实链读取', 'Read the single Event → Trigger → Session fact chain')} onOpenNavigation={props.onOpenNavigation} /><div className="cosmos-page__content">{error ? <p className="cosmos-field-error" role="alert">{error.message}</p> : null}<section className="cosmos-section-heading"><div><p>Automation Sessions</p><h2>{label(locale, '触发执行', 'Triggered execution')}</h2></div></section>{loading ? <p className="cosmos-empty-state">{label(locale, '加载中…', 'Loading…')}</p> : !runs.length ? <p className="cosmos-empty-state">{label(locale, '还没有自动化 Session。', 'No Automation Sessions yet.')}</p> : <div className="remote-run-history-table cosmos-panel"><table className="cosmos-table"><thead><tr><th>Session</th><th>{label(locale, 'Expert', 'Expert')}</th><th>{label(locale, '触发来源', 'Trigger source')}</th><th>{label(locale, '状态', 'Status')}</th><th>{label(locale, '时间', 'Received')}</th><th /></tr></thead><tbody>{runs.map((run) => <tr key={run.eventId}><td><strong>{run.session.title}</strong><small>{run.session.id}</small></td><td>{run.session.expertName}<small>{run.automationName}</small></td><td>{run.source}<small>{run.eventType}</small></td><td>{run.session.status}</td><td>{formatDate(run.receivedAt, locale)}</td><td><button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => props.onOpenSession(run.session.id)}>{label(locale, '打开', 'Open')}<ChevronRight aria-hidden="true" /></button></td></tr>)}</tbody></table></div>}</div></main>
}
