import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import type { User } from 'oidc-client-ts'
import { AuthProvider } from './AuthProvider'
import type { OidcAuthConfig } from './config'
import { useAuth } from './context'
import { getMe } from '../services/relayApi'

const authTestState = vi.hoisted(() => ({
  config: undefined as unknown,
  constructorError: undefined as Error | undefined,
  manager: undefined as unknown,
  settings: [] as unknown[],
}))

vi.mock('./config', () => ({
  getWebAuthConfig: () => authTestState.config,
}))

vi.mock('oidc-client-ts', () => {
  class InMemoryWebStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length() { return this.values.size }
    clear() { this.values.clear() }
    getItem(key: string) { return this.values.get(key) ?? null }
    key(index: number) { return [...this.values.keys()][index] ?? null }
    removeItem(key: string) { this.values.delete(key) }
    setItem(key: string, value: string) { this.values.set(key, value) }
  }

  class WebStorageStateStore {
    constructor(readonly settings: { store: Storage }) {}
  }

  class UserManager {
    constructor(settings: unknown) {
      authTestState.settings.push(settings)
      if (authTestState.constructorError) throw authTestState.constructorError
      return authTestState.manager as UserManager
    }
  }

  return { InMemoryWebStorage, UserManager, WebStorageStateStore }
})

type UserStub = Pick<User, 'access_token' | 'expired' | 'profile' | 'state'>

function createUser(
  state: unknown = '/sessions',
  accessToken = 'access-token-must-stay-in-memory',
): UserStub {
  return {
    access_token: accessToken,
    expired: false,
    profile: { sub: 'user-production', name: 'Production User' } as User['profile'],
    state,
  }
}

function createManager(user: UserStub | null = null) {
  return {
    events: {
      addAccessTokenExpired: vi.fn(),
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      removeAccessTokenExpired: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
    },
    getUser: vi.fn(async () => user),
    removeUser: vi.fn(async () => undefined),
    signinRedirect: vi.fn(async () => undefined),
    signinRedirectCallback: vi.fn(async () => user),
    signinSilent: vi.fn(async () => user),
    signinSilentCallback: vi.fn(async () => undefined),
    signoutRedirect: vi.fn(async () => undefined),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

let configSequence = 0

function configure(path: string) {
  configSequence += 1
  const origin = window.location.origin
  const config: OidcAuthConfig = {
    mode: 'oidc',
    authority: 'https://identity.example.com/',
    clientId: `relay-web-${configSequence}`,
    redirectUri: `${origin}/auth/callback`,
    postLogoutRedirectUri: `${origin}/`,
    scope: 'openid profile email',
    demoMode: false,
  }
  authTestState.config = config
  window.history.replaceState({}, '', path)
  return config
}

function AuthProbe() {
  const auth = useAuth()
  return (
    <div>
      <output data-testid="auth-status">{auth.status}</output>
      <output data-testid="auth-error">{auth.error ?? ''}</output>
      <output data-testid="access-token">{auth.accessToken ?? ''}</output>
      <output data-testid="credential-version">{auth.credentialVersion}</output>
      <button type="button" onClick={() => { void auth.handleUnauthorized(auth.accessToken) }}>Clear identity</button>
      <button type="button" onClick={() => {
        void getMe({ accessToken: auth.accessToken, onUnauthorized: auth.handleUnauthorized }).catch(() => undefined)
      }}>Load profile</button>
      <button type="button" onClick={() => { void auth.signOut() }}>Sign out</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <StrictMode>
      <AuthProvider><AuthProbe /></AuthProvider>
    </StrictMode>,
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    authTestState.constructorError = undefined
    authTestState.manager = undefined
    authTestState.settings = []
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('uses in-memory user storage while keeping only protocol state in session storage', async () => {
    configure('/sessions')
    const manager = createManager()
    authTestState.manager = manager

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated'))
    expect(authTestState.settings).toHaveLength(1)
    const settings = authTestState.settings[0] as {
      stateStore: { settings: { store: Storage } }
      userStore: { settings: { store: Storage } }
    }
    const { InMemoryWebStorage, WebStorageStateStore } = await import('oidc-client-ts')
    expect(settings.userStore).toBeInstanceOf(WebStorageStateStore)
    expect(settings.userStore.settings.store).toBeInstanceOf(InMemoryWebStorage)
    expect(settings.userStore.settings.store).not.toBe(window.sessionStorage)
    expect(settings.stateStore).toBeInstanceOf(WebStorageStateStore)
    expect(settings.stateStore.settings.store).toBe(window.sessionStorage)
    expect(JSON.stringify(window.sessionStorage)).not.toContain('access-token-must-stay-in-memory')
  })

  it('consumes a successful callback URL exactly once across StrictMode remounts', async () => {
    const callbackUrl = '/auth/callback?code=success&state=oidc-state'
    configure(callbackUrl)
    const callback = deferred<UserStub>()
    const user = createUser('/runs/session-42')
    const manager = createManager(user)
    manager.signinRedirectCallback.mockReturnValue(callback.promise)
    authTestState.manager = manager

    const firstRender = renderProvider()
    await waitFor(() => expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1))
    firstRender.unmount()
    const secondRender = renderProvider()
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1)

    await act(async () => { callback.resolve(user) })

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('access-token')).toHaveTextContent(user.access_token)
    expect(window.location.pathname).toBe('/runs/session-42')
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1)

    secondRender.unmount()
    window.history.replaceState({}, '', callbackUrl)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1)
  })

  it('locks a rejected callback and removes authorization data from the URL', async () => {
    const callbackUrl = '/auth/callback?code=rejected&state=oidc-state'
    configure(callbackUrl)
    const callback = deferred<UserStub>()
    const manager = createManager()
    manager.signinRedirectCallback.mockReturnValue(callback.promise)
    authTestState.manager = manager

    const firstRender = renderProvider()
    await waitFor(() => expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1))
    await act(async () => { callback.reject(new Error('Invalid callback state.')) })

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated'))
    expect(window.location.pathname).toBe('/sessions')
    expect(window.location.search).toBe('')
    firstRender.unmount()

    window.history.replaceState({}, '', callbackUrl)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated'))
    expect(window.location.pathname).toBe('/sessions')
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the OIDC manager cannot be initialized', async () => {
    configure('/sessions')
    authTestState.manager = createManager()
    authTestState.constructorError = new Error('OIDC storage is unavailable.')

    const failedRender = renderProvider()

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('configuration_error'))
    expect(screen.getByTestId('auth-error')).toHaveTextContent('OIDC storage is unavailable.')
    expect(authTestState.settings).toHaveLength(1)

    failedRender.unmount()
    authTestState.constructorError = undefined
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated'))
    expect(authTestState.settings).toHaveLength(2)
  })

  it('clears the current identity synchronously when its 401 cleanup rejects', async () => {
    configure('/sessions')
    const manager = createManager(createUser())
    manager.removeUser.mockRejectedValue(new Error('Storage cleanup failed.'))
    authTestState.manager = manager
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    const user = userEvent.setup()
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))

    await user.click(screen.getByRole('button', { name: 'Load profile' }))

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('access-token')).toBeEmptyDOMElement()
    await waitFor(() => expect(manager.removeUser).toHaveBeenCalledTimes(1))
  })

  it('ignores token A\'s delayed 401 after token B becomes current', async () => {
    configure('/sessions')
    const manager = createManager(createUser('/sessions', 'token-a'))
    authTestState.manager = manager
    const response = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('access-token')).toHaveTextContent('token-a'))
    expect(screen.getByTestId('credential-version')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Load profile' }))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token-a')

    const onLoaded = manager.events.addUserLoaded.mock.lastCall?.[0] as ((user: User) => void) | undefined
    expect(onLoaded).toBeTypeOf('function')
    act(() => { onLoaded?.(createUser('/sessions', 'token-b') as User) })
    expect(screen.getByTestId('access-token')).toHaveTextContent('token-b')
    expect(screen.getByTestId('credential-version')).toHaveTextContent('2')

    await act(async () => {
      response.resolve(new Response(JSON.stringify({
        code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.', retryable: false,
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
      await response.promise
    })

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('access-token')).toHaveTextContent('token-b')
    expect(manager.removeUser).not.toHaveBeenCalled()
  })

  it('leaves a local signed-out state when the provider logout redirect fails', async () => {
    configure('/sessions')
    const manager = createManager(createUser())
    manager.signoutRedirect.mockRejectedValue(new Error('Identity provider is unavailable.'))
    manager.removeUser.mockRejectedValue(new Error('Storage cleanup failed.'))
    authTestState.manager = manager
    const user = userEvent.setup()
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(screen.getByTestId('auth-status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('access-token')).toBeEmptyDOMElement()
    await waitFor(() => expect(manager.removeUser).toHaveBeenCalledTimes(1))
  })
})
