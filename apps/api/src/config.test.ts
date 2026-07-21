import { describe, expect, it } from 'vitest'
import { loadConfig, loadMigrationConfig } from './config.js'

const securityAuditHmacKey = '01'.repeat(32)

describe('API configuration', () => {
  it('supports an explicitly selected loopback-only development identity', () => {
    expect(loadConfig({ AUTH_MODE: 'development' })).toEqual({
      host: '127.0.0.1', port: 8787, corsOrigin: false, databaseUrl: undefined,
      trustProxy: false,
      bodyLimit: 1_048_576,
      connectionTimeoutMs: 10_000,
      requestTimeoutMs: 15_000,
      keepAliveTimeoutMs: 5_000,
      securityHeaders: { hsts: false },
      securityAuditHmacKey: undefined,
      securityAuditHmacKeyId: undefined,
      rateLimit: { max: 600, timeWindowMs: 60_000, cache: 10_000 },
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 20_000,
      databaseStatementTimeoutMs: 15_000,
      migrateOnStart: true,
      executionEnabled: true,
      executionMaxAttempts: 5,
      workerReadinessMaxAgeMs: 30_000,
      sessionEventStream: {
        maxConnections: 1_000,
        maxConnectionsPerActor: 10,
        maxConnectionsPerSession: 50,
        retryAfterSeconds: 5,
      },
      authentication: { mode: 'development', actorId: 'user-local-admin' },
    })
  })

  it('keeps Context Engine HTTP limited to explicit development deployments', () => {
    const contextEngine = {
      CONTEXT_ENGINE_API_KEY: 'context-secret',
      CONTEXT_ENGINE_WORKSPACES_JSON: '{"relay/platform":"workspace-platform"}',
    }
    expect(loadConfig({
      AUTH_MODE: 'development',
      ...contextEngine,
      CONTEXT_ENGINE_BASE_URL: 'http://127.0.0.1:8790',
    }).contextEngine).toMatchObject({
      baseUrl: 'http://127.0.0.1:8790',
      workspaces: { 'relay/platform': 'workspace-platform' },
    })
    expect(() => loadConfig({
      AUTH_MODE: 'development',
      ...contextEngine,
      CONTEXT_ENGINE_BASE_URL: 'http://host.docker.internal:8790',
    })).toThrow('explicitly allowed development HTTP')
    expect(loadConfig({
      AUTH_MODE: 'development',
      ...contextEngine,
      CONTEXT_ENGINE_BASE_URL: 'http://host.docker.internal:8790',
      CONTEXT_ENGINE_ALLOW_INSECURE_HTTP: 'true',
    }).contextEngine?.baseUrl).toBe('http://host.docker.internal:8790')
    expect(() => loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
      ...contextEngine,
      CONTEXT_ENGINE_BASE_URL: 'http://contextengine.internal:8790',
      CONTEXT_ENGINE_ALLOW_INSECURE_HTTP: 'true',
    })).toThrow('only when NODE_ENV is development')
  })

  it('requires persistent storage and an explicit CORS origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'oidc' })).toThrow('DATABASE_URL')
    expect(() => loadConfig({
      NODE_ENV: 'production', AUTH_MODE: 'oidc', DATABASE_URL: 'postgres://relay',
    })).toThrow('CORS_ORIGIN')
    expect(() => loadConfig({
      NODE_ENV: 'production', AUTH_MODE: 'oidc', DATABASE_URL: 'postgres://relay',
      CORS_ORIGIN: 'https://relay.example',
    })).toThrow('OIDC_ISSUER')
  })

  it('never starts OIDC authentication with an implicit environment or in-memory storage', () => {
    const oidc = {
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
    }
    expect(() => loadConfig({ ...oidc, DATABASE_URL: 'postgres://relay' })).toThrow('NODE_ENV must be explicitly set')
    expect(() => loadConfig({ ...oidc, NODE_ENV: 'development' })).toThrow('DATABASE_URL')
  })

  it('requires HTTPS OIDC endpoints in production', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      CORS_ORIGIN: 'https://relay.example',
      OIDC_AUDIENCE: 'relay-api',
    }
    expect(() => loadConfig({
      ...production,
      OIDC_ISSUER: 'http://identity.test/',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
    })).toThrow('OIDC_ISSUER must be a valid HTTPS URL in production')
    expect(() => loadConfig({
      ...production,
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_JWKS_URI: 'http://identity.test/.well-known/jwks.json',
    })).toThrow('OIDC_JWKS_URI must be a valid HTTPS URL in production')
  })

  it('requires one exact HTTPS production CORS origin', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
      SECURITY_AUDIT_HMAC_KEY: securityAuditHmacKey,
      SECURITY_AUDIT_HMAC_KEY_ID: 'production-v1',
    }
    for (const corsOrigin of ['*', 'http://relay.example', 'https://relay.example/path', 'https://relay.example/']) {
      expect(() => loadConfig({ ...production, CORS_ORIGIN: corsOrigin })).toThrow('exact HTTPS origin')
    }
    expect(loadConfig({ ...production, CORS_ORIGIN: 'https://relay.example' })).toMatchObject({
      corsOrigin: 'https://relay.example',
      securityHeaders: { hsts: true },
    })
  })

  it('accepts only explicit trusted proxy IPs and CIDR ranges', () => {
    expect(loadConfig({
      AUTH_MODE: 'development', TRUST_PROXY: '127.0.0.1, 172.18.0.0/16, ::1/128',
    }).trustProxy).toEqual(['127.0.0.1', '172.18.0.0/16', '::1/128'])
    for (const value of ['*', 'true', 'proxy.internal', '999.1.1.1', '127.0.0.1/33', '::1/129']) {
      expect(() => loadConfig({ AUTH_MODE: 'development', TRUST_PROXY: value })).toThrow('TRUST_PROXY')
    }
  })

  it('uses an explicit migration job outside development', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      CORS_ORIGIN: 'https://relay.example',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
      SECURITY_AUDIT_HMAC_KEY: securityAuditHmacKey,
      SECURITY_AUDIT_HMAC_KEY_ID: 'production-v1',
    }
    expect(loadConfig(production).migrateOnStart).toBe(false)
    expect(loadConfig(production).executionEnabled).toBe(false)
    expect(() => loadConfig({ ...production, MIGRATE_ON_START: 'true' })).toThrow('migration job')
    expect(() => loadConfig({ AUTH_MODE: 'development', MIGRATE_ON_START: 'sometimes' })).toThrow('true or false')
  })

  it('requires a strong security-audit HMAC key outside development', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      CORS_ORIGIN: 'https://relay.example',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
    }
    expect(() => loadConfig(production)).toThrow('SECURITY_AUDIT_HMAC_KEY is required')
    expect(() => loadConfig({
      ...production, SECURITY_AUDIT_HMAC_KEY: 'too-short',
    })).toThrow('exactly 64 hexadecimal')
    expect(() => loadConfig({
      ...production, SECURITY_AUDIT_HMAC_KEY: securityAuditHmacKey,
    })).toThrow('SECURITY_AUDIT_HMAC_KEY_ID is required')
    expect(loadConfig({
      ...production,
      SECURITY_AUDIT_HMAC_KEY: securityAuditHmacKey.toUpperCase(),
      SECURITY_AUDIT_HMAC_KEY_ID: 'production-v1',
    })).toMatchObject({
      securityAuditHmacKey,
      securityAuditHmacKeyId: 'production-v1',
    })
    expect(() => loadConfig({
      ...production,
      SECURITY_AUDIT_HMAC_KEY: securityAuditHmacKey,
      SECURITY_AUDIT_HMAC_KEY_ID: 'invalid key id',
    })).toThrow('stable key identifier')
  })

  it('loads migration-only database settings without runtime credentials', () => {
    expect(loadMigrationConfig({ DATABASE_URL: 'postgres://relay' })).toEqual({
      databaseUrl: 'postgres://relay',
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 20_000,
      databaseStatementTimeoutMs: 15_000,
    })
    expect(() => loadMigrationConfig({})).toThrow('DATABASE_URL is required to run migrations')
  })

  it('requires an explicit, bounded production execution policy', () => {
    expect(loadConfig({
      AUTH_MODE: 'development',
      EXECUTION_ENABLED: 'false',
      EXECUTION_MAX_ATTEMPTS: '8',
    })).toMatchObject({ executionEnabled: false, executionMaxAttempts: 8 })
    expect(() => loadConfig({
      AUTH_MODE: 'development', EXECUTION_ENABLED: 'sometimes',
    })).toThrow('EXECUTION_ENABLED')
    expect(() => loadConfig({
      AUTH_MODE: 'development', EXECUTION_MAX_ATTEMPTS: '0',
    })).toThrow('EXECUTION_MAX_ATTEMPTS')
    expect(() => loadConfig({
      AUTH_MODE: 'development', EXECUTION_MAX_ATTEMPTS: '21',
    })).toThrow('EXECUTION_MAX_ATTEMPTS')
    expect(loadConfig({
      AUTH_MODE: 'development', WORKER_READINESS_MAX_AGE_MS: '45000',
    }).workerReadinessMaxAgeMs).toBe(45_000)
    expect(() => loadConfig({
      AUTH_MODE: 'development', WORKER_READINESS_MAX_AGE_MS: '99',
    })).toThrow('WORKER_READINESS_MAX_AGE_MS')
  })

  it('loads strictly bounded Session event stream connection limits', () => {
    expect(loadConfig({
      AUTH_MODE: 'development',
      SESSION_EVENT_STREAM_MAX_CONNECTIONS: '2000',
      SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_ACTOR: '20',
      SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_SESSION: '80',
      SESSION_EVENT_STREAM_RETRY_AFTER_SECONDS: '15',
    }).sessionEventStream).toEqual({
      maxConnections: 2_000,
      maxConnectionsPerActor: 20,
      maxConnectionsPerSession: 80,
      retryAfterSeconds: 15,
    })

    const invalidValues = [
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS', '0'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS', '100001'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_ACTOR', '0'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_ACTOR', '1001'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_SESSION', '0'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS_PER_SESSION', '1001'],
      ['SESSION_EVENT_STREAM_RETRY_AFTER_SECONDS', '0'],
      ['SESSION_EVENT_STREAM_RETRY_AFTER_SECONDS', '3601'],
      ['SESSION_EVENT_STREAM_MAX_CONNECTIONS', '1.5'],
    ] as const
    for (const [name, value] of invalidValues) {
      expect(() => loadConfig({ AUTH_MODE: 'development', [name]: value })).toThrow(name)
    }
  })

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: '0' })).toThrow('PORT')
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: 'not-a-port' })).toThrow('PORT')
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: '8787.5' })).toThrow('PORT')
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: '8787anything' })).toThrow('PORT')
  })

  it('bounds API transport and rate-limit settings', () => {
    expect(loadConfig({
      AUTH_MODE: 'development',
      API_BODY_LIMIT_BYTES: '2048',
      API_CONNECTION_TIMEOUT_MS: '1200',
      API_REQUEST_TIMEOUT_MS: '2500',
      API_KEEP_ALIVE_TIMEOUT_MS: '1800',
      API_RATE_LIMIT_MAX: '50',
      API_RATE_LIMIT_WINDOW_MS: '10000',
      API_RATE_LIMIT_CACHE: '200',
    })).toMatchObject({
      bodyLimit: 2_048,
      connectionTimeoutMs: 1_200,
      requestTimeoutMs: 2_500,
      keepAliveTimeoutMs: 1_800,
      rateLimit: { max: 50, timeWindowMs: 10_000, cache: 200 },
    })
    const invalidValues = [
      ['API_BODY_LIMIT_BYTES', '100'],
      ['API_CONNECTION_TIMEOUT_MS', '0'],
      ['API_REQUEST_TIMEOUT_MS', 'forever'],
      ['API_KEEP_ALIVE_TIMEOUT_MS', '300001'],
      ['API_RATE_LIMIT_MAX', '0'],
      ['API_RATE_LIMIT_WINDOW_MS', '999'],
      ['API_RATE_LIMIT_CACHE', '99'],
    ] as const
    for (const [name, value] of invalidValues) {
      expect(() => loadConfig({ AUTH_MODE: 'development', [name]: value })).toThrow(name)
    }
  })

  it('bounds PostgreSQL connection, query, and server statement timeouts', () => {
    const config = loadConfig({
      AUTH_MODE: 'development',
      DATABASE_CONNECTION_TIMEOUT_MS: '1200',
      DATABASE_QUERY_TIMEOUT_MS: '2500',
      DATABASE_STATEMENT_TIMEOUT_MS: '2000',
    })
    expect(config.databaseConnectionTimeoutMs).toBe(1_200)
    expect(config.databaseQueryTimeoutMs).toBe(2_500)
    expect(config.databaseStatementTimeoutMs).toBe(2_000)

    expect(() => loadConfig({
      AUTH_MODE: 'development', DATABASE_CONNECTION_TIMEOUT_MS: '0',
    })).toThrow('DATABASE_CONNECTION_TIMEOUT_MS')
    expect(() => loadConfig({
      AUTH_MODE: 'development', DATABASE_QUERY_TIMEOUT_MS: 'forever',
    })).toThrow('DATABASE_QUERY_TIMEOUT_MS')
    expect(() => loadConfig({
      AUTH_MODE: 'development', DATABASE_STATEMENT_TIMEOUT_MS: '300001',
    })).toThrow('DATABASE_STATEMENT_TIMEOUT_MS')
  })

  it('requires an explicit authentication mode and never enables development identity outside development', () => {
    expect(() => loadConfig({})).toThrow('AUTH_MODE')
    expect(() => loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'development' })).toThrow('only when NODE_ENV is development')
    expect(() => loadConfig({ NODE_ENV: 'staging', AUTH_MODE: 'development' })).toThrow('only when NODE_ENV is development')
    expect(() => loadConfig({ NODE_ENV: 'developmnt', AUTH_MODE: 'oidc' })).toThrow('NODE_ENV')
  })

  it('fails closed for partial OIDC configuration and non-loopback development auth', () => {
    expect(() => loadConfig({
      NODE_ENV: 'development', AUTH_MODE: 'development', OIDC_ISSUER: 'https://identity.test/',
    })).toThrow('configured together')
    expect(() => loadConfig({
      NODE_ENV: 'development', AUTH_MODE: 'development', HOST: '0.0.0.0',
    })).toThrow('loopback')
    expect(loadConfig({
      NODE_ENV: 'development', AUTH_MODE: 'development', HOST: '0.0.0.0',
      ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH: 'true',
    }).host).toBe('0.0.0.0')
    expect(() => loadConfig({
      NODE_ENV: 'development', AUTH_MODE: 'development', HOST: '0.0.0.0',
      ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH: 'sometimes',
    })).toThrow('ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH')
  })
})
