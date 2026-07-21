export type DevelopmentAuthConfig = {
  mode: 'development'
  actorId: string
  demoMode: boolean
}

export type OidcAuthConfig = {
  mode: 'oidc'
  authority: string
  clientId: string
  redirectUri: string
  postLogoutRedirectUri: string
  silentRedirectUri?: string
  scope: string
  audience?: string
  demoMode: false
}

export type WebAuthConfig = DevelopmentAuthConfig | OidcAuthConfig

type WebEnvironment = Record<string, string | boolean | undefined>

function required(value: string | boolean | undefined, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`)
  return value.trim()
}

function isLoopback(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
}

function secureUrl(
  value: string,
  name: string,
  options: { production: boolean; expectedOrigin?: string },
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute URL.`)
  }
  const loopbackHttp = !options.production && url.protocol === 'http:' && isLoopback(url)
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only on loopback outside production).`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} cannot contain credentials, a query, or a fragment.`)
  }
  if (options.expectedOrigin && url.origin !== options.expectedOrigin) {
    throw new Error(`${name} must use the application origin.`)
  }
  return url.toString()
}

export function loadWebAuthConfig(
  env: WebEnvironment,
  locationOrigin: string,
): WebAuthConfig {
  const isTest = env.MODE === 'test'
  const production = env.PROD === true
  const mode = typeof env.VITE_AUTH_MODE === 'string'
    ? env.VITE_AUTH_MODE.trim()
    : isTest ? 'development' : ''
  if (mode !== 'development' && mode !== 'oidc') {
    throw new Error('VITE_AUTH_MODE must be explicitly set to development or oidc.')
  }
  if (mode === 'development') {
    const allowProductionDevelopmentAuth = env.VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH === 'true'
    if (production && (!allowProductionDevelopmentAuth || !isLoopback(new URL(locationOrigin)))) {
      throw new Error('Development authentication is disabled in production builds outside an explicitly enabled loopback runtime.')
    }
    const demoMode = env.VITE_DEMO_MODE === 'true' || isTest
    if (production && demoMode) throw new Error('Demo mode is disabled in production builds.')
    return {
      mode,
      actorId: required(env.VITE_DEVELOPMENT_ACTOR_ID ?? 'user-local-admin', 'VITE_DEVELOPMENT_ACTOR_ID'),
      demoMode,
    }
  }

  const applicationOrigin = new URL(locationOrigin).origin
  const redirectUri = secureUrl(
    typeof env.VITE_OIDC_REDIRECT_URI === 'string' && env.VITE_OIDC_REDIRECT_URI.trim()
      ? env.VITE_OIDC_REDIRECT_URI.trim()
      : `${locationOrigin}/auth/callback`,
    'VITE_OIDC_REDIRECT_URI',
    { production, expectedOrigin: applicationOrigin },
  )
  const postLogoutRedirectUri = secureUrl(
    typeof env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI === 'string' && env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI.trim()
      ? env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI.trim()
      : `${locationOrigin}/`,
    'VITE_OIDC_POST_LOGOUT_REDIRECT_URI',
    { production, expectedOrigin: applicationOrigin },
  )
  const silentRedirectValue = typeof env.VITE_OIDC_SILENT_REDIRECT_URI === 'string'
    ? env.VITE_OIDC_SILENT_REDIRECT_URI.trim()
    : ''

  return {
    mode,
    authority: secureUrl(
      required(env.VITE_OIDC_AUTHORITY, 'VITE_OIDC_AUTHORITY'),
      'VITE_OIDC_AUTHORITY',
      { production },
    ),
    clientId: required(env.VITE_OIDC_CLIENT_ID, 'VITE_OIDC_CLIENT_ID'),
    redirectUri,
    postLogoutRedirectUri,
    silentRedirectUri: silentRedirectValue
      ? secureUrl(silentRedirectValue, 'VITE_OIDC_SILENT_REDIRECT_URI', {
          production,
          expectedOrigin: applicationOrigin,
        })
      : undefined,
    scope: typeof env.VITE_OIDC_SCOPE === 'string' && env.VITE_OIDC_SCOPE.trim()
      ? env.VITE_OIDC_SCOPE.trim()
      : 'openid profile email',
    audience: typeof env.VITE_OIDC_AUDIENCE === 'string' && env.VITE_OIDC_AUDIENCE.trim()
      ? env.VITE_OIDC_AUDIENCE.trim()
      : undefined,
    demoMode: false,
  }
}

export function getWebAuthConfig() {
  return loadWebAuthConfig(import.meta.env as unknown as WebEnvironment, window.location.origin)
}
