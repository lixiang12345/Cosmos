import type { ContextPackResponse } from '@cosmos/contracts'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  DatabaseZap,
  Download,
  ExternalLink,
  FileClock,
  FileText,
  Folder,
  FolderOpen,
  GitPullRequest,
  LockKeyhole,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  WandSparkles,
  Webhook,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { GlobalControls } from '../components/GlobalControls'
import {
  useControlPlane,
  type Automation,
  type AutomationSource,
  type InboundEvent,
  type InjectEventResult,
  type JsonValue,
  type MemoryFile,
} from '../features/control-plane'
import { usePreferences, type Locale } from '../preferences'
import type { Run, RunStatus } from '../types'
import type { NewTaskExpertOption, SessionCatalogStatus } from '../components/NewTaskDialog'

const prototypeLabel = {
  zh: '原型模拟，不会触发真实外部行为',
  en: 'Prototype simulation; no external action will be performed',
} as const

function localize(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function getSubmissionErrorMessage(error: unknown, locale: Locale) {
  if (error instanceof Error && error.message.trim()) return error.message
  return localize(locale, '会话创建失败，请稍后重试。', 'The session could not be created. Try again.')
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function formatTimestamp(value: string | undefined, locale: Locale) {
  if (!value) return localize(locale, '从未', 'Never')
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getStatusLabel(locale: Locale, status: RunStatus) {
  const labels: Record<RunStatus, { zh: string; en: string }> = {
    draft: { zh: '草稿', en: 'Draft' },
    queued: { zh: '排队中', en: 'Queued' },
    running: { zh: '运行中', en: 'Running' },
    paused: { zh: '已暂停', en: 'Paused' },
    waiting: { zh: '待审批', en: 'Awaiting approval' },
    completed: { zh: '已完成', en: 'Completed' },
    failed: { zh: '失败', en: 'Failed' },
    canceled: { zh: '已取消', en: 'Canceled' },
  }
  return labels[status][locale]
}

function getRiskLabel(locale: Locale, risk: 'low' | 'medium' | 'high') {
  const labels = {
    low: { zh: '低风险', en: 'Low risk' },
    medium: { zh: '中风险', en: 'Medium risk' },
    high: { zh: '高风险', en: 'High risk' },
  }
  return labels[risk][locale]
}

function CosmosStatus({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`cosmos-status cosmos-status--${status}`}>{children}</span>
}

function CosmosPrototypeNote({ locale }: { locale: Locale }) {
  return (
    <p className="cosmos-prototype-note">
      <ShieldCheck aria-hidden="true" />
      {prototypeLabel[locale]}
    </p>
  )
}

function CosmosIconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" className="cosmos-icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon aria-hidden="true" />
    </button>
  )
}

function CosmosPageHeader({
  title,
  description,
  onOpenNavigation,
  action,
}: {
  title: string
  description: string
  onOpenNavigation?: () => void
  action?: ReactNode
}) {
  const { locale } = usePreferences()
  return (
    <header className="cosmos-page-header">
      <div className="cosmos-page-header__identity">
        {onOpenNavigation ? (
          <CosmosIconButton
            icon={Menu}
            label={localize(locale, '打开导航', 'Open navigation')}
            onClick={onOpenNavigation}
          />
        ) : null}
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="cosmos-page-header__actions">
        <GlobalControls />
        {action}
      </div>
    </header>
  )
}

function CosmosNotice({ children }: { children: ReactNode }) {
  return (
    <div className="cosmos-notice" role="status">
      <CheckCircle2 aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export type CosmosPageBaseProps = {
  runs?: Run[]
  onOpenNavigation?: () => void
  onNewTask?: (expertId?: string, initialPrompt?: string) => void
  onOpenSession?: (runId: string) => void
}

export type CosmosHomePageProps = CosmosPageBaseProps & {
  experts: NewTaskExpertOption[]
  catalogStatus?: SessionCatalogStatus
  catalogError?: string
  prototypeTools?: boolean
  sessionCreationEnabled?: boolean
  executionEnabled?: boolean
  contextEnabled?: boolean
  contextPreflight?: (repository: string, task: string) => Promise<ContextPackResponse>
  onRetryCatalog?: () => void
  onCreateSession?: (draft: {
    expertId: string
    prompt: string
    visibility: 'private' | 'space'
    attachments: string[]
    mode: 'run' | 'draft'
    contextPack?: ContextPackResponse | null
  }) => Promise<void>
}

export function CosmosHomePage({
  runs = [],
  onOpenNavigation,
  onNewTask,
  onOpenSession,
  experts,
  catalogStatus,
  catalogError,
  prototypeTools = true,
  sessionCreationEnabled = true,
  executionEnabled = true,
  contextEnabled = false,
  contextPreflight,
  onRetryCatalog,
  onCreateSession,
}: CosmosHomePageProps) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  const [selectedExpertId, setSelectedExpertId] = useState(experts[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'space'>('private')
  const [attachments, setAttachments] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [contextState, setContextState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [contextPack, setContextPack] = useState<ContextPackResponse>()
  const [contextError, setContextError] = useState('')
  const [pendingDraft, setPendingDraft] = useState<{
    expertId: string
    prompt: string
    visibility: 'private' | 'space'
    attachments: string[]
    mode: 'run' | 'draft'
  }>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedExpert = experts.find((expert) => expert.id === selectedExpertId) ?? experts[0]
  const recentRuns = runs.filter((run) => !run.archived).slice(0, 5)
  const resolvedCatalogStatus = catalogStatus ?? (experts.length ? 'ready' : 'empty')

  const createFromDraft = async (
    draft: NonNullable<typeof pendingDraft>,
    nextContextPack?: ContextPackResponse | null,
  ) => {
    if (onCreateSession) {
      setSubmitError('')
      setSubmitting(true)
      try {
        await onCreateSession({
          ...draft,
          contextPack: nextContextPack,
        })
        setPendingDraft(undefined)
        setContextPack(undefined)
        setContextState('idle')
      } catch (error) {
        setSubmitError(getSubmissionErrorMessage(error, locale))
      } finally {
        setSubmitting(false)
      }
      return
    }
    onNewTask?.(draft.expertId, draft.prompt)
  }

  const submitSession = async (event: FormEvent) => {
    event.preventDefault()
    const value = prompt.trim()
    if (!value || !selectedExpert || submitting || contextState === 'loading') return
    const draft = {
      expertId: selectedExpert.id,
      prompt: value,
      visibility,
      attachments: prototypeTools ? attachments : [],
      mode: executionEnabled ? 'run' as const : 'draft' as const,
    }
    if (contextEnabled && contextPreflight && selectedExpert.repository) {
      setSubmitError('')
      setContextError('')
      setContextPack(undefined)
      setPendingDraft(draft)
      setContextState('loading')
      try {
        const nextPack = await contextPreflight(selectedExpert.repository, value)
        setContextPack(nextPack)
        setContextState('ready')
      } catch (error) {
        setContextError(getSubmissionErrorMessage(error, locale))
        setContextState('error')
      }
      return
    }
    await createFromDraft(draft)
  }

  const openSession = (runId: string) => {
    if (onOpenSession) onOpenSession(runId)
    else navigate(`/sessions/${runId}`)
  }

  return (
    <main className="cosmos-home">
      <header className="cosmos-home__topbar">
        <CosmosIconButton icon={Menu} label={localize(locale, '打开导航', 'Open navigation')} onClick={onOpenNavigation ?? (() => undefined)} />
        <GlobalControls />
      </header>
      <div className="cosmos-home__content">
        <section className="home-launcher" aria-labelledby="home-launcher-title">
          <header>
            <span className="home-launcher__mark"><Sparkles aria-hidden="true" /></span>
            <p>{localize(locale, 'Cosmos Agent OS', 'Cosmos Agent OS')}</p>
            <h1 id="home-launcher-title">{executionEnabled
              ? localize(locale, '选择 Expert，开始一个会话', 'Choose an Expert and start a session')
              : localize(locale, '选择 Expert，保存会话草稿', 'Choose an Expert and save a Session draft')}</h1>
            <span>{localize(locale, 'Expert 已封装模型、能力和运行环境；你只需要描述想完成的工作。', 'The Expert already packages its model, capabilities, and environment. Just describe the work.')}</span>
          </header>

          {resolvedCatalogStatus === 'ready' ? (
            <div className="home-expert-grid" role="radiogroup" aria-label={localize(locale, '选择 Expert', 'Choose an Expert')}>
              {experts.slice(0, 6).map((expert) => (
                <button type="button" role="radio" aria-checked={expert.id === selectedExpert?.id} className={`home-expert-card${expert.id === selectedExpert?.id ? ' home-expert-card--selected' : ''}`} key={expert.id} onClick={() => { setSelectedExpertId(expert.id); setPendingDraft(undefined); setContextPack(undefined); setContextState('idle') }}>
                  <span>{expert.builtIn ? <Sparkles aria-hidden="true" /> : <Bot aria-hidden="true" />}</span>
                  <strong>{expert.name}</strong>
                  <small>{expert.description}</small>
                  <em>{expert.environment}</em>
                  {expert.id === selectedExpert?.id ? <Check aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : resolvedCatalogStatus === 'loading' ? (
            <div className="remote-catalog-state" role="status" aria-live="polite">
              <LoaderCircle className="cosmos-spin" aria-hidden="true" />
              <p>{localize(locale, '正在加载可用 Expert 与运行环境…', 'Loading available Experts and Environments…')}</p>
            </div>
          ) : resolvedCatalogStatus === 'error' ? (
            <div className="remote-catalog-state remote-catalog-state--error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{localize(locale, '无法加载会话目录', 'Unable to load the session catalog')}</strong>
                {catalogError ? <p>{catalogError}</p> : null}
              </div>
              {onRetryCatalog ? (
                <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onRetryCatalog}>
                  <RefreshCw aria-hidden="true" />{localize(locale, '重试', 'Retry')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="remote-catalog-empty" role="status">
              <Bot aria-hidden="true" />
              <strong>{localize(locale, '当前 Space 没有可用 Expert', 'No Experts are available in this Space')}</strong>
              <p>{localize(locale, '请先发布一个绑定了就绪环境的 Expert。', 'Publish an Expert bound to a ready Environment first.')}</p>
            </div>
          )}

          {resolvedCatalogStatus === 'ready' && sessionCreationEnabled ? <form className="home-session-composer" onSubmit={submitSession}>
            <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setPendingDraft(undefined); setContextPack(undefined); setContextState('idle') }} placeholder={selectedExpert?.launchGuidance || localize(locale, '描述你想完成的工作…', 'Describe the work you want done…')} rows={3} aria-label={localize(locale, '会话任务', 'Session task')} />
            {prototypeTools && attachments.length ? (
              <div className="home-session-composer__attachments">
                {attachments.map((name) => (
                  <span key={name}><Paperclip aria-hidden="true" />{name}<button type="button" aria-label={`${localize(locale, '移除附件', 'Remove attachment')}: ${name}`} onClick={() => setAttachments((items) => items.filter((item) => item !== name))}><X aria-hidden="true" /></button></span>
                ))}
              </div>
            ) : null}
            {submitError ? <p className="cosmos-field-error" role="alert">{submitError}</p> : null}
            <footer>
              <div className="home-session-composer__tools">
                {prototypeTools ? <>
                  <input ref={fileInputRef} className="cosmos-visually-hidden" type="file" hidden aria-hidden="true" tabIndex={-1} multiple accept="image/*,.txt,.md,.json,.log,.pdf" onChange={(event) => {
                    const names = Array.from(event.target.files ?? []).slice(0, 10).map((file) => file.name)
                    setAttachments((items) => [...new Set([...items, ...names])].slice(0, 10))
                    event.target.value = ''
                  }} />
                  <CosmosIconButton icon={Paperclip} label={localize(locale, '添加附件', 'Attach files')} onClick={() => fileInputRef.current?.click()} />
                  <button type="button" className="cosmos-icon-button" aria-label={localize(locale, '增强提示词', 'Enhance prompt')} title={localize(locale, '增强提示词', 'Enhance prompt')} disabled={!prompt.trim()} onClick={() => setPrompt((value) => `${value.trim()}\n\n${localize(locale, '请确认目标、约束、风险和可验证的完成标准。', 'Confirm the goal, constraints, risks, and verifiable completion criteria.')}`)}><WandSparkles aria-hidden="true" /></button>
                </> : null}
                <label className="home-session-composer__visibility">
                  {visibility === 'private' ? <LockKeyhole aria-hidden="true" /> : <User aria-hidden="true" />}
                  <span className="cosmos-visually-hidden">{localize(locale, '可见范围', 'Visibility')}</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'space')}>
                    <option value="private">{localize(locale, '仅自己', 'Private')}</option>
                    <option value="space">{localize(locale, '当前 Space', 'Current Space')}</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </label>
                <span><ShieldCheck aria-hidden="true" />{selectedExpert?.tools}</span>
              </div>
              <button type="submit" className="cosmos-button cosmos-button--primary" disabled={!prompt.trim() || !selectedExpert || submitting || contextState === 'loading'} aria-busy={submitting || contextState === 'loading'}>
                {submitting || contextState === 'loading'
                  ? <LoaderCircle className="new-task-submit-spinner" aria-hidden="true" />
                  : executionEnabled ? <Send aria-hidden="true" /> : <Save aria-hidden="true" />}
                {contextState === 'loading'
                  ? localize(locale, '正在预检上下文…', 'Checking context…')
                  : submitting
                  ? (executionEnabled ? localize(locale, '正在启动…', 'Starting…') : localize(locale, '正在保存…', 'Saving…'))
                  : (executionEnabled ? localize(locale, '开始会话', 'Start session') : localize(locale, '保存草稿', 'Save draft'))}
              </button>
            </footer>
          </form> : resolvedCatalogStatus === 'ready' ? <p className="cosmos-empty-state" role="note">{localize(locale, '你在当前 Space 中只有查看权限。', 'You have view-only access in this Space.')}</p> : null}

          {pendingDraft && contextState !== 'loading' ? (
            <section className={`home-context-confirmation${contextState === 'error' ? ' home-context-confirmation--error' : ''}`} aria-live="polite" aria-label={localize(locale, '上下文预检', 'Context preflight')}>
              <span className="home-context-confirmation__icon">{contextState === 'error' ? <AlertTriangle aria-hidden="true" /> : <DatabaseZap aria-hidden="true" />}</span>
              <div className="home-context-confirmation__body">
                <small>{localize(locale, 'ContextEngine 预检', 'ContextEngine preflight')}</small>
                <strong>{contextState === 'error'
                  ? localize(locale, '无法构建上下文包', 'Unable to build the context pack')
                  : localize(locale, '上下文包已就绪，请确认后启动', 'Context pack ready. Confirm before launch.')}</strong>
                {contextState === 'error' ? <p>{contextError}</p> : <>
                  <p>{contextPack?.hits.slice(0, 4).map((hit) => hit.path).join(' · ') || localize(locale, '未命中代码证据', 'No code evidence matched')}</p>
                  <dl>
                    <div><dt>{localize(locale, '证据', 'Sources')}</dt><dd>{contextPack?.hits.length ?? 0}</dd></div>
                    <div><dt>{localize(locale, '预估 token', 'Estimated tokens')}</dt><dd>{new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(contextPack?.estimatedTokens ?? 0)}</dd></div>
                    <div><dt>{localize(locale, '完整性', 'Coverage')}</dt><dd>{contextPack?.truncated ? localize(locale, '已截断', 'Truncated') : localize(locale, '完整', 'Complete')}</dd></div>
                  </dl>
                  <em>{localize(locale, '仓库内容将作为非可信证据附加，Agent 不会把其中内容当作指令。', 'Repository content is attached as untrusted evidence, never as instructions.')}</em>
                </>}
              </div>
              <div className="home-context-confirmation__actions">
                {contextState === 'ready' ? <button type="button" className="cosmos-button cosmos-button--primary" disabled={submitting} onClick={() => { void createFromDraft(pendingDraft, contextPack) }}><ShieldCheck aria-hidden="true" />{localize(locale, '附加并启动', 'Attach and start')}</button> : null}
                <button type="button" className="cosmos-button cosmos-button--secondary" disabled={submitting} onClick={() => { void createFromDraft(pendingDraft, null) }}>{localize(locale, '不附加，继续', 'Continue without it')}</button>
                <button type="button" className="cosmos-button cosmos-button--ghost" disabled={submitting} onClick={() => { setPendingDraft(undefined); setContextPack(undefined); setContextState('idle'); setContextError('') }}>{localize(locale, '取消', 'Cancel')}</button>
              </div>
            </section>
          ) : null}
        </section>

        <section className="home-recent" aria-labelledby="cosmos-recent-title">
          <div className="cosmos-section-heading">
            <div><p>{localize(locale, '会话', 'Sessions')}</p><h2 id="cosmos-recent-title">{localize(locale, '最近会话', 'Recent sessions')}</h2></div>
            <button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => navigate('/sessions')}>{localize(locale, '查看全部', 'View all')}<ChevronRight aria-hidden="true" /></button>
          </div>
          {recentRuns.length ? (
            <div className="cosmos-session-list">
              {recentRuns.map((run) => (
                <article className="cosmos-session-row" key={run.id}>
                  <span className="cosmos-session-row__icon"><Bot aria-hidden="true" /></span>
                  <div><h3>{run.title}</h3><p>{run.expert} · {run.repo}</p></div>
                  <CosmosStatus status={run.status}>{getStatusLabel(locale, run.status)}</CosmosStatus>
                  <time>{run.updatedAt}</time>
                  <CosmosIconButton icon={ExternalLink} label={localize(locale, '打开会话', 'Open session')} onClick={() => openSession(run.id)} />
                </article>
              ))}
            </div>
          ) : <p className="cosmos-empty-state">{localize(locale, '还没有会话。选择一个 Expert 开始。', 'No sessions yet. Choose an Expert to begin.')}</p>}
        </section>
      </div>
    </main>
  )
}

export type CosmosFileScope = 'user' | 'organization'

export type CosmosFileVersion = {
  id: string
  version: number
  content: string
  author: string
  createdAt: string
}

export type CosmosFileRecord = {
  id: string
  scope: CosmosFileScope
  path: string
  description: string
  content: string
  updatedAt: string
  author: string
  versions: CosmosFileVersion[]
}

function getFileScope(path: string): CosmosFileScope {
  return path.startsWith('user/') ? 'user' : 'organization'
}

function getDisplayFilePath(file: MemoryFile) {
  return getFileScope(file.path) === 'user' ? file.path.slice('user/'.length) : file.path
}

function getScopedFilePath(file: CosmosFileRecord) {
  return `${file.scope}/${file.path}`
}

function getFileSize(content: string, locale: Locale) {
  const bytes = new Blob([content]).size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`
  return `${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Copy is not supported')
}

function downloadFile(path: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split('/').at(-1) ?? 'file.txt'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

type CosmosFileTreeRow =
  | { kind: 'directory'; path: string; name: string; depth: number }
  | { kind: 'file'; file: CosmosFileRecord; depth: number }

function getDirectoryPaths(files: CosmosFileRecord[]) {
  const paths = new Set<string>()
  files.forEach((file) => {
    const segments = file.path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join('/'))
    }
  })
  return paths
}

function getFileTreeRows(files: CosmosFileRecord[], expandedDirectories: Set<string>): CosmosFileTreeRow[] {
  const rows: CosmosFileTreeRow[] = []
  const renderedDirectories = new Set<string>()

  files.slice().sort((left, right) => left.path.localeCompare(right.path)).forEach((file) => {
    const segments = file.path.split('/')
    let visible = true
    for (let index = 1; index < segments.length; index += 1) {
      const path = segments.slice(0, index).join('/')
      if (visible && !renderedDirectories.has(path)) {
        rows.push({ kind: 'directory', path, name: segments[index - 1], depth: index - 1 })
        renderedDirectories.add(path)
      }
      if (!expandedDirectories.has(path)) visible = false
    }
    if (visible) rows.push({ kind: 'file', file, depth: segments.length - 1 })
  })

  return rows
}

function toCosmosFileRecord(file: MemoryFile, locale: Locale): CosmosFileRecord {
  const versions = [...file.versions]
    .sort((left, right) => right.version - left.version)
    .map((version) => ({
      id: version.id,
      version: version.version,
      content: version.content,
      author: version.createdBy,
      createdAt: formatTimestamp(version.createdAt, locale),
    }))
  return {
    id: file.id,
    scope: getFileScope(file.path),
    path: getDisplayFilePath(file),
    description: file.description,
    content: file.content,
    updatedAt: formatTimestamp(file.updatedAt, locale),
    author: versions[0]?.author ?? localize(locale, '未知', 'Unknown'),
    versions,
  }
}

export type CosmosFilesPageProps = Pick<CosmosPageBaseProps, 'onOpenNavigation'> & {
  initialScope?: CosmosFileScope
}

export function CosmosFilesPage({ onOpenNavigation, initialScope = 'user' }: CosmosFilesPageProps) {
  const { locale } = usePreferences()
  const { scope: controlPlaneScope } = useControlPlane()
  const navigate = useNavigate()
  const files = useMemo(
    () => controlPlaneScope.memoryFiles.map((file) => toCosmosFileRecord(file, locale)),
    [controlPlaneScope.memoryFiles, locale],
  )
  const [query, setQuery] = useState('')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(() => files.find((file) => file.scope === initialScope)?.id ?? null)
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => getDirectoryPaths(files))
  const [viewVersionId, setViewVersionId] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const scopedFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return files.filter((file) => (
      file.scope === initialScope
      && `${file.path} ${file.author} ${file.description}`.toLowerCase().includes(normalizedQuery)
    ))
  }, [files, initialScope, query])
  const visibleDirectories = query.trim() ? getDirectoryPaths(scopedFiles) : expandedDirectories
  const treeRows = useMemo(
    () => getFileTreeRows(scopedFiles, visibleDirectories),
    [scopedFiles, visibleDirectories],
  )
  const selectedFile = scopedFiles.find((file) => file.id === selectedFileId) ?? scopedFiles[0] ?? null
  const viewedVersion = selectedFile?.versions.find((version) => version.id === viewVersionId) ?? null
  const previewContent = viewedVersion?.content ?? selectedFile?.content ?? ''

  const selectFile = (file: CosmosFileRecord) => {
    setSelectedFileId(file.id)
    setViewVersionId(null)
    setVersionsOpen(false)
    setNotice('')
  }

  const toggleDirectory = (path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const copyValue = async (value: string, successMessage: string) => {
    try {
      await copyToClipboard(value)
      setNotice(successMessage)
    } catch {
      setNotice(localize(locale, '复制失败，请检查浏览器权限', 'Copy failed. Check browser permissions.'))
    }
  }

  const downloadSelectedFile = () => {
    if (!selectedFile) return
    downloadFile(selectedFile.path, previewContent)
    setNotice(localize(locale, '文件下载已开始', 'File download started'))
  }

  return (
    <main className="cosmos-page cosmos-files-page">
      <CosmosPageHeader
        title={initialScope === 'organization'
          ? localize(locale, '组织文件', 'Organization files')
          : localize(locale, '个人文件', 'User files')}
        description={initialScope === 'organization'
          ? localize(locale, '跨会话共享的团队知识、产物与 Skills', 'Team knowledge, outputs, and Skills shared across Sessions')
          : localize(locale, '仅你的会话可访问的持久知识与产物', 'Persistent knowledge and outputs available only to your Sessions')}
        onOpenNavigation={onOpenNavigation}
      />
      <div className="cosmos-page__content">
        {notice ? <CosmosNotice>{notice}</CosmosNotice> : null}
        <CosmosPrototypeNote locale={locale} />

        <div className="cosmos-files-layout">
          <aside className="cosmos-files-browser" aria-label={localize(locale, '文件树', 'File tree')}>
            <div className="cosmos-segmented-control" role="tablist" aria-label={localize(locale, '文件范围', 'File scope')}>
              <button type="button" role="tab" aria-selected={initialScope === 'organization'} className={initialScope === 'organization' ? 'cosmos-segmented-control__active' : ''} onClick={() => navigate('/files/organization')}><Building2 aria-hidden="true" />{localize(locale, '组织', 'Organization')}</button>
              <button type="button" role="tab" aria-selected={initialScope === 'user'} className={initialScope === 'user' ? 'cosmos-segmented-control__active' : ''} onClick={() => navigate('/files/user')}><User aria-hidden="true" />{localize(locale, '个人', 'User')}</button>
            </div>
            <label className="cosmos-search-field">
              <Search aria-hidden="true" />
              <span className="cosmos-visually-hidden">{localize(locale, '搜索文件', 'Search files')}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={localize(locale, '搜索路径或写入者', 'Search path or writer')} />
            </label>
            <div className="cosmos-files-browser__summary">
              <span>{localize(locale, '文件树', 'File tree')}</span>
              <strong>{scopedFiles.length}</strong>
            </div>
            <div className="cosmos-file-list" role="tree">
              {treeRows.map((row) => row.kind === 'directory' ? (
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={visibleDirectories.has(row.path)}
                  className="cosmos-file-directory-row"
                  key={`directory:${row.path}`}
                  style={{ '--tree-indent': `${row.depth * 16}px` } as CSSProperties}
                  onClick={() => toggleDirectory(row.path)}
                >
                  {visibleDirectories.has(row.path) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  {visibleDirectories.has(row.path) ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
                  <span>{row.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={row.file.id === selectedFile?.id}
                  aria-label={localize(locale, `查看 ${row.file.path}`, `View ${row.file.path}`)}
                  className={`cosmos-file-row${row.file.id === selectedFile?.id ? ' cosmos-file-row--active' : ''}`}
                  key={row.file.id}
                  style={{ '--tree-indent': `${row.depth * 16}px` } as CSSProperties}
                  onClick={() => selectFile(row.file)}
                >
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{row.file.path.split('/').at(-1)}</strong>
                    <small>{row.file.path}</small>
                    <small>{getFileSize(row.file.content, locale)} · {row.file.updatedAt} · {row.file.author}</small>
                  </span>
                </button>
              ))}
              {!scopedFiles.length ? <p className="cosmos-empty-state">{query.trim()
                ? localize(locale, '没有匹配的文件', 'No matching files')
                : localize(locale, '当前范围还没有文件', 'No files in this scope yet')}</p> : null}
            </div>
          </aside>

          <section className="cosmos-file-viewer" aria-label={localize(locale, '文件预览', 'File preview')}>
            {selectedFile ? (
              <>
                <header className="cosmos-file-viewer__header">
                  <div>
                    <p>{selectedFile.scope === 'user' ? 'User' : 'Organization'}{viewedVersion ? ` · v${viewedVersion.version}` : ''}</p>
                    <h2>{selectedFile.path}</h2>
                    <span>{viewedVersion
                      ? `${viewedVersion.author} · ${viewedVersion.createdAt}`
                      : `${selectedFile.author} · ${selectedFile.updatedAt}`}</span>
                  </div>
                  <div>
                    <CosmosIconButton icon={Copy} label={localize(locale, '复制路径', 'Copy path')} onClick={() => { void copyValue(getScopedFilePath(selectedFile), localize(locale, '路径已复制', 'Path copied')) }} />
                    <CosmosIconButton icon={FileText} label={localize(locale, '复制内容', 'Copy content')} onClick={() => { void copyValue(previewContent, localize(locale, '内容已复制', 'Content copied')) }} />
                    <CosmosIconButton icon={Download} label={localize(locale, '下载文件', 'Download file')} onClick={downloadSelectedFile} />
                  </div>
                </header>

                <dl className="cosmos-file-metadata">
                  <div><dt>{localize(locale, '路径', 'Path')}</dt><dd><code>{getScopedFilePath(selectedFile)}</code></dd></div>
                  <div><dt>{localize(locale, '大小', 'Size')}</dt><dd>{getFileSize(previewContent, locale)}</dd></div>
                  <div><dt>{localize(locale, '最近写入者', 'Last writer')}</dt><dd>{viewedVersion?.author ?? selectedFile.author}</dd></div>
                  <div><dt>{localize(locale, '更新时间', 'Modified')}</dt><dd>{viewedVersion?.createdAt ?? selectedFile.updatedAt}</dd></div>
                </dl>
                {selectedFile.description ? <p className="cosmos-file-description">{selectedFile.description}</p> : null}
                <pre className="cosmos-file-preview" aria-label={localize(locale, '文件内容', 'File content')}>{previewContent}</pre>

                <section className="cosmos-version-history" aria-labelledby="cosmos-version-title">
                  <button type="button" className="cosmos-version-toggle" aria-expanded={versionsOpen} onClick={() => setVersionsOpen((value) => !value)}>
                    <span><FileClock aria-hidden="true" /><span><small>{localize(locale, '不可变快照', 'Immutable snapshots')}</small><strong id="cosmos-version-title">{localize(locale, '版本历史', 'Version history')} · {selectedFile.versions.length}</strong></span></span>
                    {versionsOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </button>
                  {versionsOpen ? (
                    <div className="cosmos-version-list">
                      {selectedFile.versions.map((version, index) => {
                        const active = index === 0 ? viewVersionId === null : version.id === viewVersionId
                        return (
                          <article className={`cosmos-version-row${active ? ' cosmos-version-row--active' : ''}`} key={version.id}>
                            <button type="button" aria-pressed={active} onClick={() => setViewVersionId(index === 0 ? null : version.id)}>
                              <FileClock aria-hidden="true" />
                              <span><strong>v{version.version}{index === 0 ? ` · ${localize(locale, '当前', 'Current')}` : ''}</strong><small>{version.author} · {version.createdAt}</small></span>
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              </>
            ) : <p className="cosmos-empty-state">{localize(locale, '选择一个文件查看内容和版本', 'Select a file to view its content and versions')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

export type CosmosApprovalsPageProps = Pick<CosmosPageBaseProps, 'runs' | 'onOpenNavigation' | 'onOpenSession'> & {
  onDecision?: (runId: string, decision: 'approved' | 'changes') => void
}

export function CosmosApprovalsPage({ runs = [], onOpenNavigation, onOpenSession, onDecision }: CosmosApprovalsPageProps) {
  const { locale } = usePreferences()
  const [resolved, setResolved] = useState<Record<string, 'approved' | 'changes'>>({})
  const waitingRuns = useMemo(() => runs.filter((run) => run.status === 'waiting' && !resolved[run.id]), [resolved, runs])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => waitingRuns[0]?.id ?? null)
  const [decisionNote, setDecisionNote] = useState('')
  const [notice, setNotice] = useState('')
  const selectedRun = waitingRuns.find((run) => run.id === selectedRunId) ?? waitingRuns[0] ?? null

  const decide = (decision: 'approved' | 'changes') => {
    if (!selectedRun) return
    onDecision?.(selectedRun.id, decision)
    setResolved((current) => ({ ...current, [selectedRun.id]: decision }))
    setDecisionNote('')
    setNotice(decision === 'approved'
      ? localize(locale, '原型已记录批准决策', 'Approval recorded in the prototype')
      : localize(locale, '原型已记录修改要求', 'Change request recorded in the prototype'))
  }

  const openSession = () => {
    if (!selectedRun) return
    if (onOpenSession) onOpenSession(selectedRun.id)
    else setNotice(localize(locale, `原型将打开会话 ${selectedRun.id}`, `The prototype would open session ${selectedRun.id}`))
  }

  return (
    <main className="cosmos-page cosmos-approvals-page">
      <CosmosPageHeader
        title={localize(locale, '审批', 'Approvals')}
        description={localize(locale, '只在需要人类判断的外部写操作和高风险节点介入', 'Intervene only for external writes and high-risk decisions that require human judgment')}
        onOpenNavigation={onOpenNavigation}
      />
      <div className="cosmos-page__content">
        {notice ? <CosmosNotice>{notice}</CosmosNotice> : null}
        <CosmosPrototypeNote locale={locale} />

        <section className="cosmos-approval-metrics" aria-label={localize(locale, '审批概览', 'Approval overview')}>
          <article><Clock3 aria-hidden="true" /><span>{localize(locale, '等待决策', 'Awaiting decision')}</span><strong>{waitingRuns.length}</strong></article>
          <article><CheckCircle2 aria-hidden="true" /><span>{localize(locale, '本页已处理', 'Resolved here')}</span><strong>{Object.keys(resolved).length}</strong></article>
          <article><ShieldCheck aria-hidden="true" /><span>{localize(locale, '默认边界', 'Default boundary')}</span><strong>{localize(locale, '合并前', 'Before merge')}</strong></article>
        </section>

        <div className="cosmos-approvals-layout">
          <section className="cosmos-approval-inbox" aria-labelledby="cosmos-approval-inbox-title">
            <div className="cosmos-section-heading"><div><p>{localize(locale, '决策收件箱', 'Decision inbox')}</p><h2 id="cosmos-approval-inbox-title">{localize(locale, '待处理请求', 'Pending requests')}</h2></div></div>
            <div className="cosmos-approval-list">
              {waitingRuns.map((run) => (
                <button type="button" className={`cosmos-approval-row${run.id === selectedRun?.id ? ' cosmos-approval-row--active' : ''}`} key={run.id} onClick={() => { setSelectedRunId(run.id); setDecisionNote('') }}>
                  <AlertTriangle aria-hidden="true" />
                  <span><strong>{run.approval?.title ?? run.title}</strong><small>{run.repo} · {run.expert}</small></span>
                  <CosmosStatus status={run.approval?.risk ?? 'medium'}>{getRiskLabel(locale, run.approval?.risk ?? 'medium')}</CosmosStatus>
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
              {!waitingRuns.length ? <p className="cosmos-empty-state">{localize(locale, '当前没有待处理审批', 'No approvals are waiting')}</p> : null}
            </div>
          </section>

          <section className="cosmos-approval-detail" aria-labelledby="cosmos-approval-detail-title">
            {selectedRun ? (
              <>
                <header>
                  <div><p>{selectedRun.id}</p><h2 id="cosmos-approval-detail-title">{selectedRun.approval?.title ?? selectedRun.title}</h2><span>{selectedRun.title} · {selectedRun.repo}</span></div>
                  <CosmosStatus status={selectedRun.approval?.risk ?? 'medium'}>{getRiskLabel(locale, selectedRun.approval?.risk ?? 'medium')}</CosmosStatus>
                </header>
                <div className="cosmos-approval-evidence">
                  <h3>{localize(locale, '决策证据', 'Decision evidence')}</h3>
                  <ul>{(selectedRun.approval?.reasons ?? [selectedRun.summary]).map((reason) => <li key={reason}><Check aria-hidden="true" />{reason}</li>)}</ul>
                </div>
                <div className="cosmos-approval-recommendation">
                  <h3>{localize(locale, '专家建议', 'Expert recommendation')}</h3>
                  <p>{selectedRun.approval?.recommendation ?? localize(locale, '核对验证结果与回滚方案后再继续。', 'Review verification evidence and the rollback plan before continuing.')}</p>
                </div>
                <label className="cosmos-approval-note">
                  {localize(locale, '决策说明', 'Decision note')}
                  <textarea rows={4} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder={localize(locale, '要求修改时请说明必须补充的内容…', 'Describe the required changes…')} />
                </label>
                <div className="cosmos-form-actions cosmos-form-actions--split">
                  <button type="button" className="cosmos-button cosmos-button--ghost" onClick={openSession}><ExternalLink aria-hidden="true" />{localize(locale, '查看完整会话', 'Open full session')}</button>
                  <div>
                    <button type="button" className="cosmos-button cosmos-button--secondary" disabled={!decisionNote.trim()} onClick={() => decide('changes')}><Pencil aria-hidden="true" />{localize(locale, '要求修改', 'Request changes')}</button>
                    <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => decide('approved')}><Check aria-hidden="true" />{localize(locale, '批准并继续', 'Approve and continue')}</button>
                  </div>
                </div>
              </>
            ) : <p className="cosmos-empty-state">{localize(locale, '所有决策已处理', 'All decisions are resolved')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

export type CosmosAutomationTriggerSource = Extract<AutomationSource, 'github' | 'slack' | 'webhook' | 'schedule'>

export type CosmosAutomation = Automation

type AutomationDraft = {
  name: string
  expert: string
  source: CosmosAutomationTriggerSource
  event: string
  filter: string
}

const emptyAutomationDraft: AutomationDraft = {
  name: '',
  expert: 'expert-seed-pr-author',
  source: 'github',
  event: 'pull_request.opened',
  filter: '{\n  "action": "opened",\n  "repository.owner": "commerce"\n}',
}

const automationSources: Array<{ source: CosmosAutomationTriggerSource; icon: LucideIcon; label: string }> = [
  { source: 'github', icon: GitPullRequest, label: 'GitHub' },
  { source: 'slack', icon: MessageSquareText, label: 'Slack' },
  { source: 'webhook', icon: Webhook, label: 'Webhook' },
  { source: 'schedule', icon: CalendarClock, label: 'Schedule' },
]

function sourceIcon(source: AutomationSource) {
  return automationSources.find((item) => item.source === source)?.icon ?? Workflow
}

function parseAutomationFilter(value: string) {
  if (!value.trim()) return {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Filter must be a JSON object')
  const entries = Object.entries(parsed)
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('Filter values must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}

function expertLabel(expertId: string) {
  return expertId
    .replace(/^expert-(seed-)?/, '')
    .split('-')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ')
}

export type CosmosAutomationsPageProps = Pick<CosmosPageBaseProps, 'onOpenNavigation'>

export function CosmosAutomationsPage({ onOpenNavigation }: CosmosAutomationsPageProps) {
  const { locale } = usePreferences()
  const { scope, actions } = useControlPlane()
  const automations = scope.automations
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [draft, setDraft] = useState<AutomationDraft>(emptyAutomationDraft)
  const [wizardError, setWizardError] = useState('')
  const [notice, setNotice] = useState('')

  const openWizard = () => {
    setDraft(emptyAutomationDraft)
    setWizardStep(1)
    setWizardError('')
    setWizardOpen(true)
  }

  const updateSource = (source: CosmosAutomationTriggerSource) => {
    const defaults: Record<CosmosAutomationTriggerSource, Pick<AutomationDraft, 'event' | 'filter'>> = {
      github: { event: 'pull_request.opened', filter: '{\n  "action": "opened",\n  "repository.owner": "commerce"\n}' },
      slack: { event: 'message.posted', filter: '{\n  "channel": "payments-alerts"\n}' },
      webhook: { event: 'custom.alert', filter: '{\n  "severity": "P1"\n}' },
      schedule: { event: '0 9 * * 1-5', filter: '' },
    }
    setDraft((current) => ({ ...current, source, ...defaults[source] }))
  }

  const nextWizardStep = () => {
    if (wizardStep === 1 && !draft.name.trim()) {
      setWizardError(localize(locale, '请输入自动化名称', 'Enter an automation name'))
      return
    }
    if (wizardStep === 2 && !draft.event.trim()) {
      setWizardError(localize(locale, '请输入事件或 Cron 表达式', 'Enter an event or cron expression'))
      return
    }
    setWizardError('')
    setWizardStep((step) => Math.min(3, step + 1))
  }

  const createAutomation = () => {
    try {
      actions.createAutomation({
        name: draft.name.trim(),
        description: '',
        source: draft.source,
        trigger: draft.event.trim(),
        filter: parseAutomationFilter(draft.filter),
        enabled: false,
        expertId: draft.expert,
      })
      setWizardOpen(false)
      setNotice(localize(locale, '自动化已写入当前 Space，触发器默认关闭', 'Automation saved to the current Space with its trigger disabled'))
    } catch (cause) {
      setWizardError(cause instanceof Error ? cause.message : localize(locale, '自动化创建失败', 'Failed to create automation'))
    }
  }

  const toggleAutomation = (automation: CosmosAutomation) => {
    try {
      actions.toggleAutomation(automation.id, !automation.enabled)
      setNotice(automation.enabled
        ? localize(locale, '触发器已暂停', 'Trigger paused')
        : localize(locale, '触发器已启用', 'Trigger enabled'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : localize(locale, '自动化更新失败', 'Failed to update automation'))
    }
  }

  return (
    <main className="cosmos-page cosmos-automations-page">
      <CosmosPageHeader
        title={localize(locale, '自动化', 'Automations')}
        description={localize(locale, '把事件源和专家绑定成可观察、可暂停的长期规则', 'Bind event sources to Experts as observable, pausable standing rules')}
        onOpenNavigation={onOpenNavigation}
        action={<button type="button" className="cosmos-button cosmos-button--primary" onClick={openWizard}><Plus aria-hidden="true" />{localize(locale, '创建自动化', 'Create automation')}</button>}
      />
      <div className="cosmos-page__content">
        {notice ? <CosmosNotice>{notice}</CosmosNotice> : null}
        <CosmosPrototypeNote locale={locale} />

        <section className="cosmos-automation-list" aria-labelledby="cosmos-automation-list-title">
          <div className="cosmos-section-heading"><div><p>{localize(locale, 'Expert + Trigger', 'Expert + Trigger')}</p><h2 id="cosmos-automation-list-title">{localize(locale, '已配置自动化', 'Configured automations')}</h2></div></div>
          {automations.map((automation) => {
            const SourceIcon = sourceIcon(automation.source)
            const expanded = expandedId === automation.id
            return (
              <article className="cosmos-automation-row" key={automation.id}>
                <div className="cosmos-automation-row__summary">
                  <span className="cosmos-automation-row__icon"><SourceIcon aria-hidden="true" /></span>
                  <div><h3>{automation.name}</h3><p>{expertLabel(automation.expertId)} · {automation.trigger}</p></div>
                  <span><small>{localize(locale, '匹配次数', 'Matches')}</small><strong>{automation.matchCount}</strong></span>
                  <span><small>{localize(locale, '最近匹配', 'Last match')}</small><strong>{formatTimestamp(automation.lastMatchedAt, locale)}</strong></span>
                  <CosmosStatus status={automation.enabled ? 'healthy' : 'paused'}>{automation.enabled ? localize(locale, '已启用', 'Enabled') : localize(locale, '已暂停', 'Paused')}</CosmosStatus>
                  <button type="button" className="cosmos-switch-button" aria-pressed={automation.enabled} aria-label={automation.enabled ? localize(locale, '暂停自动化', 'Pause automation') : localize(locale, '启用自动化', 'Enable automation')} onClick={() => toggleAutomation(automation)}>
                    {automation.enabled ? <CirclePause aria-hidden="true" /> : <CirclePlay aria-hidden="true" />}
                  </button>
                  <CosmosIconButton icon={expanded ? ChevronDown : ChevronRight} label={localize(locale, '切换详情', 'Toggle details')} onClick={() => setExpandedId(expanded ? null : automation.id)} />
                </div>
                {expanded ? (
                  <dl className="cosmos-automation-details">
                    <div><dt>{localize(locale, '来源', 'Source')}</dt><dd>{automation.source}</dd></div>
                    <div><dt>{localize(locale, '事件', 'Event')}</dt><dd><code>{automation.trigger}</code></dd></div>
                    <div><dt>{localize(locale, '筛选条件', 'Filter')}</dt><dd><code>{Object.keys(automation.filter).length ? JSON.stringify(automation.filter) : localize(locale, '无', 'None')}</code></dd></div>
                    <div><dt>{localize(locale, '仓库', 'Repository')}</dt><dd>{automation.repositoryId ?? localize(locale, '不限', 'Any')}</dd></div>
                    <div><dt>{localize(locale, '创建时间', 'Created')}</dt><dd>{formatTimestamp(automation.createdAt, locale)}</dd></div>
                  </dl>
                ) : null}
              </article>
            )
          })}
          {!automations.length ? <p className="cosmos-empty-state">{localize(locale, '当前 Space 尚未配置自动化', 'No automations are configured in this Space')}</p> : null}
        </section>
      </div>

      {wizardOpen ? (
        <div className="cosmos-dialog-backdrop">
          <section className="cosmos-dialog cosmos-automation-wizard" role="dialog" aria-modal="true" aria-labelledby="cosmos-automation-wizard-title">
            <header>
              <div><p>{localize(locale, `步骤 ${wizardStep} / 3`, `Step ${wizardStep} / 3`)}</p><h2 id="cosmos-automation-wizard-title">{localize(locale, '创建自动化', 'Create automation')}</h2></div>
              <CosmosIconButton icon={X} label={localize(locale, '关闭', 'Close')} onClick={() => setWizardOpen(false)} />
            </header>

            {wizardStep === 1 ? (
              <div className="cosmos-wizard-step">
                <label>{localize(locale, '名称', 'Name')}<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={localize(locale, '例如：主分支 PR 深度审查', 'Example: Deep review for main-branch PRs')} /></label>
                <label>{localize(locale, '执行专家', 'Expert')}<select value={draft.expert} onChange={(event) => setDraft((current) => ({ ...current, expert: event.target.value }))}><option value="expert-seed-pr-author">PR Author</option><option value="expert-seed-deep-code-reviewer">Deep Code Reviewer</option><option value="expert-seed-incident-investigator">Incident Investigator</option><option value="expert-seed-project-builder">Project Builder</option></select></label>
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="cosmos-wizard-step">
                <fieldset><legend>{localize(locale, '触发来源', 'Trigger source')}</legend><div className="cosmos-source-picker">{automationSources.map((option) => { const Icon = option.icon; return <button type="button" className={draft.source === option.source ? 'cosmos-source-picker__active' : ''} aria-pressed={draft.source === option.source} key={option.source} onClick={() => updateSource(option.source)}><Icon aria-hidden="true" />{option.label}</button> })}</div></fieldset>
                <label>{draft.source === 'schedule' ? localize(locale, 'Cron 表达式', 'Cron expression') : localize(locale, '事件类型', 'Event type')}<input value={draft.event} onChange={(event) => setDraft((current) => ({ ...current, event: event.target.value }))} /></label>
                {draft.source !== 'schedule' ? <label>{localize(locale, 'Payload 筛选（JSON）', 'Payload filter (JSON)')}<textarea rows={6} value={draft.filter} onChange={(event) => setDraft((current) => ({ ...current, filter: event.target.value }))} spellCheck={false} /></label> : null}
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <div className="cosmos-wizard-step cosmos-wizard-review">
                <dl><div><dt>{localize(locale, '名称', 'Name')}</dt><dd>{draft.name}</dd></div><div><dt>{localize(locale, '专家', 'Expert')}</dt><dd>{draft.expert}</dd></div><div><dt>{localize(locale, '触发器', 'Trigger')}</dt><dd>{draft.source} · {draft.event}</dd></div><div><dt>{localize(locale, '筛选', 'Filter')}</dt><dd>{draft.filter || localize(locale, '无', 'None')}</dd></div></dl>
                <p className="cosmos-wizard-safety"><ShieldCheck aria-hidden="true" />{localize(locale, '按照 Advisor 的分阶段上线语义，新自动化创建后默认暂停。', 'Following Advisor staged rollout semantics, new automations are created paused.')}</p>
              </div>
            ) : null}

            {wizardError ? <p className="cosmos-field-error" role="alert">{wizardError}</p> : null}
            <footer className="cosmos-form-actions cosmos-form-actions--split">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={() => wizardStep === 1 ? setWizardOpen(false) : setWizardStep((step) => step - 1)}><ArrowLeft aria-hidden="true" />{wizardStep === 1 ? localize(locale, '取消', 'Cancel') : localize(locale, '上一步', 'Back')}</button>
              {wizardStep < 3 ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={nextWizardStep}>{localize(locale, '下一步', 'Next')}<ArrowRight aria-hidden="true" /></button> : <button type="button" className="cosmos-button cosmos-button--primary" onClick={createAutomation}><Workflow aria-hidden="true" />{localize(locale, '创建并保持暂停', 'Create paused')}</button>}
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export type CosmosEventSource = 'github' | 'slack' | 'webhook'

export type CosmosEventMatch = {
  automationId: string
  automationName: string
  matched: boolean
  reason: string
}

export type CosmosEventRecord = InboundEvent

const sampleEvents: Record<CosmosEventSource, { type: string; payload: Record<string, JsonValue> }> = {
  github: {
    type: 'pull_request.opened',
    payload: { action: 'opened', repository: { full_name: 'commerce/payment-service' }, pull_request: { number: 913, draft: false, base: { ref: 'main' }, html_url: 'https://github.com/commerce/payment-service/pull/913' } },
  },
  slack: {
    type: 'message.posted',
    payload: { channel: 'payments-alerts', mentionsCosmos: 'true', text: '@Cosmos investigate payment timeouts', team_id: 'T-COMMERCE' },
  },
  webhook: {
    type: 'custom.alert',
    payload: { alert_type: 'error', severity: 'P1', service: 'payment-service', message: 'Retry queue saturation' },
  },
}

function eventSourceIcon(source: AutomationSource) {
  if (source === 'github') return GitPullRequest
  if (source === 'slack') return MessageSquareText
  if (source === 'webhook') return Webhook
  return Workflow
}

export type CosmosEventLogPageProps = Pick<CosmosPageBaseProps, 'onOpenNavigation'> & {
  onSessionCreated?: (result: InjectEventResult) => void
}

export function CosmosEventLogPage({ onOpenNavigation, onSessionCreated }: CosmosEventLogPageProps) {
  const { locale } = usePreferences()
  const { scope, actions } = useControlPlane()
  const events = scope.inboundEvents
  const [source, setSource] = useState<CosmosEventSource>('github')
  const [eventType, setEventType] = useState(sampleEvents.github.type)
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(sampleEvents.github.payload, null, 2))
  const [sourceFilter, setSourceFilter] = useState<'all' | CosmosEventSource>('all')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0] ?? null
  const filteredEvents = events.filter((event) => sourceFilter === 'all' || event.source === sourceFilter)

  const chooseSample = (nextSource: CosmosEventSource) => {
    setSource(nextSource)
    setEventType(sampleEvents[nextSource].type)
    setPayloadText(JSON.stringify(sampleEvents[nextSource].payload, null, 2))
    setError('')
  }

  const injectEvent = () => {
    try {
      const parsed: unknown = JSON.parse(payloadText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Payload must be an object')
      const result = actions.injectEvent({
        source,
        trigger: eventType.trim() || sampleEvents[source].type,
        externalId: makeId(`prototype-${source}`),
        payload: parsed as Record<string, JsonValue>,
      })
      onSessionCreated?.(result)
      setSelectedEventId(result.event.id)
      setError('')
      setNotice(result.duplicate
        ? localize(locale, '该事件已存在，未重复处理', 'This event already exists and was not processed twice')
        : result.matchedAutomation
          ? localize(locale, `事件已匹配 ${result.matchedAutomation.name} 并创建 Session 草稿`, `Event matched ${result.matchedAutomation.name} and created a Session draft`)
          : localize(locale, '事件已接收，但没有自动化匹配', 'Event received, but no automation matched'))
    } catch {
      setError(localize(locale, 'Payload 必须是有效的 JSON 对象', 'Payload must be a valid JSON object'))
    }
  }

  return (
    <main className="cosmos-page cosmos-event-log-page">
      <CosmosPageHeader
        title={localize(locale, '事件日志', 'Event Log')}
        description={localize(locale, '检查触发器真正接收到的来源、事件类型和原始 Payload', 'Inspect the source, event type, and raw payload received by triggers')}
        onOpenNavigation={onOpenNavigation}
      />
      <div className="cosmos-page__content">
        {notice ? <CosmosNotice>{notice}</CosmosNotice> : null}
        <CosmosPrototypeNote locale={locale} />

        <section className="cosmos-event-injector" aria-labelledby="cosmos-event-injector-title">
          <div className="cosmos-section-heading"><div><p>{localize(locale, '测试入口', 'Test input')}</p><h2 id="cosmos-event-injector-title">{localize(locale, '注入模拟事件', 'Inject a simulated event')}</h2></div></div>
          <div className="cosmos-source-picker" aria-label={localize(locale, '事件来源', 'Event source')}>
            {(['github', 'slack', 'webhook'] as CosmosEventSource[]).map((item) => {
              const Icon = item === 'github' ? GitPullRequest : item === 'slack' ? MessageSquareText : Webhook
              return <button type="button" className={source === item ? 'cosmos-source-picker__active' : ''} aria-pressed={source === item} key={item} onClick={() => chooseSample(item)}><Icon aria-hidden="true" />{item === 'github' ? 'GitHub' : item === 'slack' ? 'Slack' : 'Webhook'}</button>
            })}
          </div>
          <label>{localize(locale, '事件类型', 'Event type')}<input value={eventType} onChange={(event) => setEventType(event.target.value)} /></label>
          <label>{localize(locale, '原始 Payload', 'Raw payload')}<textarea rows={12} value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} /></label>
          {error ? <p className="cosmos-field-error" role="alert">{error}</p> : null}
          <div className="cosmos-form-actions"><button type="button" className="cosmos-button cosmos-button--primary" onClick={injectEvent}><Activity aria-hidden="true" />{localize(locale, '注入并匹配', 'Inject and match')}</button></div>
        </section>

        <div className="cosmos-event-layout">
          <section className="cosmos-event-list" aria-labelledby="cosmos-event-list-title">
            <div className="cosmos-section-heading">
              <div><p>{localize(locale, '最近优先', 'Most recent first')}</p><h2 id="cosmos-event-list-title">{localize(locale, '接收事件', 'Received events')}</h2></div>
              <label><span className="cosmos-visually-hidden">{localize(locale, '按来源筛选', 'Filter by source')}</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | CosmosEventSource)}><option value="all">{localize(locale, '全部来源', 'All sources')}</option><option value="github">GitHub</option><option value="slack">Slack</option><option value="webhook">Webhook</option></select></label>
            </div>
            {filteredEvents.map((event) => {
              const Icon = eventSourceIcon(event.source)
              const matchedCount = event.status === 'matched' ? 1 : 0
              return (
                <button type="button" className={`cosmos-event-row${event.id === selectedEvent?.id ? ' cosmos-event-row--active' : ''}`} key={event.id} onClick={() => setSelectedEventId(event.id)}>
                  <Icon aria-hidden="true" />
                  <span><strong>{event.trigger}</strong><small>{event.source} · {formatTimestamp(event.receivedAt, locale)}</small></span>
                  <CosmosStatus status={matchedCount ? 'healthy' : 'neutral'}>{localize(locale, `${matchedCount} 个匹配`, `${matchedCount} matched`)}</CosmosStatus>
                  <ChevronRight aria-hidden="true" />
                </button>
              )
            })}
            {!filteredEvents.length ? <p className="cosmos-empty-state">{localize(locale, '还没有模拟事件', 'No simulated events yet')}</p> : null}
          </section>

          <section className="cosmos-event-detail" aria-labelledby="cosmos-event-detail-title">
            {selectedEvent ? (
              <>
                <header><div><p>{selectedEvent.id}</p><h2 id="cosmos-event-detail-title">{selectedEvent.source} · {selectedEvent.trigger}</h2><span>{formatTimestamp(selectedEvent.receivedAt, locale)}</span></div></header>
                <section>
                  <h3>{localize(locale, '匹配结果', 'Match results')}</h3>
                  <div className="cosmos-match-list">
                    {selectedEvent.matchedAutomationId ? (
                      <article className="cosmos-match-row cosmos-match-row--matched">
                        <CheckCircle2 aria-hidden="true" />
                        <span><strong>{scope.automations.find((automation) => automation.id === selectedEvent.matchedAutomationId)?.name ?? selectedEvent.matchedAutomationId}</strong><small>{localize(locale, '控制平面已匹配并创建 Session 草稿', 'Matched by the control plane and created a Session draft')}</small></span>
                      </article>
                    ) : (
                      <article className="cosmos-match-row cosmos-match-row--missed">
                        <X aria-hidden="true" />
                        <span><strong>{localize(locale, '未匹配', 'Unmatched')}</strong><small>{localize(locale, '没有启用的自动化同时匹配来源、事件和筛选条件', 'No enabled automation matched the source, trigger, and filters')}</small></span>
                      </article>
                    )}
                  </div>
                </section>
                <section><h3>{localize(locale, 'Payload', 'Payload')}</h3><pre className="cosmos-payload-viewer">{JSON.stringify(selectedEvent.payload, null, 2)}</pre></section>
              </>
            ) : <p className="cosmos-empty-state">{localize(locale, '注入事件后可查看匹配结果和 Payload', 'Inject an event to inspect matching and payload')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

function automationSourceFromTrigger(trigger: string) {
  const value = trigger.toLowerCase()
  if (value.includes('github')) return 'GitHub'
  if (value.includes('slack') || value.includes('feishu') || value.includes('飞书')) return value.includes('feishu') || value.includes('飞书') ? 'Feishu' : 'Slack'
  if (value.includes('webhook')) return 'Webhook'
  if (value.includes('schedule') || value.includes('cron') || value.includes('定时')) return 'Schedule'
  if (value.includes('linear')) return 'Linear'
  if (value.includes('jira')) return 'Jira'
  if (value.includes('pagerduty')) return 'PagerDuty'
  return 'Automation'
}

function isAutomationTriggeredRun(run: Run) {
  const trigger = run.trigger.trim()
  if (!trigger) return false
  return !/(manual|console|控制台|手动|worker|manager|子任务)/i.test(trigger)
}

export type CosmosRunHistoryPageProps = Pick<CosmosPageBaseProps, 'runs' | 'onOpenNavigation' | 'onOpenSession'>

export function CosmosRunHistoryPage({ runs = [], onOpenNavigation, onOpenSession }: CosmosRunHistoryPageProps) {
  const { locale } = usePreferences()
  const automationRuns = useMemo(() => runs.filter(isAutomationTriggeredRun), [runs])
  const [query, setQuery] = useState('')
  const [expertFilter, setExpertFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const experts = Array.from(new Set(automationRuns.map((run) => run.expert))).sort()
  const sources = Array.from(new Set(automationRuns.map((run) => automationSourceFromTrigger(run.trigger)))).sort()
  const filteredRuns = automationRuns.filter((run) => {
    const matchesQuery = `${run.title} ${run.repo} ${run.expert} ${run.trigger}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesExpert = expertFilter === 'all' || run.expert === expertFilter
    const matchesSource = sourceFilter === 'all' || automationSourceFromTrigger(run.trigger) === sourceFilter
    return matchesQuery && matchesExpert && matchesSource
  })

  const openSession = (runId: string) => {
    if (onOpenSession) onOpenSession(runId)
    else setNotice(localize(locale, `原型将打开自动化会话 ${runId}`, `The prototype would open automation session ${runId}`))
  }

  return (
    <main className="cosmos-page cosmos-run-history-page">
      <CosmosPageHeader
        title={localize(locale, '运行历史', 'Run History')}
        description={localize(locale, '只显示由 Trigger 启动的 Sessions；手动会话和 Worker 不在此视图', 'Only trigger-created Sessions appear here; manual sessions and workers are excluded')}
        onOpenNavigation={onOpenNavigation}
      />
      <div className="cosmos-page__content">
        {notice ? <CosmosNotice>{notice}</CosmosNotice> : null}
        <section className="cosmos-run-history-metrics" aria-label={localize(locale, '运行历史概览', 'Run history overview')}>
          <article><Workflow aria-hidden="true" /><span>{localize(locale, '触发运行', 'Triggered runs')}</span><strong>{automationRuns.length}</strong></article>
          <article><CirclePlay aria-hidden="true" /><span>{localize(locale, '运行中', 'Running')}</span><strong>{automationRuns.filter((run) => run.status === 'running').length}</strong></article>
          <article><AlertTriangle aria-hidden="true" /><span>{localize(locale, '失败', 'Failed')}</span><strong>{automationRuns.filter((run) => run.status === 'failed').length}</strong></article>
          <article><CheckCircle2 aria-hidden="true" /><span>{localize(locale, '完成', 'Completed')}</span><strong>{automationRuns.filter((run) => run.status === 'completed').length}</strong></article>
        </section>

        <section className="cosmos-run-history" aria-labelledby="cosmos-run-history-title">
          <div className="cosmos-section-heading">
            <div><p>{localize(locale, 'Automation Sessions', 'Automation Sessions')}</p><h2 id="cosmos-run-history-title">{localize(locale, '按专家查看触发执行', 'Triggered execution by Expert')}</h2></div>
            <div className="cosmos-table-filters">
              <label className="cosmos-search-field"><Search aria-hidden="true" /><span className="cosmos-visually-hidden">{localize(locale, '搜索运行', 'Search runs')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={localize(locale, '搜索任务、仓库或触发器', 'Search task, repository, or trigger')} /></label>
              <label><span className="cosmos-visually-hidden">{localize(locale, '按专家筛选', 'Filter by Expert')}</span><select value={expertFilter} onChange={(event) => setExpertFilter(event.target.value)}><option value="all">{localize(locale, '全部专家', 'All Experts')}</option>{experts.map((expert) => <option key={expert} value={expert}>{expert}</option>)}</select></label>
              <label><span className="cosmos-visually-hidden">{localize(locale, '按来源筛选', 'Filter by source')}</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">{localize(locale, '全部来源', 'All sources')}</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
            </div>
          </div>

          <div className="cosmos-table-wrap">
            <table className="cosmos-table">
              <thead><tr><th>{localize(locale, 'Session', 'Session')}</th><th>{localize(locale, '专家', 'Expert')}</th><th>{localize(locale, '触发来源', 'Trigger source')}</th><th>{localize(locale, '状态', 'Status')}</th><th>{localize(locale, '最近更新', 'Updated')}</th><th><span className="cosmos-visually-hidden">{localize(locale, '操作', 'Actions')}</span></th></tr></thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.id}>
                    <td><strong>{run.title}</strong><small>{run.id} · {run.repo}</small></td>
                    <td>{run.expert}</td>
                    <td><span className="cosmos-trigger-source"><Activity aria-hidden="true" />{automationSourceFromTrigger(run.trigger)}<small>{run.trigger.split('/').slice(1).join('/').trim() || run.trigger}</small></span></td>
                    <td><CosmosStatus status={run.status}>{getStatusLabel(locale, run.status)}</CosmosStatus></td>
                    <td>{run.updatedAt}</td>
                    <td><CosmosIconButton icon={ExternalLink} label={localize(locale, '打开 Session', 'Open Session')} onClick={() => openSession(run.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredRuns.length ? <p className="cosmos-empty-state">{localize(locale, '没有匹配的自动化会话', 'No matching automation sessions')}</p> : null}
          </div>
        </section>
      </div>
    </main>
  )
}
