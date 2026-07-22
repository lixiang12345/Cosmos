import { describe, expect, it } from 'vitest'
import { loadWebAuthConfig } from './config'

describe('web authentication configuration', () => {
  it('supports an explicit test/development identity only outside production', () => {
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'development', VITE_DEMO_MODE: 'true',
    }, 'http://127.0.0.1:5173')).toEqual({
      mode: 'development', actorId: 'user-local-admin', demoMode: true,
    })
    expect(() => loadWebAuthConfig({
      VITE_AUTH_MODE: 'development', PROD: true,
    }, 'https://cosmos.example')).toThrow('disabled in production')
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'development', PROD: true,
      VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH: 'true',
    }, 'http://127.0.0.1:5173')).toEqual({
      mode: 'development', actorId: 'user-local-admin', demoMode: false,
    })
    expect(() => loadWebAuthConfig({
      VITE_AUTH_MODE: 'development', PROD: true,
      VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH: 'true',
    }, 'https://cosmos.example')).toThrow('loopback runtime')
    expect(() => loadWebAuthConfig({
      VITE_AUTH_MODE: 'development', PROD: true, VITE_DEMO_MODE: 'true',
      VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH: 'true',
    }, 'http://localhost:5173')).toThrow('Demo mode')
  })

  it('requires complete OIDC client configuration without deployment-scoped tenant ids', () => {
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'oidc',
      VITE_OIDC_AUTHORITY: 'https://identity.example.com', VITE_OIDC_CLIENT_ID: 'cosmos-web',
      VITE_OIDC_AUDIENCE: 'cosmos-api',
    }, 'https://cosmos.example')).toMatchObject({
      mode: 'oidc', authority: 'https://identity.example.com/',
      clientId: 'cosmos-web', redirectUri: 'https://cosmos.example/auth/callback',
      audience: 'cosmos-api', demoMode: false,
    })
  })

  it('fails closed when the mode is not explicit', () => {
    expect(() => loadWebAuthConfig({}, 'https://cosmos.example')).toThrow('VITE_AUTH_MODE')
  })

  it('requires secure OIDC endpoints and same-origin callbacks in production', () => {
    const base = {
      VITE_AUTH_MODE: 'oidc', PROD: true,
      VITE_OIDC_CLIENT_ID: 'cosmos-web',
    }
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'http://identity.example.com',
    }, 'https://cosmos.example')).toThrow('must use HTTPS')
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'https://identity.example.com',
      VITE_OIDC_REDIRECT_URI: 'https://attacker.example/callback',
    }, 'https://cosmos.example')).toThrow('application origin')
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'https://user:secret@identity.example.com',
    }, 'https://cosmos.example')).toThrow('cannot contain credentials')
  })

  it('allows loopback HTTP only outside production', () => {
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'oidc',
      VITE_OIDC_AUTHORITY: 'http://127.0.0.1:9000', VITE_OIDC_CLIENT_ID: 'cosmos-local',
    }, 'http://127.0.0.1:5173')).toMatchObject({
      authority: 'http://127.0.0.1:9000/', redirectUri: 'http://127.0.0.1:5173/auth/callback',
    })
  })
})
