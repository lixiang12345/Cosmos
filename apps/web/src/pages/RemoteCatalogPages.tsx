import {
  DEFAULT_AGENT_MODEL,
  SUPPORTED_AGENT_MODELS,
  type AutomationDto,
  type AutomationSource,
  type CreateEnvironmentRequestInput,
  type EnvironmentDetailDto,
  type EnvironmentRevisionDto,
  type EnvironmentStatus,
  type EnvironmentSummaryDto,
  type ExpertDetailDto,
  type ExpertRevisionListResponse,
  type ExpertStatus,
  type ExpertSummaryDto,
  type DaemonDto,
  type IntegrationDto,
  type McpServerDto,
  type RepositoryDto,
  type SecretDto,
  type WebhookDto,
} from '@cosmos/contracts'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Clock3,
  Container,
  Copy,
  Database,
  FolderGit2,
  GitBranch,
  History,
  PlugZap,
  Wrench,
  KeyRound,
  EyeOff,
  Link2,
  Webhook,
  LoaderCircle,
  LockKeyhole,
  Menu,
  ListRestart,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Server,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import {
  PrototypeCloudIcon,
  PrototypeDaemonIcon,
  PrototypeGitHubIcon,
  PrototypeHexIcon,
  PrototypeLinearIcon,
  PrototypeSearchIcon,
  PrototypeSlackIcon,
} from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  CosmosApiError,
  archiveExpert,
  archiveEnvironment,
  createEnvironment,
  createExpert,
  disableExpert,
  disableEnvironment,
  getEnvironment,
  getExpert,
  getRepository,
  getSecret,
  createSecret,
  archiveSecret,
  getWebhook,
  createWebhook,
  archiveWebhook,
  getMcpServer,
  createMcpServer,
  archiveMcpServer,
  getDaemon,
  createDaemon,
  updateDaemon,
  archiveDaemon,
  createIntegration,
  updateIntegration,
  archiveIntegration,
  listAutomations,
  listExpertRevisions,
  listEnvironmentRevisions,
  publishExpert,
  retryEnvironment,
  updateEnvironment,
  updateExpert,
  type CosmosApiAuthContext,
} from '../services/cosmosApi'

type RemoteCatalogListState<T> = {
  items: T[]
  loading: boolean
  ready: boolean
  error: Error | null
  onRetry: () => void
}

type RemoteCatalogRequestProps = {
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  credentialVersion: number
}

export type RemoteExpertsPageProps = RemoteCatalogListState<ExpertSummaryDto> & {
  onOpenNavigation?: () => void
  onOpenDetail: (expertId: string) => void
  onStartSession: (expertId: string) => void
  sessionCreationEnabled?: boolean
  canManage?: boolean
  onCreate?: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
  onOpenAdvisor?: () => void
  organizationId?: string
  spaceId?: string
  auth?: CosmosApiAuthContext
  credentialVersion?: number
}

export type RemoteExpertDetailPageProps = RemoteCatalogRequestProps & {
  expertId: string
  onOpenNavigation?: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  sessionCreationEnabled?: boolean
  canManage?: boolean
  onEdit?: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
}

export type RemoteExpertEditorPageProps = RemoteCatalogRequestProps & {
  expertId?: string
  environments: EnvironmentSummaryDto[]
  onOpenNavigation?: () => void
  onBack: () => void
  onCreated: (expertId: string) => void
  onArchived: () => void
  onCatalogChange: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
  onOpenAdvisor?: () => void
}

export type RemoteEnvironmentsPageProps = RemoteCatalogListState<EnvironmentSummaryDto>
  & RemoteCatalogRequestProps
  & {
    onOpenNavigation?: () => void
    canManage?: boolean
    secrets?: SecretDto[]
    secretsLoading?: boolean
    secretsError?: Error | null
    onRetrySecrets?: () => void
    navigationCollapsed?: boolean
    onOpenCommand?: () => void
    onOpenAdvisor?: () => void
  }

export type RemoteRepositoriesPageProps = RemoteCatalogListState<RepositoryDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void }

export type RemoteSecretsPageProps = RemoteCatalogListState<SecretDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean; onCatalogChange?: () => void }

export type RemoteWebhooksPageProps = RemoteCatalogListState<WebhookDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean; onCatalogChange?: () => void }

export type RemoteMcpServersPageProps = RemoteCatalogListState<McpServerDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean; onCatalogChange?: () => void }

export type RemoteDaemonsPageProps = RemoteCatalogListState<DaemonDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean; environments?: EnvironmentSummaryDto[] }

export type RemoteIntegrationsPageProps = RemoteCatalogListState<IntegrationDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean }

type DetailStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error'

type DetailSnapshot<T> = {
  identity: object
  status: Exclude<DetailStatus, 'idle' | 'loading'>
  item?: T
  error?: Error
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

function useRemoteDetail<T>(
  identity: object | undefined,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [retryVersion, setRetryVersion] = useState(0)
  const [snapshot, setSnapshot] = useState<DetailSnapshot<T>>()

  useEffect(() => {
    if (!identity) return
    const controller = new AbortController()
    void load(controller.signal).then(
      (item) => {
        if (!controller.signal.aborted) setSnapshot({ identity, status: 'ready', item })
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return
        const error = cause instanceof Error
          ? cause
          : new Error('Unable to load the Catalog resource.')
        setSnapshot({
          identity,
          status: cause instanceof CosmosApiError && cause.status === 404 ? 'not_found' : 'error',
          error,
        })
      },
    )
    return () => { controller.abort() }
  }, [identity, load, retryVersion])

  const retry = useCallback(() => {
    if (identity) setSnapshot(undefined)
    setRetryVersion((version) => version + 1)
  }, [identity])
  const current = snapshot?.identity === identity ? snapshot : undefined
  const status: DetailStatus = !identity ? 'idle' : current?.status ?? 'loading'
  return {
    status,
    item: current?.item,
    error: current?.error,
    retry,
  }
}

function PageHeader({
  icon,
  title,
  description,
  onOpenNavigation,
  actions,
  readOnly = false,
}: {
  icon: typeof Bot
  title: string
  description: string
  onOpenNavigation?: () => void
  actions?: ReactNode
  readOnly?: boolean
}) {
  const { locale } = usePreferences()
  const Icon = icon
  return (
    <header className="cosmos-page-header remote-catalog-header">
      <div className="cosmos-page-header__identity">
        <IconButton
          icon={Menu}
          label={text(locale, '打开导航', 'Open navigation')}
          className="cosmos-mobile-menu"
          onClick={onOpenNavigation}
        />
        <span className="cosmos-page-header__icon"><Icon aria-hidden="true" /></span>
        <div><h1>{title}</h1><p>{description}</p></div>
      </div>
      <div className="cosmos-page-header__actions">
        {readOnly ? <span className="remote-catalog-readonly"><LockKeyhole aria-hidden="true" />{text(locale, '只读', 'Read only')}</span> : null}
        <GlobalControls className="cosmos-global-controls" />
        {actions}
      </div>
    </header>
  )
}

function StatusLabel({ status }: { status: ExpertStatus | EnvironmentStatus }) {
  const { locale } = usePreferences()
  const labels: Record<ExpertStatus | EnvironmentStatus, [string, string]> = {
    draft: ['草稿', 'Draft'],
    published: ['已发布', 'Published'],
    disabled: ['已停用', 'Disabled'],
    archived: ['已归档', 'Archived'],
    provisioning: ['配置中', 'Provisioning'],
    ready: ['可用', 'Ready'],
    updating: ['更新中', 'Updating'],
    failed: ['失败', 'Failed'],
  }
  return (
    <span className={`cosmos-status cosmos-status--${status}`}>
      <i aria-hidden="true" />{text(locale, ...labels[status])}
    </span>
  )
}

function LoadState({
  status,
  resource,
  error,
  onRetry,
}: {
  status: 'loading' | 'error' | 'not_found'
  resource: string
  error?: Error | null
  onRetry: () => void
}) {
  const { locale } = usePreferences()
  if (status === 'loading') {
    return (
      <div className="remote-catalog-state" role="status">
        <LoaderCircle className="cosmos-spin" aria-hidden="true" />
        <p>{text(locale, `正在加载${resource}…`, `Loading ${resource}…`)}</p>
      </div>
    )
  }

  const notFound = status === 'not_found'
  return (
    <div className="remote-catalog-state remote-catalog-state--error" role={notFound ? 'status' : 'alert'}>
      {notFound ? <CircleOff aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
      <div>
        <strong>{notFound
          ? text(locale, `未找到${resource}`, `${resource} not found`)
          : text(locale, `无法加载${resource}`, `Unable to load ${resource}`)}</strong>
        {error?.message ? <p>{error.message}</p> : null}
      </div>
      <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}
      </button>
    </div>
  )
}

function listState(
  loading: boolean,
  ready: boolean,
  error: Error | null,
): 'loading' | 'ready' | 'error' {
  if (error) return 'error'
  if (loading) return 'loading'
  if (ready) return 'ready'
  return 'loading'
}

function canStartExpert(expert: ExpertSummaryDto | ExpertDetailDto) {
  return expert.status === 'published'
    && expert.publishedRevisionId !== null
    && ('publishedRevision' in expert
      ? expert.publishedRevision !== null
      : expert.publishedRevisionSummary !== null)
}

const EXPERT_PIN_STORAGE_KEY = 'cosmos.expertPins'

function readExpertPins(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPERT_PIN_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

function ExpertSourceIcon({ source }: { source: AutomationSource }) {
  if (source === 'github') return <PrototypeGitHubIcon aria-hidden="true" />
  if (source === 'linear') return <PrototypeLinearIcon aria-hidden="true" />
  if (source === 'slack') return <PrototypeSlackIcon aria-hidden="true" />
  return <PrototypeHexIcon aria-hidden="true" />
}

export function RemoteExpertsPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  onOpenNavigation,
  onOpenDetail,
  onStartSession,
  sessionCreationEnabled = true,
  canManage = false,
  onCreate,
  navigationCollapsed,
  onOpenCommand,
  onOpenAdvisor,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
}: RemoteExpertsPageProps) {
  const { locale } = usePreferences()
  const state = listState(loading, ready, error)
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [menuId, setMenuId] = useState<string>()
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(readExpertPins)
  const [automations, setAutomations] = useState<AutomationDto[]>([])

  useEffect(() => {
    if (!organizationId || !spaceId || !auth) return
    const controller = new AbortController()
    listAutomations(organizationId, spaceId, auth, controller.signal).then((response) => {
      if (!controller.signal.aborted) setAutomations(response.items)
    }, () => {
      /* The Automations column stays empty when the Trigger catalog is unavailable. */
    })
    return () => controller.abort()
  }, [auth, credentialVersion, organizationId, spaceId])

  const automationsByExpert = useMemo(() => {
    const index = new Map<string, AutomationDto[]>()
    for (const automation of automations) {
      if (automation.status === 'archived') continue
      const list = index.get(automation.expertId) ?? []
      list.push(automation)
      index.set(automation.expertId, list)
    }
    return index
  }, [automations])

  const togglePin = (expertId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current)
      if (next.has(expertId)) next.delete(expertId)
      else next.add(expertId)
      try {
        window.localStorage.setItem(EXPERT_PIN_STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        /* Pinning is a local convenience; ignore storage failures. */
      }
      return next
    })
  }

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return items
      .filter((expert) => (scope === 'mine' ? expert.visibility === 'private' : true))
      .filter((expert) => !normalized
        || expert.name.toLowerCase().includes(normalized)
        || expert.description.toLowerCase().includes(normalized))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [items, query, scope])

  const allChecked = rows.length > 0 && rows.every((expert) => checkedIds.has(expert.id))
  const toggleAllChecked = () => {
    setCheckedIds(allChecked ? new Set() : new Set(rows.map((expert) => expert.id)))
  }
  const toggleChecked = (expertId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(expertId)) next.delete(expertId)
      else next.add(expertId)
      return next
    })
  }

  return <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={text(locale, '配置 · Experts', 'Configuration · Experts')}
      navigationCollapsed={navigationCollapsed}
      onOpenNavigation={onOpenNavigation}
      onOpenCommand={onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content prototype-expert-content">
        <div className="prototype-automation-header">
          <div>
            <h1>Experts</h1>
            <p>{text(locale,
              'Expert 是可复用的 AI Agent 配置。用系统提示词定义它的角色，选择运行方式，随时从它发起会话。',
              'An Expert is a reusable AI agent configuration. Define its role with a system prompt, choose how it runs, and start sessions from it anytime.')}</p>
          </div>
          {canManage && onCreate ? <button type="button" className="prototype-primary-button" onClick={onCreate}>{text(locale, '创建 Expert', 'Create an expert')}</button> : null}
        </div>

        <button type="button" className="prototype-advisor-banner" disabled={!onOpenAdvisor && !onOpenCommand} onClick={onOpenAdvisor ?? onOpenCommand}>
          <span className="prototype-advisor-mark" aria-hidden="true" />
          <span><strong>{text(locale, '描述工作流，让 Agent 为你完成设置 →', 'Describe your workflow and an agent will set it up →')}</strong><small>{text(locale, 'Cosmos Advisor Agent 会配置 Expert 和 Automation', 'Cosmos Advisor agent configures the experts and automations')}</small></span>
        </button>

        <div className="prototype-automation-toolbar">
          <div className="prototype-segmented" aria-label={text(locale, 'Expert 范围', 'Expert scope')}>
            <button type="button" className={scope === 'mine' ? 'active' : ''} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>{text(locale, '我的', 'Mine')}</button>
            <button type="button" className={scope === 'all' ? 'active' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{text(locale, '全部', 'All')}</button>
          </div>
          <label className="prototype-automation-search"><PrototypeSearchIcon aria-hidden="true" /><span className="sr-only">{text(locale, '搜索 Expert', 'Search experts')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(locale, '搜索 Expert…', 'Search experts…')} /></label>
        </div>

        <div className="prototype-automation-table-wrap">
          <table className="prototype-automation-table prototype-expert-table">
            <thead><tr>
              <th className="col-check"><input type="checkbox" checked={allChecked} disabled={!rows.length} aria-label={text(locale, '选择全部 Expert', 'Select all experts')} onChange={toggleAllChecked} /></th>
              <th className="col-star"><span className="sr-only">{text(locale, '固定', 'Pinned')}</span></th>
              <th>{text(locale, '名称', 'Name')}</th>
              <th className="col-auto">Automations</th>
              <th className="col-integ">{text(locale, '集成', 'Integrations')}</th>
              <th>{text(locale, '更新时间', 'Updated')} <span className="sort-icon">↓</span></th>
              <th className="col-menu"><span className="sr-only">{text(locale, '操作', 'Actions')}</span></th>
            </tr></thead>
            <tbody>
              {state === 'loading' ? <tr><td colSpan={7} className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '加载中…', 'Loading…')}</td></tr> : null}
              {state === 'error' ? <tr><td colSpan={7} className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '无法加载 Experts。', 'Unable to load Experts.')}{error ? ` ${error.message}` : ''}</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></td></tr> : null}
              {state === 'ready' && !rows.length ? <tr><td colSpan={7} className="prototype-automation-state">{query || scope === 'mine' ? text(locale, '没有匹配的 Expert', 'No experts match') : text(locale, '当前 Space 尚无 Expert。', 'No Experts exist in this Space yet.')}</td></tr> : null}
              {state === 'ready' ? rows.map((expert) => {
                const startable = canStartExpert(expert)
                const expertAutomations = automationsByExpert.get(expert.id) ?? []
                const sources = [...new Set(expertAutomations.map((automation) => automation.source))]
                const pinned = pinnedIds.has(expert.id)
                return <tr key={expert.id} onClick={() => onOpenDetail(expert.id)}>
                  <td className="col-check" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={checkedIds.has(expert.id)} aria-label={text(locale, `选择 ${expert.name}`, `Select ${expert.name}`)} onChange={() => toggleChecked(expert.id)} />
                  </td>
                  <td className="col-star" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className={`prototype-expert-star${pinned ? ' on' : ''}`} aria-pressed={pinned} aria-label={pinned ? text(locale, `取消固定 ${expert.name}`, `Unpin ${expert.name}`) : text(locale, `固定 ${expert.name}`, `Pin ${expert.name}`)} onClick={() => togglePin(expert.id)}>{pinned ? '★' : '☆'}</button>
                  </td>
                  <td className="col-name">
                    <div className="prototype-expert-name-cell">
                      <span className="prototype-automation-expert-icon"><PrototypeHexIcon aria-hidden="true" /></span>
                      <div className="prototype-expert-name-body">
                        <div className="prototype-expert-name-line">
                          <strong>{expert.name}</strong>
                          {expert.visibility === 'space' ? <span className="prototype-expert-tag">shared</span> : null}
                          {expert.status !== 'published' ? <span className="prototype-expert-tag">{expert.status === 'draft' ? text(locale, '草稿', 'draft') : text(locale, '已归档', 'archived')}</span> : null}
                        </div>
                        <div className="prototype-expert-desc-line">{expert.description || text(locale, '暂无说明', 'No description')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="muted col-auto">{expertAutomations.length || ''}</td>
                  <td className="col-integ">{sources.length ? <div className="prototype-expert-integ-stack">
                    {sources.slice(0, 4).map((source) => <span className="prototype-expert-integ-icon" key={source} title={source}><ExpertSourceIcon source={source} /></span>)}
                    <span className="prototype-expert-integ-count">{sources.length}</span>
                  </div> : null}</td>
                  <td className="muted">{formatDate(expert.updatedAt, locale)}</td>
                  <td className="col-menu" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="icon-btn prototype-automation-more" aria-label={text(locale, `${expert.name} 更多操作`, `More actions for ${expert.name}`)} aria-expanded={menuId === expert.id} onClick={() => setMenuId((current) => current === expert.id ? undefined : expert.id)}>⋯</button>
                    {menuId === expert.id ? <div className="prototype-automation-row-menu" role="menu">
                      {sessionCreationEnabled ? <button type="button" role="menuitem" disabled={!startable} title={startable ? undefined : text(locale, '仅已发布且具有版本的 Expert 可发起会话', 'Only a published Expert revision can start a Session')} onClick={() => { setMenuId(undefined); onStartSession(expert.id) }}><strong>{text(locale, '新建会话', 'New Session')}</strong>{!startable ? <small>{text(locale, '需要已发布版本', 'Requires a published revision')}</small> : null}</button> : null}
                      <button type="button" role="menuitem" onClick={() => { setMenuId(undefined); onOpenDetail(expert.id) }}><strong>{text(locale, '查看详情', 'View details')}</strong></button>
                    </div> : null}
                  </td>
                </tr>
              }) : null}
            </tbody>
          </table>
        </div>

        {state === 'ready' ? <div className="prototype-automation-footer"><span>{rows.length} {rows.length === 1 ? 'expert' : 'experts'}</span><div><button type="button" disabled>‹</button><span>{text(locale, '第 1 页，共 1 页', 'Page 1 of 1')}</span><button type="button" disabled>›</button><span>{text(locale, '行数', 'Rows')}</span><select disabled aria-label={text(locale, '每页行数', 'Rows per page')}><option>25</option></select></div></div> : null}
      </div>
    </div>
  </main>
}

export function RemoteExpertDetailPage({
  organizationId,
  spaceId,
  expertId,
  auth,
  credentialVersion,
  onOpenNavigation,
  onBack,
  onStartSession,
  sessionCreationEnabled = true,
  canManage = false,
  onEdit,
  navigationCollapsed,
  onOpenCommand,
}: RemoteExpertDetailPageProps) {
  const { locale } = usePreferences()
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => ({
    organizationId,
    spaceId,
    expertId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }), [credentialVersion, expertId, organizationId, requestAuth.requestIdentity, spaceId])
  const load = useCallback(
    (signal: AbortSignal) => getExpert(organizationId, spaceId, expertId, requestAuth, signal),
    [expertId, organizationId, requestAuth, spaceId],
  )
  const detail = useRemoteDetail(identity, load)
  const expert = detail.status === 'ready' ? detail.item : undefined
  const revision = expert?.publishedRevision
  const startable = expert ? canStartExpert(expert) : false

  const description = expert?.description ?? ''
  const longDescription = description.length > 120

  return <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={expert ? `Experts · ${expert.name}` : 'Experts'}
      navigationCollapsed={navigationCollapsed}
      onOpenNavigation={onOpenNavigation}
      onOpenCommand={onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content prototype-expert-detail">
        <button type="button" className="prototype-expert-back" onClick={onBack}>← {text(locale, '全部 Experts', 'All Experts')}</button>

        {detail.status === 'loading' ? <div className="prototype-automation-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '正在加载专家详情…', 'Loading Expert detail…')}</div> : null}
        {detail.status === 'not_found' ? <div className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '未找到专家。', 'Expert not found.')}</span><button type="button" onClick={detail.retry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
        {detail.status === 'error' ? <div className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '无法加载专家详情。', 'Unable to load Expert detail.')}{detail.error ? ` ${detail.error.message}` : ''}</span><button type="button" onClick={detail.retry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}

        {expert ? <>
          <div className="prototype-expert-detail-head">
            <div className="prototype-expert-detail-head-main">
              <div className="prototype-expert-name-line">
                <span className="prototype-expert-tag">{expert.visibility === 'space' ? 'Team' : text(locale, '私有', 'Private')}</span>
                {expert.status !== 'published' ? <span className="prototype-expert-tag">{expert.status}</span> : null}
              </div>
              <h1 className="prototype-expert-detail-title">{expert.name}</h1>
              <p className="prototype-expert-detail-desc">
                {longDescription && !descriptionExpanded ? `${description.slice(0, 120)}…` : description || text(locale, '暂无说明', 'No description')}
                {longDescription ? <button type="button" className="prototype-expert-text-button" onClick={() => setDescriptionExpanded((value) => !value)}>{descriptionExpanded ? text(locale, '收起', 'Show less') : text(locale, '展开', 'Show more')}</button> : null}
              </p>
              <p className="prototype-expert-detail-meta">{text(locale, `更新于 ${formatDate(expert.updatedAt, locale)} · v${expert.version}`, `Updated ${formatDate(expert.updatedAt, locale)} · v${expert.version}`)}</p>
            </div>
            <div className="prototype-expert-detail-actions">
              {canManage && onEdit ? <button type="button" className="prototype-ghost-button" onClick={onEdit}>{text(locale, '编辑', 'Edit')}</button> : null}
              {startable && sessionCreationEnabled ? <button type="button" className="prototype-primary-button" onClick={() => onStartSession(expertId)}>{text(locale, '新建会话', 'New Session')}</button> : null}
            </div>
          </div>

          {revision ? <>
            <div className="prototype-expert-section">
              <div className="prototype-expert-section-intro">
                <h2>System</h2>
                <p>{text(locale, 'Agent 如何思考、在哪里运行、由哪个模型驱动。', 'How the agent thinks, where it runs, and which model powers it.')}</p>
              </div>
              <div className="prototype-expert-section-fields">
                <div className="prototype-expert-field-pair">
                  <div>
                    <span className="prototype-field-label">Environment</span>
                    <p className="prototype-expert-detail-value"><code>{revision.environmentId}</code></p>
                    <p className="prototype-expert-hint">{text(locale, '版本', 'Revision')} <code>{revision.environmentRevisionId}</code></p>
                  </div>
                  <div>
                    <span className="prototype-field-label">{text(locale, '模型', 'Model')}</span>
                    <p className="prototype-expert-detail-value">{revision.model}</p>
                  </div>
                </div>
                <span className="prototype-field-label">{text(locale, '系统提示词', 'System Prompt')}</span>
                <pre className="prototype-expert-detail-prompt">{revision.instructions || text(locale, '未配置指令', 'No instructions configured')}</pre>
              </div>
            </div>

            <div className="prototype-expert-section">
              <div className="prototype-expert-section-intro">
                <h2>{text(locale, '能力', 'Capabilities')}</h2>
                <p>{text(locale, '会话中 Agent 可使用的能力。', 'Capabilities the agent can reach during a session.')}</p>
              </div>
              <div className="prototype-expert-section-fields">
                <div className="prototype-expert-chip-box">
                  {revision.capabilities.length ? revision.capabilities.map((capability) => <span className="prototype-expert-chip" key={capability}>
                    <span className="prototype-expert-chip-icon"><PrototypeHexIcon aria-hidden="true" /></span>{capability}
                  </span>) : <span className="prototype-expert-chip-empty">{text(locale, '未开放任何能力', 'No capabilities granted')}</span>}
                </div>
                <div className="prototype-expert-policy-row">
                  <span><strong>{text(locale, '仓库覆盖', 'Repository override')}</strong></span>
                  <span className="prototype-expert-tag">{revision.allowRepositoryOverride ? text(locale, '允许', 'Allowed') : text(locale, '锁定', 'Locked')}</span>
                </div>
                <div className="prototype-expert-policy-row">
                  <span><strong>{text(locale, '基础分支覆盖', 'Base branch override')}</strong></span>
                  <span className="prototype-expert-tag">{revision.allowBaseBranchOverride ? text(locale, '允许', 'Allowed') : text(locale, '锁定', 'Locked')}</span>
                </div>
              </div>
            </div>

            <div className="prototype-expert-detail-footer">
              {startable && sessionCreationEnabled ? <button type="button" className="prototype-ghost-button" onClick={() => onStartSession(expertId)}>{text(locale, '发起会话', 'Start session')}</button> : null}
            </div>
          </> : <div className="prototype-automation-state">{text(locale, '当前 Expert 没有可用的已发布版本。', 'This Expert has no available published revision.')}</div>}
        </> : null}
      </div>
    </div>
  </main>
}

type ExpertEditorForm = {
  name: string
  description: string
  visibility: 'private' | 'space'
  instructions: string
  model: (typeof SUPPORTED_AGENT_MODELS)[number]
  environmentId: string
  capabilities: string[]
  launchGuidance: string
  allowRepositoryOverride: boolean
  allowBaseBranchOverride: boolean
}

const standardCapabilities = [
  'code-search',
  'read-code',
  'write-code',
  'run-command',
  'git',
  'create-pr',
]

function editableRevision(expert: ExpertDetailDto) {
  return expert.draftRevision ?? expert.publishedRevision
}

const markdownActions = [
  { kind: 'b', label: 'B', title: 'Bold' },
  { kind: 'i', label: 'I', title: 'Italic' },
  { kind: 'h2', label: 'H2', title: 'Heading 2' },
  { kind: 'h3', label: 'H3', title: 'Heading 3' },
  { kind: 'ul', label: '•', title: 'Bullet list' },
  { kind: 'ol', label: '1.', title: 'Numbered list' },
  { kind: 'code', label: '<>', title: 'Code' },
  { kind: 'link', label: '🔗', title: 'Link' },
] as const

function MarkdownToolbar({
  textareaRef,
  value,
  onApply,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onApply: (next: string) => void
}) {
  const apply = (kind: typeof markdownActions[number]['kind']) => {
    const area = textareaRef.current
    const start = area?.selectionStart ?? value.length
    const end = area?.selectionEnd ?? value.length
    const selection = value.slice(start, end) || 'text'
    const wraps: Record<typeof kind, string> = {
      b: `**${selection}**`,
      i: `*${selection}*`,
      h2: `## ${selection}`,
      h3: `### ${selection}`,
      ul: `- ${selection}`,
      ol: `1. ${selection}`,
      code: `\`${selection}\``,
      link: `[${selection}](https://)`,
    }
    onApply(value.slice(0, start) + wraps[kind] + value.slice(end))
    area?.focus()
  }
  return <div className="prototype-md-toolbar" role="toolbar" aria-label="Markdown">
    {markdownActions.map((action) => <button type="button" key={action.kind} className="prototype-md-button" title={action.title} aria-label={action.title} onClick={() => apply(action.kind)}>{action.label}</button>)}
  </div>
}

function formFromExpert(
  environments: EnvironmentSummaryDto[],
  expert?: ExpertDetailDto,
): ExpertEditorForm {
  const revision = expert ? editableRevision(expert) : undefined
  const defaultEnvironment = environments.find((environment) => (
    environment.status === 'ready' && environment.activeRevision !== null
  ))
  const model = SUPPORTED_AGENT_MODELS.find((candidate) => candidate === revision?.model)
    ?? DEFAULT_AGENT_MODEL
  return {
    name: expert?.name ?? '',
    description: expert?.description ?? '',
    visibility: expert?.visibility ?? 'space',
    instructions: revision?.instructions ?? '',
    model,
    environmentId: revision?.environmentId ?? defaultEnvironment?.id ?? '',
    capabilities: revision?.capabilities ?? ['code-search', 'read-code', 'git'],
    launchGuidance: revision?.launchGuidance ?? '',
    allowRepositoryOverride: revision?.allowRepositoryOverride ?? true,
    allowBaseBranchOverride: revision?.allowBaseBranchOverride ?? true,
  }
}

export function RemoteExpertEditorPage({
  organizationId,
  spaceId,
  expertId,
  environments,
  auth,
  credentialVersion,
  onOpenNavigation,
  onBack,
  onCreated,
  onArchived,
  onCatalogChange,
  navigationCollapsed,
  onOpenCommand,
  onOpenAdvisor,
}: RemoteExpertEditorPageProps) {
  const { locale } = usePreferences()
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [addCapabilityOpen, setAddCapabilityOpen] = useState(false)
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => expertId ? ({
    organizationId,
    spaceId,
    expertId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, expertId, organizationId, requestAuth.requestIdentity, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!expertId) throw new Error('No Expert selected.')
    return getExpert(organizationId, spaceId, expertId, requestAuth, signal)
  }, [expertId, organizationId, requestAuth, spaceId])
  const detail = useRemoteDetail(identity, load)
  const [savedExpert, setSavedExpert] = useState<ExpertDetailDto>()
  const expert = savedExpert ?? (detail.status === 'ready' ? detail.item : undefined)
  const formSource = [
    expert?.id ?? 'new',
    expert?.version ?? 0,
    ...environments.map((environment) => `${environment.id}:${environment.activeRevisionId ?? ''}`),
  ].join('\u0000')
  const [formState, setFormState] = useState(() => ({
    source: formSource,
    value: formFromExpert(environments, expert),
  }))
  if (formState.source !== formSource) {
    setFormState({ source: formSource, value: formFromExpert(environments, expert) })
  }
  const form = formState.source === formSource
    ? formState.value
    : formFromExpert(environments, expert)
  const [busy, setBusy] = useState<'save' | 'publish' | 'disable' | 'archive'>()
  const [error, setError] = useState<Error>()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [revisions, setRevisions] = useState<ExpertRevisionListResponse>()

  useEffect(() => {
    if (!expertId) return
    const controller = new AbortController()
    void listExpertRevisions(
      organizationId, spaceId, expertId, requestAuth, controller.signal,
    ).then((response) => {
      if (!controller.signal.aborted) setRevisions(response)
    }, () => undefined)
    return () => controller.abort()
  }, [expertId, expert?.version, organizationId, requestAuth, spaceId])

  const readyEnvironments = environments.filter((environment) => (
    environment.status === 'ready' && environment.activeRevision !== null
  ))
  const selectedEnvironment = readyEnvironments.find((environment) => environment.id === form.environmentId)
  const field = <Key extends keyof ExpertEditorForm>(key: Key, value: ExpertEditorForm[Key]) => {
    setFormState((current) => ({
      source: formSource,
      value: { ...(current.source === formSource ? current.value : form), [key]: value },
    }))
    setError(undefined)
  }
  const toggleCapability = (capability: string) => {
    field('capabilities', form.capabilities.includes(capability)
      ? form.capabilities.filter((item) => item !== capability)
      : [...form.capabilities, capability])
  }
  const capabilityOptions = [...new Set([...standardCapabilities, ...form.capabilities])]
  const valid = form.name.trim().length > 0 && selectedEnvironment?.activeRevision != null

  const persistDraft = async () => {
    if (!selectedEnvironment?.activeRevision) {
      throw new Error(text(locale, '请选择可用的运行环境。', 'Select a Ready Environment.'))
    }
    const input = {
      name: form.name,
      description: form.description,
      visibility: form.visibility,
      instructions: form.instructions,
      model: form.model,
      environmentId: selectedEnvironment.id,
      environmentRevisionId: selectedEnvironment.activeRevision.id,
      allowRepositoryOverride: form.allowRepositoryOverride,
      allowBaseBranchOverride: form.allowBaseBranchOverride,
      capabilities: form.capabilities,
      launchGuidance: form.launchGuidance,
    }
    return expert
      ? updateExpert(organizationId, spaceId, expert.id, input, expert.version, requestAuth)
      : createExpert(
          organizationId,
          spaceId,
          input,
          globalThis.crypto.randomUUID(),
          requestAuth,
        )
  }

  const run = async (
    action: NonNullable<typeof busy>,
    operation: () => Promise<ExpertDetailDto | void>,
  ) => {
    setBusy(action)
    setError(undefined)
    try {
      const result = await operation()
      if (result) setSavedExpert(result)
      onCatalogChange()
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Expert operation failed.'))
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const save = () => void run('save', async () => {
    const created = !expert
    const result = await persistDraft()
    if (created) onCreated(result.id)
    return result
  })

  const publish = () => void run('publish', async () => {
    const created = !expert
    const draft = await persistDraft()
    const result = await publishExpert(
      organizationId,
      spaceId,
      draft.id,
      draft.version,
      globalThis.crypto.randomUUID(),
      requestAuth,
    )
    if (created) onCreated(result.id)
    return result
  })

  const disable = () => {
    if (!expert) return
    void run('disable', () => disableExpert(
      organizationId, spaceId, expert.id, expert.version, requestAuth,
    ))
  }

  const archive = () => {
    if (!expert) return
    void run('archive', async () => {
      await archiveExpert(organizationId, spaceId, expert.id, expert.version, requestAuth)
      onArchived()
    })
  }

  const editorShell = (children: ReactNode) => <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={expert ? text(locale, `Experts · ${expert.name}`, `Experts · ${expert.name}`) : text(locale, 'Experts · 新建', 'Experts · New')}
      navigationCollapsed={navigationCollapsed}
      onOpenNavigation={onOpenNavigation}
      onOpenCommand={onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content prototype-expert-detail">{children}</div>
    </div>
  </main>

  if (expertId && detail.status === 'loading' && !expert) {
    return editorShell(<div className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '加载中…', 'Loading…')}</div>)
  }
  if (expertId && (detail.status === 'error' || detail.status === 'not_found') && !expert) {
    return editorShell(<div className="prototype-automation-state prototype-automation-state--error">
      <span role="alert">{detail.status === 'not_found' ? text(locale, '未找到该 Expert。', 'Expert not found.') : detail.error?.message ?? text(locale, '无法加载 Expert。', 'Unable to load the Expert.')}</span>
      <button type="button" onClick={detail.retry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button>
    </div>)
  }

  const missingCapabilities = capabilityOptions.filter((capability) => !form.capabilities.includes(capability))

  return editorShell(<>
    <button type="button" className="prototype-expert-back" onClick={onBack}>← {text(locale, '全部 Experts', 'All Experts')}</button>

    <div className="prototype-expert-detail-head">
      <div className="prototype-expert-detail-head-main">
        <div className="prototype-expert-name-line">
          <span className="prototype-expert-tag">{form.visibility === 'space' ? 'Team' : text(locale, '私有', 'Private')}</span>
          {expert && expert.status !== 'published' ? <span className="prototype-expert-tag">{expert.status}</span> : null}
        </div>
        <input
          className="prototype-expert-title-input"
          aria-label={text(locale, '名称', 'Name')}
          value={form.name}
          maxLength={160}
          placeholder={text(locale, 'Expert 名称', 'Expert name')}
          onChange={(event) => field('name', event.target.value)}
        />
        <p className="prototype-expert-detail-meta">{expert
          ? text(locale, `更新于 ${formatDate(expert.updatedAt, locale)} · v${expert.version}`, `Updated ${formatDate(expert.updatedAt, locale)} · v${expert.version}`)
          : text(locale, '新的可复用 Expert 配置', 'A new reusable Expert configuration')}</p>
      </div>
      <div className="prototype-expert-detail-actions">
        <button type="button" className="prototype-ghost-button" disabled={!valid || busy !== undefined} onClick={save}>{busy === 'save' ? text(locale, '保存中…', 'Saving…') : text(locale, '保存草稿', 'Save draft')}</button>
        <button type="button" className="prototype-primary-button" disabled={!valid || busy !== undefined} onClick={publish}>{busy === 'publish' ? text(locale, '发布中…', 'Publishing…') : text(locale, '发布', 'Publish')}</button>
      </div>
    </div>

    <button type="button" className="prototype-advisor-banner" disabled={!onOpenAdvisor && !onOpenCommand} onClick={onOpenAdvisor ?? onOpenCommand}>
      <span className="prototype-advisor-mark" aria-hidden="true" />
      <span><strong>{text(locale, '让 Agent 调整这个 Expert →', 'Ask an agent to tune this expert →')}</strong><small>{text(locale, 'Cosmos Advisor Agent 会配置这个 Expert', 'Cosmos Advisor agent configures this expert')}</small></span>
    </button>

    {error ? <div className="prototype-expert-error" role="alert">
      <span><strong>{text(locale, '操作未完成', 'Operation not completed')}</strong> {error.message}</span>
      {error instanceof CosmosApiError && error.status === 412 ? <button type="button" className="prototype-ghost-button" onClick={() => { setSavedExpert(undefined); detail.retry() }}>{text(locale, '重新加载', 'Reload')}</button> : null}
    </div> : null}

    <div className="prototype-expert-lead">
      <label className="prototype-field-label" htmlFor="expert-launch-guidance">{text(locale, '可选占位提示', 'Optional placeholder')}</label>
      <p className="prototype-expert-hint">{text(locale, '选中该 Expert 时显示在首页对话框中的占位提示，留空使用默认值。', 'Optional placeholder shown in the home-page chat box when this expert is selected. Leave empty to use the default.')}</p>
      <textarea id="expert-launch-guidance" className="prototype-field" aria-label={text(locale, '启动提示', 'Launch guidance')} rows={2} maxLength={10000} value={form.launchGuidance} onChange={(event) => field('launchGuidance', event.target.value)} placeholder={text(locale, '告诉我要跟踪或启动什么', 'Tell me what to track or kick off')} />

      <label className="prototype-field-label" htmlFor="expert-description">{text(locale, '用户说明', 'User Instructions')}</label>
      <p className="prototype-expert-hint">{text(locale, '向使用者解释如何使用该 Expert 的 Markdown 说明。', 'Markdown shown to users explaining how to use this expert.')}</p>
      <div className="prototype-md-editor">
        <MarkdownToolbar textareaRef={descriptionRef} value={form.description} onApply={(next) => field('description', next)} />
        <textarea id="expert-description" ref={descriptionRef} className="prototype-field prototype-md-area" aria-label={text(locale, '描述', 'Description')} rows={5} maxLength={2000} value={form.description} onChange={(event) => field('description', event.target.value)} />
      </div>
    </div>

    <div className="prototype-expert-section">
      <div className="prototype-expert-section-intro">
        <h2>System</h2>
        <p>{text(locale, 'Agent 如何思考、在哪里运行、由哪个模型驱动。', 'How the agent thinks, where it runs, and which model powers it.')}</p>
      </div>
      <div className="prototype-expert-section-fields">
        <div className="prototype-expert-field-pair">
          <div>
            <label className="prototype-field-label" htmlFor="expert-environment">Environment</label>
            <p className="prototype-expert-hint">{text(locale, 'Cloud 沙箱或已连接的 Daemon 进程。', 'Cloud sandbox or a connected daemon process.')}</p>
            <select id="expert-environment" className="prototype-field-select" aria-label="Environment" value={form.environmentId} onChange={(event) => field('environmentId', event.target.value)}>
              <option value="" disabled>{text(locale, '选择运行环境', 'Select Environment')}</option>
              {readyEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}
            </select>
          </div>
          <div>
            <label className="prototype-field-label" htmlFor="expert-model">{text(locale, '模型', 'Model')}</label>
            <p className="prototype-expert-hint">{text(locale, '影响质量、速度与额度消耗。', 'Affects quality, speed, and credit usage.')}</p>
            <select id="expert-model" className="prototype-field-select" aria-label={text(locale, '模型', 'Model')} value={form.model} onChange={(event) => field('model', event.target.value as ExpertEditorForm['model'])}>
              {SUPPORTED_AGENT_MODELS.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
          </div>
        </div>
        <label className="prototype-field-label" htmlFor="expert-instructions">{text(locale, '系统提示词', 'System Prompt')}</label>
        <p className="prototype-expert-hint">{text(locale, '支持 Markdown。典型提示词为 50–300 行。', 'Supports Markdown. Typical prompts are 50–300 lines.')}</p>
        <div className="prototype-md-editor">
          <MarkdownToolbar textareaRef={promptRef} value={form.instructions} onApply={(next) => field('instructions', next)} />
          <textarea id="expert-instructions" ref={promptRef} className="prototype-field prototype-md-area prototype-expert-prompt" aria-label={text(locale, '系统指令', 'Instructions')} rows={12} maxLength={100000} value={form.instructions} onChange={(event) => field('instructions', event.target.value)} />
        </div>
      </div>
    </div>

    <div className="prototype-expert-section">
      <div className="prototype-expert-section-intro">
        <h2>{text(locale, '能力', 'Capabilities')}</h2>
        <p>{text(locale, '会话中 Agent 可使用的能力，只开放职责所需。', 'Capabilities the agent can reach during a session. Grant only what the role requires.')}</p>
      </div>
      <div className="prototype-expert-section-fields">
        <div className="prototype-expert-chip-box">
          {form.capabilities.map((capability) => <span className="prototype-expert-chip" key={capability}>
            <span className="prototype-expert-chip-icon"><PrototypeHexIcon aria-hidden="true" /></span>
            {capability}
            <button type="button" className="prototype-expert-chip-x" aria-label={text(locale, `移除 ${capability}`, `Remove ${capability}`)} onClick={() => toggleCapability(capability)}>×</button>
          </span>)}
          {!form.capabilities.length ? <span className="prototype-expert-chip-empty">{text(locale, '未开放任何能力', 'No capabilities granted')}</span> : null}
          {missingCapabilities.length ? <button type="button" className="prototype-expert-chip prototype-expert-chip-add" aria-expanded={addCapabilityOpen} onClick={() => setAddCapabilityOpen((open) => !open)}>+ {text(locale, '添加', 'Add')}</button> : null}
        </div>
        {addCapabilityOpen && missingCapabilities.length ? <div className="prototype-expert-add-menu">
          {missingCapabilities.map((capability) => <button type="button" key={capability} onClick={() => { toggleCapability(capability); setAddCapabilityOpen(false) }}>
            <span className="prototype-expert-chip-icon"><PrototypeHexIcon aria-hidden="true" /></span>{capability}
          </button>)}
        </div> : null}

        <div className="prototype-expert-policy-row">
          <span><strong>{text(locale, '允许仓库覆盖', 'Repository override')}</strong><small>{text(locale, '会话可改用其他 Repository。', 'Sessions may target a different repository.')}</small></span>
          <input type="checkbox" role="switch" aria-label={text(locale, '允许仓库覆盖', 'Repository override')} checked={form.allowRepositoryOverride} onChange={(event) => field('allowRepositoryOverride', event.target.checked)} />
        </div>
        <div className="prototype-expert-policy-row">
          <span><strong>{text(locale, '允许分支覆盖', 'Branch override')}</strong><small>{text(locale, '会话可改用其他基础分支。', 'Sessions may start from a different base branch.')}</small></span>
          <input type="checkbox" role="switch" aria-label={text(locale, '允许分支覆盖', 'Branch override')} checked={form.allowBaseBranchOverride} onChange={(event) => field('allowBaseBranchOverride', event.target.checked)} />
        </div>
      </div>
    </div>

    <div className="prototype-expert-section">
      <div className="prototype-expert-section-intro">
        <h2>{text(locale, '共享', 'Sharing')}</h2>
        <p>{text(locale, '管理谁可以发现并使用这个 Expert。', 'Manage who can discover and use this expert.')}</p>
      </div>
      <div className="prototype-expert-section-fields">
        <select className="prototype-field-select prototype-expert-share-select" aria-label={text(locale, '可见范围', 'Visibility')} value={form.visibility} onChange={(event) => field('visibility', event.target.value as ExpertEditorForm['visibility'])}>
          <option value="space">{text(locale, 'Team · Space 内可见', 'Team — visible to the Space')}</option>
          <option value="private">{text(locale, '私有 · 仅自己可见', 'Private — only you')}</option>
        </select>
      </div>
    </div>

    {expert ? <div className="prototype-expert-section">
      <div className="prototype-expert-section-intro">
        <h2>{text(locale, '版本', 'Revisions')}</h2>
        <p>{text(locale, '已发布版本不可变，Session 固定使用发布时的快照。', 'Published revisions are immutable; sessions pin the published snapshot.')}</p>
      </div>
      <div className="prototype-expert-section-fields">
        <div className="prototype-expert-revisions">
          {revisions?.items.length ? revisions.items.map((revision) => <div key={revision.id}>
            <span><strong>v{revision.revision}</strong><small>{formatDate(revision.createdAt, locale)}</small></span>
            <span className="prototype-expert-tag">{revision.status}</span>
          </div>) : <span className="prototype-expert-chip-empty">{text(locale, '暂无版本记录', 'No revisions yet')}</span>}
        </div>
      </div>
    </div> : null}

    {expert ? <div className="prototype-expert-section prototype-expert-danger-section">
      <div className="prototype-expert-section-intro">
        <h2>{text(locale, '危险区', 'Danger zone')}</h2>
        <p>{text(locale, '这些操作无法撤销。', 'These actions cannot be undone.')}</p>
      </div>
      <div className="prototype-expert-section-fields">
        {expert.publishedRevisionId ? <div className="prototype-expert-danger-row">
          <div>
            <div className="prototype-expert-danger-title">{text(locale, '停用 Expert', 'Disable expert')}</div>
            <p className="prototype-expert-hint">{text(locale, '停用后无法从该 Expert 发起新会话，直到重新发布。', 'New sessions cannot start from this expert until it is published again.')}</p>
          </div>
          <button type="button" className="prototype-expert-danger-button" disabled={busy !== undefined || expert.status === 'disabled'} onClick={disable}>{busy === 'disable' ? text(locale, '停用中…', 'Disabling…') : text(locale, '停用 Expert', 'Disable Expert')}</button>
        </div> : null}
        <div className="prototype-expert-danger-row">
          <div>
            <div className="prototype-expert-danger-title">{text(locale, '归档 Expert', 'Archive expert')}</div>
            <p className="prototype-expert-hint">{text(locale, '归档后引用它的 Trigger 与 Automation 将停止工作。', 'Any triggers or automations that reference it will stop working.')}</p>
          </div>
          {!confirmArchive ? <button type="button" className="prototype-expert-danger-button" disabled={busy !== undefined} onClick={() => setConfirmArchive(true)}>{text(locale, '归档 Expert', 'Archive Expert')}</button> : <div className="prototype-automation-confirm"><span>{text(locale, '确认归档？', 'Archive this Expert?')}</span><button type="button" disabled={busy !== undefined} onClick={() => setConfirmArchive(false)}>{text(locale, '取消', 'Cancel')}</button><button type="button" className="danger" disabled={busy !== undefined} onClick={archive}>{text(locale, '确认归档', 'Archive')}</button></div>}
        </div>
      </div>
    </div> : null}
  </>)
}

export function RemoteEnvironmentsPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  onOpenNavigation,
  canManage = false,
  secrets = [],
  secretsLoading = false,
  secretsError = null,
  onRetrySecrets,
  navigationCollapsed,
  onOpenCommand,
  onOpenAdvisor,
}: RemoteEnvironmentsPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingExisting, setEditingExisting] = useState(false)
  const [busy, setBusy] = useState<'retry' | 'disable' | 'archive'>()
  const [mutationError, setMutationError] = useState<Error>()
  const editorReturnFocusRef = useRef<HTMLElement | null>(null)
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedEnvironmentId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedEnvironmentId ? ({
    organizationId,
    spaceId,
    environmentId: selectedEnvironmentId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedEnvironmentId, spaceId])
  const load = useCallback(
    (signal: AbortSignal) => {
      if (!selectedEnvironmentId) throw new Error('No Environment selected.')
      return getEnvironment(organizationId, spaceId, selectedEnvironmentId, requestAuth, signal)
    },
    [organizationId, requestAuth, selectedEnvironmentId, spaceId],
  )
  const detail = useRemoteDetail(identity, load)
  const environment = detail.status === 'ready' ? detail.item : undefined
  const revisionIdentity = useMemo(() => environment ? ({
    environmentId: environment.id,
    version: environment.version,
    credentialVersion,
  }) : undefined, [credentialVersion, environment])
  const loadRevisions = useCallback((signal: AbortSignal) => {
    if (!environment) throw new Error('No Environment selected.')
    return listEnvironmentRevisions(organizationId, spaceId, environment.id, requestAuth, signal)
  }, [environment, organizationId, requestAuth, spaceId])
  const revisions = useRemoteDetail(revisionIdentity, loadRevisions)

  useEffect(() => {
    if (!environment || !['provisioning', 'updating'].includes(environment.status)) return
    const timer = window.setInterval(() => {
      detail.retry()
      onRetry()
    }, 3_000)
    return () => window.clearInterval(timer)
  }, [detail, environment, onRetry])

  const refreshAfterMutation = useCallback((next: EnvironmentDetailDto) => {
    setSelectedId(next.id)
    detail.retry()
    onRetry()
  }, [detail, onRetry])
  const openEditor = (editing: boolean) => {
    const activeElement = document.activeElement
    editorReturnFocusRef.current = activeElement && 'focus' in activeElement
      ? activeElement as HTMLElement
      : null
    setEditingExisting(editing)
    setEditorOpen(true)
  }
  const closeEditor = () => {
    setEditorOpen(false)
    window.requestAnimationFrame(() => editorReturnFocusRef.current?.focus())
  }

  const runAction = async (action: 'retry' | 'disable' | 'archive') => {
    if (!environment) return
    setBusy(action)
    setMutationError(undefined)
    try {
      const key = crypto.randomUUID()
      const next = action === 'retry'
        ? await retryEnvironment(organizationId, spaceId, environment.id, environment.version, key, requestAuth)
        : action === 'disable'
          ? await disableEnvironment(organizationId, spaceId, environment.id, environment.version, key, requestAuth)
          : await archiveEnvironment(organizationId, spaceId, environment.id, environment.version, key, requestAuth)
      refreshAfterMutation(next)
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error('Environment mutation failed.'))
    } finally {
      setBusy(undefined)
    }
  }

  const rows = items
    .filter((item) => (scope === 'mine' ? item.visibility === 'private' : true))
    .filter((item) => {
      const normalized = query.trim().toLowerCase()
      if (!normalized) return true
      return item.name.toLowerCase().includes(normalized)
        || item.description.toLowerCase().includes(normalized)
        || (item.activeRevision?.defaultRepository.repository ?? '').toLowerCase().includes(normalized)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const allChecked = rows.length > 0 && rows.every((item) => checkedIds.has(item.id))
  const toggleAllChecked = () => setCheckedIds(allChecked ? new Set() : new Set(rows.map((item) => item.id)))
  const toggleChecked = (environmentId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(environmentId)) next.delete(environmentId)
      else next.add(environmentId)
      return next
    })
  }
  const environmentStatusLabel = (status: EnvironmentStatus) => {
    if (status === 'ready') return text(locale, '就绪', 'Ready')
    if (status === 'provisioning') return text(locale, '配置中', 'Provisioning')
    if (status === 'updating') return text(locale, '更新中', 'Updating')
    if (status === 'failed') return text(locale, '失败', 'Failed')
    if (status === 'disabled') return text(locale, '已停用', 'Disabled')
    return text(locale, '已归档', 'Archived')
  }

  return <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={text(locale, '配置 · Environments', 'Configuration · Environments')}
      navigationCollapsed={navigationCollapsed}
      onOpenNavigation={onOpenNavigation}
      onOpenCommand={onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content prototype-expert-content">
        <div className="prototype-automation-header">
          <div>
            <h1>Environments</h1>
            <p>{text(locale,
              'Environment 是带有预装工具、依赖和仓库的可复用运行环境快照，每个会话都在其中运行。Daemon pool 将本地运行的 daemon 分组，会话可以指向特定 daemon。',
              'An environment is a reusable VM snapshot with pre-installed tools, packages, and repositories. Each session runs inside one. Daemon pools group locally-running daemons so sessions can target a specific daemon.')}</p>
          </div>
          {canManage ? <button type="button" className="prototype-primary-button" onClick={() => openEditor(false)}>{text(locale, '创建环境', 'Create an environment')}</button> : null}
        </div>

        <button type="button" className="prototype-advisor-banner" disabled={!onOpenAdvisor && !onOpenCommand} onClick={onOpenAdvisor ?? onOpenCommand}>
          <span className="prototype-advisor-mark" aria-hidden="true" />
          <span><strong>{text(locale, '描述你的环境，让 Agent 为你完成配置 →', 'Describe your environment and an agent will set it up →')}</strong><small>{text(locale, 'Cosmos Advisor Agent 会配置这个环境', 'Cosmos Advisor agent configures the environment')}</small></span>
        </button>

        <div className="prototype-automation-toolbar">
          <div className="prototype-segmented" aria-label={text(locale, '环境范围', 'Environment scope')}>
            <button type="button" className={scope === 'mine' ? 'active' : ''} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>{text(locale, '我的', 'Mine')}</button>
            <button type="button" className={scope === 'all' ? 'active' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{text(locale, '全部', 'All')}</button>
          </div>
          <label className="prototype-automation-search"><PrototypeSearchIcon aria-hidden="true" /><span className="sr-only">{text(locale, '搜索环境', 'Search environments')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(locale, '搜索环境…', 'Search environments…')} /></label>
        </div>

        <div className="prototype-automation-table-wrap">
          <table className="prototype-automation-table prototype-expert-table prototype-environment-table">
            <thead><tr>
              <th className="col-check"><input type="checkbox" checked={allChecked} disabled={!rows.length} aria-label={text(locale, '选择全部环境', 'Select all environments')} onChange={toggleAllChecked} /></th>
              <th>{text(locale, '名称', 'Name')} <span className="sort-icon">↑</span></th>
              <th className="col-status">{text(locale, '状态', 'Status')}</th>
              <th className="col-repo">{text(locale, '仓库', 'Repos')}</th>
              <th>{text(locale, '构建时间', 'Last built')}</th>
              <th className="col-menu"><span className="sr-only">{text(locale, '操作', 'Actions')}</span></th>
            </tr></thead>
            <tbody>
              {state === 'loading' ? <tr><td colSpan={6} className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '加载中…', 'Loading…')}</td></tr> : null}
              {state === 'error' ? <tr><td colSpan={6} className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '无法加载运行环境。', 'Unable to load Environments.')}{error ? ` ${error.message}` : ''}</span><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></td></tr> : null}
              {state === 'ready' && !rows.length ? <tr><td colSpan={6} className="prototype-automation-state">{query || scope === 'mine' ? text(locale, '没有匹配的环境', 'No environments match') : text(locale, '当前 Space 尚无运行环境。', 'No Environments exist in this Space yet.')}</td></tr> : null}
              {state === 'ready' ? rows.map((item) => {
                const repository = item.activeRevision?.defaultRepository.repository
                return <tr key={item.id} className={item.id === selectedEnvironmentId ? 'expanded' : ''} onClick={() => setSelectedId(item.id)}>
                  <td className="col-check" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={checkedIds.has(item.id)} aria-label={text(locale, `选择 ${item.name}`, `Select ${item.name}`)} onChange={() => toggleChecked(item.id)} />
                  </td>
                  <td className="col-name">
                    <div className="prototype-expert-name-cell">
                      <span className="prototype-automation-expert-icon" title={item.type === 'daemon' ? 'Daemon' : 'Cloud'}>{item.type === 'daemon' ? <PrototypeDaemonIcon aria-hidden="true" /> : <PrototypeCloudIcon aria-hidden="true" />}</span>
                      <div className="prototype-expert-name-body">
                        <div className="prototype-expert-name-line">
                          <strong>{item.name}</strong>
                          {item.visibility === 'space' ? <span className="prototype-expert-tag">shared</span> : null}
                        </div>
                        {item.description ? <div className="prototype-expert-desc-line">{item.description}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="col-status"><span className={`prototype-environment-status prototype-environment-status--${item.status}`}>{environmentStatusLabel(item.status)}</span></td>
                  <td className="col-repo">{repository ? <span className="prototype-environment-repo-pill">{repository}</span> : <span className="muted">—</span>}</td>
                  <td className="muted">{item.activeRevision ? formatDate(item.activeRevision.createdAt, locale) : '—'}</td>
                  <td className="col-menu" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="icon-btn prototype-automation-more" aria-label={text(locale, `查看 ${item.name}`, `Open ${item.name}`)} onClick={() => setSelectedId(item.id)}>⋯</button>
                  </td>
                </tr>
              }) : null}
            </tbody>
          </table>
        </div>

        {state === 'ready' ? <div className="prototype-automation-footer"><span>{rows.length} {rows.length === 1 ? 'environment' : 'environments'}</span><div><button type="button" disabled>‹</button><span>{text(locale, '第 1 页，共 1 页', 'Page 1 of 1')}</span><button type="button" disabled>›</button><span>{text(locale, '行数', 'Rows')}</span><select disabled aria-label={text(locale, '每页行数', 'Rows per page')}><option>25</option></select></div></div> : null}

        {state === 'ready' && (items.length > 0 || editorOpen) ? <section className="prototype-environment-detail-panel" aria-label={text(locale, '运行环境详情', 'Environment detail')}>
          {editorOpen ? <EnvironmentEditor
            environment={editingExisting ? environment : undefined}
            organizationId={organizationId}
            spaceId={spaceId}
            auth={requestAuth}
            secrets={secrets}
            secretsLoading={secretsLoading}
            secretsError={secretsError}
            onRetrySecrets={onRetrySecrets}
            onCancel={closeEditor}
            onSaved={(next) => { closeEditor(); refreshAfterMutation(next) }}
          /> : null}
          {!editorOpen ? <>
          {detail.status === 'loading' ? <div className="prototype-automation-state" role="status"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '正在加载运行环境详情…', 'Loading Environment detail…')}</div> : null}
          {detail.status === 'not_found' ? <div className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '未找到运行环境。', 'Environment not found.')}</span><button type="button" onClick={detail.retry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
          {detail.status === 'error' ? <div className="prototype-automation-state prototype-automation-state--error"><span role="alert">{text(locale, '无法加载运行环境详情。', 'Unable to load Environment detail.')}{detail.error ? ` ${detail.error.message}` : ''}</span><button type="button" onClick={detail.retry}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
          {environment ? <EnvironmentDetail
            environment={environment}
            revisions={revisions.status === 'ready' ? revisions.item?.items ?? [] : []}
            canManage={canManage}
            busy={busy}
            error={mutationError}
            onEdit={() => openEditor(true)}
            onRetry={() => void runAction('retry')}
            onDisable={() => void runAction('disable')}
            onArchive={() => void runAction('archive')}
          /> : null}
          </> : null}
        </section> : null}
      </div>
    </div>
  </main>
}

type EnvironmentEditorState = {
  type: 'cloud' | 'daemon'
  name: string
  description: string
  visibility: 'private' | 'space'
  image: string
  repositories: Array<{ repositoryId: string; repository: string; baseBranch: string; isDefault: boolean }>
  variables: Array<{ name: string; secretId: string }>
  hooks: Array<{ phase: 'setup' | 'start' | 'stop'; command: string; timeoutSeconds: number }>
  networkMode: 'restricted' | 'allowlist' | 'unrestricted'
  allowedHosts: string[]
  daemonPoolId: string
}

function editorState(environment?: EnvironmentDetailDto): EnvironmentEditorState {
  const revision = environment?.latestRevision
  return {
    type: environment?.type ?? 'cloud',
    name: environment?.name ?? '',
    description: environment?.description ?? '',
    visibility: environment?.visibility ?? 'space',
    image: revision?.image ?? '',
    repositories: revision?.repositoryBindings.map((binding) => ({ ...binding }))
      ?? [{ repositoryId: '', repository: '', baseBranch: 'main', isDefault: true }],
    variables: revision?.variableReferences.map((reference) => ({ ...reference })) ?? [],
    hooks: revision?.hooks.map((hook) => ({ ...hook })) ?? [],
    networkMode: revision?.networkPolicy.mode ?? 'restricted',
    allowedHosts: revision?.networkPolicy.allowedHosts.slice() ?? [],
    daemonPoolId: revision?.daemonPoolId ?? '',
  }
}

function EnvironmentEditor({
  environment,
  organizationId,
  spaceId,
  auth,
  secrets,
  secretsLoading,
  secretsError,
  onRetrySecrets,
  onCancel,
  onSaved,
}: {
  environment?: EnvironmentDetailDto
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  secrets: SecretDto[]
  secretsLoading: boolean
  secretsError: Error | null
  onRetrySecrets?: () => void
  onCancel: () => void
  onSaved: (environment: EnvironmentDetailDto) => void
}) {
  const { locale } = usePreferences()
  const [state, setState] = useState(() => editorState(environment))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error>()
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameInputRef.current?.focus() }, [])
  const patchState = <Key extends keyof EnvironmentEditorState>(key: Key, value: EnvironmentEditorState[Key]) => {
    setError(undefined)
    setState((current) => ({ ...current, [key]: value }))
  }
  const fieldErrors = error instanceof CosmosApiError ? error.fieldErrors : undefined
  // Backend keys variable-reference validation errors as `variableReferences.<index>.secretId`
  // (ENVIRONMENT_SECRET_REFERENCE_INVALID). Map each back to its row so the invalid Secret
  // <select> is flagged inline instead of only surfacing in the summary.
  const variableSecretErrors = useMemo(() => {
    const byRow = new Map<number, string[]>()
    if (!fieldErrors) return byRow
    for (const [path, messages] of Object.entries(fieldErrors)) {
      const match = /^variableReferences\.(\d+)\.secretId$/.exec(path)
      if (match) byRow.set(Number(match[1]), messages)
    }
    return byRow
  }, [fieldErrors])
  // Selectable Secrets must be active AND belong to the current Space. The catalog already
  // scopes to the active Space, but guard on spaceId so a stale cross-Space item cannot leak in.
  const selectableSecrets = useMemo(
    () => secrets.filter((secret) => secret.status === 'active' && secret.spaceId === spaceId),
    [secrets, spaceId],
  )
  const hasUnresolvedSecretReference = state.variables.some((reference) => (
    !selectableSecrets.some((secret) => secret.id === reference.secretId)
  ))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    const input: CreateEnvironmentRequestInput = {
      type: state.type,
      name: state.name,
      description: state.description,
      visibility: state.visibility,
      image: state.image,
      repositoryBindings: state.repositories,
      variableReferences: state.variables,
      hooks: state.hooks,
      networkPolicy: {
        mode: state.networkMode,
        allowedHosts: state.networkMode === 'allowlist' ? state.allowedHosts.filter(Boolean) : [],
      },
      sharing: state.visibility,
      daemonPoolId: state.type === 'daemon' ? state.daemonPoolId : null,
    }
    try {
      let next: EnvironmentDetailDto
      if (environment) {
        const update = {
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          image: input.image,
          repositoryBindings: input.repositoryBindings,
          variableReferences: input.variableReferences,
          hooks: input.hooks,
          networkPolicy: input.networkPolicy,
          sharing: input.sharing,
          daemonPoolId: input.daemonPoolId,
        }
        next = await updateEnvironment(
          organizationId, spaceId, environment.id, update,
          environment.version, crypto.randomUUID(), auth,
        )
      } else {
        next = await createEnvironment(organizationId, spaceId, input, crypto.randomUUID(), auth)
      }
      onSaved(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Environment could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return <form className="remote-environment-editor" aria-busy={saving} onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onCancel() }} onSubmit={(event) => void submit(event)}>
    <header><div><span>{environment ? text(locale, '新配置版本', 'New configuration revision') : text(locale, '新环境', 'New Environment')}</span><h2>{environment ? environment.name : text(locale, '创建运行环境', 'Create Environment')}</h2></div><IconButton icon={X} label={text(locale, '关闭编辑器', 'Close editor')} disabled={saving} onClick={onCancel} /></header>
    {error ? <InlineError error={error} excludeFieldPrefixes={['variableReferences.']} /> : null}
    <fieldset className="remote-environment-editor__fields" disabled={saving}>
    <div className="remote-environment-form-grid">
      <label><span>{text(locale, '类型', 'Type')}</span><select value={state.type} disabled={Boolean(environment)} onChange={(event) => patchState('type', event.target.value as EnvironmentEditorState['type'])}><option value="cloud">Cloud</option><option value="daemon">Self-hosted / Daemon</option></select></label>
      <label><span>{text(locale, '名称', 'Name')}</span><input ref={nameInputRef} required maxLength={160} value={state.name} onChange={(event) => patchState('name', event.target.value)} /></label>
      <label className="remote-environment-form-wide"><span>{text(locale, '说明', 'Description')}</span><textarea maxLength={10_000} value={state.description} onChange={(event) => patchState('description', event.target.value)} /></label>
      <label><span>{text(locale, '共享范围', 'Sharing')}</span><select value={state.visibility} onChange={(event) => patchState('visibility', event.target.value as EnvironmentEditorState['visibility'])}><option value="space">Space</option><option value="private">Private</option></select></label>
      <label><span>{text(locale, '镜像', 'Image')}</span><input required maxLength={1_000} value={state.image} onChange={(event) => patchState('image', event.target.value)} /></label>
      {state.type === 'daemon' ? <label className="remote-environment-form-wide"><span>{text(locale, 'Daemon Pool ID', 'Daemon pool ID')}</span><input required value={state.daemonPoolId} onChange={(event) => patchState('daemonPoolId', event.target.value)} /></label> : null}
    </div>
    <EnvironmentArrayEditor
      title={text(locale, '仓库绑定', 'Repository bindings')}
      rows={state.repositories}
      onAdd={() => patchState('repositories', [...state.repositories, { repositoryId: '', repository: '', baseBranch: 'main', isDefault: false }])}
      onRemove={(index) => patchState('repositories', state.repositories.filter((_, rowIndex) => rowIndex !== index))}
      render={(row, index) => <>
        <input required aria-label={text(locale, '仓库 ID', 'Repository ID')} value={row.repositoryId} onChange={(event) => patchState('repositories', state.repositories.map((item, rowIndex) => rowIndex === index ? { ...item, repositoryId: event.target.value } : item))} />
        <input required aria-label={text(locale, '仓库', 'Repository')} value={row.repository} onChange={(event) => patchState('repositories', state.repositories.map((item, rowIndex) => rowIndex === index ? { ...item, repository: event.target.value } : item))} />
        <input required aria-label={text(locale, '基础分支', 'Base branch')} value={row.baseBranch} onChange={(event) => patchState('repositories', state.repositories.map((item, rowIndex) => rowIndex === index ? { ...item, baseBranch: event.target.value } : item))} />
        <label className="remote-environment-check"><input type="radio" name="default-repository" checked={row.isDefault} onChange={() => patchState('repositories', state.repositories.map((item, rowIndex) => ({ ...item, isDefault: rowIndex === index })))} /><span>{text(locale, '默认', 'Default')}</span></label>
      </>}
    />
    <EnvironmentArrayEditor
      title={text(locale, '变量引用', 'Variable references')}
      rows={state.variables}
      addDisabled={secretsLoading || secretsError !== null || selectableSecrets.length === 0}
      onAdd={() => patchState('variables', [...state.variables, { name: '', secretId: '' }])}
      onRemove={(index) => patchState('variables', state.variables.filter((_, rowIndex) => rowIndex !== index))}
      notice={secretsLoading ? <div className="remote-environment-array__notice" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" /><span>{text(locale, '正在加载 Secret…', 'Loading Secrets…')}</span></div> : secretsError ? <div className="remote-environment-array__notice remote-environment-array__notice--error" role="alert"><AlertTriangle aria-hidden="true" /><span>{text(locale, '无法加载 Secret Catalog。', 'Unable to load the Secret Catalog.')}</span>{onRetrySecrets ? <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onRetrySecrets}>{text(locale, '重试', 'Retry')}</button> : null}</div> : undefined}
      empty={!secretsLoading && !secretsError ? <div className="remote-environment-array__empty"><KeyRound aria-hidden="true" /><span><strong>{text(locale, '暂无变量引用', 'No variable references')}</strong><small>{selectableSecrets.length === 0 ? text(locale, '当前 Space 没有可用的 active Secret。', 'No active Secrets are available in this Space.') : text(locale, '仅在运行环境确实需要时添加 Secret。', 'Add a Secret only when the runtime requires it.')}</small></span></div> : undefined}
      render={(row, index) => {
        const rowErrors = variableSecretErrors.get(index)
        const unavailable = row.secretId !== '' && !selectableSecrets.some((secret) => secret.id === row.secretId)
        const errorId = rowErrors || unavailable ? `variable-secret-error-${index}` : undefined
        return <>
          <input required aria-label={text(locale, '变量名', 'Variable name')} value={row.name} onChange={(event) => patchState('variables', state.variables.map((item, rowIndex) => rowIndex === index ? { ...item, name: event.target.value } : item))} />
          <select required aria-label="Secret reference" aria-invalid={rowErrors || unavailable ? true : undefined} aria-describedby={errorId} className={rowErrors || unavailable ? 'remote-environment-array__field--invalid' : undefined} value={row.secretId} disabled={(secretsLoading || secretsError !== null || selectableSecrets.length === 0) && row.secretId === ''} onChange={(event) => patchState('variables', state.variables.map((item, rowIndex) => rowIndex === index ? { ...item, secretId: event.target.value } : item))}>
            <option value="" disabled>{text(locale, '选择 Secret…', 'Select a secret…')}</option>
            {selectableSecrets.map((secret) => <option key={secret.id} value={secret.id}>{secret.name}</option>)}
            {row.secretId && !selectableSecrets.some((secret) => secret.id === row.secretId) ? <option value={row.secretId}>{text(locale, `不可用的 Secret · ${row.secretId}`, `Unavailable Secret · ${row.secretId}`)}</option> : null}
          </select>
          {rowErrors ? <p id={errorId} className="remote-environment-array__field-error" role="alert">{rowErrors.join('; ')}</p> : unavailable ? <p id={errorId} className="remote-environment-array__field-error" role="alert">{text(locale, '此 Secret 已不可用。请选择当前 Space 的 active Secret，或删除该变量引用。', 'This Secret is unavailable. Select an active Secret in this Space or remove the variable reference.')}</p> : null}
        </>
      }}
    />
    <EnvironmentArrayEditor
      title="Hooks"
      rows={state.hooks}
      onAdd={() => patchState('hooks', [...state.hooks, { phase: 'setup', command: '', timeoutSeconds: 300 }])}
      onRemove={(index) => patchState('hooks', state.hooks.filter((_, rowIndex) => rowIndex !== index))}
      render={(row, index) => <>
        <select aria-label={text(locale, '阶段', 'Phase')} value={row.phase} onChange={(event) => patchState('hooks', state.hooks.map((item, rowIndex) => rowIndex === index ? { ...item, phase: event.target.value as typeof row.phase } : item))}><option value="setup">setup</option><option value="start">start</option><option value="stop">stop</option></select>
        <input required aria-label={text(locale, '命令', 'Command')} value={row.command} onChange={(event) => patchState('hooks', state.hooks.map((item, rowIndex) => rowIndex === index ? { ...item, command: event.target.value } : item))} />
        <input required type="number" min={1} max={3600} aria-label={text(locale, '超时秒数', 'Timeout seconds')} value={row.timeoutSeconds} onChange={(event) => patchState('hooks', state.hooks.map((item, rowIndex) => rowIndex === index ? { ...item, timeoutSeconds: Number(event.target.value) } : item))} />
      </>}
    />
    <section className="remote-environment-network"><header><h3>{text(locale, '网络策略', 'Network policy')}</h3></header><select value={state.networkMode} onChange={(event) => patchState('networkMode', event.target.value as EnvironmentEditorState['networkMode'])}><option value="restricted">restricted</option><option value="allowlist">allowlist</option><option value="unrestricted">unrestricted</option></select>{state.networkMode === 'allowlist' ? <EnvironmentArrayEditor title={text(locale, '允许主机', 'Allowed hosts')} rows={state.allowedHosts} onAdd={() => patchState('allowedHosts', [...state.allowedHosts, ''])} onRemove={(index) => patchState('allowedHosts', state.allowedHosts.filter((_, rowIndex) => rowIndex !== index))} render={(host, index) => <input required aria-label={text(locale, '主机名', 'Host')} value={host} onChange={(event) => patchState('allowedHosts', state.allowedHosts.map((item, rowIndex) => rowIndex === index ? event.target.value : item))} />} /> : null}</section>
    </fieldset>
    <footer><button type="button" className="cosmos-button cosmos-button--secondary" disabled={saving} onClick={onCancel}>{text(locale, '取消', 'Cancel')}</button><button type="submit" className="cosmos-button cosmos-button--primary" disabled={saving || hasUnresolvedSecretReference}><Save aria-hidden="true" />{saving ? text(locale, '保存中…', 'Saving…') : text(locale, '保存并配置', 'Save and provision')}</button></footer>
  </form>
}

function EnvironmentArrayEditor<Row>({ title, rows, onAdd, onRemove, render, empty, notice, addDisabled = false }: {
  title: string
  rows: Row[]
  onAdd: () => void
  onRemove: (index: number) => void
  render: (row: Row, index: number) => ReactNode
  empty?: ReactNode
  notice?: ReactNode
  addDisabled?: boolean
}) {
  const { locale } = usePreferences()
  return <section className="remote-environment-array"><header><h3>{title}</h3><IconButton icon={Plus} label={`${text(locale, '添加', 'Add')} ${title}`} disabled={addDisabled} onClick={onAdd} /></header>{notice}{rows.length === 0 ? empty : null}{rows.map((row, index) => <div className="remote-environment-array__row" key={index}>{render(row, index)}<IconButton icon={Trash2} label={`${text(locale, '删除', 'Remove')} ${title}`} onClick={() => onRemove(index)} /></div>)}</section>
}

function InlineError({ error, excludeFieldPrefixes = [] }: { error: Error; excludeFieldPrefixes?: string[] }) {
  const { locale } = usePreferences()
  const fieldErrors = error instanceof CosmosApiError ? error.fieldErrors : undefined
  const fieldEntries = fieldErrors
    ? Object.entries(fieldErrors).filter(([field]) => !excludeFieldPrefixes.some((prefix) => field.startsWith(prefix)))
    : []
  return <div className="remote-expert-editor__error" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>{text(locale, '操作未完成', 'Operation not completed')}</strong><small>{error.message}</small>{fieldEntries.length > 0 ? <ul className="remote-expert-editor__field-errors">{fieldEntries.map(([field, messages]) => <li key={field}><code>{field}</code><span>{messages.join('; ')}</span></li>)}</ul> : null}</span></div>
}

function EnvironmentDetail({
  environment,
  revisions,
  canManage,
  busy,
  error,
  onEdit,
  onRetry,
  onDisable,
  onArchive,
}: {
  environment: EnvironmentDetailDto
  revisions: EnvironmentRevisionDto[]
  canManage: boolean
  busy?: 'retry' | 'disable' | 'archive'
  error?: Error
  onEdit: () => void
  onRetry: () => void
  onDisable: () => void
  onArchive: () => void
}) {
  const { locale } = usePreferences()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const revision = environment.activeRevision
  const latest = environment.latestRevision
  return (
    <>
      <header className="remote-detail-panel__identity">
        <span className="cosmos-resource-row__icon"><Container aria-hidden="true" /></span>
        <div><h2>{environment.name}</h2><p>{environment.description || text(locale, '暂无说明', 'No description')}</p></div>
        <StatusLabel status={environment.status} />
      </header>
      <dl className="remote-detail-specs remote-detail-specs--environment">
        <div><dt>{text(locale, '资源版本', 'Resource version')}</dt><dd>v{environment.version}</dd></div>
        <div><dt>{text(locale, '活动版本', 'Active revision')}</dt><dd>{revision ? `v${revision.revision}` : '—'}</dd></div>
        <div><dt>{text(locale, '更新时间', 'Updated')}</dt><dd>{formatDate(environment.updatedAt, locale)}</dd></div>
        <div><dt>{text(locale, '类型', 'Type')}</dt><dd>{environment.type === 'cloud' ? 'Cloud' : 'Self-hosted / Daemon'}</dd></div>
      </dl>
      {error ? <InlineError error={error} /> : null}
      {environment.provisioning ? <section className="remote-detail-section remote-environment-provisioning"><header><ListRestart aria-hidden="true" /><h3>{text(locale, '配置状态', 'Provisioning')}</h3></header><div className="remote-environment-progress"><span style={{ width: `${environment.provisioning.progress}%` }} /></div><dl className="remote-detail-list"><div><dt>{text(locale, '阶段', 'Phase')}</dt><dd>{environment.provisioning.phase}</dd></div><div><dt>{text(locale, '尝试', 'Attempt')}</dt><dd>{environment.provisioning.attempt}/{environment.provisioning.maxAttempts}</dd></div>{environment.provisioning.error ? <div><dt>{text(locale, '错误', 'Error')}</dt><dd>{environment.provisioning.error.message}</dd></div> : null}</dl></section> : null}
      {revision ? (
        <>
          <section className="remote-detail-section">
            <header><ServerCog aria-hidden="true" /><h3>{text(locale, '默认仓库', 'Default repository')}</h3></header>
            <dl className="remote-detail-list">
              <div><dt>{text(locale, '默认仓库', 'Default repository')}</dt><dd><code>{revision.defaultRepository.repository}</code></dd></div>
              <div><dt>{text(locale, '基础分支', 'Base branch')}</dt><dd><GitBranch aria-hidden="true" />{revision.defaultRepository.baseBranch}</dd></div>
            </dl>
          </section>
          <section className="remote-detail-section">
            <header><GitBranch aria-hidden="true" /><h3>{text(locale, '仓库绑定', 'Repository bindings')}</h3></header>
            <div className="remote-repository-list">
              {revision.repositoryBindings.map((binding) => (
                <div key={binding.repositoryId}>
                  <span><strong>{binding.repository}</strong><small>{binding.repositoryId}</small></span>
                  <code>{binding.baseBranch}</code>
                  {binding.isDefault ? <span className="remote-default-label">{text(locale, '默认', 'Default')}</span> : null}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{text(locale, '当前 Environment 没有活动版本。', 'This Environment has no active revision.')}</div>
      )}
      <section className="remote-detail-section"><header><ShieldCheck aria-hidden="true" /><h3>{text(locale, '配置', 'Configuration')}</h3></header><dl className="remote-detail-list"><div><dt>{text(locale, '最新版本', 'Latest revision')}</dt><dd>v{latest.revision} · {latest.status}</dd></div><div><dt>{text(locale, '镜像', 'Image')}</dt><dd><code>{latest.image}</code></dd></div><div><dt>{text(locale, '网络', 'Network')}</dt><dd>{latest.networkPolicy.mode}</dd></div><div><dt>{text(locale, '变量引用', 'Variable references')}</dt><dd>{latest.variableReferences.length}</dd></div><div><dt>Hooks</dt><dd>{latest.hooks.length}</dd></div></dl></section>
      {revisions.length > 0 ? <section className="remote-detail-section"><header><History aria-hidden="true" /><h3>{text(locale, '配置版本', 'Configuration revisions')}</h3></header><div className="remote-expert-revisions">{revisions.map((item, index) => { const previous = revisions[index + 1]; const changes = previous ? ['image', 'repositoryBindings', 'variableReferences', 'hooks', 'networkPolicy', 'sharing', 'daemonPoolId'].filter((field) => JSON.stringify(item[field as keyof EnvironmentRevisionDto]) !== JSON.stringify(previous[field as keyof EnvironmentRevisionDto])) : []; return <div key={item.id}><span><strong>v{item.revision}</strong><small>{changes.length ? changes.join(', ') : text(locale, '初始配置', 'Initial configuration')}</small></span><StatusLabel status={item.status} /></div> })}</div></section> : null}
      {canManage && environment.status !== 'archived' ? <div className="remote-environment-actions"><button type="button" className="cosmos-button cosmos-button--secondary" disabled={Boolean(busy) || ['provisioning', 'updating'].includes(environment.status)} onClick={onEdit}><Pencil aria-hidden="true" />{text(locale, '新建配置版本', 'New revision')}</button>{environment.status === 'failed' ? <button type="button" className="cosmos-button cosmos-button--primary" disabled={Boolean(busy)} onClick={onRetry}><RefreshCw aria-hidden="true" />{busy === 'retry' ? text(locale, '重试中…', 'Retrying…') : text(locale, '重试', 'Retry')}</button> : null}<button type="button" className="cosmos-button cosmos-button--secondary" disabled={Boolean(busy) || environment.status === 'disabled'} onClick={onDisable}><Power aria-hidden="true" />{busy === 'disable' ? text(locale, '停用中…', 'Disabling…') : text(locale, '停用', 'Disable')}</button>{confirmArchive ? <><button type="button" className="cosmos-button cosmos-button--secondary" disabled={Boolean(busy)} onClick={() => setConfirmArchive(false)}>{text(locale, '取消', 'Cancel')}</button><button type="button" className="cosmos-button cosmos-button--ghost remote-expert-danger" disabled={Boolean(busy)} onClick={onArchive}><Trash2 aria-hidden="true" />{busy === 'archive' ? text(locale, '归档中…', 'Archiving…') : text(locale, '确认归档', 'Confirm archive')}</button></> : <button type="button" className="cosmos-button cosmos-button--ghost remote-expert-danger" disabled={Boolean(busy)} onClick={() => setConfirmArchive(true)}><Trash2 aria-hidden="true" />{text(locale, '归档', 'Archive')}</button>}</div> : null}
      <footer className="remote-detail-footer"><Clock3 aria-hidden="true" />{text(locale, '创建于', 'Created')} {formatDate(environment.createdAt, locale)}</footer>
    </>
  )
}

function RepositoryStatusLabel({ status }: { status: RepositoryDto['connectionStatus'] }) {
  const { locale } = usePreferences()
  const map: Record<RepositoryDto['connectionStatus'], { label: string; tone: string }> = {
    connected: { label: text(locale, '已连接', 'Connected'), tone: 'ok' },
    action_required: { label: text(locale, '需处理', 'Action required'), tone: 'warn' },
    archived: { label: text(locale, '已归档', 'Archived'), tone: 'muted' },
  }
  const entry = map[status]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

export function RemoteRepositoriesPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  onOpenNavigation,
}: RemoteRepositoriesPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedRepositoryId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedRepositoryId ? ({
    organizationId,
    spaceId,
    repositoryId: selectedRepositoryId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedRepositoryId, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!selectedRepositoryId) throw new Error('No Repository selected.')
    return getRepository(organizationId, spaceId, selectedRepositoryId, requestAuth, signal)
  }, [organizationId, requestAuth, selectedRepositoryId, spaceId])
  const detail = useRemoteDetail(identity, load)
  const repository = detail.status === 'ready' ? detail.item : selectedSummary

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={FolderGit2}
        title={text(locale, '代码仓库', 'Repositories')}
        description={text(locale, '当前 Space 中由服务端管理的仓库连接', 'Server-managed repository connections in this Space')}
        onOpenNavigation={onOpenNavigation}
        readOnly
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, '代码仓库', 'Repositories')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, '代码仓库', 'Repositories')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><FolderGit2 aria-hidden="true" /><strong>{text(locale, '暂无仓库', 'No Repositories')}</strong><p>{text(locale, '通过 Integrations 连接 GitHub 或 GitLab 后，仓库会显示在这里。', 'Connect GitHub or GitLab from Integrations and repositories will appear here.')}</p></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, '仓库列表', 'Repository list')}>
              <header className="cosmos-section-heading">
                <div><span>Catalog</span><h2>{text(locale, `${items.length} 个仓库`, `${items.length} Repositories`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新仓库列表', 'Refresh Repository list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedRepositoryId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedRepositoryId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><FolderGit2 aria-hidden="true" /></span>
                  <span><strong>{item.fullName}</strong><small>{item.provider}</small></span>
                  <RepositoryStatusLabel status={item.connectionStatus} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, '仓库详情', 'Repository detail')}>
              {repository ? (
                <>
                  <header className="cosmos-section-heading">
                    <div><span>{repository.provider}</span><h2>{repository.fullName}</h2></div>
                    <RepositoryStatusLabel status={repository.connectionStatus} />
                  </header>
                  <section className="remote-detail-section">
                    <header><GitBranch aria-hidden="true" /><h3>{text(locale, '配置', 'Configuration')}</h3></header>
                    <dl className="remote-detail-list">
                      <div><dt>{text(locale, '默认分支', 'Default branch')}</dt><dd><GitBranch aria-hidden="true" />{repository.defaultBranch}</dd></div>
                      <div><dt>{text(locale, '提供方', 'Provider')}</dt><dd>{repository.provider}</dd></div>
                      <div><dt>{text(locale, '安装 ID', 'Installation ID')}</dt><dd>{repository.installationId ? <code>{repository.installationId}</code> : '—'}</dd></div>
                    </dl>
                  </section>
                  <footer className="remote-detail-footer"><Clock3 aria-hidden="true" />{text(locale, '创建于', 'Created')} {formatDate(repository.createdAt, locale)}</footer>
                </>
              ) : (
                <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{detail.error?.message ?? text(locale, '无法加载仓库详情。', 'Unable to load the Repository detail.')}</div>
              )}
            </section>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function SecretScopeLabel({ scope }: { scope: SecretDto['scope'] }) {
  const { locale } = usePreferences()
  const map: Record<SecretDto['scope'], { label: string; tone: string }> = {
    private: { label: text(locale, '私有', 'Private'), tone: 'muted' },
    shared: { label: text(locale, '共享', 'Shared'), tone: 'ok' },
  }
  const entry = map[scope]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

type SecretDraft = { name: string; scope: SecretDto['scope']; value: string; description: string; vmInstall: boolean }
const initialSecretDraft: SecretDraft = { name: '', scope: 'private', value: '', description: '', vmInstall: true }

export function RemoteSecretsPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  canManage,
  onOpenNavigation,
}: RemoteSecretsPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<SecretDraft>(initialSecretDraft)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedSecretId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedSecretId ? ({
    organizationId,
    spaceId,
    secretId: selectedSecretId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedSecretId, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!selectedSecretId) throw new Error('No Secret selected.')
    return getSecret(organizationId, spaceId, selectedSecretId, requestAuth, signal)
  }, [organizationId, requestAuth, selectedSecretId, spaceId])
  const detail = useRemoteDetail(identity, load)
  const secret = detail.status === 'ready' ? detail.item : selectedSummary

  const closeForm = useCallback(() => { setDraft(initialSecretDraft); setMutationError(null); setFormOpen(false) }, [])

  const submitSecret = useCallback(async () => {
    const name = draft.name.trim()
    const value = draft.value
    if (!name || !value) {
      setMutationError(new Error(text(locale, '名称和密钥值均为必填。', 'Name and secret value are both required.')))
      return
    }
    setMutating(true)
    setMutationError(null)
    try {
      await createSecret(organizationId, spaceId, {
        name,
        scope: draft.scope,
        value,
        description: draft.description.trim() || null,
        vmInstall: draft.vmInstall,
      }, crypto.randomUUID(), requestAuth)
      closeForm()
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [closeForm, draft, locale, onRetry, organizationId, requestAuth, spaceId])

  const archiveSelected = useCallback(async () => {
    if (!secret) return
    setMutating(true)
    setMutationError(null)
    try {
      await archiveSecret(organizationId, spaceId, secret.id, secret.version, requestAuth)
      setSelectedId(undefined)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [onRetry, organizationId, requestAuth, secret, spaceId])

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={KeyRound}
        title={text(locale, '密钥', 'Secrets')}
        description={text(locale, '写入一次即只写；在作用域内自动以大写下划线环境变量注入 Expert 环境。', 'Write-once then write-only; injected into Expert VMs as upper-snake-case env vars within scope.')}
        onOpenNavigation={onOpenNavigation}
        readOnly={!canManage}
        actions={canManage ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />{text(locale, '创建密钥', 'Create secret')}
          </button>
        ) : undefined}
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, '密钥', 'Secrets')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, '密钥', 'Secrets')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><KeyRound aria-hidden="true" /><strong>{text(locale, '还没有密钥', 'No Secrets')}</strong><p>{text(locale, '创建第一个只写凭证，作用域内的 Expert 会自动获得对应环境变量。', 'Create the first write-only credential; in-scope Experts receive the matching env var automatically.')}</p></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, '密钥列表', 'Secret list')}>
              <header className="cosmos-section-heading">
                <div><span>Catalog</span><h2>{text(locale, `${items.length} 个密钥`, `${items.length} Secrets`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新密钥列表', 'Refresh Secret list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedSecretId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedSecretId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><KeyRound aria-hidden="true" /></span>
                  <span><strong>{item.name}</strong><small>{item.description ?? text(locale, '无说明', 'No description')}</small></span>
                  <SecretScopeLabel scope={item.scope} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, '密钥详情', 'Secret detail')}>
              {secret ? (
                <>
                  <header className="cosmos-section-heading">
                    <div><span>{text(locale, '密钥', 'Secret')}</span><h2>{secret.name}</h2></div>
                    <SecretScopeLabel scope={secret.scope} />
                  </header>
                  <section className="remote-detail-section">
                    <header><ShieldCheck aria-hidden="true" /><h3>{text(locale, '属性', 'Attributes')}</h3></header>
                    <dl className="remote-detail-list">
                      <div><dt>{text(locale, '密钥值', 'Secret value')}</dt><dd><EyeOff aria-hidden="true" />•••• {secret.lastFour ?? '••••'}</dd></div>
                      <div><dt>{text(locale, '作用域', 'Scope')}</dt><dd>{secret.scope === 'shared' ? text(locale, '共享给组织成员', 'Shared with organization members') : text(locale, '仅本人会话可读', 'Readable only by your sessions')}</dd></div>
                      <div><dt>{text(locale, '注入 VM', 'Inject into VMs')}</dt><dd>{secret.vmInstall ? text(locale, '自动', 'Auto') : text(locale, '关闭', 'Off')}</dd></div>
                      <div><dt>{text(locale, '说明', 'Description')}</dt><dd>{secret.description ?? '—'}</dd></div>
                    </dl>
                  </section>
                  {mutationError ? <InlineError error={mutationError} /> : null}
                  <footer className="remote-detail-footer">
                    <span><Clock3 aria-hidden="true" />{text(locale, '更新于', 'Updated')} {formatDate(secret.updatedAt, locale)}</span>
                    {canManage ? (
                      <button type="button" className="cosmos-button cosmos-button--danger" disabled={mutating} onClick={archiveSelected}>
                        <Trash2 aria-hidden="true" />{text(locale, '归档密钥', 'Archive secret')}
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : (
                <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{detail.error?.message ?? text(locale, '无法加载密钥详情。', 'Unable to load the Secret detail.')}</div>
              )}
            </section>
          </section>
        ) : null}
      </div>
      {formOpen ? (
        <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
          <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={text(locale, '创建密钥', 'Create secret')}>
            <header><h2>{text(locale, '创建密钥', 'Create secret')}</h2><IconButton icon={X} label={text(locale, '关闭', 'Close')} onClick={closeForm} /></header>
            <div className="cosmos-modal__body">
              <div className="cosmos-form-grid">
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '名称（大写下划线）', 'Name (upper snake case)')}</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.toUpperCase() })} placeholder="OPENAI_API_KEY" />
                </label>
                <label className="cosmos-field">
                  <span>{text(locale, '作用域', 'Scope')}</span>
                  <select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as SecretDto['scope'] })}>
                    <option value="private">{text(locale, '私有', 'Private')}</option>
                    <option value="shared">{text(locale, '共享', 'Shared')}</option>
                  </select>
                </label>
                <label className="cosmos-field cosmos-inline-toggle">
                  <input type="checkbox" checked={draft.vmInstall} onChange={(event) => setDraft({ ...draft, vmInstall: event.target.checked })} />
                  <span>{text(locale, '自动注入 VM', 'Auto-inject into VMs')}</span>
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '密钥值', 'Secret value')}</span>
                  <input type="password" autoComplete="new-password" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="••••••••••••" />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '说明', 'Description')}</span>
                  <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </label>
              </div>
              <div className="cosmos-security-note cosmos-security-note--compact"><EyeOff aria-hidden="true" /><span><strong>{text(locale, '保存后不可查看', 'Not viewable after save')}</strong>{text(locale, '密钥值仅保留末四位用于识别，服务端以只写方式存储。', 'Only the last four characters are retained for identification; the value is stored write-only on the server.')}</span></div>
              {mutationError ? <InlineError error={mutationError} /> : null}
            </div>
            <footer className="cosmos-modal__footer">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeForm}>{text(locale, '取消', 'Cancel')}</button>
              <span />
              <button type="button" className="cosmos-button cosmos-button--primary" disabled={mutating} onClick={submitSecret}>
                <KeyRound aria-hidden="true" />{text(locale, '创建且不回显', 'Create without readback')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function WebhookScopeLabel({ scope }: { scope: WebhookDto['scope'] }) {
  const { locale } = usePreferences()
  const map: Record<WebhookDto['scope'], { label: string; tone: string }> = {
    shared: { label: text(locale, '共享', 'Shared'), tone: 'ok' },
    personal: { label: text(locale, '个人', 'Personal'), tone: 'muted' },
  }
  const entry = map[scope]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

type WebhookDraft = { name: string; url: string; scope: WebhookDto['scope']; description: string }
const initialWebhookDraft: WebhookDraft = { name: '', url: '', scope: 'shared', description: '' }

export function RemoteWebhooksPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  canManage,
  onOpenNavigation,
}: RemoteWebhooksPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<WebhookDraft>(initialWebhookDraft)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<string>()
  const [copied, setCopied] = useState(false)
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedWebhookId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedWebhookId ? ({
    organizationId,
    spaceId,
    webhookId: selectedWebhookId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedWebhookId, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!selectedWebhookId) throw new Error('No Webhook selected.')
    return getWebhook(organizationId, spaceId, selectedWebhookId, requestAuth, signal)
  }, [organizationId, requestAuth, selectedWebhookId, spaceId])
  const detail = useRemoteDetail(identity, load)
  const webhook = detail.status === 'ready' ? detail.item : selectedSummary

  const closeForm = useCallback(() => { setDraft(initialWebhookDraft); setMutationError(null); setFormOpen(false) }, [])

  const submitWebhook = useCallback(async () => {
    const name = draft.name.trim()
    const url = draft.url.trim()
    if (!name || !url) {
      setMutationError(new Error(text(locale, '名称和目标 URL 均为必填。', 'Name and target URL are both required.')))
      return
    }
    setMutating(true)
    setMutationError(null)
    try {
      const response = await createWebhook(organizationId, spaceId, {
        name,
        url,
        scope: draft.scope,
        description: draft.description.trim() || null,
      }, crypto.randomUUID(), requestAuth)
      closeForm()
      if (response.signingSecret) setRevealedSecret(response.signingSecret)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [closeForm, draft, locale, onRetry, organizationId, requestAuth, spaceId])

  const archiveSelected = useCallback(async () => {
    if (!webhook) return
    setMutating(true)
    setMutationError(null)
    try {
      await archiveWebhook(organizationId, spaceId, webhook.id, webhook.version, requestAuth)
      setSelectedId(undefined)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [onRetry, organizationId, requestAuth, spaceId, webhook])

  const copySecret = useCallback(() => {
    if (!revealedSecret) return
    navigator.clipboard?.writeText(revealedSecret)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [revealedSecret])

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Webhook}
        title={text(locale, 'Webhooks', 'Webhooks')}
        description={text(locale, '面向 Datadog、CircleCI 等的 HTTPS 端点，可在 Automations 中作为 Webhook 触发器接入。', 'Custom HTTPS endpoints for Datadog, CircleCI, etc. Wire them as a Webhook trigger from Automations.')}
        onOpenNavigation={onOpenNavigation}
        readOnly={!canManage}
        actions={canManage ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />{text(locale, '创建 Webhook', 'Create webhook')}
          </button>
        ) : undefined}
      />
      <div className="cosmos-page__scroll">
        {revealedSecret ? (
          <section className="cosmos-one-time-secret" role="status">
            <KeyRound aria-hidden="true" />
            <div>
              <strong>{text(locale, '签名密钥仅显示一次', 'Signing secret shown once')}</strong>
              <p>{text(locale, '关闭后无法再次查看。请立即复制并妥善保存，用于校验 Webhook 请求签名。', 'It cannot be viewed again after dismissal. Copy it now and store it safely to verify Webhook request signatures.')}</p>
              <code>{revealedSecret}</code>
            </div>
            <div>
              <IconButton icon={Copy} label={copied ? text(locale, '已复制', 'Copied') : text(locale, '复制密钥', 'Copy secret')} onClick={copySecret} />
              <IconButton icon={EyeOff} label={text(locale, '隐藏且不再显示', 'Hide permanently')} onClick={() => setRevealedSecret(undefined)} />
            </div>
          </section>
        ) : null}
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, 'Webhooks', 'Webhooks')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, 'Webhooks', 'Webhooks')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><Webhook aria-hidden="true" /><strong>{text(locale, '还没有 Webhook', 'No Webhooks')}</strong><p>{text(locale, '创建第一个 HTTPS 端点，之后可在 Automations 中作为触发器接入。', 'Create the first HTTPS endpoint, then wire it as a trigger from Automations.')}</p></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, 'Webhook 列表', 'Webhook list')}>
              <header className="cosmos-section-heading">
                <div><span>Catalog</span><h2>{text(locale, `${items.length} 个 Webhook`, `${items.length} Webhooks`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新 Webhook 列表', 'Refresh Webhook list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedWebhookId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedWebhookId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><Webhook aria-hidden="true" /></span>
                  <span><strong>{item.name}</strong><small>{item.url}</small></span>
                  <WebhookScopeLabel scope={item.scope} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, 'Webhook 详情', 'Webhook detail')}>
              {webhook ? (
                <>
                  <header className="cosmos-section-heading">
                    <div><span>Webhook</span><h2>{webhook.name}</h2></div>
                    <WebhookScopeLabel scope={webhook.scope} />
                  </header>
                  <section className="remote-detail-section">
                    <header><Link2 aria-hidden="true" /><h3>{text(locale, '端点', 'Endpoint')}</h3></header>
                    <dl className="remote-detail-list">
                      <div><dt>{text(locale, '目标 URL', 'Target URL')}</dt><dd><code>{webhook.url}</code></dd></div>
                      <div><dt>{text(locale, '签名密钥', 'Signing secret')}</dt><dd><EyeOff aria-hidden="true" />•••• {webhook.secretLastFour ?? '••••'}</dd></div>
                      <div><dt>{text(locale, '事件数', 'Events delivered')}</dt><dd>{webhook.eventCount}</dd></div>
                      <div><dt>{text(locale, '说明', 'Description')}</dt><dd>{webhook.description ?? '—'}</dd></div>
                    </dl>
                  </section>
                  {mutationError ? <InlineError error={mutationError} /> : null}
                  <footer className="remote-detail-footer">
                    <span><Clock3 aria-hidden="true" />{text(locale, '更新于', 'Updated')} {formatDate(webhook.updatedAt, locale)}</span>
                    {canManage ? (
                      <button type="button" className="cosmos-button cosmos-button--danger" disabled={mutating} onClick={archiveSelected}>
                        <Trash2 aria-hidden="true" />{text(locale, '归档 Webhook', 'Archive webhook')}
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : (
                <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{detail.error?.message ?? text(locale, '无法加载 Webhook 详情。', 'Unable to load the Webhook detail.')}</div>
              )}
            </section>
          </section>
        ) : null}
      </div>
      {formOpen ? (
        <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
          <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={text(locale, '创建 Webhook', 'Create webhook')}>
            <header><h2>{text(locale, '创建 Webhook', 'Create webhook')}</h2><IconButton icon={X} label={text(locale, '关闭', 'Close')} onClick={closeForm} /></header>
            <div className="cosmos-modal__body">
              <div className="cosmos-form-grid">
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '名称', 'Name')}</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="datadog-alerts" />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '目标 URL（HTTPS）', 'Target URL (HTTPS)')}</span>
                  <input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/hooks/cosmos" />
                </label>
                <label className="cosmos-field">
                  <span>{text(locale, '作用域', 'Scope')}</span>
                  <select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as WebhookDto['scope'] })}>
                    <option value="shared">{text(locale, '共享', 'Shared')}</option>
                    <option value="personal">{text(locale, '个人', 'Personal')}</option>
                  </select>
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '说明', 'Description')}</span>
                  <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </label>
              </div>
              <div className="cosmos-security-note cosmos-security-note--compact"><KeyRound aria-hidden="true" /><span><strong>{text(locale, '签名密钥仅在创建时显示一次', 'Signing secret shown once at creation')}</strong>{text(locale, '创建后请立即复制密钥，服务端仅以只写方式保存，之后无法再次查看。', 'Copy the secret immediately after creation; the server stores it write-only and it cannot be viewed again.')}</span></div>
              {mutationError ? <InlineError error={mutationError} /> : null}
            </div>
            <footer className="cosmos-modal__footer">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeForm}>{text(locale, '取消', 'Cancel')}</button>
              <span />
              <button type="button" className="cosmos-button cosmos-button--primary" disabled={mutating} onClick={submitWebhook}>
                <Webhook aria-hidden="true" />{text(locale, '创建并显示密钥', 'Create and reveal secret')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function McpConnectionLabel({ status }: { status: McpServerDto['connectionStatus'] }) {
  const { locale } = usePreferences()
  const map: Record<McpServerDto['connectionStatus'], { label: string; tone: string }> = {
    connected: { label: text(locale, '已连接', 'Connected'), tone: 'ok' },
    action_required: { label: text(locale, '需处理', 'Action required'), tone: 'warn' },
    archived: { label: text(locale, '已归档', 'Archived'), tone: 'muted' },
  }
  const entry = map[status]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

type McpDraft = { name: string; transport: McpServerDto['transport']; endpoint: string; command: string }
const initialMcpDraft: McpDraft = { name: '', transport: 'http', endpoint: '', command: '' }

export function RemoteMcpServersPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  canManage,
  onOpenNavigation,
}: RemoteMcpServersPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<McpDraft>(initialMcpDraft)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedMcpServerId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedMcpServerId ? ({
    organizationId,
    spaceId,
    mcpServerId: selectedMcpServerId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedMcpServerId, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!selectedMcpServerId) throw new Error('No MCP server selected.')
    return getMcpServer(organizationId, spaceId, selectedMcpServerId, requestAuth, signal)
  }, [organizationId, requestAuth, selectedMcpServerId, spaceId])
  const detail = useRemoteDetail(identity, load)
  const server = detail.status === 'ready' ? detail.item : selectedSummary

  const closeForm = useCallback(() => { setDraft(initialMcpDraft); setMutationError(null); setFormOpen(false) }, [])

  const submitServer = useCallback(async () => {
    const name = draft.name.trim()
    const isStdio = draft.transport === 'stdio'
    const target = isStdio ? draft.command.trim() : draft.endpoint.trim()
    if (!name || !target) {
      setMutationError(new Error(isStdio
        ? text(locale, '名称和启动命令均为必填。', 'Name and launch command are both required.')
        : text(locale, '名称和 Endpoint 均为必填。', 'Name and endpoint are both required.')))
      return
    }
    setMutating(true)
    setMutationError(null)
    try {
      await createMcpServer(organizationId, spaceId, {
        name,
        transport: draft.transport,
        endpoint: isStdio ? undefined : target,
        command: isStdio ? target : undefined,
      }, crypto.randomUUID(), requestAuth)
      closeForm()
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [closeForm, draft, locale, onRetry, organizationId, requestAuth, spaceId])

  const archiveSelected = useCallback(async () => {
    if (!server) return
    setMutating(true)
    setMutationError(null)
    try {
      await archiveMcpServer(organizationId, spaceId, server.id, server.version, requestAuth)
      setSelectedId(undefined)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [onRetry, organizationId, requestAuth, spaceId, server])

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Database}
        title={text(locale, 'MCP Registry', 'MCP Registry')}
        description={text(locale, '管理可供专家调用的 Model Context Protocol servers，然后在专家编辑器中固定。', 'Manage Model Context Protocol servers available to Experts, then pin them from the Expert editor.')}
        onOpenNavigation={onOpenNavigation}
        readOnly={!canManage}
        actions={canManage ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />{text(locale, '新增 Server', 'Add server')}
          </button>
        ) : undefined}
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, 'MCP servers', 'MCP servers')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, 'MCP servers', 'MCP servers')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><Database aria-hidden="true" /><strong>{text(locale, '注册表为空', 'Registry is empty')}</strong><p>{text(locale, '新增第一个 MCP server 作为专家的工具来源。', 'Add the first MCP server as an Expert tool source.')}</p></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, 'MCP server 列表', 'MCP server list')}>
              <header className="cosmos-section-heading">
                <div><span>Registry</span><h2>{text(locale, `${items.length} 个 Server`, `${items.length} servers`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新 MCP server 列表', 'Refresh MCP server list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedMcpServerId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedMcpServerId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><Database aria-hidden="true" /></span>
                  <span><strong>{item.name}</strong><small>{item.transport === 'stdio' ? item.command : item.endpoint}</small></span>
                  <McpConnectionLabel status={item.connectionStatus} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, 'MCP server 详情', 'MCP server detail')}>
              {server ? (
                <>
                  <header className="cosmos-section-heading">
                    <div><span>MCP server</span><h2>{server.name}</h2></div>
                    <McpConnectionLabel status={server.connectionStatus} />
                  </header>
                  <section className="remote-detail-section">
                    <header><Link2 aria-hidden="true" /><h3>{text(locale, '连接', 'Connection')}</h3></header>
                    <dl className="remote-detail-list">
                      <div><dt>Transport</dt><dd>{server.transport}</dd></div>
                      <div><dt>{server.transport === 'stdio' ? text(locale, '启动命令', 'Launch command') : 'Endpoint'}</dt><dd><code>{server.transport === 'stdio' ? server.command : server.endpoint}</code></dd></div>
                      <div><dt>{text(locale, '工具数', 'Tools discovered')}</dt><dd>{server.toolCount}</dd></div>
                    </dl>
                  </section>
                  {mutationError ? <InlineError error={mutationError} /> : null}
                  <footer className="remote-detail-footer">
                    <span><Clock3 aria-hidden="true" />{text(locale, '更新于', 'Updated')} {formatDate(server.updatedAt, locale)}</span>
                    {canManage ? (
                      <button type="button" className="cosmos-button cosmos-button--danger" disabled={mutating} onClick={archiveSelected}>
                        <Trash2 aria-hidden="true" />{text(locale, '归档 Server', 'Archive server')}
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : (
                <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{detail.error?.message ?? text(locale, '无法加载 MCP server 详情。', 'Unable to load the MCP server detail.')}</div>
              )}
            </section>
          </section>
        ) : null}
      </div>
      {formOpen ? (
        <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
          <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={text(locale, '新增 MCP Server', 'Add MCP server')}>
            <header><h2>{text(locale, '新增 MCP Server', 'Add MCP server')}</h2><IconButton icon={X} label={text(locale, '关闭', 'Close')} onClick={closeForm} /></header>
            <div className="cosmos-modal__body">
              <div className="cosmos-form-grid">
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '名称', 'Name')}</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Internal Docs MCP" />
                </label>
                <label className="cosmos-field">
                  <span>Transport</span>
                  <select value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as McpServerDto['transport'] })}>
                    <option value="http">HTTP</option>
                    <option value="sse">SSE</option>
                    <option value="stdio">stdio</option>
                  </select>
                </label>
                {draft.transport === 'stdio' ? (
                  <label className="cosmos-field cosmos-field--wide">
                    <span>{text(locale, '启动命令', 'Launch command')}</span>
                    <input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="npx @company/mcp-server" />
                  </label>
                ) : (
                  <label className="cosmos-field cosmos-field--wide">
                    <span>Endpoint</span>
                    <input type="url" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://mcp.example.com/api" />
                  </label>
                )}
              </div>
              {mutationError ? <InlineError error={mutationError} /> : null}
            </div>
            <footer className="cosmos-modal__footer">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeForm}>{text(locale, '取消', 'Cancel')}</button>
              <span />
              <button type="button" className="cosmos-button cosmos-button--primary" disabled={mutating} onClick={submitServer}>
                <Database aria-hidden="true" />{text(locale, '新增 Server', 'Add server')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function DaemonStatusLabel({ status, enabled }: { status: DaemonDto['status']; enabled: boolean }) {
  const { locale } = usePreferences()
  if (status === 'archived') {
    return <span className="cosmos-status-label cosmos-status-label--muted">{text(locale, '已归档', 'Archived')}</span>
  }
  if (!enabled) {
    return <span className="cosmos-status-label cosmos-status-label--muted">{text(locale, '已停用', 'Disabled')}</span>
  }
  const map: Record<Exclude<DaemonDto['status'], 'archived'>, { label: string; tone: string }> = {
    online: { label: text(locale, '在线', 'Online'), tone: 'ok' },
    offline: { label: text(locale, '离线', 'Offline'), tone: 'warn' },
    degraded: { label: text(locale, '降级', 'Degraded'), tone: 'warn' },
  }
  const entry = map[status]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

type DaemonDraft = { name: string; environmentId: string; description: string; capabilities: string; concurrencySlots: number }
const initialDaemonDraft: DaemonDraft = { name: '', environmentId: '', description: '', capabilities: '', concurrencySlots: 4 }

export function RemoteDaemonsPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  canManage,
  environments = [],
  onOpenNavigation,
}: RemoteDaemonsPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<DaemonDraft>(initialDaemonDraft)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedDaemonId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const identity = useMemo(() => selectedDaemonId ? ({
    organizationId,
    spaceId,
    daemonId: selectedDaemonId,
    requestIdentity: requestAuth.requestIdentity,
    credentialVersion,
  }) : undefined, [credentialVersion, organizationId, requestAuth.requestIdentity, selectedDaemonId, spaceId])
  const load = useCallback((signal: AbortSignal) => {
    if (!selectedDaemonId) throw new Error('No daemon selected.')
    return getDaemon(organizationId, spaceId, selectedDaemonId, requestAuth, signal)
  }, [organizationId, requestAuth, selectedDaemonId, spaceId])
  const detail = useRemoteDetail(identity, load)
  const daemon = detail.status === 'ready' ? detail.item : selectedSummary

  const environmentName = useCallback((environmentId: string) => (
    environments.find((environment) => environment.id === environmentId)?.name ?? environmentId
  ), [environments])

  const closeForm = useCallback(() => { setDraft(initialDaemonDraft); setMutationError(null); setFormOpen(false) }, [])

  const submitDaemon = useCallback(async () => {
    const name = draft.name.trim()
    const environmentId = draft.environmentId || environments[0]?.id
    if (!name || !environmentId) {
      setMutationError(new Error(text(locale, '名称和执行环境均为必填。', 'Name and environment are both required.')))
      return
    }
    const capabilities = draft.capabilities.split(',').map((entry) => entry.trim()).filter(Boolean)
    setMutating(true)
    setMutationError(null)
    try {
      await createDaemon(organizationId, spaceId, {
        name,
        environmentId,
        description: draft.description.trim() || undefined,
        capabilities: capabilities.length ? capabilities : undefined,
        concurrencySlots: draft.concurrencySlots,
      }, crypto.randomUUID(), requestAuth)
      closeForm()
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [closeForm, draft, environments, locale, onRetry, organizationId, requestAuth, spaceId])

  const toggleEnabled = useCallback(async () => {
    if (!daemon) return
    setMutating(true)
    setMutationError(null)
    try {
      await updateDaemon(organizationId, spaceId, daemon.id, daemon.version, { enabled: !daemon.enabled }, crypto.randomUUID(), requestAuth)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [daemon, onRetry, organizationId, requestAuth, spaceId])

  const archiveSelected = useCallback(async () => {
    if (!daemon) return
    setMutating(true)
    setMutationError(null)
    try {
      await archiveDaemon(organizationId, spaceId, daemon.id, daemon.version, requestAuth)
      setSelectedId(undefined)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setMutating(false)
    }
  }, [daemon, onRetry, organizationId, requestAuth, spaceId])

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Server}
        title={text(locale, 'Daemon Pools', 'Daemon pools')}
        description={text(locale, '管理自托管执行机器与容量，供调度器分配 Session 运行。', 'Manage self-hosted execution machines and capacity for the scheduler to assign Session runs.')}
        onOpenNavigation={onOpenNavigation}
        readOnly={!canManage}
        actions={canManage ? (
          <button type="button" className="cosmos-button cosmos-button--primary" disabled={environments.length === 0} onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />{text(locale, '注册机器', 'Register machine')}
          </button>
        ) : undefined}
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, 'daemons', 'daemons')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, 'daemons', 'daemons')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><Server aria-hidden="true" /><strong>{text(locale, '没有已注册机器', 'No machines registered')}</strong><p>{text(locale, '注册第一台 Daemon 为该 Space 提供执行容量。', 'Register the first daemon to provide execution capacity for this Space.')}</p></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, 'Daemon 列表', 'Daemon list')}>
              <header className="cosmos-section-heading">
                <div><span>Pools</span><h2>{text(locale, `${items.filter((item) => item.enabled).length}/${items.length} 台在线`, `${items.filter((item) => item.enabled).length}/${items.length} online`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新 Daemon 列表', 'Refresh daemon list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedDaemonId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedDaemonId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><Server aria-hidden="true" /></span>
                  <span><strong>{item.name}</strong><small>{environmentName(item.environmentId)}</small></span>
                  <DaemonStatusLabel status={item.status} enabled={item.enabled} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, 'Daemon 详情', 'Daemon detail')}>
              {daemon ? (
                <>
                  <header className="cosmos-section-heading">
                    <div><span>Daemon</span><h2>{daemon.name}</h2></div>
                    <DaemonStatusLabel status={daemon.status} enabled={daemon.enabled} />
                  </header>
                  {daemon.description ? <p className="remote-detail-lead">{daemon.description}</p> : null}
                  <section className="remote-detail-section">
                    <header><ServerCog aria-hidden="true" /><h3>{text(locale, '容量', 'Capacity')}</h3></header>
                    <dl className="remote-detail-list">
                      <div><dt>{text(locale, '执行环境', 'Environment')}</dt><dd>{environmentName(daemon.environmentId)}</dd></div>
                      <div><dt>{text(locale, '并发槽位', 'Concurrency slots')}</dt><dd>{daemon.concurrencySlots}</dd></div>
                      <div><dt>{text(locale, '能力', 'Capabilities')}</dt><dd>{daemon.capabilities.length ? <code>{daemon.capabilities.join(' · ')}</code> : text(locale, '未声明', 'None declared')}</dd></div>
                      <div><dt>{text(locale, '最近心跳', 'Last heartbeat')}</dt><dd>{daemon.lastHeartbeatAt ? formatDate(daemon.lastHeartbeatAt, locale) : text(locale, '从未', 'Never')}</dd></div>
                    </dl>
                  </section>
                  {mutationError ? <InlineError error={mutationError} /> : null}
                  <footer className="remote-detail-footer">
                    <span><Clock3 aria-hidden="true" />{text(locale, '更新于', 'Updated')} {formatDate(daemon.updatedAt, locale)}</span>
                    {canManage ? (
                      <div className="remote-detail-actions">
                        <button type="button" className="cosmos-button cosmos-button--secondary" disabled={mutating} onClick={toggleEnabled}>
                          <Power aria-hidden="true" />{daemon.enabled ? text(locale, '停用', 'Disable') : text(locale, '启用', 'Enable')}
                        </button>
                        <button type="button" className="cosmos-button cosmos-button--danger" disabled={mutating} onClick={archiveSelected}>
                          <Trash2 aria-hidden="true" />{text(locale, '归档机器', 'Archive machine')}
                        </button>
                      </div>
                    ) : null}
                  </footer>
                </>
              ) : (
                <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{detail.error?.message ?? text(locale, '无法加载 Daemon 详情。', 'Unable to load the daemon detail.')}</div>
              )}
            </section>
          </section>
        ) : null}
      </div>
      {formOpen ? (
        <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
          <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={text(locale, '注册 Daemon', 'Register daemon')}>
            <header><h2>{text(locale, '注册 Daemon', 'Register daemon')}</h2><IconButton icon={X} label={text(locale, '关闭', 'Close')} onClick={closeForm} /></header>
            <div className="cosmos-modal__body">
              <div className="cosmos-form-grid">
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '名称', 'Name')}</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Commerce runner" />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '执行环境', 'Environment')}</span>
                  <select value={draft.environmentId || environments[0]?.id || ''} onChange={(event) => setDraft({ ...draft, environmentId: event.target.value })}>
                    {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                  </select>
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '描述', 'Description')}</span>
                  <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={text(locale, '执行仓库感知的专家运行。', 'Executes repository-aware Expert runs.')} />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '能力（逗号分隔）', 'Capabilities (comma separated)')}</span>
                  <input value={draft.capabilities} onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })} placeholder="code-search, shell, git" />
                </label>
                <label className="cosmos-field">
                  <span>{text(locale, '并发槽位', 'Concurrency slots')}</span>
                  <input type="number" min={1} max={64} value={draft.concurrencySlots} onChange={(event) => setDraft({ ...draft, concurrencySlots: Math.min(64, Math.max(1, Number(event.target.value) || 1)) })} />
                </label>
              </div>
              {mutationError ? <InlineError error={mutationError} /> : null}
            </div>
            <footer className="cosmos-modal__footer">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeForm}>{text(locale, '取消', 'Cancel')}</button>
              <span />
              <button type="button" className="cosmos-button cosmos-button--primary" disabled={mutating} onClick={submitDaemon}>
                <Server aria-hidden="true" />{text(locale, '注册机器', 'Register machine')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}

const integrationIcons: Record<IntegrationDto['type'], typeof GitBranch> = {
  github: GitBranch,
  slack: PlugZap,
  jira: CheckCircle2,
  pagerduty: AlertTriangle,
  linear: Activity,
  custom: Wrench,
}

const integrationTypeLabels: Record<IntegrationDto['type'], string> = {
  github: 'GitHub',
  slack: 'Slack',
  jira: 'Jira',
  pagerduty: 'PagerDuty',
  linear: 'Linear',
  custom: 'Custom',
}

function IntegrationStatusLabel({ status }: { status: IntegrationDto['connectionStatus'] }) {
  const { locale } = usePreferences()
  const map: Record<IntegrationDto['connectionStatus'], { label: string; tone: string }> = {
    connected: { label: text(locale, '已连接', 'Connected'), tone: 'ok' },
    action_required: { label: text(locale, '需要处理', 'Action required'), tone: 'warn' },
    disconnected: { label: text(locale, '未连接', 'Disconnected'), tone: 'muted' },
    archived: { label: text(locale, '已归档', 'Archived'), tone: 'muted' },
  }
  const entry = map[status]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

function IntegrationHealthLabel({ health }: { health: IntegrationDto['health'] }) {
  const { locale } = usePreferences()
  const map: Record<IntegrationDto['health'], { label: string; tone: string }> = {
    healthy: { label: text(locale, '健康', 'Healthy'), tone: 'ok' },
    degraded: { label: text(locale, '降级', 'Degraded'), tone: 'warn' },
    unknown: { label: text(locale, '未知', 'Unknown'), tone: 'muted' },
  }
  const entry = map[health]
  return <span className={`cosmos-status-label cosmos-status-label--${entry.tone}`}>{entry.label}</span>
}

type IntegrationDraft = { type: IntegrationDto['type']; name: string; externalAccount: string; scopes: string }
const initialIntegrationDraft: IntegrationDraft = { type: 'github', name: '', externalAccount: '', scopes: '' }

export function RemoteIntegrationsPage({
  items,
  loading,
  ready,
  error,
  onRetry,
  organizationId,
  spaceId,
  auth,
  canManage,
  onOpenNavigation,
}: RemoteIntegrationsPageProps) {
  const { locale } = usePreferences()
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<IntegrationDraft>(initialIntegrationDraft)
  const [workingId, setWorkingId] = useState<string>()
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const state = listState(loading, ready, error)
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])

  const closeForm = useCallback(() => { setDraft(initialIntegrationDraft); setMutationError(null); setFormOpen(false) }, [])

  const submitIntegration = useCallback(async () => {
    const name = draft.name.trim()
    if (!name) {
      setMutationError(new Error(text(locale, '名称为必填。', 'Name is required.')))
      return
    }
    const scopes = draft.scopes.split(',').map((entry) => entry.trim()).filter(Boolean)
    setWorkingId('__create__')
    setMutationError(null)
    try {
      await createIntegration(organizationId, spaceId, {
        type: draft.type,
        name,
        externalAccount: draft.externalAccount.trim() || undefined,
        scopes: scopes.length ? scopes : undefined,
      }, crypto.randomUUID(), requestAuth)
      closeForm()
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setWorkingId(undefined)
    }
  }, [closeForm, draft, locale, onRetry, organizationId, requestAuth, spaceId])

  const reconnect = useCallback(async (integration: IntegrationDto) => {
    setWorkingId(integration.id)
    setMutationError(null)
    try {
      await updateIntegration(organizationId, spaceId, integration.id, integration.version, {
        connectionStatus: 'connected',
        health: 'healthy',
        diagnostic: null,
      }, crypto.randomUUID(), requestAuth)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setWorkingId(undefined)
    }
  }, [onRetry, organizationId, requestAuth, spaceId])

  const archiveSelected = useCallback(async (integration: IntegrationDto) => {
    setWorkingId(integration.id)
    setMutationError(null)
    try {
      await archiveIntegration(organizationId, spaceId, integration.id, integration.version, requestAuth)
      onRetry()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setWorkingId(undefined)
    }
  }, [onRetry, organizationId, requestAuth, spaceId])

  const active = items.filter((item) => item.connectionStatus !== 'archived')

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={PlugZap}
        title={text(locale, '集成', 'Integrations')}
        description={text(locale, '连接该 Space 的开发与协作系统，管理连接健康与授权范围。', 'Connect development and collaboration systems for this Space and manage connection health and scopes.')}
        onOpenNavigation={onOpenNavigation}
        readOnly={!canManage}
        actions={canManage ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />{text(locale, '添加集成', 'Add integration')}
          </button>
        ) : undefined}
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, 'integrations', 'integrations')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, 'integrations', 'integrations')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && active.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><PlugZap aria-hidden="true" /><strong>{text(locale, '还没有集成', 'No integrations yet')}</strong><p>{text(locale, '连接第一个开发或协作系统，为该 Space 引入外部事件与操作。', 'Connect the first development or collaboration system to bring external events and actions into this Space.')}</p></section>
        ) : null}
        {mutationError ? <InlineError error={mutationError} /> : null}
        {state === 'ready' && active.length > 0 ? (
          <div className="cosmos-integration-grid">
            {active.map((integration) => {
              const IntegrationIcon = integrationIcons[integration.type]
              const working = workingId === integration.id
              const needsRepair = integration.connectionStatus === 'action_required' || integration.health === 'degraded'
              return (
                <article className="cosmos-panel cosmos-integration-card" key={integration.id}>
                  <header>
                    <span className="cosmos-integration-card__icon"><IntegrationIcon aria-hidden="true" /></span>
                    <IntegrationStatusLabel status={integration.connectionStatus} />
                  </header>
                  <h2>{integration.name}</h2>
                  <p>{integration.externalAccount || text(locale, '尚未绑定账号', 'No account connected')}</p>
                  <dl>
                    <div><dt>{text(locale, '类型', 'Type')}</dt><dd>{integrationTypeLabels[integration.type]}</dd></div>
                    <div><dt>{text(locale, '健康状态', 'Health')}</dt><dd><IntegrationHealthLabel health={integration.health} /></dd></div>
                    <div><dt>Scopes</dt><dd>{integration.scopes.join(', ') || '—'}</dd></div>
                    <div><dt>{text(locale, '最近事件', 'Last event')}</dt><dd>{integration.lastEventAt ? formatDate(integration.lastEventAt, locale) : text(locale, '暂无', 'None')}</dd></div>
                  </dl>
                  {integration.diagnostic ? <div className="cosmos-diagnostic"><AlertTriangle aria-hidden="true" /><span><strong>{text(locale, '诊断', 'Diagnostic')}</strong>{integration.diagnostic}</span></div> : null}
                  {canManage ? (
                    <footer className="remote-integration-actions">
                      <button type="button" className={needsRepair ? 'cosmos-button cosmos-button--primary' : 'cosmos-button cosmos-button--secondary'} disabled={working} onClick={() => reconnect(integration)}>
                        {working ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : needsRepair ? <Wrench aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                        {needsRepair ? text(locale, '修复连接', 'Repair connection') : text(locale, '标记已连接', 'Mark connected')}
                      </button>
                      <IconButton icon={Trash2} label={text(locale, '归档集成', 'Archive integration')} onClick={() => archiveSelected(integration)} />
                    </footer>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : null}
      </div>
      {formOpen ? (
        <div className="cosmos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
          <section className="cosmos-modal" role="dialog" aria-modal="true" aria-label={text(locale, '添加集成', 'Add integration')}>
            <header><h2>{text(locale, '添加集成', 'Add integration')}</h2><IconButton icon={X} label={text(locale, '关闭', 'Close')} onClick={closeForm} /></header>
            <div className="cosmos-modal__body">
              <div className="cosmos-form-grid">
                <label className="cosmos-field">
                  <span>{text(locale, '类型', 'Type')}</span>
                  <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as IntegrationDto['type'] })}>
                    {(Object.keys(integrationTypeLabels) as IntegrationDto['type'][]).map((type) => <option key={type} value={type}>{integrationTypeLabels[type]}</option>)}
                  </select>
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '名称', 'Name')}</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Production GitHub" />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '外部账号（可选）', 'External account (optional)')}</span>
                  <input value={draft.externalAccount} onChange={(event) => setDraft({ ...draft, externalAccount: event.target.value })} placeholder="acme-inc" />
                </label>
                <label className="cosmos-field cosmos-field--wide">
                  <span>{text(locale, '授权范围（逗号分隔）', 'Scopes (comma separated)')}</span>
                  <input value={draft.scopes} onChange={(event) => setDraft({ ...draft, scopes: event.target.value })} placeholder="repo, read:org" />
                </label>
              </div>
              {mutationError ? <InlineError error={mutationError} /> : null}
            </div>
            <footer className="cosmos-modal__footer">
              <button type="button" className="cosmos-button cosmos-button--ghost" onClick={closeForm}>{text(locale, '取消', 'Cancel')}</button>
              <span />
              <button type="button" className="cosmos-button cosmos-button--primary" disabled={workingId === '__create__'} onClick={submitIntegration}>
                <PlugZap aria-hidden="true" />{text(locale, '添加集成', 'Add integration')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  )
}
