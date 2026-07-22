import { loadObjectStorageConfig, type ObjectStorageConfig } from './object-storage-config.js'

export type ApiConfig = {
  host: string
  port: number
  corsOrigin: boolean | string
  trustProxy: false | string[]
  bodyLimit: number
  connectionTimeoutMs: number
  requestTimeoutMs: number
  keepAliveTimeoutMs: number
  securityHeaders: {
    hsts: boolean
  }
  securityAuditHmacKey?: string
  securityAuditHmacKeyId?: string
  objectStorage?: ObjectStorageConfig
  contextEngine?: {
    baseUrl: string
    apiKey: string
    workspaces: Record<string, string>
    timeoutMs: number
    allowInsecureHttp: boolean
  }
  rateLimit: {
    max: number
    timeWindowMs: number
    cache: number
  }
  databaseUrl?: string
  databaseConnectionTimeoutMs: number
  databaseQueryTimeoutMs: number
  databaseStatementTimeoutMs: number
  migrateOnStart: boolean
  executionEnabled: boolean
  executionMaxAttempts: number
  workerReadinessMaxAgeMs: number
  sessionEventStream: {
    maxConnections: number
    maxConnectionsPerActor: number
    maxConnectionsPerSession: number
    retryAfterSeconds: number
  }
  authentication:
    | { mode: 'development'; actorId: string }
    | { mode: 'oidc'; issuer: string; audience: string; jwksUri: string }
}

export type MigrationConfig = {
  databaseUrl: string
  databaseConnectionTimeoutMs: number
  databaseQueryTimeoutMs: number
  databaseStatementTimeoutMs: number
}

const RUNTIME_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production'])

function parsePort(value: string | undefined) {
  const port = Number(value ?? '8787')
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

function parseBoolean(value: string | undefined, name: string, defaultValue: boolean) {
  if (value === undefined) return defaultValue
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false when configured.`)
  }
  return value === 'true'
}

function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return defaultValue
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function parseCorsOrigin(value: string | undefined, environment: string | undefined) {
  const origin = value?.trim()
  if (environment === 'production' && !origin) {
    throw new Error('CORS_ORIGIN is required in production.')
  }
  if (environment === 'production' && origin) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error('CORS_ORIGIN must be one exact HTTPS origin in production.')
    }
    if (
      url.protocol !== 'https:'
      || url.origin !== origin
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      throw new Error('CORS_ORIGIN must be one exact HTTPS origin in production.')
    }
  }
  return origin || false
}

function trustedProxy(value: string) {
  const match = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(value)
  if (!match) return false
  const address = match[1] ?? ''
  const version = isIP(address)
  if (version === 0) return false
  const maximumPrefix = version === 6 ? 128 : 32
  return match[2] === undefined || Number(match[2]) <= maximumPrefix
}

function parseTrustProxy(value: string | undefined) {
  const configured = value?.trim()
  if (!configured) return false
  const entries = configured.split(',').map((entry) => entry.trim())
  if (
    entries.length > 32
    || entries.some((entry) => !entry || entry.length > 128 || !trustedProxy(entry))
  ) {
    throw new Error('TRUST_PROXY must be a comma-separated list of at most 32 IP addresses or CIDR ranges.')
  }
  return [...new Set(entries)]
}

function parseSecurityAuditHmacKey(value: string | undefined, environment: string) {
  const key = value?.trim()
  if (!key) {
    if (environment === 'staging' || environment === 'production') {
      throw new Error('SECURITY_AUDIT_HMAC_KEY is required in staging and production.')
    }
    return undefined
  }
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error('SECURITY_AUDIT_HMAC_KEY must contain exactly 64 hexadecimal characters.')
  }
  return key.toLowerCase()
}

function parseSecurityAuditHmacKeyId(value: string | undefined, environment: string, hasKey: boolean) {
  const keyId = value?.trim()
  if (!keyId) {
    if (environment === 'staging' || environment === 'production') {
      throw new Error('SECURITY_AUDIT_HMAC_KEY_ID is required in staging and production.')
    }
    return hasKey ? 'development' : undefined
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) {
    throw new Error('SECURITY_AUDIT_HMAC_KEY_ID must be a 1 to 64 character stable key identifier.')
  }
  return keyId
}

function parseContextEngineConfig(env: NodeJS.ProcessEnv, environment: string) {
  const baseUrl = env.CONTEXT_ENGINE_BASE_URL?.trim()
  const apiKey = env.CONTEXT_ENGINE_API_KEY?.trim()
  const workspacesJson = env.CONTEXT_ENGINE_WORKSPACES_JSON?.trim()
  const configured = [baseUrl, apiKey, workspacesJson].filter(Boolean).length
  if (configured === 0) return undefined
  if (configured !== 3 || !baseUrl || !apiKey || !workspacesJson) {
    throw new Error('CONTEXT_ENGINE_BASE_URL, CONTEXT_ENGINE_API_KEY, and CONTEXT_ENGINE_WORKSPACES_JSON must be configured together.')
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('CONTEXT_ENGINE_BASE_URL must be a valid URL.')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  const allowInsecureHttp = parseBoolean(
    env.CONTEXT_ENGINE_ALLOW_INSECURE_HTTP,
    'CONTEXT_ENGINE_ALLOW_INSECURE_HTTP',
    false,
  )
  if (allowInsecureHttp && environment !== 'development') {
    throw new Error('CONTEXT_ENGINE_ALLOW_INSECURE_HTTP may be enabled only when NODE_ENV is development.')
  }
  const developmentHttp = environment === 'development' && allowInsecureHttp && url.protocol === 'http:'
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback) && !developmentHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('CONTEXT_ENGINE_BASE_URL must use HTTPS except for loopback or explicitly allowed development HTTP, and must not contain credentials, a query, or a fragment.')
  }
  if (/\r|\n/.test(apiKey)) throw new Error('CONTEXT_ENGINE_API_KEY must be a valid bearer token.')
  let parsed: unknown
  try {
    parsed = JSON.parse(workspacesJson)
  } catch {
    throw new Error('CONTEXT_ENGINE_WORKSPACES_JSON must be a JSON object mapping repository names to workspace ids.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CONTEXT_ENGINE_WORKSPACES_JSON must be a JSON object mapping repository names to workspace ids.')
  }
  const entries = Object.entries(parsed)
  if (
    entries.length === 0
    || entries.length > 256
    || entries.some(([repository, workspaceId]) => (
      !repository.trim()
      || repository.length > 512
      || typeof workspaceId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workspaceId)
    ))
  ) {
    throw new Error('CONTEXT_ENGINE_WORKSPACES_JSON must contain 1 to 256 valid repository-to-workspace mappings.')
  }
  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    apiKey,
    workspaces: Object.fromEntries(entries.map(([repository, workspaceId]) => [repository.trim(), workspaceId])),
    timeoutMs: parseDuration(env.CONTEXT_ENGINE_TIMEOUT_MS, 'CONTEXT_ENGINE_TIMEOUT_MS', 20_000),
    allowInsecureHttp,
  }
}

export function loadMigrationConfig(env: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations.')
  return {
    databaseUrl,
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
  }
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
  const migrateOnStartValue = env.MIGRATE_ON_START?.trim() || undefined
  const migrateOnStart = parseBoolean(
    migrateOnStartValue,
    'MIGRATE_ON_START',
    environment === 'development',
  )
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
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new Error(`${name} must be a valid HTTPS URL in production.`)
      }
    }
  }
  const host = env.HOST?.trim() || (authMode === 'development' ? '127.0.0.1' : '0.0.0.0')
  const allowNonLoopbackDevelopmentAuth = parseBoolean(
    env.ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH,
    'ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH',
    false,
  )
  if (
    authMode === 'development'
    && !['127.0.0.1', 'localhost', '::1'].includes(host)
    && !(environment === 'development' && allowNonLoopbackDevelopmentAuth)
  ) {
    throw new Error('Development authentication may bind only to a loopback host.')
  }

  const securityAuditHmacKey = parseSecurityAuditHmacKey(env.SECURITY_AUDIT_HMAC_KEY, environment)
  return {
    host,
    port: parsePort(env.PORT),
    corsOrigin,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    bodyLimit: parseInteger(env.API_BODY_LIMIT_BYTES, 'API_BODY_LIMIT_BYTES', 1_048_576, 1_024, 10_485_760),
    connectionTimeoutMs: parseDuration(
      env.API_CONNECTION_TIMEOUT_MS,
      'API_CONNECTION_TIMEOUT_MS',
      10_000,
    ),
    requestTimeoutMs: parseDuration(
      env.API_REQUEST_TIMEOUT_MS,
      'API_REQUEST_TIMEOUT_MS',
      15_000,
    ),
    keepAliveTimeoutMs: parseDuration(
      env.API_KEEP_ALIVE_TIMEOUT_MS,
      'API_KEEP_ALIVE_TIMEOUT_MS',
      5_000,
    ),
    securityHeaders: { hsts: environment === 'production' },
    securityAuditHmacKey,
    securityAuditHmacKeyId: parseSecurityAuditHmacKeyId(
      env.SECURITY_AUDIT_HMAC_KEY_ID,
      environment,
      securityAuditHmacKey !== undefined,
    ),
    objectStorage: loadObjectStorageConfig(env, environment),
    contextEngine: parseContextEngineConfig(env, environment),
    rateLimit: {
      max: parseInteger(env.API_RATE_LIMIT_MAX, 'API_RATE_LIMIT_MAX', 600, 1, 100_000),
      timeWindowMs: parseInteger(
        env.API_RATE_LIMIT_WINDOW_MS,
        'API_RATE_LIMIT_WINDOW_MS',
        60_000,
        1_000,
        3_600_000,
      ),
      cache: parseInteger(env.API_RATE_LIMIT_CACHE, 'API_RATE_LIMIT_CACHE', 10_000, 100, 1_000_000),
    },
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
    executionEnabled: parseBoolean(
      env.EXECUTION_ENABLED?.trim() || undefined,
      'EXECUTION_ENABLED',
      environment === 'development',
    ),
    executionMaxAttempts: parseInteger(
      env.EXECUTION_MAX_ATTEMPTS?.trim() || undefined,
      'EXECUTION_MAX_ATTEMPTS',
      5,
      1,
      20,
    ),
    workerReadinessMaxAgeMs: parseInteger(
      env.WORKER_READINESS_MAX_AGE_MS?.trim() || undefined,
      'WORKER_READINESS_MAX_AGE_MS',
      30_000,
      100,
      300_000,
    ),
    sessionEventStream: {
      maxConnections: parseInteger(
        env.SESSION_EVENT_STREAM_MAX_CONNECTIONS?.trim() || undefined,
        'SESSION_EVENT_STREAM_MAX_CONNECTIONS',
        1_000,
        1,
        100_000,
      ),
      maxConnectionsPerActor: parseInteger(
        env.SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_ACTOR?.trim() || undefined,
        'SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_ACTOR',
        10,
        1,
        1_000,
      ),
      maxConnectionsPerSession: parseInteger(
        env.SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_SESSION?.trim() || undefined,
        'SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_SESSION',
        50,
        1,
        1_000,
      ),
      retryAfterSeconds: parseInteger(
        env.SESSION_EVENT_STREAM_RETRY_AFTER_SECONDS?.trim() || undefined,
        'SESSION_EVENT_STREAM_RETRY_AFTER_SECONDS',
        5,
        1,
        3_600,
      ),
    },
    authentication: authMode === 'oidc' && issuer && audience && jwksUri
      ? { mode: 'oidc', issuer, audience, jwksUri }
      : { mode: 'development', actorId: env.DEVELOPMENT_ACTOR_ID?.trim() || 'user-local-admin' },
  }
}
import { isIP } from 'node:net'
