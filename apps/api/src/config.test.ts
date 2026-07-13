import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('API configuration', () => {
  it('supports an explicitly selected loopback-only development identity', () => {
    expect(loadConfig({ AUTH_MODE: 'development' })).toEqual({
      host: '127.0.0.1', port: 8787, corsOrigin: false, databaseUrl: undefined,
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

  it('uses an explicit migration job outside development', () => {
    const production = {
      NODE_ENV: 'production',
      AUTH_MODE: 'oidc',
      DATABASE_URL: 'postgres://relay',
      CORS_ORIGIN: 'https://relay.example',
      OIDC_ISSUER: 'https://identity.test/',
      OIDC_AUDIENCE: 'relay-api',
      OIDC_JWKS_URI: 'https://identity.test/.well-known/jwks.json',
    }
    expect(loadConfig(production).migrateOnStart).toBe(false)
    expect(loadConfig(production).executionEnabled).toBe(false)
    expect(() => loadConfig({ ...production, MIGRATE_ON_START: 'true' })).toThrow('migration job')
    expect(() => loadConfig({ AUTH_MODE: 'development', MIGRATE_ON_START: 'sometimes' })).toThrow('true or false')
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
  })
})
