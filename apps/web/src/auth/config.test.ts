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
    }, 'https://relay.example')).toThrow('disabled in production')
  })

  it('requires complete OIDC client configuration without deployment-scoped tenant ids', () => {
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'oidc',
      VITE_OIDC_AUTHORITY: 'https://identity.example.com', VITE_OIDC_CLIENT_ID: 'relay-web',
      VITE_OIDC_AUDIENCE: 'relay-api',
    }, 'https://relay.example')).toMatchObject({
      mode: 'oidc', authority: 'https://identity.example.com/',
      clientId: 'relay-web', redirectUri: 'https://relay.example/auth/callback',
      audience: 'relay-api', demoMode: false,
    })
  })

  it('fails closed when the mode is not explicit', () => {
    expect(() => loadWebAuthConfig({}, 'https://relay.example')).toThrow('VITE_AUTH_MODE')
  })

  it('requires secure OIDC endpoints and same-origin callbacks in production', () => {
    const base = {
      VITE_AUTH_MODE: 'oidc', PROD: true,
      VITE_OIDC_CLIENT_ID: 'relay-web',
    }
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'http://identity.example.com',
    }, 'https://relay.example')).toThrow('must use HTTPS')
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'https://identity.example.com',
      VITE_OIDC_REDIRECT_URI: 'https://attacker.example/callback',
    }, 'https://relay.example')).toThrow('application origin')
    expect(() => loadWebAuthConfig({
      ...base, VITE_OIDC_AUTHORITY: 'https://user:secret@identity.example.com',
    }, 'https://relay.example')).toThrow('cannot contain credentials')
  })

  it('allows loopback HTTP only outside production', () => {
    expect(loadWebAuthConfig({
      VITE_AUTH_MODE: 'oidc',
      VITE_OIDC_AUTHORITY: 'http://127.0.0.1:9000', VITE_OIDC_CLIENT_ID: 'relay-local',
    }, 'http://127.0.0.1:5173')).toMatchObject({
      authority: 'http://127.0.0.1:9000/', redirectUri: 'http://127.0.0.1:5173/auth/callback',
    })
  })
})
