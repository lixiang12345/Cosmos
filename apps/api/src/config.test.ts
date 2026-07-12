import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('API configuration', () => {
  it('uses development defaults without requiring external services', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0', port: 8787, corsOrigin: false, databaseUrl: undefined,
    })
  })

  it('requires persistent storage and an explicit CORS origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL')
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://relay' })).toThrow('CORS_ORIGIN')
  })

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow('PORT')
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow('PORT')
  })
})
