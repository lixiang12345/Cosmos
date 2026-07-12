import type { User, UserManager } from 'oidc-client-ts'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getWebAuthConfig, type OidcAuthConfig, type WebAuthConfig } from './config'
import { AuthContext, type AuthContextValue, type AuthStatus } from './context'

async function createUserManager(config: OidcAuthConfig) {
  const {
    InMemoryWebStorage,
    UserManager: LoadedUserManager,
    WebStorageStateStore,
  } = await import('oidc-client-ts')
  return new LoadedUserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    silent_redirect_uri: config.silentRedirectUri,
    response_type: 'code',
    scope: config.scope,
    automaticSilentRenew: Boolean(config.silentRedirectUri),
    loadUserInfo: true,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    extraQueryParams: config.audience ? { audience: config.audience } : undefined,
  })
}

let managerCache: { key: string; promise: Promise<UserManager> } | undefined
let redirectCallbackCache: { url: string; promise: Promise<string> } | undefined
let silentCallbackCache: { url: string; promise: Promise<void> } | undefined

function userManager(config: OidcAuthConfig) {
  const key = JSON.stringify(config)
  if (!managerCache || managerCache.key !== key) {
    const promise = createUserManager(config)
    managerCache = { key, promise }
    void promise.catch(() => {
      if (managerCache?.promise === promise) managerCache = undefined
    })
  }
  return managerCache.promise
}

function consumeRedirectCallback(manager: UserManager) {
  const url = window.location.href
  if (!redirectCallbackCache || redirectCallbackCache.url !== url) {
    const promise = manager.signinRedirectCallback().then((user) => safeReturnPath(user.state))
    redirectCallbackCache = { url, promise }
  }
  return redirectCallbackCache.promise
}

function consumeSilentCallback(manager: UserManager) {
  const url = window.location.href
  if (!silentCallbackCache || silentCallbackCache.url !== url) {
    const promise = manager.signinSilentCallback()
    silentCallbackCache = { url, promise }
  }
  return silentCallbackCache.promise
}

function callbackPath(uri: string | undefined) {
  return uri ? new URL(uri).pathname : undefined
}

function safeReturnPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/sessions'
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config] = useState<WebAuthConfig | Error>(() => {
    try {
      return getWebAuthConfig()
    } catch (error) {
      return error instanceof Error ? error : new Error('Invalid authentication configuration.')
    }
  })
  const [manager, setManager] = useState<UserManager>()
  const [user, setUser] = useState<User | undefined>(undefined)
  const currentAccessToken = useRef<string | undefined>(undefined)
  const [initializationError, setInitializationError] = useState<string>()
  const [status, setStatus] = useState<AuthStatus>(() => (
    config instanceof Error ? 'configuration_error' : config.mode === 'development' ? 'authenticated' : 'loading'
  ))

  const updateUser = useCallback((nextUser: User | undefined) => {
    currentAccessToken.current = nextUser?.access_token
    setUser(nextUser)
  }, [])

  const clearIdentity = useCallback(async () => {
    updateUser(undefined)
    setStatus('unauthenticated')
    if (!(config instanceof Error) && config.mode === 'oidc') {
      try {
        await manager?.removeUser()
      } catch {
        // Local identity is already cleared; remote storage cleanup is best effort.
      }
    }
  }, [config, manager, updateUser])

  const handleUnauthorized = useCallback(async (failedAccessToken: string | undefined) => {
    if (failedAccessToken !== currentAccessToken.current) return
    await clearIdentity()
  }, [clearIdentity])

  useEffect(() => {
    if (config instanceof Error || config.mode === 'development') return
    let cancelled = false
    void userManager(config).then(
      (loadedManager) => {
        if (!cancelled) setManager(loadedManager)
      },
      (error: unknown) => {
        if (cancelled) return
        setInitializationError(error instanceof Error ? error.message : 'Authentication initialization failed.')
        setStatus('configuration_error')
      },
    )
    return () => { cancelled = true }
  }, [config])

  useEffect(() => {
    if (config instanceof Error || config.mode === 'development') return
    if (!manager) return
    let cancelled = false

    const load = async () => {
      const path = window.location.pathname
      const isRedirectCallback = path === callbackPath(config.redirectUri)
      try {
        if (path === callbackPath(config.silentRedirectUri)) {
          await consumeSilentCallback(manager)
          return
        }
        let currentUser: User | null
        if (isRedirectCallback) {
          const returnPath = await consumeRedirectCallback(manager)
          window.history.replaceState({}, document.title, returnPath)
          currentUser = await manager.getUser()
        } else {
          currentUser = await manager.getUser()
          if ((!currentUser || currentUser.expired) && config.silentRedirectUri) {
            currentUser = await manager.signinSilent().catch(() => null)
          }
        }
        if (cancelled) return
        if (currentUser && !currentUser.expired) {
          updateUser(currentUser)
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      } catch {
        if (isRedirectCallback) {
          window.history.replaceState({}, document.title, '/sessions')
        }
        if (!cancelled) setStatus('unauthenticated')
      }
    }

    const onLoaded = (loadedUser: User) => {
      updateUser(loadedUser)
      setStatus('authenticated')
    }
    const onUnloaded = () => {
      updateUser(undefined)
      setStatus('unauthenticated')
    }
    const onExpired = () => { void clearIdentity() }
    manager.events.addUserLoaded(onLoaded)
    manager.events.addUserUnloaded(onUnloaded)
    manager.events.addAccessTokenExpired(onExpired)
    void load()
    return () => {
      cancelled = true
      manager.events.removeUserLoaded(onLoaded)
      manager.events.removeUserUnloaded(onUnloaded)
      manager.events.removeAccessTokenExpired(onExpired)
    }
  }, [clearIdentity, config, manager, updateUser])

  const signIn = useCallback(async () => {
    if (config instanceof Error || config.mode !== 'oidc') return
    await manager?.signinRedirect({
      state: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    })
  }, [config, manager])

  const signOut = useCallback(async () => {
    if (config instanceof Error || config.mode !== 'oidc') return
    updateUser(undefined)
    setStatus('unauthenticated')
    try {
      await manager?.signoutRedirect()
    } catch {
      await clearIdentity()
    }
  }, [clearIdentity, config, manager, updateUser])

  const actorId = config instanceof Error
    ? undefined
    : config.mode === 'development'
      ? config.actorId
      : typeof user?.profile.sub === 'string' ? user.profile.sub : undefined
  const displayName = config instanceof Error || config.mode === 'development'
    ? actorId
    : typeof user?.profile.name === 'string'
      ? user.profile.name
      : typeof user?.profile.email === 'string' ? user.profile.email : actorId

  const value = useMemo<AuthContextValue>(() => ({
    status,
    mode: config instanceof Error ? undefined : config.mode,
    actorId,
    displayName,
    demoMode: config instanceof Error ? false : config.demoMode,
    accessToken: user?.access_token,
    error: config instanceof Error ? config.message : initializationError,
    handleUnauthorized,
    signIn,
    signOut,
  }), [actorId, config, displayName, handleUnauthorized, initializationError, signIn, signOut, status, user?.access_token])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
