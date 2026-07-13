import type {
  EnvironmentDetailDto,
  EnvironmentStatus,
  EnvironmentSummaryDto,
  ExpertDetailDto,
  ExpertStatus,
  ExpertSummaryDto,
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
  LoaderCircle,
  LockKeyhole,
  Menu,
  FilePlus2,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  RelayApiError,
  getEnvironment,
  getExpert,
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
}

export type RemoteExpertDetailPageProps = RemoteCatalogRequestProps & {
  expertId: string
  onOpenNavigation?: () => void
  onBack: () => void
  onStartSession: (expertId: string) => void
  sessionCreationEnabled?: boolean
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
}: {
  icon: typeof Bot
  title: string
  description: string
  onOpenNavigation?: () => void
  actions?: ReactNode
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
        <span className="remote-catalog-readonly"><LockKeyhole aria-hidden="true" />{text(locale, '只读', 'Read only')}</span>
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
      />
      <div className="cosmos-page__scroll">
        <ReadOnlyNote>{text(
          locale,
          '当前开放查询和会话创建；是否立即执行由部署能力决定。Expert 的创建、编辑与发布尚未接入生产 API。',
          'Query and Session creation are available; deployment capabilities decide whether execution starts immediately. Expert create, edit, and publish are not connected to the production API.',
        )}</ReadOnlyNote>
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
        actions={startable && sessionCreationEnabled ? (
          <button type="button" className="cosmos-button cosmos-button--primary" onClick={() => onStartSession(expertId)}>
            <FilePlus2 aria-hidden="true" />{text(locale, '新建会话', 'New Session')}
          </button>
        ) : null}
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
            <ReadOnlyNote>{text(locale, '这是已保存的服务端配置。当前页面不提供编辑或发布操作。', 'This is the saved server configuration. Editing and publishing are not available here.')}</ReadOnlyNote>
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
