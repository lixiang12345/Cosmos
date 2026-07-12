export type ApiConfig = {
  host: string
  port: number
  corsOrigin: boolean | string
  databaseUrl?: string
  databaseConnectionTimeoutMs: number
  databaseQueryTimeoutMs: number
  databaseStatementTimeoutMs: number
  migrateOnStart: boolean
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

function parseDuration(value: string | undefined, name: string, defaultValue: number) {
  if (value === undefined) return defaultValue
  const duration = Number(value)
  if (!Number.isSafeInteger(duration) || duration < 100 || duration > 300_000) {
    throw new Error(`${name} must be an integer between 100 and 300000 milliseconds.`)
  }
  return duration
}

function parseCorsOrigin(value: string | undefined, environment: string | undefined) {
  const origin = value?.trim()
  if (environment === 'production' && !origin) {
    throw new Error('CORS_ORIGIN is required in production.')
  }
  return origin || false
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const configuredEnvironment = env.NODE_ENV?.trim()
  const environment = configuredEnvironment || 'development'
  if (!RUNTIME_ENVIRONMENTS.has(environment)) throw new Error('NODE_ENV must be development, test, staging, or production.')
  const authMode = env.AUTH_MODE?.trim()
  if (authMode !== 'development' && authMode !== 'oidc') {
    throw new Error('AUTH_MODE must be explicitly set to development or oidc.')
  }
  if (authMode === 'oidc' && !configuredEnvironment) {
    throw new Error('NODE_ENV must be explicitly set when AUTH_MODE is oidc.')
  }
  if (authMode === 'development' && environment !== 'development') {
    throw new Error('Development authentication is allowed only when NODE_ENV is development.')
  }
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl && (authMode === 'oidc' || environment === 'staging' || environment === 'production')) {
    throw new Error('DATABASE_URL is required when AUTH_MODE is oidc and in staging and production.')
  }
  const corsOrigin = parseCorsOrigin(env.CORS_ORIGIN, environment)
  const migrateOnStartValue = env.MIGRATE_ON_START?.trim()
  if (migrateOnStartValue && migrateOnStartValue !== 'true' && migrateOnStartValue !== 'false') {
    throw new Error('MIGRATE_ON_START must be true or false when configured.')
  }
  const migrateOnStart = migrateOnStartValue
    ? migrateOnStartValue === 'true'
    : environment === 'development'
  if (migrateOnStart && (environment === 'staging' || environment === 'production')) {
    throw new Error('MIGRATE_ON_START cannot be enabled in staging or production; use the migration job.')
  }
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
  if (authMode === 'oidc' && environment === 'production' && issuer && jwksUri) {
    for (const [name, value] of [['OIDC_ISSUER', issuer], ['OIDC_JWKS_URI', jwksUri]]) {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        throw new Error(`${name} must be a valid HTTPS URL in production.`)
      }
      if (url.protocol !== 'https:') throw new Error(`${name} must be a valid HTTPS URL in production.`)
    }
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
    databaseConnectionTimeoutMs: parseDuration(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      5_000,
    ),
    databaseQueryTimeoutMs: parseDuration(
      env.DATABASE_QUERY_TIMEOUT_MS,
      'DATABASE_QUERY_TIMEOUT_MS',
      20_000,
    ),
    databaseStatementTimeoutMs: parseDuration(
      env.DATABASE_STATEMENT_TIMEOUT_MS,
      'DATABASE_STATEMENT_TIMEOUT_MS',
      15_000,
    ),
    migrateOnStart,
    authentication: authMode === 'oidc' && issuer && audience && jwksUri
      ? { mode: 'oidc', issuer, audience, jwksUri }
      : { mode: 'development', actorId: env.DEVELOPMENT_ACTOR_ID?.trim() || 'user-local-admin' },
  }
}
