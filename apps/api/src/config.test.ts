import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('API configuration', () => {
  it('supports an explicitly selected loopback-only development identity', () => {
    expect(loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'development' })).toEqual({
      host: '127.0.0.1', port: 8787, corsOrigin: false, databaseUrl: undefined,
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

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: '0' })).toThrow('PORT')
    expect(() => loadConfig({ AUTH_MODE: 'development', PORT: 'not-a-port' })).toThrow('PORT')
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
