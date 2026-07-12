export type ApiConfig = {
  host: string
  port: number
  corsOrigin: boolean | string
  databaseUrl?: string
  authentication:
    | { mode: 'development'; actorId: string }
    | { mode: 'oidc'; issuer: string; audience: string; jwksUri: string }
}

const RUNTIME_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production'])

function parsePort(value: string | undefined) {
  const port = Number.parseInt(value ?? '8787', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}

function parseCorsOrigin(value: string | undefined, environment: string | undefined) {
  const origin = value?.trim()
  if (environment === 'production' && !origin) {
    throw new Error('CORS_ORIGIN is required in production.')
  }
  return origin || false
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment = env.NODE_ENV?.trim() || 'development'
  if (!RUNTIME_ENVIRONMENTS.has(environment)) throw new Error('NODE_ENV must be development, test, staging, or production.')
  const authMode = env.AUTH_MODE?.trim()
  if (authMode !== 'development' && authMode !== 'oidc') {
    throw new Error('AUTH_MODE must be explicitly set to development or oidc.')
  }
  if (authMode === 'development' && environment !== 'development') {
    throw new Error('Development authentication is allowed only when NODE_ENV is development.')
  }
  const databaseUrl = env.DATABASE_URL?.trim()
  if ((environment === 'staging' || environment === 'production') && !databaseUrl) {
    throw new Error('DATABASE_URL is required in staging and production.')
  }
  const corsOrigin = parseCorsOrigin(env.CORS_ORIGIN, environment)
  const issuer = env.OIDC_ISSUER?.trim()
  const audience = env.OIDC_AUDIENCE?.trim()
  const jwksUri = env.OIDC_JWKS_URI?.trim()
  const configuredOidcValues = [issuer, audience, jwksUri].filter(Boolean).length
  if (configuredOidcValues > 0 && configuredOidcValues < 3) {
    throw new Error('OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URI must be configured together.')
  }
  if (authMode === 'oidc' && (!issuer || !audience || !jwksUri)) {
    throw new Error('OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URI are required when AUTH_MODE is oidc.')
  }
  const host = env.HOST?.trim() || (authMode === 'development' ? '127.0.0.1' : '0.0.0.0')
  if (authMode === 'development' && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Development authentication may bind only to a loopback host.')
  }

  return {
    host,
    port: parsePort(env.PORT),
    corsOrigin,
    databaseUrl: databaseUrl || undefined,
    authentication: authMode === 'oidc' && issuer && audience && jwksUri
      ? { mode: 'oidc', issuer, audience, jwksUri }
      : { mode: 'development', actorId: env.DEVELOPMENT_ACTOR_ID?.trim() || 'user-local-admin' },
  }
}
