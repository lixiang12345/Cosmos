import {
  DEFAULT_AGENT_MODEL,
  SUPPORTED_AGENT_MODELS,
  type CreateEnvironmentRequestInput,
  type EnvironmentDetailDto,
  type EnvironmentRevisionDto,
  type EnvironmentStatus,
  type EnvironmentSummaryDto,
  type ExpertDetailDto,
  type ExpertRevisionListResponse,
  type ExpertStatus,
  type ExpertSummaryDto,
  type RepositoryDto,
  type SecretDto,
} from '@cosmos/contracts'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  ChevronRight,
  CircleOff,
  Clock3,
  Container,
  FolderGit2,
  GitBranch,
  History,
  KeyRound,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Menu,
  FilePlus2,
  ListRestart,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Save,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { GlobalControls } from '../components/GlobalControls'
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
}

export type RemoteExpertDetailPageProps = RemoteCatalogRequestProps & {
  expertId: string
  onOpenNavigation?: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  sessionCreationEnabled?: boolean
  canManage?: boolean
  onEdit?: () => void
}

export type RemoteExpertEditorPageProps = RemoteCatalogRequestProps & {
  expertId?: string
  environments: EnvironmentSummaryDto[]
  onOpenNavigation?: () => void
  onBack: () => void
  onCreated: (expertId: string) => void
  onArchived: () => void
  onCatalogChange: () => void
}

export type RemoteEnvironmentsPageProps = RemoteCatalogListState<EnvironmentSummaryDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean }

export type RemoteRepositoriesPageProps = RemoteCatalogListState<RepositoryDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void }

export type RemoteSecretsPageProps = RemoteCatalogListState<SecretDto>
  & RemoteCatalogRequestProps
  & { onOpenNavigation?: () => void; canManage?: boolean; onCatalogChange?: () => void }

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
}: RemoteExpertsPageProps) {
  const { locale } = usePreferences()
  const state = listState(loading, ready, error)

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Bot}
        title={text(locale, '专家库', 'Experts')}
        description={text(locale, '当前 Space 中可用的服务端 Expert 配置', 'Server-managed Expert configurations in this Space')}
        onOpenNavigation={onOpenNavigation}
        actions={canManage && onCreate ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={onCreate}>
            <Plus aria-hidden="true" />{text(locale, '新建 Expert', 'New Expert')}
          </button>
        ) : null}
      />
      <div className="cosmos-page__scroll">
        <section className="cosmos-panel remote-catalog-panel" aria-label={text(locale, '专家列表', 'Expert list')}>
          <header className="cosmos-section-heading">
            <div><span>Catalog</span><h2>{text(locale, `${items.length} 个专家`, `${items.length} Experts`)}</h2></div>
            {state === 'ready' ? (
              <IconButton icon={RefreshCw} label={text(locale, '刷新专家列表', 'Refresh Expert list')} onClick={onRetry} />
            ) : null}
          </header>
          {state === 'loading' ? <LoadState status="loading" resource={text(locale, '专家', 'Experts')} onRetry={onRetry} /> : null}
          {state === 'error' ? <LoadState status="error" resource={text(locale, '专家', 'Experts')} error={error} onRetry={onRetry} /> : null}
          {state === 'ready' && items.length === 0 ? (
            <div className="remote-catalog-empty"><Bot aria-hidden="true" /><strong>{text(locale, '暂无专家', 'No Experts')}</strong></div>
          ) : null}
          {state === 'ready' && items.length > 0 ? (
            <div className="remote-catalog-list">
              {items.map((expert) => {
                const revision = expert.publishedRevisionSummary
                const startable = canStartExpert(expert)
                return (
                  <article className="remote-catalog-row" key={expert.id}>
                    <button type="button" className="remote-catalog-row__main" onClick={() => onOpenDetail(expert.id)}>
                      <span className="cosmos-resource-row__icon"><Bot aria-hidden="true" /></span>
                      <span className="remote-catalog-row__copy">
                        <strong>{expert.name}</strong>
                        <small>{expert.description || text(locale, '暂无说明', 'No description')}</small>
                      </span>
                      <span className="remote-catalog-row__meta">
                        <StatusLabel status={expert.status} />
                        <small>{revision ? `v${revision.revision} · ${revision.model}` : text(locale, '未发布版本', 'No published revision')}</small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                    {sessionCreationEnabled ? <button
                      type="button"
                      className="cosmos-button cosmos-button--secondary remote-catalog-row__start"
                      disabled={!startable}
                      title={startable ? undefined : text(locale, '仅已发布且具有版本的 Expert 可发起会话', 'Only a published Expert revision can start a Session')}
                      onClick={() => onStartSession(expert.id)}
                    >
                      <FilePlus2 aria-hidden="true" />{text(locale, '新建会话', 'New Session')}
                    </button> : null}
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
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
}: RemoteExpertDetailPageProps) {
  const { locale } = usePreferences()
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

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Bot}
        title={expert?.name ?? text(locale, '专家详情', 'Expert detail')}
        description={expert ? expert.id : text(locale, '服务端 Expert 配置', 'Server-managed Expert configuration')}
        onOpenNavigation={onOpenNavigation}
        actions={<>
          {canManage && onEdit ? <button type="button" className="cosmos-button cosmos-button--secondary" onClick={onEdit}>
            <Pencil aria-hidden="true" />{text(locale, '编辑', 'Edit')}
          </button> : null}
          {startable && sessionCreationEnabled ? (
            <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => onStartSession(expertId)}>
              <FilePlus2 aria-hidden="true" />{text(locale, '新建会话', 'New Session')}
            </button>
          ) : null}
        </>}
      />
      <div className="cosmos-page__scroll">
        <button type="button" className="remote-catalog-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />{text(locale, '返回专家库', 'Back to Experts')}
        </button>
        {detail.status === 'loading' ? <LoadState status="loading" resource={text(locale, '专家详情', 'Expert detail')} onRetry={detail.retry} /> : null}
        {detail.status === 'not_found' ? <LoadState status="not_found" resource={text(locale, '专家', 'Expert')} error={detail.error} onRetry={detail.retry} /> : null}
        {detail.status === 'error' ? <LoadState status="error" resource={text(locale, '专家详情', 'Expert detail')} error={detail.error} onRetry={detail.retry} /> : null}
        {expert ? (
          <section className="cosmos-panel remote-detail-panel">
            <header className="remote-detail-panel__identity">
              <span className="cosmos-resource-row__icon"><Bot aria-hidden="true" /></span>
              <div><h2>{expert.name}</h2><p>{expert.description || text(locale, '暂无说明', 'No description')}</p></div>
              <StatusLabel status={expert.status} />
            </header>
            <dl className="remote-detail-specs">
              <div><dt>{text(locale, '资源版本', 'Resource version')}</dt><dd>v{expert.version}</dd></div>
              <div><dt>{text(locale, '发布版本', 'Published revision')}</dt><dd>{revision ? `v${revision.revision}` : '—'}</dd></div>
              <div><dt>{text(locale, '可见范围', 'Visibility')}</dt><dd>{expert.visibility === 'space' ? 'Space' : text(locale, '仅创建者', 'Creator only')}</dd></div>
              <div><dt>{text(locale, '更新时间', 'Updated')}</dt><dd>{formatDate(expert.updatedAt, locale)}</dd></div>
            </dl>
            {revision ? (
              <>
                <section className="remote-detail-section">
                  <header><ServerCog aria-hidden="true" /><h3>{text(locale, '运行配置', 'Runtime')}</h3></header>
                  <dl className="remote-detail-list">
                    <div><dt>{text(locale, '模型', 'Model')}</dt><dd>{revision.model}</dd></div>
                    <div><dt>Environment</dt><dd><code>{revision.environmentId}</code></dd></div>
                    <div><dt>Environment revision</dt><dd><code>{revision.environmentRevisionId}</code></dd></div>
                    <div><dt>{text(locale, '仓库覆盖', 'Repository override')}</dt><dd>{revision.allowRepositoryOverride ? text(locale, '允许', 'Allowed') : text(locale, '锁定', 'Locked')}</dd></div>
                    <div><dt>{text(locale, '基础分支覆盖', 'Base branch override')}</dt><dd>{revision.allowBaseBranchOverride ? text(locale, '允许', 'Allowed') : text(locale, '锁定', 'Locked')}</dd></div>
                  </dl>
                </section>
                <section className="remote-detail-section">
                  <header><ShieldCheck aria-hidden="true" /><h3>{text(locale, '指令', 'Instructions')}</h3></header>
                  <pre>{revision.instructions || text(locale, '未配置指令', 'No instructions configured')}</pre>
                </section>
              </>
            ) : (
              <div className="remote-detail-unavailable"><CircleOff aria-hidden="true" />{text(locale, '当前 Expert 没有可用的已发布版本。', 'This Expert has no available published revision.')}</div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
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
}: RemoteExpertEditorPageProps) {
  const { locale } = usePreferences()
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

  if (expertId && detail.status === 'loading' && !expert) {
    return <main className="cosmos-page remote-catalog-page"><PageHeader icon={Bot} title={text(locale, '编辑 Expert', 'Edit Expert')} description="" onOpenNavigation={onOpenNavigation} /><div className="cosmos-page__scroll"><LoadState status="loading" resource="Expert" onRetry={detail.retry} /></div></main>
  }
  if (expertId && (detail.status === 'error' || detail.status === 'not_found') && !expert) {
    return <main className="cosmos-page remote-catalog-page"><PageHeader icon={Bot} title={text(locale, '编辑 Expert', 'Edit Expert')} description="" onOpenNavigation={onOpenNavigation} /><div className="cosmos-page__scroll"><LoadState status={detail.status} resource="Expert" error={detail.error} onRetry={detail.retry} /></div></main>
  }

  return (
    <main className="cosmos-page remote-catalog-page remote-expert-editor">
      <PageHeader
        icon={Bot}
        title={expert ? expert.name : text(locale, '新建 Expert', 'New Expert')}
        description={expert
          ? text(locale, `资源版本 v${expert.version}`, `Resource version v${expert.version}`)
          : text(locale, '创建可发布、可复用的工作流配置', 'Create a publishable, reusable workflow configuration')}
        onOpenNavigation={onOpenNavigation}
        actions={<>
          <button type="button" className="cosmos-button cosmos-button--secondary" disabled={!valid || busy !== undefined} onClick={save}>
            <Save aria-hidden="true" />{busy === 'save' ? text(locale, '保存中…', 'Saving…') : text(locale, '保存草稿', 'Save draft')}
          </button>
          <button type="button" className="cosmos-button cosmos-button--primary" disabled={!valid || busy !== undefined} onClick={publish}>
            <Rocket aria-hidden="true" />{busy === 'publish' ? text(locale, '发布中…', 'Publishing…') : text(locale, '发布', 'Publish')}
          </button>
        </>}
      />
      <div className="cosmos-page__scroll remote-expert-editor__scroll">
        <button type="button" className="remote-catalog-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />{text(locale, '返回专家库', 'Back to Experts')}
        </button>
        {error ? <div className="remote-expert-editor__error" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>{text(locale, '操作未完成', 'Operation not completed')}</strong><small>{error.message}</small></span>{error instanceof CosmosApiError && error.status === 412 ? <button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => { setSavedExpert(undefined); detail.retry() }}>{text(locale, '重新加载', 'Reload')}</button> : null}</div> : null}
        <div className="remote-expert-editor__layout">
          <div className="remote-expert-editor__main">
            <section className="cosmos-panel remote-expert-form-section">
              <header><span>01</span><div><h2>{text(locale, '基本信息', 'Identity')}</h2><p>{text(locale, '用于列表检索和团队识别。', 'Used for discovery and team recognition.')}</p></div></header>
              <div className="remote-expert-form-grid remote-expert-form-grid--two">
                <label className="field"><span>{text(locale, '名称', 'Name')}</span><input aria-label={text(locale, '名称', 'Name')} value={form.name} maxLength={160} onChange={(event) => field('name', event.target.value)} /></label>
                <label className="field field--select"><span>{text(locale, '可见范围', 'Visibility')}</span><select aria-label={text(locale, '可见范围', 'Visibility')} value={form.visibility} onChange={(event) => field('visibility', event.target.value as ExpertEditorForm['visibility'])}><option value="space">Space</option><option value="private">{text(locale, '仅自己', 'Private')}</option></select></label>
              </div>
              <label className="field"><span>{text(locale, '描述', 'Description')}</span><textarea aria-label={text(locale, '描述', 'Description')} rows={3} maxLength={2000} value={form.description} onChange={(event) => field('description', event.target.value)} /></label>
              <label className="field"><span>{text(locale, '启动提示', 'Launch guidance')}</span><textarea aria-label={text(locale, '启动提示', 'Launch guidance')} rows={3} maxLength={10000} value={form.launchGuidance} onChange={(event) => field('launchGuidance', event.target.value)} /></label>
            </section>

            <section className="cosmos-panel remote-expert-form-section">
              <header><span>02</span><div><h2>{text(locale, '系统指令', 'Instructions')}</h2><p>{text(locale, '定义职责、边界和交付标准。', 'Define responsibilities, boundaries, and delivery standards.')}</p></div></header>
              <label className="field"><textarea className="remote-expert-instructions" aria-label={text(locale, '系统指令', 'Instructions')} rows={14} maxLength={100000} value={form.instructions} onChange={(event) => field('instructions', event.target.value)} /></label>
            </section>

            <section className="cosmos-panel remote-expert-form-section">
              <header><span>03</span><div><h2>{text(locale, '能力', 'Capabilities')}</h2><p>{text(locale, '只开放完成职责所需的能力。', 'Grant only the capabilities required for the role.')}</p></div></header>
              <div className="remote-expert-capabilities">{capabilityOptions.map((capability) => <label key={capability}><span><strong>{capability}</strong></span><input type="checkbox" role="switch" checked={form.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} /></label>)}</div>
            </section>
          </div>

          <aside className="remote-expert-editor__aside">
            <section className="cosmos-panel remote-expert-runtime">
              <header><ServerCog aria-hidden="true" /><h2>{text(locale, '运行配置', 'Runtime')}</h2></header>
              <label className="field field--select"><span>{text(locale, '模型', 'Model')}</span><select aria-label={text(locale, '模型', 'Model')} value={form.model} onChange={(event) => field('model', event.target.value as ExpertEditorForm['model'])}>{SUPPORTED_AGENT_MODELS.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
              <label className="field field--select"><span>Environment</span><select aria-label="Environment" value={form.environmentId} onChange={(event) => field('environmentId', event.target.value)}><option value="" disabled>{text(locale, '选择运行环境', 'Select Environment')}</option>{readyEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}</select></label>
              <div className="remote-expert-policy-row"><span><strong>{text(locale, '允许仓库覆盖', 'Repository override')}</strong></span><input type="checkbox" role="switch" checked={form.allowRepositoryOverride} onChange={(event) => field('allowRepositoryOverride', event.target.checked)} /></div>
              <div className="remote-expert-policy-row"><span><strong>{text(locale, '允许分支覆盖', 'Branch override')}</strong></span><input type="checkbox" role="switch" checked={form.allowBaseBranchOverride} onChange={(event) => field('allowBaseBranchOverride', event.target.checked)} /></div>
            </section>

            {expert ? <section className="cosmos-panel remote-expert-runtime">
              <header><History aria-hidden="true" /><h2>{text(locale, '版本', 'Revisions')}</h2></header>
              <div className="remote-expert-revisions">{revisions?.items.map((revision) => <div key={revision.id}><span><strong>v{revision.revision}</strong><small>{formatDate(revision.createdAt, locale)}</small></span><StatusLabel status={revision.status} /></div>) ?? null}</div>
            </section> : null}

            {expert?.publishedRevisionId ? <button type="button" className="cosmos-button cosmos-button--secondary remote-expert-wide-action" disabled={busy !== undefined || expert.status === 'disabled'} onClick={disable}><Power aria-hidden="true" />{busy === 'disable' ? text(locale, '停用中…', 'Disabling…') : text(locale, '停用 Expert', 'Disable Expert')}</button> : null}
            {expert && !confirmArchive ? <button type="button" className="cosmos-button cosmos-button--ghost remote-expert-wide-action remote-expert-danger" disabled={busy !== undefined} onClick={() => setConfirmArchive(true)}><Trash2 aria-hidden="true" />{text(locale, '归档 Expert', 'Archive Expert')}</button> : null}
            {expert && confirmArchive ? <div className="remote-expert-archive-confirm"><strong>{text(locale, '确认归档？', 'Archive this Expert?')}</strong><div><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => setConfirmArchive(false)}>{text(locale, '取消', 'Cancel')}</button><button type="button" className="cosmos-button cosmos-button--primary" disabled={busy !== undefined} onClick={archive}>{text(locale, '确认归档', 'Archive')}</button></div></div> : null}
          </aside>
        </div>
      </div>
    </main>
  )
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
}: RemoteEnvironmentsPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingExisting, setEditingExisting] = useState(false)
  const [busy, setBusy] = useState<'retry' | 'disable' | 'archive'>()
  const [mutationError, setMutationError] = useState<Error>()
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

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Container}
        title={text(locale, '运行环境', 'Environments')}
        description={text(locale, '当前 Space 中由服务端管理的运行环境', 'Server-managed runtimes in this Space')}
        onOpenNavigation={onOpenNavigation}
        actions={canManage ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { setEditingExisting(false); setEditorOpen(true) }}><Plus aria-hidden="true" />{text(locale, '创建环境', 'Create Environment')}</button> : undefined}
      />
      <div className="cosmos-page__scroll">
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, '运行环境', 'Environments')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, '运行环境', 'Environments')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 && !editorOpen ? (
          <section className="cosmos-panel remote-catalog-empty"><Container aria-hidden="true" /><strong>{text(locale, '暂无运行环境', 'No Environments')}</strong>{canManage ? <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { setEditingExisting(false); setEditorOpen(true) }}><Plus aria-hidden="true" />{text(locale, '创建环境', 'Create Environment')}</button> : null}</section>
        ) : null}
        {state === 'ready' && (items.length > 0 || editorOpen) ? (
          <section className="remote-environment-layout">
            <aside className="cosmos-panel remote-environment-list" aria-label={text(locale, '运行环境列表', 'Environment list')}>
              <header className="cosmos-section-heading">
                <div><span>Catalog</span><h2>{text(locale, `${items.length} 个运行环境`, `${items.length} Environments`)}</h2></div>
                <IconButton icon={RefreshCw} label={text(locale, '刷新运行环境列表', 'Refresh Environment list')} onClick={onRetry} />
              </header>
              {items.map((item) => (
                <button
                  type="button"
                  className={`remote-environment-row${item.id === selectedEnvironmentId ? ' remote-environment-row--selected' : ''}`}
                  aria-pressed={item.id === selectedEnvironmentId}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="cosmos-resource-row__icon"><Box aria-hidden="true" /></span>
                  <span><strong>{item.name}</strong><small>{item.activeRevision?.defaultRepository.repository ?? text(locale, '未绑定默认仓库', 'No default repository')}</small></span>
                  <StatusLabel status={item.status} />
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </aside>
            <section className="cosmos-panel remote-environment-detail" aria-label={text(locale, '运行环境详情', 'Environment detail')}>
              {editorOpen ? <EnvironmentEditor
                environment={editingExisting ? environment : undefined}
                organizationId={organizationId}
                spaceId={spaceId}
                auth={requestAuth}
                onCancel={() => setEditorOpen(false)}
                onSaved={(next) => { setEditorOpen(false); refreshAfterMutation(next) }}
              /> : null}
              {!editorOpen ? <>
              {detail.status === 'loading' ? <LoadState status="loading" resource={text(locale, '运行环境详情', 'Environment detail')} onRetry={detail.retry} /> : null}
              {detail.status === 'not_found' ? <LoadState status="not_found" resource={text(locale, '运行环境', 'Environment')} error={detail.error} onRetry={detail.retry} /> : null}
              {detail.status === 'error' ? <LoadState status="error" resource={text(locale, '运行环境详情', 'Environment detail')} error={detail.error} onRetry={detail.retry} /> : null}
              {environment ? <EnvironmentDetail
                environment={environment}
                revisions={revisions.status === 'ready' ? revisions.item?.items ?? [] : []}
                canManage={canManage}
                busy={busy}
                error={mutationError}
                onEdit={() => { setEditingExisting(true); setEditorOpen(true) }}
                onRetry={() => void runAction('retry')}
                onDisable={() => void runAction('disable')}
                onArchive={() => void runAction('archive')}
              /> : null}
              </> : null}
            </section>
          </section>
        ) : null}
      </div>
    </main>
  )
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
  onCancel,
  onSaved,
}: {
  environment?: EnvironmentDetailDto
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  onCancel: () => void
  onSaved: (environment: EnvironmentDetailDto) => void
}) {
  const { locale } = usePreferences()
  const [state, setState] = useState(() => editorState(environment))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error>()
  const patchState = <Key extends keyof EnvironmentEditorState>(key: Key, value: EnvironmentEditorState[Key]) => {
    setState((current) => ({ ...current, [key]: value }))
  }
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

  return <form className="remote-environment-editor" onSubmit={(event) => void submit(event)}>
    <header><div><span>{environment ? text(locale, '新配置版本', 'New configuration revision') : text(locale, '新环境', 'New Environment')}</span><h2>{environment ? environment.name : text(locale, '创建运行环境', 'Create Environment')}</h2></div><IconButton icon={X} label={text(locale, '关闭编辑器', 'Close editor')} onClick={onCancel} /></header>
    {error ? <InlineError error={error} /> : null}
    <div className="remote-environment-form-grid">
      <label><span>{text(locale, '类型', 'Type')}</span><select value={state.type} disabled={Boolean(environment)} onChange={(event) => patchState('type', event.target.value as EnvironmentEditorState['type'])}><option value="cloud">Cloud</option><option value="daemon">Self-hosted / Daemon</option></select></label>
      <label><span>{text(locale, '名称', 'Name')}</span><input required maxLength={160} value={state.name} onChange={(event) => patchState('name', event.target.value)} /></label>
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
      onAdd={() => patchState('variables', [...state.variables, { name: '', secretId: '' }])}
      onRemove={(index) => patchState('variables', state.variables.filter((_, rowIndex) => rowIndex !== index))}
      render={(row, index) => <>
        <input required aria-label={text(locale, '变量名', 'Variable name')} value={row.name} onChange={(event) => patchState('variables', state.variables.map((item, rowIndex) => rowIndex === index ? { ...item, name: event.target.value } : item))} />
        <input required aria-label="Secret reference ID" value={row.secretId} onChange={(event) => patchState('variables', state.variables.map((item, rowIndex) => rowIndex === index ? { ...item, secretId: event.target.value } : item))} />
      </>}
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
    <footer><button type="button" className="cosmos-button cosmos-button--secondary" onClick={onCancel}>{text(locale, '取消', 'Cancel')}</button><button type="submit" className="cosmos-button cosmos-button--primary" disabled={saving}><Save aria-hidden="true" />{saving ? text(locale, '保存中…', 'Saving…') : text(locale, '保存并配置', 'Save and provision')}</button></footer>
  </form>
}

function EnvironmentArrayEditor<Row>({ title, rows, onAdd, onRemove, render }: {
  title: string
  rows: Row[]
  onAdd: () => void
  onRemove: (index: number) => void
  render: (row: Row, index: number) => ReactNode
}) {
  const { locale } = usePreferences()
  return <section className="remote-environment-array"><header><h3>{title}</h3><IconButton icon={Plus} label={`${text(locale, '添加', 'Add')} ${title}`} onClick={onAdd} /></header>{rows.map((row, index) => <div className="remote-environment-array__row" key={index}>{render(row, index)}<IconButton icon={Trash2} label={`${text(locale, '删除', 'Remove')} ${title}`} onClick={() => onRemove(index)} /></div>)}</section>
}

function InlineError({ error }: { error: Error }) {
  const { locale } = usePreferences()
  return <div className="remote-expert-editor__error" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>{text(locale, '操作未完成', 'Operation not completed')}</strong><small>{error.message}</small></span></div>
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
