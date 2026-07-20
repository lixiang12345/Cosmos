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
  CheckCircle2,
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
  Network,
  PackageCheck,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Waypoints,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
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
  onNewTask: (expertId?: string, initialPrompt?: string, contextPack?: ContextPackResponse) => void
}

type RequestState = 'idle' | 'loading' | 'ready' | 'error'
type StatusSnapshot = {
  repository: string
  state: Extract<RequestState, 'ready' | 'error'>
  status?: ContextEngineStatus
  error: string
}

const sampleQueries = {
  zh: [
    { query: '支付重试策略在哪里实现？', detail: '定位策略、调用方与回归测试', icon: Zap },
    { query: '鉴权中间件如何校验租户边界？', detail: '追踪权限判断和数据边界', icon: ShieldCheck },
    { query: '定位文件写入与审计链路', detail: '还原写入、事件和审计关系', icon: Network },
  ],
  en: [
    { query: 'Where is payment retry implemented?', detail: 'Find the policy, callers, and regression tests', icon: Zap },
    { query: 'How does auth enforce tenant boundaries?', detail: 'Trace permission checks and data boundaries', icon: ShieldCheck },
    { query: 'Trace file writes and their audit trail', detail: 'Map writes, events, and audit relationships', icon: Network },
  ],
} as const

const codeTokenPattern = /(\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|implements|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)\b|\b\d[\d_]*(?:\.\d+)?\b)/g

function highlightCodeLine(line: string): ReactNode[] {
  return line.split(codeTokenPattern).filter((token) => token !== '').map((token, index) => {
    const className = /^\/\//.test(token) || /^\/\*/.test(token)
      ? 'context-code__token--comment'
      : /^["'`]/.test(token)
        ? 'context-code__token--string'
        : /^\d/.test(token)
          ? 'context-code__token--number'
          : /^(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|implements|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)$/.test(token)
            ? 'context-code__token--keyword'
            : undefined
    return className ? <span className={className} key={`${index}:${token}`}>{token}</span> : token
  })
}

function CodePreview({ hit }: { hit: ContextEngineHit }) {
  const lines = hit.content.replace(/\r\n/g, '\n').split('\n')
  return (
    <div className="context-code" aria-label={`${hit.path} L${hit.startLine}–${hit.endLine}`}>
      <pre><code>{lines.map((line, index) => (
        <span className="context-code__line" key={`${hit.startLine + index}:${line}`}>
          <span className="context-code__number" aria-hidden="true">{hit.startLine + index}</span>
          <span className="context-code__content">{highlightCodeLine(line)}{'\n'}</span>
        </span>
      ))}</code></pre>
    </div>
  )
}

function describeMatch(hit: ContextEngineHit, locale: 'zh' | 'en') {
  const channels = (hit.channels.length ? hit.channels : [hit.source]).slice(0, 4).join(' + ')
  const score = Math.round(hit.score * 100)
  return locale === 'zh'
    ? `${channels} 联合召回，相关度 ${score}%。已结合符号、路径与代码关系进行排序。`
    : `Retrieved through ${channels} at ${score}% relevance, ranked with symbol, path, and code relationships.`
}

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
    <button type="button" className={`context-hit${active ? ' context-hit--active' : ''}`} aria-pressed={active} onClick={onSelect}>
      <span className="context-hit__icon"><FileCode2 aria-hidden="true" /></span>
      <span className="context-hit__body">
        <strong title={hit.path}>{hit.path}</strong>
        <small>{hit.symbol ?? hit.language} · L{hit.startLine}–{hit.endLine}</small>
        <p>{hit.preview}</p>
        <span className="context-hit__channels">
          {(hit.channels.length ? hit.channels : [hit.source]).slice(0, 3).map((channel) => <em key={channel}>{channel}</em>)}
        </span>
      </span>
      <span className="context-hit__score"><strong>{Math.round(hit.score * 100)}<small>%</small></strong><span aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, hit.score * 100))}%` }} /></span></span>
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
  const [resultRequestKey, setResultRequestKey] = useState('')
  const [searchState, setSearchState] = useState<RequestState>('idle')
  const [searchError, setSearchError] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [pack, setPack] = useState<ContextPackResponse>()
  const [packRequestKey, setPackRequestKey] = useState('')
  const [packState, setPackState] = useState<RequestState>('idle')
  const [packError, setPackError] = useState('')
  const [copied, setCopied] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)
  const packAbortRef = useRef<AbortController | null>(null)
  const queryRef = useRef<HTMLTextAreaElement | null>(null)
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
  const currentSearchKey = `${activeRepository}\u0000${query.trim()}\u0000${pathPrefix.trim()}\u0000${mode}`
  const currentPackKey = `${activeRepository}\u0000${query.trim()}\u0000${pathPrefix.trim()}`
  const visibleResult = resultRequestKey === currentSearchKey ? result : undefined
  const visiblePack = packRequestKey === currentPackKey ? pack : undefined
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

  useEffect(() => {
    const focusQuery = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      event.preventDefault()
      queryRef.current?.focus()
    }
    window.addEventListener('keydown', focusQuery)
    return () => window.removeEventListener('keydown', focusQuery)
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
      setResultRequestKey(currentSearchKey)
      setSelectedPath(next.hits[0]?.path ?? '')
      setSearchState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setSearchError(displayError(error, locale))
      setSearchState('error')
    }
  }

  const buildPack = async (): Promise<ContextPackResponse | undefined> => {
    const value = query.trim()
    if (!value || !activeRepository || !available || packState === 'loading') return
    if (visiblePack) return visiblePack
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
      setPackRequestKey(currentPackKey)
      setPackState('ready')
      return next
    } catch (error) {
      if (controller.signal.aborted) return
      setPackError(displayError(error, locale))
      setPackState('error')
      return undefined
    }
  }

  const startSession = async () => {
    if (!query.trim() || packState === 'loading') return
    const nextPack = visiblePack ?? await buildPack()
    if (!nextPack) return
    onNewTask(undefined, query.trim(), nextPack)
  }

  const copyReference = async () => {
    if (!selectedHit) return
    await navigator.clipboard.writeText(`${selectedHit.path}:${selectedHit.startLine}-${selectedHit.endLine}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  const copy = locale === 'zh'
    ? {
        eyebrow: 'Context Intelligence', title: '代码上下文', description: '检索、审阅并打包可信证据，再把任务交给 Agent。', repository: '代码库',
        indexed: '索引状态', ready: '已就绪', unavailable: '未配置', files: '索引文件', chunks: '上下文分片',
        mode: '检索模式', hybrid: '混合检索', updated: '最近同步', searchPlaceholder: '描述你要理解或修改的内容…',
        pathPlaceholder: '可选路径范围，例如 src/api', search: '检索证据', searching: '正在检索', pack: '打包上下文',
        packing: '正在打包', results: '证据结果', resultHint: '按多路召回、图关系与相关性综合排序', detail: '证据预览',
        noResults: '没有找到匹配证据。尝试移除路径限制或换一种描述。', start: '用此任务开始会话', copied: '已复制',
        copyRef: '复制引用', packReady: 'Agent 上下文包', tokenEstimate: '预估 token', sources: '证据来源',
        askLabel: '向代码库提问', askDetail: '一次描述目标，ContextEngine 会联动全文、符号、语义与代码关系。',
        startingPoint: '建议起点', startingTitle: '从真实工程问题开始，而不是猜关键词',
        startingDetail: '选择一个示例，或按 / 立即聚焦输入框。检索后可审阅证据并安全附加到会话。',
        whyMatched: '为什么相关', confidence: '匹配置信度', rankedEvidence: '排序证据', previewHint: '逐行审阅命中内容',
        packPending: '打包后会将仓库证据作为非可信数据附加到新会话。', launch: '打包并开始会话', launchReady: '携带上下文开始会话',
        setup: 'ContextEngine 尚未在此部署启用。配置服务地址、API Key 与代码库 Workspace 映射后即可使用。',
        demo: '演示索引', demoHint: '当前展示确定性演示数据；生产模式由 ContextEngine-plugin 实时返回。',
      }

    : {
        eyebrow: 'Context Intelligence', title: 'Code context', description: 'Retrieve, review, and pack trusted evidence before handing work to an Agent.', repository: 'Repository',
        indexed: 'Index status', ready: 'Ready', unavailable: 'Not configured', files: 'Indexed files', chunks: 'Context chunks',
        mode: 'Retrieval mode', hybrid: 'Hybrid retrieval', updated: 'Last synced', searchPlaceholder: 'Describe what you need to understand or change…',
        pathPlaceholder: 'Optional path scope, e.g. src/api', search: 'Retrieve evidence', searching: 'Retrieving', pack: 'Pack context',
        packing: 'Packing', results: 'Evidence results', resultHint: 'Ranked across retrieval channels, graph links, and relevance', detail: 'Evidence preview',
        noResults: 'No matching evidence. Remove the path scope or describe the task differently.', start: 'Start a session with this task', copied: 'Copied',
        copyRef: 'Copy reference', packReady: 'Agent context pack', tokenEstimate: 'Estimated tokens', sources: 'Evidence sources',
        askLabel: 'Ask your codebase', askDetail: 'Describe the goal once. ContextEngine combines full text, symbols, semantics, and code relationships.',
        startingPoint: 'Suggested starting points', startingTitle: 'Begin with an engineering question, not guessed keywords',
        startingDetail: 'Choose an example or press / to focus the composer. Review the evidence before attaching it to a session.',
        whyMatched: 'Why this matched', confidence: 'Match confidence', rankedEvidence: 'Ranked evidence', previewHint: 'Review the matched lines',
        packPending: 'Packing attaches repository evidence to the new session as untrusted data.', launch: 'Pack and start session', launchReady: 'Start with context',
        setup: 'ContextEngine is not enabled for this deployment. Configure the service URL, API key, and repository workspace mappings to use it.',
        demo: 'Demo index', demoHint: 'Showing deterministic demo data. Production results come directly from ContextEngine-plugin.',
      }

  const handleRepositoryChange = (nextRepository: string) => {
    setRepository(nextRepository)
    setResult(undefined)
    setResultRequestKey('')
    setPack(undefined)
    setPackRequestKey('')
    setSelectedPath('')
    setSearchState('idle')
    setSearchError('')
    setPackState('idle')
    setPackError('')
  }

  return (
    <main className={`context-page${visibleResult ? ' context-page--active' : ''}`}>
      <header className="cosmos-page-header context-page__header">
        <div className="cosmos-page-header__identity context-page__identity">
          <button type="button" className="cosmos-icon-button" aria-label={locale === 'zh' ? '打开导航' : 'Open navigation'} onClick={onOpenNavigation}><Menu aria-hidden="true" /></button>
          <span className="context-page__mark"><Waypoints aria-hidden="true" /></span>
          <div><span className="context-page__eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
        </div>
        <div className="cosmos-page-header__actions"><GlobalControls /></div>
      </header>

      <div className="context-page__scroll">
        <div className="context-workspace">
          <section className="context-index-bar" aria-label={copy.indexed}>
            <label className="context-repository">
              <span>{copy.repository}</span>
              <span className="context-repository__control"><GitFork aria-hidden="true" /><select value={activeRepository} onChange={(event) => handleRepositoryChange(event.target.value)} disabled={!repositories.length}>
                {repositories.map((item) => <option key={item.id} value={item.fullName}>{item.fullName}</option>)}
              </select></span>
            </label>
            <div className="context-index-bar__status">
              <div className={`context-index-state context-index-state--${statusState}`}>
                {statusState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : visibleStatus?.indexed ? <CheckCircle2 aria-hidden="true" /> : <DatabaseZap aria-hidden="true" />}
                <span><small>{copy.indexed}</small><strong>{visibleStatus?.indexed ? copy.ready : copy.unavailable}</strong></span>
              </div>
              {demoMode ? <span className="context-demo-badge" title={copy.demoHint}><Sparkles aria-hidden="true" />{copy.demo}</span> : null}
            </div>
          </section>

          {!available ? <section className="context-setup-state"><DatabaseZap aria-hidden="true" /><h2>{copy.unavailable}</h2><p>{copy.setup}</p><code>CONTEXT_ENGINE_BASE_URL · CONTEXT_ENGINE_WORKSPACES_JSON</code></section> : (
            <>
              {statusError ? <p className="context-inline-error" role="alert">{statusError}</p> : null}
              <section className="context-metrics-grid" aria-label={locale === 'zh' ? '索引概览' : 'Index overview'}>
                <ContextMetric icon={FileCode2} label={copy.files} value={formatNumber(visibleStatus?.stats.files ?? 0, locale)} detail={activeRepository || '—'} />
                <ContextMetric icon={Layers3} label={copy.chunks} value={formatNumber(visibleStatus?.stats.chunks ?? 0, locale)} detail={`${formatNumber(visibleStatus?.stats.symbols ?? 0, locale)} symbols`} />
                <ContextMetric icon={Waypoints} label={copy.mode} value={visibleStatus?.retrievalMode === 'hybrid' ? copy.hybrid : 'BM25'} detail="FTS · symbol · graph · MMR" />
                <ContextMetric icon={Clock3} label={copy.updated} value={formatRelativeTimestamp(visibleStatus?.updatedAt ?? null, locale)} detail={`revision ${visibleStatus?.revision ?? '—'}`} />
              </section>

              <form className="context-query" aria-label={copy.askLabel} onSubmit={(event) => { void runSearch(event) }}>
                <header className="context-query__heading">
                  <span className="context-query__heading-icon"><Search aria-hidden="true" /></span>
                  <span><strong>{copy.askLabel}</strong><small>{copy.askDetail}</small></span>
                  <kbd>/ · {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ↵</kbd>
                </header>
                <div className="context-query__main">
                  <textarea
                    ref={queryRef}
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
                </div>
                <div className="context-query__controls">
                  <label className="context-query__path"><GitFork aria-hidden="true" /><input value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} placeholder={copy.pathPlaceholder} aria-label={copy.pathPlaceholder} /></label>
                  <label className="context-query__mode"><CircleGauge aria-hidden="true" /><select value={mode} onChange={(event) => setMode(event.target.value as ContextRetrievalMode)} aria-label={copy.mode}><option value="auto">Auto</option><option value="hybrid">Hybrid</option><option value="bm25">BM25</option><option value="semantic">Semantic</option></select></label>
                  <button type="submit" className="cosmos-button cosmos-button--primary context-query__submit" disabled={!query.trim() || searchState === 'loading'}>
                    {searchState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                    {searchState === 'loading' ? copy.searching : copy.search}
                  </button>
                </div>
              </form>

              {!visibleResult && searchState !== 'loading' && !searchError ? <section className="context-start">
                <header><div><p>{copy.startingPoint}</p><h2>{copy.startingTitle}</h2></div><span>{copy.startingDetail}</span></header>
                <div className="context-examples">{sampleQueries[locale].map((sample) => {
                  const Icon = sample.icon
                  return <button type="button" key={sample.query} aria-label={sample.query} onClick={() => { setQuery(sample.query); window.setTimeout(() => queryRef.current?.focus(), 0) }}><span><Icon aria-hidden="true" /></span><span><strong>{sample.query}</strong><small>{sample.detail}</small></span><ArrowRight aria-hidden="true" /></button>
                })}</div>
              </section> : null}
              {searchError ? <p className="context-inline-error" role="alert">{searchError}</p> : null}

              {visibleResult ? <section className="context-results" aria-label={copy.results}>
                <header className="context-results__header"><div><p><span aria-hidden="true" />{copy.results}</p><h2>{visibleResult.hits.length} {locale === 'zh' ? '项高相关证据' : 'high-confidence sources'}</h2></div><div className="context-results__meta"><span>{visibleResult.durationMs}ms</span><span>{visibleResult.mode}</span><small>{copy.resultHint}</small></div></header>
                {visibleResult.hits.length ? <>
                  <div className="context-results__grid">
                    <aside className="context-hit-list" aria-label={copy.rankedEvidence}>
                      <header><span><strong>{copy.rankedEvidence}</strong><small>{visibleResult.hits.length} {copy.sources}</small></span><CircleGauge aria-hidden="true" /></header>
                      {visibleResult.hits.map((hit) => <HitRow key={`${hit.path}:${hit.startLine}`} hit={hit} active={selectedHit?.path === hit.path} onSelect={() => setSelectedPath(hit.path)} />)}
                    </aside>
                    {selectedHit ? <article className="context-preview">
                      <header><span className="context-preview__file-icon"><Braces aria-hidden="true" /></span><div><small>{copy.detail}</small><strong title={selectedHit.path}>{selectedHit.path}</strong><p>L{selectedHit.startLine}–{selectedHit.endLine}{selectedHit.symbol ? ` · ${selectedHit.symbol}` : ''}</p></div><div className="context-preview__header-actions"><span className="context-preview__confidence"><small>{copy.confidence}</small><strong>{Math.round(selectedHit.score * 100)}%</strong></span><button type="button" onClick={() => { void copyReference() }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? copy.copied : copy.copyRef}</button></div></header>
                      <aside className="context-preview__reason"><Sparkles aria-hidden="true" /><span><strong>{copy.whyMatched}</strong><p>{describeMatch(selectedHit, locale)}</p></span></aside>
                      <CodePreview hit={selectedHit} />
                      <footer><span>{selectedHit.language}</span><span>{selectedHit.source}</span>{selectedHit.channels.map((channel) => <span key={channel}>{channel}</span>)}<small>{copy.previewHint}</small></footer>
                    </article> : null}
                  </div>
                  <footer className={`context-action-bar${visiblePack ? ' context-action-bar--ready' : ''}`}>
                    <div className="context-action-bar__summary" aria-live="polite">
                      <span>{visiblePack ? <PackageCheck aria-hidden="true" /> : <Layers3 aria-hidden="true" />}</span>
                      <div><small>{visiblePack ? copy.packReady : copy.pack}</small><h2>{visiblePack ? `${visiblePack.hits.length} ${copy.sources} · ${formatNumber(visiblePack.estimatedTokens, locale)} ${copy.tokenEstimate}` : copy.packPending}</h2>{visiblePack ? <div className="context-pack__paths">{visiblePack.hits.slice(0, 4).map((hit) => <span key={`${hit.path}:${hit.startLine}`}>{hit.path}</span>)}</div> : null}</div>
                    </div>
                    <div className="context-action-bar__actions"><button type="button" className="cosmos-button cosmos-button--secondary" onClick={() => { void buildPack() }} disabled={packState === 'loading' || Boolean(visiblePack)}>{packState === 'loading' ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : visiblePack ? <Check aria-hidden="true" /> : <PackageCheck aria-hidden="true" />}{packState === 'loading' ? copy.packing : visiblePack ? copy.packReady : copy.pack}</button><button type="button" className="cosmos-button cosmos-button--primary" onClick={() => { void startSession() }} disabled={packState === 'loading'}><Send aria-hidden="true" />{visiblePack ? copy.launchReady : copy.launch}</button></div>
                  </footer>
                </> : <p className="context-empty">{copy.noResults}</p>}
              </section> : null}

              {packError ? <p className="context-inline-error" role="alert">{packError}</p> : null}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
