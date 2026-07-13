import type { FileDto, FileScope, FileVersionDto } from '@relay/contracts'
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileClock,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageSquarePlus,
  RefreshCw,
  Search,
  User,
} from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { GlobalControls } from '../components/GlobalControls'
import { IconButton } from '../components/ui'
import { usePreferences, type Locale } from '../preferences'
import {
  getFileContent,
  listFiles,
  listFileVersions,
  type RelayApiAuthContext,
  type RelayFileContent,
} from '../services/relayApi'

type RemoteFileScope = Extract<FileScope, 'user' | 'organization'>

export type RemoteFilesPageProps = {
  organizationId: string
  spaceId: string
  scope: RemoteFileScope
  auth: RelayApiAuthContext
  credentialVersion: number
  sessionCreationEnabled: boolean
  onOpenNavigation?: () => void
  onRequestModification: (path: string) => void
}

type FileTreeRow =
  | { kind: 'directory'; path: string; name: string; depth: number }
  | { kind: 'file'; file: FileDto; depth: number }

type ListSnapshot = {
  identity: string
  status: 'ready' | 'error'
  items: FileDto[]
  nextCursor: string | null
  loadingMore: boolean
  error?: Error
}

type VersionSnapshot = {
  identity: string
  status: 'ready' | 'error'
  items: FileVersionDto[]
  nextCursor: string | null
  loadingMore: boolean
  error?: Error
}

type ContentSnapshot = {
  identity: string
  status: 'ready' | 'error'
  response?: RelayFileContent
  text?: string
  error?: Error
}

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatSize(bytes: number, locale: Locale) {
  if (bytes < 1_024) return `${bytes} B`
  const formatter = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: 1,
  })
  return bytes < 1_048_576
    ? `${formatter.format(bytes / 1_024)} KB`
    : `${formatter.format(bytes / 1_048_576)} MB`
}

function fileTreeRows(files: FileDto[], collapsed: Set<string>): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const rendered = new Set<string>()
  for (const file of files) {
    const segments = file.path.split('/')
    let visible = true
    for (let index = 1; index < segments.length; index += 1) {
      const path = segments.slice(0, index).join('/')
      if (visible && !rendered.has(path)) {
        rows.push({ kind: 'directory', path, name: segments[index - 1] ?? path, depth: index - 1 })
        rendered.add(path)
      }
      if (collapsed.has(path)) visible = false
    }
    if (visible) rows.push({ kind: 'file', file, depth: segments.length - 1 })
  }
  return rows
}

function errorValue(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause : new Error(fallback)
}

function canPreview(contentType: string) {
  const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mimeType?.startsWith('text/') || mimeType === 'application/json'
}

async function copyValue(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
  await navigator.clipboard.writeText(value)
}

function downloadBlob(content: RelayFileContent, fallbackName: string) {
  const url = URL.createObjectURL(content.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = content.fileName || fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function RemoteFilesPage({
  organizationId,
  spaceId,
  scope,
  auth,
  credentialVersion,
  sessionCreationEnabled,
  onOpenNavigation,
  onRequestModification,
}: RemoteFilesPageProps) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  const requestAuth = useMemo<RelayApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [retryVersion, setRetryVersion] = useState(0)
  const listIdentity = [
    organizationId, spaceId, scope, credentialVersion, deferredQuery, retryVersion,
  ].join('\u0000')
  const [listSnapshot, setListSnapshot] = useState<ListSnapshot>()
  const currentList = listSnapshot?.identity === listIdentity ? listSnapshot : undefined
  const items = useMemo(() => currentList?.items ?? [], [currentList])

  useEffect(() => {
    const controller = new AbortController()
    void listFiles(organizationId, spaceId, {
      scope,
      search: deferredQuery || undefined,
      limit: 100,
    }, requestAuth, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setListSnapshot({
          identity: listIdentity,
          status: 'ready',
          items: page.items,
          nextCursor: page.page.nextCursor,
          loadingMore: false,
        })
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setListSnapshot({
          identity: listIdentity,
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
          error: errorValue(cause, 'Unable to load Files.'),
        })
      },
    )
    return () => { controller.abort() }
  }, [deferredQuery, listIdentity, organizationId, requestAuth, scope, spaceId])

  const loadMore = useCallback(() => {
    if (!currentList?.nextCursor || currentList.loadingMore) return
    const cursor = currentList.nextCursor
    setListSnapshot({ ...currentList, loadingMore: true })
    void listFiles(organizationId, spaceId, {
      scope,
      search: deferredQuery || undefined,
      cursor,
      limit: 100,
    }, requestAuth).then(
      (page) => setListSnapshot((current) => current?.identity === listIdentity ? {
        ...current,
        status: 'ready',
        items: [...current.items, ...page.items],
        nextCursor: page.page.nextCursor,
        loadingMore: false,
      } : current),
      (cause: unknown) => setListSnapshot((current) => current?.identity === listIdentity ? {
        ...current,
        loadingMore: false,
        error: errorValue(cause, 'Unable to load more Files.'),
      } : current),
    )
  }, [currentList, deferredQuery, listIdentity, organizationId, requestAuth, scope, spaceId])

  const [selectedFileId, setSelectedFileId] = useState<string>()
  const selectedFile = items.find((item) => item.id === selectedFileId) ?? items[0]
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const treeRows = useMemo(() => fileTreeRows(items, collapsed), [collapsed, items])

  const [selectedVersion, setSelectedVersion] = useState<number>()
  const versionIdentity = selectedFile
    ? `${listIdentity}\u0000${selectedFile.id}`
    : ''
  const [versionSnapshot, setVersionSnapshot] = useState<VersionSnapshot>()
  const currentVersions = versionSnapshot?.identity === versionIdentity ? versionSnapshot : undefined
  useEffect(() => {
    if (!selectedFile) return
    const controller = new AbortController()
    void listFileVersions(
      organizationId, spaceId, selectedFile.id, requestAuth, controller.signal, { limit: 100 },
    ).then(
      (page) => {
        if (!controller.signal.aborted) setVersionSnapshot({
          identity: versionIdentity,
          status: 'ready',
          items: page.items,
          nextCursor: page.page.nextCursor,
          loadingMore: false,
        })
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setVersionSnapshot({
          identity: versionIdentity,
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
          error: errorValue(cause, 'Unable to load File versions.'),
        })
      },
    )
    return () => { controller.abort() }
  }, [organizationId, requestAuth, selectedFile, spaceId, versionIdentity])

  const viewVersion = selectedVersion ?? selectedFile?.version
  const contentIdentity = selectedFile && viewVersion
    ? `${versionIdentity}\u0000${viewVersion}`
    : ''
  const [contentSnapshot, setContentSnapshot] = useState<ContentSnapshot>()
  const currentContent = contentSnapshot?.identity === contentIdentity ? contentSnapshot : undefined
  useEffect(() => {
    if (!selectedFile || !viewVersion) return
    const controller = new AbortController()
    void getFileContent(
      organizationId, spaceId, selectedFile.id, requestAuth, controller.signal,
      { version: viewVersion, disposition: 'inline' },
    ).then(async (response) => {
      const preview = canPreview(response.contentType) ? await response.blob.text() : undefined
      if (!controller.signal.aborted) setContentSnapshot({
        identity: contentIdentity,
        status: 'ready',
        response,
        text: preview,
      })
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setContentSnapshot({
        identity: contentIdentity,
        status: 'error',
        error: errorValue(cause, 'Unable to load File content.'),
      })
    })
    return () => { controller.abort() }
  }, [contentIdentity, organizationId, requestAuth, selectedFile, spaceId, viewVersion])

  const [versionsOpen, setVersionsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [downloading, setDownloading] = useState(false)
  const viewedVersion = currentVersions?.items.find((version) => version.version === viewVersion)

  const selectFile = (file: FileDto) => {
    setSelectedFileId(file.id)
    setSelectedVersion(undefined)
    setVersionsOpen(false)
    setNotice('')
  }

  const toggleDirectory = (path: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  const copy = async (value: string, success: string) => {
    try {
      await copyValue(value)
      setNotice(success)
    } catch {
      setNotice(text(locale, '复制失败，请检查浏览器权限。', 'Copy failed. Check browser permissions.'))
    }
  }

  const download = async () => {
    if (!selectedFile || !viewVersion || downloading) return
    setDownloading(true)
    setNotice('')
    try {
      const content = await getFileContent(
        organizationId, spaceId, selectedFile.id, requestAuth, undefined,
        { version: viewVersion, disposition: 'attachment' },
      )
      downloadBlob(content, selectedFile.path.split('/').at(-1) ?? 'download')
      setNotice(text(locale, '文件下载已开始。', 'File download started.'))
    } catch (cause) {
      setNotice(errorValue(cause, 'Unable to download File.').message)
    } finally {
      setDownloading(false)
    }
  }

  const loadMoreVersions = () => {
    if (!selectedFile || !currentVersions?.nextCursor || currentVersions.loadingMore) return
    const cursor = currentVersions.nextCursor
    setVersionSnapshot({ ...currentVersions, loadingMore: true })
    void listFileVersions(
      organizationId, spaceId, selectedFile.id, requestAuth, undefined, { cursor, limit: 100 },
    ).then(
      (page) => setVersionSnapshot((current) => current?.identity === versionIdentity ? {
        ...current,
        items: [...current.items, ...page.items],
        nextCursor: page.page.nextCursor,
        loadingMore: false,
      } : current),
      (cause: unknown) => setVersionSnapshot((current) => current?.identity === versionIdentity ? {
        ...current,
        loadingMore: false,
        error: errorValue(cause, 'Unable to load more File versions.'),
      } : current),
    )
  }

  return (
    <main className="cosmos-page cosmos-files-page remote-files-page">
      <header className="cosmos-page-header">
        <div className="cosmos-page-header__identity">
          <IconButton icon={Menu} label={text(locale, '打开导航', 'Open navigation')} className="cosmos-mobile-menu" onClick={onOpenNavigation} />
          <span className="cosmos-page-header__icon"><FileText aria-hidden="true" /></span>
          <div>
            <h1>{scope === 'organization' ? text(locale, '组织文件', 'Organization Files') : text(locale, '个人文件', 'User Files')}</h1>
            <p>{organizationId} / {spaceId}</p>
          </div>
        </div>
        <div className="cosmos-page-header__actions">
          <span className="remote-catalog-readonly"><LockKeyhole aria-hidden="true" />{text(locale, '只读', 'Read only')}</span>
          <GlobalControls className="cosmos-global-controls" />
          <IconButton icon={RefreshCw} label={text(locale, '刷新文件', 'Refresh Files')} onClick={() => setRetryVersion((version) => version + 1)} />
        </div>
      </header>
      <div className="cosmos-page__content">
        {notice ? <div className="cosmos-notice" role="status">{notice}</div> : null}
        <div className="cosmos-files-layout">
          <aside className="cosmos-files-browser" aria-label={text(locale, '文件树', 'File tree')}>
            <div className="cosmos-segmented-control" role="tablist" aria-label={text(locale, '文件范围', 'File scope')}>
              <button type="button" role="tab" aria-selected={scope === 'organization'} className={scope === 'organization' ? 'cosmos-segmented-control__active' : ''} onClick={() => navigate('/files/organization')}><Building2 aria-hidden="true" />{text(locale, '组织', 'Organization')}</button>
              <button type="button" role="tab" aria-selected={scope === 'user'} className={scope === 'user' ? 'cosmos-segmented-control__active' : ''} onClick={() => navigate('/files/user')}><User aria-hidden="true" />{text(locale, '个人', 'User')}</button>
            </div>
            <label className="cosmos-search-field">
              <Search aria-hidden="true" />
              <span className="cosmos-visually-hidden">{text(locale, '搜索文件', 'Search Files')}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(locale, '搜索路径', 'Search paths')} />
            </label>
            <div className="cosmos-files-browser__summary"><span>{text(locale, '文件树', 'File tree')}</span><strong>{items.length}</strong></div>
            <div className="cosmos-file-list" role="tree">
              {!currentList ? <div className="remote-files-state" role="status"><LoaderCircle className="cosmos-spin" aria-hidden="true" />{text(locale, '正在加载…', 'Loading…')}</div> : null}
              {currentList?.status === 'error' ? <div className="remote-files-state remote-files-state--error" role="alert"><AlertTriangle aria-hidden="true" /><span>{currentList.error?.message}</span><button type="button" onClick={() => setRetryVersion((version) => version + 1)}><RefreshCw aria-hidden="true" />{text(locale, '重试', 'Retry')}</button></div> : null}
              {currentList?.status === 'ready' ? treeRows.map((row) => row.kind === 'directory' ? (
                <button type="button" role="treeitem" aria-expanded={!collapsed.has(row.path)} className="cosmos-file-directory-row" key={`directory:${row.path}`} style={{ '--tree-indent': `${row.depth * 16}px` } as CSSProperties} onClick={() => toggleDirectory(row.path)}>
                  {!collapsed.has(row.path) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  {!collapsed.has(row.path) ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
                  <span>{row.name}</span>
                </button>
              ) : (
                <button type="button" role="treeitem" aria-selected={row.file.id === selectedFile?.id} className={`cosmos-file-row${row.file.id === selectedFile?.id ? ' cosmos-file-row--active' : ''}`} key={row.file.id} style={{ '--tree-indent': `${row.depth * 16}px` } as CSSProperties} onClick={() => selectFile(row.file)}>
                  <FileText aria-hidden="true" />
                  <span><strong>{row.file.path.split('/').at(-1)}</strong><small>{row.file.path}</small><small>{formatSize(row.file.size, locale)} · {formatDate(row.file.updatedAt, locale)}</small></span>
                </button>
              )) : null}
              {currentList?.status === 'ready' && !items.length ? <p className="cosmos-empty-state">{text(locale, '没有文件', 'No Files')}</p> : null}
              {currentList?.nextCursor ? <button type="button" className="remote-files-load-more" disabled={currentList.loadingMore} onClick={loadMore}>{currentList.loadingMore ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{text(locale, '加载更多', 'Load more')}</button> : null}
            </div>
          </aside>

          <section className="cosmos-file-viewer" aria-label={text(locale, '文件预览', 'File preview')}>
            {selectedFile ? <>
              <header className="cosmos-file-viewer__header">
                <div><p>{scope === 'user' ? 'User' : 'Organization'} · v{viewVersion}</p><h2>{selectedFile.path}</h2><span>{formatDate(viewedVersion?.createdAt ?? selectedFile.updatedAt, locale)}</span></div>
                <div>
                  <IconButton icon={Copy} label={text(locale, '复制路径', 'Copy path')} onClick={() => { void copy(`${scope}/${selectedFile.path}`, text(locale, '路径已复制。', 'Path copied.')) }} />
                  <IconButton icon={FileText} label={text(locale, '复制内容', 'Copy content')} disabled={currentContent?.status !== 'ready' || currentContent.text === undefined} onClick={() => { void copy(currentContent?.text ?? '', text(locale, '内容已复制。', 'Content copied.')) }} />
                  <IconButton icon={Download} label={text(locale, '下载文件', 'Download File')} disabled={downloading} onClick={() => { void download() }} />
                  <button type="button" className="cosmos-button cosmos-button--secondary remote-files-request" disabled={!sessionCreationEnabled} onClick={() => onRequestModification(`${scope}/${selectedFile.path}`)}><MessageSquarePlus aria-hidden="true" />{text(locale, '请求修改', 'Request change')}</button>
                </div>
              </header>
              <dl className="cosmos-file-metadata">
                <div><dt>{text(locale, '路径', 'Path')}</dt><dd><code>{scope}/{selectedFile.path}</code></dd></div>
                <div><dt>{text(locale, '大小', 'Size')}</dt><dd>{formatSize(viewedVersion?.size ?? selectedFile.size, locale)}</dd></div>
                <div><dt>{text(locale, '写入 Expert', 'Writer Expert')}</dt><dd>{selectedFile.lastWrittenByExpertId}</dd></div>
                <div><dt>{text(locale, 'MIME 类型', 'MIME type')}</dt><dd>{selectedFile.mimeType}</dd></div>
              </dl>
              {!currentContent ? <div className="remote-files-preview-state" role="status"><LoaderCircle className="cosmos-spin" aria-hidden="true" />{text(locale, '正在加载内容…', 'Loading content…')}</div> : null}
              {currentContent?.status === 'error' ? <div className="remote-files-preview-state remote-files-state--error" role="alert"><AlertTriangle aria-hidden="true" />{currentContent.error?.message}</div> : null}
              {currentContent?.status === 'ready' && currentContent.text !== undefined ? <pre className="cosmos-file-preview" aria-label={text(locale, '文件内容', 'File content')}>{currentContent.text}</pre> : null}
              {currentContent?.status === 'ready' && currentContent.text === undefined ? <div className="remote-files-preview-state"><FileText aria-hidden="true" /><strong>{currentContent.response?.contentType}</strong><span>{text(locale, '此格式可下载查看。', 'Download this format to inspect it.')}</span></div> : null}

              <section className="cosmos-version-history" aria-labelledby="remote-version-title">
                <button type="button" className="cosmos-version-toggle" aria-expanded={versionsOpen} onClick={() => setVersionsOpen((value) => !value)}>
                  <span><FileClock aria-hidden="true" /><span><small>{text(locale, '不可变快照', 'Immutable snapshots')}</small><strong id="remote-version-title">{text(locale, '版本历史', 'Version history')} · {currentVersions?.items.length ?? 0}</strong></span></span>
                  {versionsOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                </button>
                {versionsOpen ? <div className="cosmos-version-list">
                  {!currentVersions ? <div className="remote-files-state"><LoaderCircle className="cosmos-spin" aria-hidden="true" />{text(locale, '正在加载版本…', 'Loading versions…')}</div> : null}
                  {currentVersions?.status === 'error' ? <div className="remote-files-state remote-files-state--error"><AlertTriangle aria-hidden="true" />{currentVersions.error?.message}</div> : null}
                  {currentVersions?.items.map((version) => {
                    const active = version.version === viewVersion
                    return <article className={`cosmos-version-row${active ? ' cosmos-version-row--active' : ''}`} key={version.id}><button type="button" aria-pressed={active} onClick={() => setSelectedVersion(version.version)}><FileClock aria-hidden="true" /><span><strong>v{version.version}{version.version === selectedFile.version ? ` · ${text(locale, '当前', 'Current')}` : ''}</strong><small>{formatDate(version.createdAt, locale)} · {version.createdByToolCallId}</small></span></button></article>
                  })}
                  {currentVersions?.nextCursor ? <button type="button" className="remote-files-load-more" disabled={currentVersions.loadingMore} onClick={loadMoreVersions}>{currentVersions.loadingMore ? <LoaderCircle className="cosmos-spin" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{text(locale, '加载更多版本', 'Load more versions')}</button> : null}
                </div> : null}
              </section>
            </> : <p className="cosmos-empty-state">{text(locale, '选择一个文件', 'Select a File')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}
