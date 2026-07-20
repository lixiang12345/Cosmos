import type {
  ContextEngineHit,
  ContextEngineStatus,
  ContextPackResponse,
  ContextRetrievalMode,
  ContextSearchResponse,
} from '@relay/contracts'
import {
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  Copy,
  DatabaseZap,
  FileCode2,
  GitFork,
  Layers3,
  LoaderCircle,
  Menu,
  PackageCheck,
  Search,
  Send,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { GlobalControls } from '../components/GlobalControls'
import { createDemoContextStatus, packDemoContext, searchDemoContext } from '../data/contextEngineDemo'
import { usePreferences } from '../preferences'
import {
  getContextEngineStatus,
  packContextEngine,
  searchContextEngine,
  type RelayApiAuthContext,
} from '../services/relayApi'
import { useAuth } from '../auth/context'
import { useActiveWorkspace } from '../workspace'

export type ContextRepositoryOption = {
  id: string
  fullName: string
  defaultBranch: string
}

export type ContextWorkspacePageProps = {
  repositories: ContextRepositoryOption[]
  demoMode: boolean
  contextEnabled: boolean
  onOpenNavigation: () => void
  onNewTask: (expertId?: string, initialPrompt?: string) => void
}

type RequestState = 'idle' | 'loading' | 'ready' | 'error'
type StatusSnapshot = {
  repository: string
  state: Extract<RequestState, 'ready' | 'error'>
  status?: ContextEngineStatus
  error: string
}

const sampleQueries = {
  zh: ['支付重试策略在哪里实现？', '鉴权中间件如何校验租户边界？', '定位文件写入与审计链路'],
  en: ['Where is payment retry implemented?', 'How does auth enforce tenant boundaries?', 'Trace file writes and their audit trail'],
} as const

function formatNumber(value: number, locale: 'zh' | 'en') {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact' }).format(value)
}

function formatRelativeTimestamp(value: string | null, locale: 'zh' | 'en') {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return '—'
  const elapsedSeconds = (Date.now() - timestamp) / 1_000
  const absoluteSeconds = Math.abs(elapsedSeconds)
  const unit = absoluteSeconds < 60
    ? 'second'
    : absoluteSeconds < 3_600
      ? 'minute'
      : absoluteSeconds < 86_400
        ? 'hour'
        : 'day'
  const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3_600 : 86_400
  const rounded = Math.round(elapsedSeconds / divisor)
  const amount = rounded === 0 ? (elapsedSeconds < 0 ? -1 : 1) : rounded
  return new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { numeric: 'auto' }).format(-amount, unit)
}

function displayError(error: unknown, locale: 'zh' | 'en') {
  if (error instanceof Error && error.message.trim()) return error.message
  return locale === 'zh' ? '上下文请求失败，请稍后重试。' : 'The context request failed. Try again.'
}

function ContextMetric({ icon: Icon, label, value, detail }: {
  icon: typeof DatabaseZap
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="context-metric">
      <span><Icon aria-hidden="true" /></span>
      <div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>
    </div>
  )
}

function HitRow({ hit, active, onSelect }: {
  hit: ContextEngineHit
  active: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={`context-hit${active ? ' context-hit--active' : ''}`} onClick={onSelect}>
      <span className="context-hit__icon"><FileCode2 aria-hidden="true" /></span>
      <span className="context-hit__body">
        <strong>{hit.path}</strong>
        <small>{hit.symbol ?? hit.language} · L{hit.startLine}–{hit.endLine}</small>
        <p>{hit.preview}</p>
        <span className="context-hit__channels">
          {(hit.channels.length ? hit.channels : [hit.source]).slice(0, 3).map((channel) => <em key={channel}>{channel}</em>)}
        </span>
      </span>
      <span className="context-hit__score">{Math.round(hit.score * 100)}<small>%</small></span>
      <ChevronRight aria-hidden="true" />
    </button>
  )
}

export function ContextWorkspacePage({
  repositories,
  demoMode,
  contextEnabled,
  onOpenNavigation,
  onNewTask,
}: ContextWorkspacePageProps) {
  const { locale } = usePreferences()
  const auth = useAuth()
  const workspace = useActiveWorkspace()
  const [repository, setRepository] = useState(repositories[0]?.fullName ?? '')
  const [query, setQuery] = useState('')
  const [pathPrefix, setPathPrefix] = useState('')
  const [mode, setMode] = useState<ContextRetrievalMode>('auto')
  const [statusSnapshot, setStatusSnapshot] = useState<StatusSnapshot>()
  const [result, setResult] = useState<ContextSearchResponse>()
  const [resultRepository, setResultRepository] = useState('')
  const [searchState, setSearchState] = useState<RequestState>('idle')
  const [searchError, setSearchError] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [pack, setPack] = useState<ContextPackResponse>()
  const [packRepository, setPackRepository] = useState('')
  const [packState, setPackState] = useState<RequestState>('idle')
  const [packError, setPackError] = useState('')
  const [copied, setCopied] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)
  const packAbortRef = useRef<AbortController | null>(null)
  const available = demoMode || contextEnabled
  const activeRepository = repositories.some((item) => item.fullName === repository)
    ? repository
    : repositories[0]?.fullName ?? ''
  const currentStatusSnapshot = statusSnapshot?.repository === activeRepository ? statusSnapshot : undefined
  const visibleStatus = currentStatusSnapshot?.status
  const statusState: RequestState = !activeRepository || !available
    ? 'idle'
    : currentStatusSnapshot?.state ?? 'loading'
  const statusError = currentStatusSnapshot?.error ?? ''
  const visibleResult = resultRepository === activeRepository ? result : undefined
  const visiblePack = packRepository === activeRepository ? pack : undefined
  const selectedHit = visibleResult?.hits.find((hit) => hit.path === selectedPath) ?? visibleResult?.hits[0]
  const authContext = useMemo<RelayApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: `${auth.actorId ?? 'anonymous'}:${auth.credentialVersion}`,
    onUnauthorized: auth.handleUnauthorized,
  }), [auth.accessToken, auth.actorId, auth.credentialVersion, auth.handleUnauthorized])

  useEffect(() => {
    if (!activeRepository || !available) {
      return
    }
    const controller = new AbortController()
    const request = demoMode
      ? Promise.resolve(createDemoContextStatus(activeRepository))
      : getContextEngineStatus(
          workspace.organization.id,
          workspace.space.id,
          activeRepository,
          authContext,
          controller.signal,
        )
    void request.then((next) => {
      if (controller.signal.aborted) return
      setStatusSnapshot({ repository: activeRepository, state: 'ready', status: next, error: '' })
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      setStatusSnapshot({
        repository: activeRepository,
        state: 'error',
        error: displayError(error, locale),
      })
    })
    return () => controller.abort()
  }, [activeRepository, authContext, available, demoMode, locale, workspace.organization.id, workspace.space.id])

  useEffect(() => () => {
    searchAbortRef.current?.abort()
    packAbortRef.current?.abort()
  }, [])

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = query.trim()
    if (!value || !activeRepository || !available || searchState === 'loading') return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchState('loading')
    setSearchError('')
    setPack(undefined)
    setPackError('')
    try {
      const input = {
        repository: activeRepository,
        query: value,
        topK: 10,
        mode,
        expandGraph: true,
        ...(pathPrefix.trim() ? { pathPrefix: pathPrefix.trim() } : {}),
      }
      const next = demoMode
        ? searchDemoContext(input)
        : await searchContextEngine(
            workspace.organization.id,
            workspace.space.id,
            input,
            authContext,
            controller.signal,
          )
      if (controller.signal.aborted) return
      setResult(next)
      setResultRepository(activeRepository)
      setSelectedPath(next.hits[0]?.path ?? '')
      setSearchState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setSearchError(displayError(error, locale))
      setSearchState('error')
    }
  }

  const buildPack = async () => {
    const value = query.trim()
    if (!value || !activeRepository || !available || packState === 'loading') return
    packAbortRef.current?.abort()
    const controller = new AbortController()
    packAbortRef.current = controller
    setPackState('loading')
    setPackError('')
    try {
      const input = {
        repository: activeRepository,
        task: value,
        topK: 14,
        maxTokens: 16_000,
        ...(pathPrefix.trim() ? { pathPrefix: pathPrefix.trim() } : {}),
      }
      const next = demoMode
        ? packDemoContext(input)
        : await packContextEngine(
            workspace.organization.id,
            workspace.space.id,
            input,
            authContext,
            controller.signal,
          )
      if (controller.signal.aborted) return
      setPack(next)
      setPackRepository(activeRepository)
      setPackState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setPackError(displayError(error, locale))
      setPackState('error')
    }
  }

  const copyReference = async () => {
    if (!selectedHit) return
    await navigator.clipboard.writeText(`${selectedHit.path}:${selectedHit.startLine}-${selectedHit.endLine}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  const copy = locale === 'zh'
    ? {
        title: '上下文工作区', description: '在启动 Agent 前检索、审阅并打包代码库证据。', repository: '代码库',
        indexed: '索引状态', ready: '已就绪', unavailable: '未配置', files: '索引文件', chunks: '上下文分片',
        mode: '检索模式', hybrid: '混合检索', updated: '最近同步', searchPlaceholder: '描述你要理解或修改的内容…',
        pathPlaceholder: '可选路径范围，例如 src/api', search: '检索证据', searching: '正在检索', pack: '打包上下文',
        packing: '正在打包', results: '证据结果', resultHint: '按多路召回、图关系与相关性综合排序', detail: '证据预览',
        noResults: '没有找到匹配证据。尝试移除路径限制或换一种描述。', start: '用此任务开始会话', copied: '已复制',
        copyRef: '复制引用', packReady: 'Agent 上下文包', tokenEstimate: '预估 token', sources: '证据来源',
        setup: 'ContextEngine 尚未在此部署启用。配置服务地址、API Key 与代码库 Workspace 映射后即可使用。',
        demo: '演示索引', demoHint: '当前展示确定性演示数据；生产模式由 ContextEngine-plugin 实时返回。',
      }

    : {
        title: 'Context workspace', description: 'Retrieve, review, and pack codebase evidence before an Agent starts.', repository: 'Repository',
        indexed: 'Index status', ready: 'Ready', unavailable: 'Not configured', files: 'Indexed files', chunks: 'Context chunks',
        mode: 'Retrieval mode', hybrid: 'Hybrid retrieval', updated: 'Last synced', searchPlaceholder: 'Describe what you need to understand or change…',
        pathPlaceholder: 'Optional path scope, e.g. src/api', search: 'Retrieve evidence', searching: 'Retrieving', pack: 'Pack context',
        packing: 'Packing', results: 'Evidence results', resultHint: 'Ranked across retrieval channels, graph links, and relevance', detail: 'Evidence preview',
        noResults: 'No matching evidence. Remove the path scope or describe the task differently.', start: 'Start a session with this task', copied: 'Copied',
        copyRef: 'Copy reference', packReady: 'Agent context pack', tokenEstimate: 'Estimated tokens', sources: 'Evidence sources',
        setup: 'ContextEngine is not enabled for this deployment. Configure the service URL, API key, and repository workspace mappings to use it.',
        demo: 'Demo index', demoHint: 'Showing deterministic demo data. Production results come directly from ContextEngine-plugin.',
      }

  const handleRepositoryChange = (nextRepository: string) => {
    setRepository(nextRepository)
    setResult(undefined)
    setResultRepository('')
    setPack(undefined)
    setPackRepository('')
    setSelectedPath('')
    setSearchState('idle')
    setSearchError('')
    setPackState('idle')
    setPackError('')
  }

  return (
    <main className="context-page">
      <header className="cosmos-page-header context-page__header">
        <div className="cosmos-page-header__identity">
          <button type="button" className="cosmos-icon-button" aria-label={locale === 'zh' ? '打开导航' : 'Open navigation'} onClick={onOpenNavigation}><Menu aria-hidden="true" /></button>
          <div><h1>{copy.title}</h1><p>{copy.description}</p></div>
        </div>
        <div className="cosmos-page-header__actions"><GlobalControls /></div>
      </header>

      <div className="context-page__scroll">
        <section className="context-index-bar" aria-label={copy.indexed}>
          <label>
            <span>{copy.repository}</span>
            <select value={activeRepository} onChange={(event) => handleRepositoryChange(event.target.value)} disabled={!repositories.length}>
              {repositories.map((item) => <option key={item.id} value={item.fullName}>{item.fullName}</option>)}
            </select>
          </label>
          <div className={`context-index-state context-index-state--${statusState}`}>
            {statusState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <DatabaseZap aria-hidden="true" />}
            <span><small>{copy.indexed}</small><strong>{visibleStatus?.indexed ? copy.ready : copy.unavailable}</strong></span>
          </div>
          {demoMode ? <span className="context-demo-badge" title={copy.demoHint}><Sparkles aria-hidden="true" />{copy.demo}</span> : null}
        </section>

        {!available ? <section className="context-setup-state"><DatabaseZap aria-hidden="true" /><h2>{copy.unavailable}</h2><p>{copy.setup}</p><code>CONTEXT_ENGINE_BASE_URL · CONTEXT_ENGINE_WORKSPACES_JSON</code></section> : (
          <>
            {statusError ? <p className="context-inline-error" role="alert">{statusError}</p> : null}
            <section className="context-metrics-grid">
              <ContextMetric icon={FileCode2} label={copy.files} value={formatNumber(visibleStatus?.stats.files ?? 0, locale)} detail={activeRepository || '—'} />
              <ContextMetric icon={Layers3} label={copy.chunks} value={formatNumber(visibleStatus?.stats.chunks ?? 0, locale)} detail={`${formatNumber(visibleStatus?.stats.symbols ?? 0, locale)} symbols`} />
              <ContextMetric icon={Waypoints} label={copy.mode} value={visibleStatus?.retrievalMode === 'hybrid' ? copy.hybrid : 'BM25'} detail="FTS · symbol · graph · MMR" />
              <ContextMetric icon={Clock3} label={copy.updated} value={formatRelativeTimestamp(visibleStatus?.updatedAt ?? null, locale)} detail={`revision ${visibleStatus?.revision ?? '—'}`} />
            </section>

            <form className="context-query" onSubmit={(event) => { void runSearch(event) }}>
              <div className="context-query__main">
                <Search aria-hidden="true" />
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchPlaceholder}
                  rows={2}
                />
                <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ↵</kbd>
              </div>
              <div className="context-query__controls">
                <label><GitFork aria-hidden="true" /><input value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} placeholder={copy.pathPlaceholder} aria-label={copy.pathPlaceholder} /></label>
                <label><CircleGauge aria-hidden="true" /><select value={mode} onChange={(event) => setMode(event.target.value as ContextRetrievalMode)} aria-label={copy.mode}><option value="auto">Auto</option><option value="hybrid">Hybrid</option><option value="bm25">BM25</option><option value="semantic">Semantic</option></select></label>
                <button type="submit" className="cosmos-button cosmos-button--primary" disabled={!query.trim() || searchState === 'loading'}>
                  {searchState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                  {searchState === 'loading' ? copy.searching : copy.search}
                </button>
              </div>
            </form>

            {searchState === 'idle' ? <section className="context-examples"><p>{locale === 'zh' ? '从一个真实问题开始' : 'Start with a real question'}</p><div>{sampleQueries[locale].map((sample) => <button type="button" key={sample} onClick={() => setQuery(sample)}>{sample}<ArrowRight aria-hidden="true" /></button>)}</div></section> : null}
            {searchError ? <p className="context-inline-error" role="alert">{searchError}</p> : null}

            {visibleResult ? <section className="context-results" aria-label={copy.results}>
              <header><div><p>{copy.results}</p><h2>{visibleResult.hits.length} {locale === 'zh' ? '项高相关证据' : 'high-confidence sources'}</h2></div><span>{visibleResult.durationMs}ms · {copy.resultHint}</span></header>
              {visibleResult.hits.length ? <div className="context-results__grid">
                <div className="context-hit-list">{visibleResult.hits.map((hit) => <HitRow key={`${hit.path}:${hit.startLine}`} hit={hit} active={selectedHit?.path === hit.path} onSelect={() => setSelectedPath(hit.path)} />)}</div>
                {selectedHit ? <article className="context-preview">
                  <header><span><Braces aria-hidden="true" /></span><div><small>{copy.detail}</small><strong>{selectedHit.path}</strong><p>L{selectedHit.startLine}–{selectedHit.endLine}{selectedHit.symbol ? ` · ${selectedHit.symbol}` : ''}</p></div><button type="button" onClick={() => { void copyReference() }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? copy.copied : copy.copyRef}</button></header>
                  <pre><code>{selectedHit.content}</code></pre>
                  <footer><span>{selectedHit.language}</span><span>{selectedHit.source}</span>{selectedHit.channels.map((channel) => <span key={channel}>{channel}</span>)}</footer>
                </article> : null}
              </div> : <p className="context-empty">{copy.noResults}</p>}
              {visibleResult.hits.length ? <footer className="context-results__actions"><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => { void buildPack() }} disabled={packState === 'loading'}>{packState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <PackageCheck aria-hidden="true" />}{packState === 'loading' ? copy.packing : copy.pack}</button><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => onNewTask(undefined, query.trim())}><Send aria-hidden="true" />{copy.start}</button></footer> : null}
            </section> : null}

            {packError ? <p className="context-inline-error" role="alert">{packError}</p> : null}
            {visiblePack ? <section className="context-pack" aria-live="polite"><span className="context-pack__icon"><PackageCheck aria-hidden="true" /></span><div><small>{copy.packReady}</small><h2>{visiblePack.hits.length} {copy.sources} · {formatNumber(visiblePack.estimatedTokens, locale)} {copy.tokenEstimate}</h2><p>{visiblePack.hits.slice(0, 5).map((hit) => hit.path).join(' · ')}</p></div><span className="context-pack__check"><Check aria-hidden="true" /></span></section> : null}
          </>
        )}
      </div>
    </main>
  )
}
