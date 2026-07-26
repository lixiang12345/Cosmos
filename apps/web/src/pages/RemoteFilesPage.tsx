import type { FileDto, FileScope, FileVersionDto } from '@cosmos/contracts'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PrototypeChevronDownLargeIcon,
  PrototypeFileIcon,
  PrototypeFolderIcon,
} from '../components/PrototypeIcons'
import { PrototypePageTopbar } from '../components/PrototypePageTopbar'
import { usePreferences, type Locale } from '../preferences'
import {
  getFileContent,
  listFiles,
  listFileVersions,
  type CosmosApiAuthContext,
  type CosmosFileContent,
} from '../services/cosmosApi'

export type RemoteFilesPageProps = {
  organizationId: string
  spaceId: string
  scope: FileScope
  sessionId?: string
  auth: CosmosApiAuthContext
  credentialVersion: number
  sessionCreationEnabled: boolean
  navigationCollapsed?: boolean
  onOpenNavigation?: () => void
  onOpenCommand?: () => void
  onBackToSession?: () => void
  onRequestModification: (path: string) => void
}

type FileTreeRow =
  | { kind: 'directory'; path: string; name: string; depth: number }
  | { kind: 'file'; file: FileDto; depth: number }

type DirectoryListEntry = {
  kind: 'directory'
  path: string
  name: string
  size: number
  updatedAt: string
}

type FileListEntry = { kind: 'file'; file: FileDto }

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
  response?: CosmosFileContent
  text?: string
  error?: Error
}

function text(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

function scopeTitle(scope: FileScope) {
  if (scope === 'organization') return 'Organization VFS'
  if (scope === 'user') return 'User VFS'
  return 'Workspace VFS'
}

function scopeLabel(scope: FileScope) {
  if (scope === 'organization') return 'Organization'
  if (scope === 'user') return 'User'
  return 'Workspace'
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }).format(date)
}

function formatSize(bytes: number, locale: Locale) {
  if (bytes < 1_024) return `${bytes} B`
  const formatter = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 })
  return bytes < 1_048_576
    ? `${formatter.format(bytes / 1_024)} KiB`
    : `${formatter.format(bytes / 1_048_576)} MiB`
}

function parentPath(path: string) {
  const splitAt = path.lastIndexOf('/')
  return splitAt === -1 ? '' : path.slice(0, splitAt)
}

function baseName(path: string) {
  return path.split('/').at(-1) ?? path
}

function directoryPaths(files: FileDto[]) {
  const paths = new Set<string>()
  files.forEach((file) => {
    const segments = file.path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join('/'))
    }
  })
  return paths
}

function fileTreeRows(files: FileDto[], collapsed: Set<string>): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const rendered = new Set<string>()
  files.slice().sort((left, right) => left.path.localeCompare(right.path)).forEach((file) => {
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
  })
  return rows
}

function folderEntries(files: FileDto[], folder: string): Array<DirectoryListEntry | FileListEntry> {
  const prefix = folder ? `${folder}/` : ''
  const directories = new Map<string, DirectoryListEntry>()
  const directFiles: FileListEntry[] = []

  files.forEach((file) => {
    if (!file.path.startsWith(prefix)) return
    const relative = file.path.slice(prefix.length)
    const slash = relative.indexOf('/')
    if (slash === -1) {
      directFiles.push({ kind: 'file', file })
      return
    }
    const name = relative.slice(0, slash)
    const path = `${prefix}${name}`
    const current = directories.get(path)
    directories.set(path, {
      kind: 'directory',
      path,
      name,
      size: (current?.size ?? 0) + file.size,
      updatedAt: !current || Date.parse(file.updatedAt) > Date.parse(current.updatedAt) ? file.updatedAt : current.updatedAt,
    })
  })

  return [
    ...[...directories.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ...directFiles.sort((left, right) => baseName(left.file.path).localeCompare(baseName(right.file.path))),
  ]
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

function downloadBlob(content: CosmosFileContent, fallbackName: string) {
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
  sessionId,
  auth,
  credentialVersion,
  sessionCreationEnabled,
  navigationCollapsed = false,
  onOpenNavigation,
  onOpenCommand,
  onBackToSession,
  onRequestModification,
}: RemoteFilesPageProps) {
  const { locale } = usePreferences()
  const navigate = useNavigate()
  const requestAuth = useMemo<CosmosApiAuthContext>(() => ({
    accessToken: auth.accessToken,
    requestIdentity: auth.requestIdentity,
    onUnauthorized: auth.onUnauthorized,
  }), [auth.accessToken, auth.onUnauthorized, auth.requestIdentity])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [retryVersion, setRetryVersion] = useState(0)
  const listIdentity = [organizationId, spaceId, scope, sessionId ?? '', credentialVersion, deferredQuery, retryVersion].join('\u0000')
  const [listSnapshot, setListSnapshot] = useState<ListSnapshot>()
  const currentList = listSnapshot?.identity === listIdentity ? listSnapshot : undefined
  const items = useMemo(() => currentList?.items ?? [], [currentList])

  useEffect(() => {
    const controller = new AbortController()
    void listFiles(organizationId, spaceId, {
      scope,
      sessionId: scope === 'workspace' ? sessionId : undefined,
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
  }, [deferredQuery, listIdentity, organizationId, requestAuth, scope, sessionId, spaceId])

  const loadMore = useCallback(() => {
    if (!currentList?.nextCursor || currentList.loadingMore) return
    const cursor = currentList.nextCursor
    setListSnapshot({ ...currentList, loadingMore: true })
    void listFiles(organizationId, spaceId, {
      scope,
      sessionId: scope === 'workspace' ? sessionId : undefined,
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
  }, [currentList, deferredQuery, listIdentity, organizationId, requestAuth, scope, sessionId, spaceId])

  const [selectedFileId, setSelectedFileId] = useState<string>()
  const selectedFile = items.find((item) => item.id === selectedFileId)
  const [currentFolder, setCurrentFolder] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const initializedListRef = useRef('')

  useEffect(() => {
    if (!currentList || currentList.status !== 'ready' || initializedListRef.current === listIdentity) return
    initializedListRef.current = listIdentity
    setSelectedFileId(undefined)
    setCurrentFolder('')
    setCollapsed(directoryPaths(currentList.items))
  }, [currentList, listIdentity])

  const treeRows = useMemo(() => fileTreeRows(items, collapsed), [collapsed, items])
  const listEntries = useMemo(() => folderEntries(items, currentFolder), [currentFolder, items])
  const totalSize = useMemo(() => items.reduce((sum, file) => sum + file.size, 0), [items])

  const [selectedVersion, setSelectedVersion] = useState<number>()
  const versionIdentity = selectedFile ? `${listIdentity}\u0000${selectedFile.id}` : ''
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
  const contentIdentity = selectedFile && viewVersion ? `${versionIdentity}\u0000${viewVersion}` : ''
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
      if (!controller.signal.aborted) setContentSnapshot({ identity: contentIdentity, status: 'ready', response, text: preview })
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setContentSnapshot({
        identity: contentIdentity,
        status: 'error',
        error: errorValue(cause, 'Unable to load File content.'),
      })
    })
    return () => { controller.abort() }
  }, [contentIdentity, organizationId, requestAuth, selectedFile, spaceId, viewVersion])

  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [downloading, setDownloading] = useState(false)
  const scopeTriggerRef = useRef<HTMLButtonElement>(null)
  const scopeMenuRef = useRef<HTMLDivElement>(null)
  const versionTriggerRef = useRef<HTMLButtonElement>(null)
  const versionMenuRef = useRef<HTMLDivElement>(null)
  const searchDialogRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchReturnFocusRef = useRef<HTMLElement | null>(null)

  const openSearch = useCallback(() => {
    searchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    window.requestAnimationFrame(() => {
      if (searchReturnFocusRef.current?.isConnected) searchReturnFocusRef.current.focus()
      else scopeTriggerRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2_800)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (scopeMenuOpen) scopeMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    if (versionMenuOpen) versionMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    if (searchOpen) searchInputRef.current?.focus()
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (scopeMenuOpen && !scopeMenuRef.current?.contains(target) && target !== scopeTriggerRef.current) setScopeMenuOpen(false)
      if (versionMenuOpen && !versionMenuRef.current?.contains(target) && target !== versionTriggerRef.current) setVersionMenuOpen(false)
    }
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openSearch()
        return
      }
      if (event.key === 'Tab' && searchOpen) {
        const focusable = Array.from(searchDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      if (event.key !== 'Escape') return
      if (scopeMenuOpen) {
        setScopeMenuOpen(false)
        window.requestAnimationFrame(() => scopeTriggerRef.current?.focus())
      }
      if (versionMenuOpen) {
        setVersionMenuOpen(false)
        window.requestAnimationFrame(() => versionTriggerRef.current?.focus())
      }
      if (searchOpen) closeSearch()
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnKey)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnKey)
    }
  }, [closeSearch, openSearch, scopeMenuOpen, searchOpen, versionMenuOpen])

  const selectFile = (file: FileDto, revealParent = false) => {
    if (revealParent) setCurrentFolder(parentPath(file.path))
    setSelectedFileId(file.id)
    setSelectedVersion(undefined)
    setVersionMenuOpen(false)
    setNotice('')
  }

  const openDirectory = (path: string) => {
    setCurrentFolder(path)
    setSelectedFileId(undefined)
    setVersionMenuOpen(false)
    setCollapsed((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }

  const toggleTreeDirectory = (path: string) => {
    if (currentFolder === path && !collapsed.has(path)) {
      setCollapsed((current) => new Set(current).add(path))
      return
    }
    openDirectory(path)
  }

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
      downloadBlob(content, baseName(selectedFile.path) || 'download')
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

  const activateEntry = (event: KeyboardEvent<HTMLTableRowElement>, entry: DirectoryListEntry | FileListEntry) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (entry.kind === 'directory') openDirectory(entry.path)
    else selectFile(entry.file)
  }

  const title = scopeTitle(scope)
  const selectedPath = selectedFile ? `${scope}/${selectedFile.path}` : ''

  return (
    <main className="prototype-files-page">
      <h1 className="prototype-visually-hidden">{scope === 'organization'
        ? text(locale, '组织文件', 'Organization Files')
        : scope === 'user'
          ? text(locale, '个人文件', 'User Files')
          : text(locale, '会话工作区文件', 'Session Workspace Files')}</h1>
      <PrototypePageTopbar
        crumb={title}
        navigationCollapsed={navigationCollapsed}
        onOpenNavigation={onOpenNavigation}
        onOpenCommand={onOpenCommand}
      />
      <div className="prototype-files-viewport">
        <div className="prototype-vfs-page">
          <div className="prototype-vfs-layout">
            <aside className="prototype-vfs-sidebar" aria-label={text(locale, '文件树', 'File tree')}>
              <button
                ref={scopeTriggerRef}
                type="button"
                className="prototype-vfs-scope-btn"
                aria-haspopup={scope === 'workspace' ? undefined : 'menu'}
                aria-expanded={scope === 'workspace' ? undefined : scopeMenuOpen}
                onClick={() => { if (scope !== 'workspace') setScopeMenuOpen((value) => !value) }}
              >
                {title}{scope !== 'workspace' ? <PrototypeChevronDownLargeIcon aria-hidden="true" /> : null}
              </button>
              {scopeMenuOpen && scope !== 'workspace' ? <div ref={scopeMenuRef} className="prototype-vfs-scope-menu" role="menu">
                <button type="button" role="menuitem" className={scope === 'user' ? 'active' : undefined} onClick={() => navigate('/files/user')}>User VFS</button>
                <button type="button" role="menuitem" className={scope === 'organization' ? 'active' : undefined} onClick={() => navigate('/files/organization')}>Organization VFS</button>
              </div> : null}

              <div className="prototype-vfs-tree" role="tree">
                {!currentList ? <div className="prototype-vfs-state" role="status">{text(locale, '正在加载…', 'Loading…')}</div> : null}
                {currentList?.status === 'error' ? <div className="prototype-vfs-state error" role="alert"><span>{currentList.error?.message}</span><button type="button" onClick={() => setRetryVersion((value) => value + 1)}>{text(locale, '重试', 'Retry')}</button></div> : null}
                {currentList?.status === 'ready' ? treeRows.map((row) => row.kind === 'directory' ? (
                  <div className={`prototype-vfs-tree-item depth-${Math.min(row.depth, 2)}`} key={`directory:${row.path}`}>
                    <button type="button" role="treeitem" aria-expanded={!collapsed.has(row.path)} aria-selected={currentFolder === row.path} className={`prototype-vfs-tree-row${currentFolder === row.path ? ' active' : ''}`} onClick={() => toggleTreeDirectory(row.path)}>
                      <span className={`prototype-vfs-chev${collapsed.has(row.path) ? '' : ' open'}`} aria-hidden="true">›</span>
                      <span className="prototype-vfs-ico"><PrototypeFolderIcon aria-hidden="true" /></span>
                      <span className="prototype-vfs-label" title={row.name}>{row.name}</span>
                      <span className="prototype-vfs-row-more" aria-hidden="true">⋯</span>
                    </button>
                  </div>
                ) : (
                  <div className={`prototype-vfs-tree-item depth-${Math.min(row.depth, 2)}`} key={row.file.id}>
                    <button type="button" role="treeitem" aria-selected={selectedFile?.id === row.file.id} className={`prototype-vfs-tree-row${selectedFile?.id === row.file.id ? ' active' : ''}`} onClick={() => selectFile(row.file, true)}>
                      <span className="prototype-vfs-chev" aria-hidden="true" />
                      <span className="prototype-vfs-ico"><PrototypeFileIcon aria-hidden="true" /></span>
                      <span className="prototype-vfs-label" title={baseName(row.file.path)}>{baseName(row.file.path)}</span>
                    </button>
                  </div>
                )) : null}
                {currentList?.status === 'ready' && !items.length ? <div className="prototype-vfs-state">{deferredQuery ? text(locale, '没有匹配的文件', 'No matching Files') : text(locale, '当前范围没有文件', 'No Files')}</div> : null}
                {currentList?.nextCursor ? <button type="button" className="prototype-vfs-load-more" disabled={currentList.loadingMore} onClick={loadMore}>{currentList.loadingMore ? text(locale, '加载中…', 'Loading…') : text(locale, '加载更多', 'Load more')}</button> : null}
              </div>
              <div className="prototype-vfs-side-foot">{items.length} {text(locale, '个文件', items.length === 1 ? 'file' : 'files')} · {formatSize(totalSize, locale)}</div>
            </aside>

            <section className="prototype-vfs-main" aria-label={text(locale, '文件浏览器', 'Files browser')}>
              <div className="prototype-vfs-main-head">
                <div className="prototype-vfs-crumb"><span className="prototype-vfs-ico"><PrototypeFolderIcon aria-hidden="true" /></span>{currentFolder ? baseName(currentFolder) : scopeLabel(scope)}</div>
                <div className="prototype-vfs-actions">
                  {scope === 'workspace' && onBackToSession ? <button type="button" className="prototype-vfs-back" onClick={onBackToSession}>{text(locale, '返回会话', 'Back')}</button> : null}
                  <button type="button" aria-label={text(locale, '上传不可用', 'Upload unavailable')} title={text(locale, '当前 API 不支持直接上传', 'Direct upload is unavailable in the current API')} disabled>↑</button>
                  <button type="button" aria-label={text(locale, '请求修改', 'Request change')} title={text(locale, '在新会话中请求修改', 'Request a change in a new Session')} disabled={!selectedFile || !sessionCreationEnabled} onClick={() => { if (selectedFile) onRequestModification(selectedPath) }}>＋</button>
                  <button type="button" aria-label={text(locale, '下载文件', 'Download File')} title={text(locale, '下载文件', 'Download')} disabled={!selectedFile || downloading} onClick={() => { void download() }}>↓</button>
                </div>
              </div>

              <div className="prototype-vfs-list-wrap">
                <table className="prototype-vfs-table" aria-label={text(locale, '文件', 'Files')}>
                  <thead><tr><th>{text(locale, '名称', 'Name')}</th><th className="col-size">{text(locale, '大小', 'Size')}</th><th className="col-mod">{text(locale, '修改时间', 'Modified')}</th></tr></thead>
                  <tbody>
                    {!currentList ? <tr><td colSpan={3} className="prototype-vfs-table-state">{text(locale, '正在加载文件…', 'Loading Files…')}</td></tr> : null}
                    {currentList?.status === 'error' ? <tr><td colSpan={3} className="prototype-vfs-table-state error">{currentList.error?.message}<button type="button" onClick={() => setRetryVersion((value) => value + 1)}>{text(locale, '重试', 'Retry')}</button></td></tr> : null}
                    {currentList?.status === 'ready' ? listEntries.map((entry) => (
                      <tr
                        key={entry.kind === 'directory' ? `directory:${entry.path}` : entry.file.id}
                        tabIndex={0}
                        className={entry.kind === 'directory' ? (currentFolder === entry.path ? 'active' : undefined) : (selectedFile?.id === entry.file.id ? 'active' : undefined)}
                        aria-label={entry.kind === 'directory' ? `${text(locale, '打开文件夹', 'Open folder')}: ${entry.name}` : `${text(locale, '预览文件', 'Preview File')}: ${baseName(entry.file.path)}`}
                        onClick={() => { if (entry.kind === 'directory') openDirectory(entry.path); else selectFile(entry.file) }}
                        onDoubleClick={() => { if (entry.kind === 'directory') openDirectory(entry.path) }}
                        onKeyDown={(event) => activateEntry(event, entry)}
                      >
                        <td><span className="prototype-vfs-row-name"><span className="prototype-vfs-ico">{entry.kind === 'directory' ? <PrototypeFolderIcon aria-hidden="true" /> : <PrototypeFileIcon aria-hidden="true" />}</span>{entry.kind === 'directory' ? entry.name : baseName(entry.file.path)}</span></td>
                        <td className="muted col-size">{formatSize(entry.kind === 'directory' ? entry.size : entry.file.size, locale)}</td>
                        <td className="muted col-mod">{formatDate(entry.kind === 'directory' ? entry.updatedAt : entry.file.updatedAt, locale)}</td>
                      </tr>
                    )) : null}
                    {currentList?.status === 'ready' && !listEntries.length ? <tr><td colSpan={3} className="prototype-vfs-table-state">{deferredQuery ? text(locale, '没有匹配的文件', 'No matching Files') : text(locale, '空文件夹', 'Empty folder')}</td></tr> : null}
                  </tbody>
                </table>
              </div>

              <div className="prototype-vfs-main-foot">{listEntries.length} {text(locale, '项', listEntries.length === 1 ? 'item' : 'items')}{selectedFile ? ` · ${text(locale, '已选择', 'selected')} ${baseName(selectedFile.path)}` : ''} · {formatSize(totalSize, locale)}</div>

              {selectedFile ? <div className="prototype-vfs-preview">
                <div className="prototype-vfs-preview-head">
                  <span className="prototype-vfs-version-wrap">
                    <button ref={versionTriggerRef} type="button" className="prototype-vfs-file-title" aria-label={`${text(locale, '版本历史', 'Version history')}: ${baseName(selectedFile.path)}`} aria-haspopup="menu" aria-expanded={versionMenuOpen} onClick={() => setVersionMenuOpen((value) => !value)}>{baseName(selectedFile.path)}</button>
                    {versionMenuOpen ? <div ref={versionMenuRef} className="prototype-vfs-version-menu" role="menu">
                      {!currentVersions ? <span>{text(locale, '正在加载版本…', 'Loading versions…')}</span> : null}
                      {currentVersions?.status === 'error' ? <span role="alert">{currentVersions.error?.message}</span> : null}
                      {currentVersions?.items.map((version) => <button type="button" role="menuitemradio" aria-checked={version.version === viewVersion} key={version.id} onClick={() => { setSelectedVersion(version.version); setVersionMenuOpen(false) }}><strong>v{version.version}{version.version === selectedFile.version ? ` · ${text(locale, '当前', 'Current')}` : ''}</strong><small>{formatDate(version.createdAt, locale)}</small></button>)}
                      {currentVersions?.nextCursor ? <button type="button" role="menuitem" disabled={currentVersions.loadingMore} onClick={loadMoreVersions}>{currentVersions.loadingMore ? text(locale, '加载中…', 'Loading…') : text(locale, '加载更多版本', 'Load more versions')}</button> : null}
                    </div> : null}
                  </span>
                  <div>
                    <button type="button" disabled={!selectedFile} onClick={() => { void copy(selectedPath, text(locale, '路径已复制。', 'Path copied.')) }}>{text(locale, '复制路径', 'Copy path')}</button>
                    <button type="button" disabled={currentContent?.status !== 'ready' || currentContent.text === undefined} onClick={() => { void copy(currentContent?.text ?? '', text(locale, '内容已复制。', 'Content copied.')) }}>{text(locale, '复制', 'Copy')}</button>
                    <button type="button" disabled={downloading} onClick={() => { void download() }}>{text(locale, '下载', 'Download')}</button>
                  </div>
                </div>
                {!currentContent ? <pre className="prototype-vfs-preview-body" aria-label={text(locale, '文件内容', 'File content')}>{text(locale, '正在加载内容…', 'Loading content…')}</pre> : null}
                {currentContent?.status === 'error' ? <pre className="prototype-vfs-preview-body error" role="alert">{currentContent.error?.message}</pre> : null}
                {currentContent?.status === 'ready' ? <pre className="prototype-vfs-preview-body" aria-label={text(locale, '文件内容', 'File content')}>{currentContent.text ?? text(locale, `${currentContent.response?.contentType} 文件可下载查看。`, `Download the ${currentContent.response?.contentType} File to inspect it.`)}</pre> : null}
              </div> : null}
            </section>
          </div>
        </div>
      </div>

      {notice ? <div className="prototype-files-toast" role="status">{notice}</div> : null}
      {searchOpen ? <div className="prototype-session-dialog-backdrop" role="presentation"><section ref={searchDialogRef} className="prototype-session-dialog prototype-files-search-dialog" role="dialog" aria-modal="true" aria-labelledby="prototype-files-search-title"><h2 id="prototype-files-search-title">{text(locale, '搜索文件', 'Search Files')}</h2><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={text(locale, '搜索文件', 'Search Files')} placeholder={text(locale, '搜索路径…', 'Search paths…')} /><div><button type="button" onClick={closeSearch}>{text(locale, '完成', 'Done')}</button></div></section></div> : null}
    </main>
  )
}
