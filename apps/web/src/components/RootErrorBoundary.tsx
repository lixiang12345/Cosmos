import { Component, Fragment, type ReactNode } from 'react'

const SAFE_REFRESH_STORAGE_KEY = 'cosmos.root-error.safe-refresh'
const SAFE_REFRESH_WINDOW_MS = 30_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

type RootErrorBoundaryProps = {
  children: ReactNode
  locationKey?: () => string
  now?: () => number
  reloadPage?: () => void
  storage?: StorageLike
}

type RefreshStatus = 'ready' | 'blocked' | 'unavailable'

type RootErrorBoundaryState = {
  error: unknown
  hasError: boolean
  refreshStatus: RefreshStatus
  retryKey: number
}

type SafeRefreshRecord = {
  attemptedAt: number
  location: string
}

const copy = {
  zh: {
    eyebrow: 'COSMOS RECOVERY',
    renderTitle: '页面暂时无法显示',
    renderBody: '应用遇到了意外错误。你可以先重试当前界面；若仍无法恢复，请进行一次安全刷新。',
    chunkTitle: '应用更新未能加载',
    chunkBody: '页面资源可能已更新，或网络连接刚刚中断。你可以先重试；若仍无法恢复，请进行一次安全刷新。',
    retry: '重试',
    refresh: '安全刷新',
    blocked: '本页刚刚已安全刷新。为避免刷新循环，再次刷新已暂时停用，请稍后重试。',
    unavailable: '浏览器无法安全记录刷新状态。为避免刷新循环，请稍后使用浏览器的刷新功能。',
    reference: '错误类型',
    chunkReference: '资源加载',
    renderReference: '界面渲染',
  },
  en: {
    eyebrow: 'COSMOS RECOVERY',
    renderTitle: 'This page is temporarily unavailable',
    renderBody: 'The application encountered an unexpected error. Retry this view first, then use one safe refresh if it still cannot recover.',
    chunkTitle: 'The application update could not be loaded',
    chunkBody: 'The page assets may have changed, or the network connection was interrupted. Retry first, then use one safe refresh if needed.',
    retry: 'Retry',
    refresh: 'Safe refresh',
    blocked: 'This page was just safely refreshed. Another refresh is temporarily disabled to prevent a reload loop. Please retry shortly.',
    unavailable: 'The browser cannot safely record refresh state. To prevent a reload loop, wait before using the browser refresh control.',
    reference: 'Error type',
    chunkReference: 'asset loading',
    renderReference: 'view rendering',
  },
} as const

function resolveLocale(): keyof typeof copy {
  try {
    const storedLocale = window.localStorage.getItem('cosmos.locale')
    if (storedLocale === 'zh' || storedLocale === 'en') return storedLocale
  } catch {
    // Continue with browser-provided language signals.
  }

  const language = document.documentElement.lang || window.navigator.language
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function resolveTheme() {
  try {
    const storedTheme = window.localStorage.getItem('cosmos.theme')
    if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme
  } catch {
    // Continue with browser-provided theme signals.
  }

  const documentTheme = document.documentElement.dataset.theme
  if (documentTheme === 'dark' || documentTheme === 'light') return documentTheme
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function isChunkLoadError(error: unknown) {
  try {
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
    return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)
  } catch {
    return false
  }
}

function getSessionStorage(): StorageLike | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

function getLocationKey() {
  return `${window.location.pathname}${window.location.search}`
}

function readSafeRefreshRecord(storage: StorageLike): SafeRefreshRecord | undefined {
  try {
    const raw = storage.getItem(SAFE_REFRESH_STORAGE_KEY)
    if (!raw) return undefined

    const record = JSON.parse(raw) as Partial<SafeRefreshRecord>
    if (typeof record.attemptedAt !== 'number' || typeof record.location !== 'string') return undefined
    return { attemptedAt: record.attemptedAt, location: record.location }
  } catch {
    return undefined
  }
}

function wasRecentlyRefreshed(storage: StorageLike | undefined, location: string, now: number) {
  if (!storage) return false
  const record = readSafeRefreshRecord(storage)
  if (!record || record.location !== location) return false
  return Math.abs(now - record.attemptedAt) < SAFE_REFRESH_WINDOW_MS
}

function writeSafeRefreshRecord(storage: StorageLike, location: string, now: number) {
  try {
    storage.setItem(SAFE_REFRESH_STORAGE_KEY, JSON.stringify({ attemptedAt: now, location }))
    return true
  } catch {
    return false
  }
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: undefined,
    hasError: false,
    refreshStatus: 'ready',
    retryKey: 0,
  }

  static getDerivedStateFromError(error: unknown): Partial<RootErrorBoundaryState> {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[RootErrorBoundary] Unhandled application error', {
      category: isChunkLoadError(error) ? 'asset_loading' : 'view_rendering',
      errorType: error instanceof Error ? error.name : typeof error,
    })
  }

  private getStorage = () => this.props.storage ?? getSessionStorage()

  private getLocation = () => this.props.locationKey?.() ?? getLocationKey()

  private getNow = () => this.props.now?.() ?? Date.now()

  private handleRetry = () => {
    this.setState((current) => ({
      error: undefined,
      hasError: false,
      refreshStatus: 'ready',
      retryKey: current.retryKey + 1,
    }))
  }

  private handleSafeRefresh = () => {
    const storage = this.getStorage()
    const location = this.getLocation()
    const now = this.getNow()

    if (!storage) {
      this.setState({ refreshStatus: 'unavailable' })
      return
    }

    if (wasRecentlyRefreshed(storage, location, now)) {
      this.setState({ refreshStatus: 'blocked' })
      return
    }

    if (!writeSafeRefreshRecord(storage, location, now)) {
      this.setState({ refreshStatus: 'unavailable' })
      return
    }

    this.setState({ refreshStatus: 'blocked' }, () => {
      const reloadPage = this.props.reloadPage ?? (() => window.location.reload())
      try {
        reloadPage()
      } catch {
        this.setState({ refreshStatus: 'unavailable' })
      }
    })
  }

  render() {
    if (!this.state.hasError) {
      return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
    }

    const locale = resolveLocale()
    const theme = resolveTheme()
    const text = copy[locale]
    const chunkLoadFailure = isChunkLoadError(this.state.error)
    const storage = this.getStorage()
    const recentlyRefreshed = wasRecentlyRefreshed(storage, this.getLocation(), this.getNow())
    const refreshStatus = this.state.refreshStatus === 'ready' && recentlyRefreshed
      ? 'blocked'
      : this.state.refreshStatus
    const refreshMessage = refreshStatus === 'blocked'
      ? text.blocked
      : refreshStatus === 'unavailable'
        ? text.unavailable
        : null

    return (
      <main className={`root-error-screen root-error-screen--${theme}`} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
        <section className="root-error-panel" role="alert" aria-live="assertive">
          <span className="root-error-panel__mark" aria-hidden="true">!</span>
          <p className="root-error-panel__eyebrow">{text.eyebrow}</p>
          <h1>{chunkLoadFailure ? text.chunkTitle : text.renderTitle}</h1>
          <p className="root-error-panel__body">{chunkLoadFailure ? text.chunkBody : text.renderBody}</p>
          <div className="root-error-panel__actions">
            <button type="button" className="root-error-button root-error-button--primary" onClick={this.handleRetry}>
              {text.retry}
            </button>
            <button
              type="button"
              className="root-error-button"
              disabled={refreshStatus !== 'ready'}
              onClick={this.handleSafeRefresh}
            >
              {text.refresh}
            </button>
          </div>
          {refreshMessage ? <p className="root-error-panel__notice" role="status">{refreshMessage}</p> : null}
          <p className="root-error-panel__reference">
            {text.reference}: {chunkLoadFailure ? text.chunkReference : text.renderReference}
          </p>
        </section>
      </main>
    )
  }
}
