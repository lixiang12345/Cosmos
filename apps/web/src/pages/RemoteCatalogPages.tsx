import {
  DEFAULT_AGENT_MODEL,
  SUPPORTED_AGENT_MODELS,
  type EnvironmentDetailDto,
  type EnvironmentStatus,
  type EnvironmentSummaryDto,
  type ExpertDetailDto,
  type ExpertRevisionListResponse,
  type ExpertStatus,
  type ExpertSummaryDto,
} from '@relay/contracts'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  ChevronRight,
  CircleOff,
  Clock3,
  Container,
  GitBranch,
  History,
  LoaderCircle,
  LockKeyhole,
  Menu,
  FilePlus2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Save,
  ServerCog,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  RelayApiError,
  archiveExpert,
  createExpert,
  disableExpert,
  getEnvironment,
  getExpert,
  listExpertRevisions,
  publishExpert,
  updateExpert,
  type RelayApiAuthContext,
} from '../services/relayApi'

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
  auth: RelayApiAuthContext
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
  & { onOpenNavigation?: () => void }

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
          status: cause instanceof RelayApiError && cause.status === 404 ? 'not_found' : 'error',
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

function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <div className="remote-catalog-note" role="note">
      <ShieldCheck aria-hidden="true" />
      <span>{children}</span>
    </div>
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
  const requestAuth = useMemo<RelayApiAuthContext>(() => ({
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
  const requestAuth = useMemo<RelayApiAuthContext>(() => ({
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
        {error ? <div className="remote-expert-editor__error" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>{text(locale, '操作未完成', 'Operation not completed')}</strong><small>{error.message}</small></span>{error instanceof RelayApiError && error.status === 412 ? <button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => { setSavedExpert(undefined); detail.retry() }}>{text(locale, '重新加载', 'Reload')}</button> : null}</div> : null}
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
}: RemoteEnvironmentsPageProps) {
  const { locale } = usePreferences()
  const [selectedId, setSelectedId] = useState<string>()
  const state = listState(loading, ready, error)
  const selectedSummary = items.find((item) => item.id === selectedId) ?? items[0]
  const selectedEnvironmentId = state === 'ready' ? selectedSummary?.id : undefined
  const requestAuth = useMemo<RelayApiAuthContext>(() => ({
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

  return (
    <main className="cosmos-page remote-catalog-page">
      <PageHeader
        icon={Container}
        title={text(locale, '运行环境', 'Environments')}
        description={text(locale, '当前 Space 中由服务端管理的运行环境', 'Server-managed runtimes in this Space')}
        onOpenNavigation={onOpenNavigation}
        readOnly
      />
      <div className="cosmos-page__scroll">
        <ReadOnlyNote>{text(
          locale,
          '当前仅开放查询；创建、编辑、变量与重新配置尚未接入生产 API。',
          'Query is available. Create, edit, variables, and reprovisioning are not connected to the production API.',
        )}</ReadOnlyNote>
        {state === 'loading' ? <LoadState status="loading" resource={text(locale, '运行环境', 'Environments')} onRetry={onRetry} /> : null}
        {state === 'error' ? <LoadState status="error" resource={text(locale, '运行环境', 'Environments')} error={error} onRetry={onRetry} /> : null}
        {state === 'ready' && items.length === 0 ? (
          <section className="cosmos-panel remote-catalog-empty"><Container aria-hidden="true" /><strong>{text(locale, '暂无运行环境', 'No Environments')}</strong></section>
        ) : null}
        {state === 'ready' && items.length > 0 ? (
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
              {detail.status === 'loading' ? <LoadState status="loading" resource={text(locale, '运行环境详情', 'Environment detail')} onRetry={detail.retry} /> : null}
              {detail.status === 'not_found' ? <LoadState status="not_found" resource={text(locale, '运行环境', 'Environment')} error={detail.error} onRetry={detail.retry} /> : null}
              {detail.status === 'error' ? <LoadState status="error" resource={text(locale, '运行环境详情', 'Environment detail')} error={detail.error} onRetry={detail.retry} /> : null}
              {environment ? <EnvironmentDetail environment={environment} /> : null}
            </section>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function EnvironmentDetail({ environment }: { environment: EnvironmentDetailDto }) {
  const { locale } = usePreferences()
  const revision = environment.activeRevision
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
      </dl>
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
      <footer className="remote-detail-footer"><Clock3 aria-hidden="true" />{text(locale, '创建于', 'Created')} {formatDate(environment.createdAt, locale)}</footer>
    </>
  )
}
