import type { ArtifactDto, ArtifactType } from '@cosmos/contracts'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PrototypeHexIcon, PrototypeSearchIcon } from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import { usePreferences, type Locale } from '../preferences'
import { listSpaceArtifacts, type CosmosApiAuthContext } from '../services/cosmosApi'

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

const artifactTypeLabels: Record<string, { zh: string; en: string }> = {
  pull_request: { zh: 'PR', en: 'Pull request' },
  branch: { zh: '分支', en: 'Branch' },
  commit: { zh: '提交', en: 'Commit' },
  issue: { zh: '工单', en: 'Issue' },
  link: { zh: '链接', en: 'Link' },
  test_report: { zh: '测试报告', en: 'Test report' },
  deployment: { zh: '部署', en: 'Deployment' },
  document: { zh: '文档', en: 'Document' },
}

export type RemoteArtifactsPageProps = {
  organizationId: string
  spaceId: string
  auth: CosmosApiAuthContext
  credentialVersion: number
  enabled?: boolean
  onOpenSession: (sessionId: string) => void
  onOpenNavigation?: () => void
  navigationCollapsed?: boolean
  onOpenCommand?: () => void
}

export function RemoteArtifactsPage({
  organizationId,
  spaceId,
  auth,
  credentialVersion,
  enabled = true,
  onOpenSession,
  onOpenNavigation,
  navigationCollapsed,
  onOpenCommand,
}: RemoteArtifactsPageProps) {
  const { locale } = usePreferences()
  const [typeFilter, setTypeFilter] = useState<'' | ArtifactType>('')
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState<ArtifactDto[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(enabled ? 'loading' : 'ready')
  const [error, setError] = useState<string>()
  const [retryVersion, setRetryVersion] = useState(0)
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      setStatus('loading')
      setError(undefined)
    }).then(() => listSpaceArtifacts(
      organizationId, spaceId, requestAuth, controller.signal,
      typeFilter ? { type: typeFilter, limit: 100 } : { limit: 100 },
    )).then((response) => {
      if (controller.signal.aborted) return
      setPages(response.items)
      setCursor(response.page.nextCursor)
      setStatus('ready')
    }, (cause: unknown) => {
      if (controller.signal.aborted) return
      setStatus('error')
      setError(cause instanceof Error ? cause.message : text(locale, '无法加载产出物。', 'Unable to load artifacts.'))
    })
    return () => controller.abort()
  }, [credentialVersion, enabled, locale, organizationId, requestAuth, retryVersion, spaceId, typeFilter])

  const loadMore = useCallback(() => {
    if (!cursor) return
    void listSpaceArtifacts(organizationId, spaceId, requestAuth, undefined, {
      cursor,
      limit: 100,
      ...(typeFilter ? { type: typeFilter } : {}),
    }).then((response) => {
      setPages((current) => [...current, ...response.items])
      setCursor(response.page.nextCursor)
    }, () => undefined)
  }, [cursor, organizationId, requestAuth, spaceId, typeFilter])

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return pages
    return pages.filter((artifact) => artifact.label.toLowerCase().includes(normalized)
      || artifact.url.toLowerCase().includes(normalized))
  }, [pages, query])

  return <main className="prototype-automation-page">
    <PrototypePageTopbar
      crumb={text(locale, '会话 · Artifacts', 'Sessions · Artifacts')}
      navigationCollapsed={navigationCollapsed}
      onOpenNavigation={onOpenNavigation}
      onOpenCommand={onOpenCommand}
    />
    <div className="prototype-automation-viewport">
      <div className="prototype-automation-content prototype-expert-content">
        <div className="prototype-automation-header">
          <div>
            <h1>{text(locale, '产出物', 'Artifacts')}</h1>
            <p>{text(locale,
              '会话产生的持久产出物——PR、分支、工单与自定义链接——跨会话检索，并可跳回来源会话。',
              'Durable outputs your sessions produce — pull requests, branches, issues, and custom links — searchable across sessions, each linking back to its source session.')}</p>
          </div>
        </div>

        <div className="prototype-automation-toolbar">
          <select className="prototype-field-select prototype-artifact-type-filter" aria-label={text(locale, '按类型筛选', 'Filter by type')} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as '' | ArtifactType)}>
            <option value="">{text(locale, '全部类型', 'All types')}</option>
            {Object.entries(artifactTypeLabels).map(([type, label]) => <option key={type} value={type}>{locale === 'zh' ? label.zh : label.en}</option>)}
          </select>
          <label className="prototype-automation-search"><PrototypeSearchIcon aria-hidden="true" /><span className="sr-only">{text(locale, '搜索产出物', 'Search artifacts')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(locale, '搜索产出物…', 'Search artifacts…')} /></label>
        </div>

        <div className="prototype-automation-table-wrap">
          <table className="prototype-automation-table prototype-expert-table">
            <thead><tr>
              <th>{text(locale, '产出物', 'Artifact')}</th>
              <th>{text(locale, '类型', 'Type')}</th>
              <th>{text(locale, '状态', 'Status')}</th>
              <th>{text(locale, '来源会话', 'Session')}</th>
              <th>{text(locale, '创建时间', 'Created')}</th>
            </tr></thead>
            <tbody>
              {status === 'loading' ? <tr><td colSpan={5} className="prototype-automation-state"><LoaderCircle className="spin" aria-hidden="true" />{text(locale, '加载中…', 'Loading…')}</td></tr> : null}
              {status === 'error' ? <tr><td colSpan={5} className="prototype-automation-state prototype-automation-state--error"><span role="alert">{error}</span><button type="button" onClick={() => setRetryVersion((value) => value + 1)}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></td></tr> : null}
              {status === 'ready' && !rows.length ? <tr><td colSpan={5} className="prototype-automation-state">{query || typeFilter ? text(locale, '没有匹配的产出物', 'No artifacts match') : text(locale, '还没有产出物。会话交付 PR、分支或链接后会显示在这里。', 'No artifacts yet. They appear here once sessions deliver pull requests, branches, or links.')}</td></tr> : null}
              {status === 'ready' ? rows.map((artifact) => <tr key={artifact.id}>
                <td><div className="prototype-expert-name-cell">
                  <span className="prototype-automation-expert-icon"><PrototypeHexIcon aria-hidden="true" /></span>
                  <div className="prototype-expert-name-body">
                    <div className="prototype-expert-name-line"><a className="prototype-artifact-link" href={artifact.url} target="_blank" rel="noreferrer"><strong>{artifact.label}</strong></a></div>
                    <div className="prototype-expert-desc-line">{artifact.url}</div>
                  </div>
                </div></td>
                <td><span className="prototype-expert-tag">{locale === 'zh' ? artifactTypeLabels[artifact.type]?.zh ?? artifact.type : artifactTypeLabels[artifact.type]?.en ?? artifact.type}</span></td>
                <td className="muted">{artifact.status ?? '—'}</td>
                <td><button type="button" className="prototype-ghost-button" onClick={() => onOpenSession(artifact.sessionId)}>{text(locale, '打开会话', 'Open session')}</button></td>
                <td className="muted">{formatDate(artifact.createdAt, locale)}</td>
              </tr>) : null}
            </tbody>
          </table>
        </div>

        {status === 'ready' ? <div className="prototype-automation-footer">
          <span>{rows.length} {rows.length === 1 ? 'artifact' : 'artifacts'}</span>
          <div>{cursor ? <button type="button" className="prototype-ghost-button" onClick={loadMore}>{text(locale, '加载更多', 'Load more')}</button> : null}</div>
        </div> : null}
      </div>
    </div>
  </main>
}
