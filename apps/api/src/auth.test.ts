import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AuthenticationError,
  createDevelopmentAuthenticator,
  createJwtAuthenticator,
} from './auth.js'

describe('JWT authentication', () => {
  let authenticate: ReturnType<typeof createJwtAuthenticator>
  let sign: (overrides?: {
    audience?: string
    issuer?: string
    subject?: string
    issuedAt?: number
    expiresIn?: string | number
  }) => Promise<string>

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    authenticate = createJwtAuthenticator({
      issuer: 'https://identity.relay.test/',
      audience: 'relay-api',
      jwksUri: 'https://identity.relay.test/.well-known/jwks.json',
      getKey: async () => publicKey,
    })
    sign = async (overrides = {}) => new SignJWT({ actor_type: 'user' })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid ?? 'test-key', typ: 'at+jwt' })
      .setIssuer(overrides.issuer ?? 'https://identity.relay.test/')
      .setAudience(overrides.audience ?? 'relay-api')
      .setSubject(overrides.subject ?? 'user-1')
      .setIssuedAt(overrides.issuedAt)
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(privateKey)
  })

  it('accepts a signed token with the configured issuer and audience', async () => {
    await expect(authenticate(`Bearer ${await sign()}`)).resolves.toEqual({ id: 'user-1', kind: 'user' })
  })

  it('maps an explicitly typed service account without trusting unknown actor types', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const serviceAuthenticate = createJwtAuthenticator({
      issuer: 'https://identity.relay.test/', audience: 'relay-api',
      jwksUri: 'https://identity.relay.test/.well-known/jwks.json', getKey: async () => publicKey,
    })
    const token = await new SignJWT({ actor_type: 'service_account' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('service-1')
      .setIssuedAt().setExpirationTime('5m').sign(privateKey)

    await expect(serviceAuthenticate(`Bearer ${token}`)).resolves.toEqual({
      id: 'service-1', kind: 'service_account', audience: 'relay-api',
    })
  })

  it('rejects missing, expired, wrong-issuer, and wrong-audience tokens', async () => {
    await expect(authenticate(undefined)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate(`Bearer ${await sign({ expiresIn: '-1s' })}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate(`Bearer ${await sign({ expiresIn: '-10s' })}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate(`Bearer ${await sign({ issuer: 'https://attacker.test/' })}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate(`Bearer ${await sign({ audience: 'another-api' })}`)).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('bounds revocation exposure by rejecting access tokens longer than five minutes', async () => {
    await expect(authenticate(`Bearer ${await sign({ expiresIn: '6m' })}`))
      .rejects.toBeInstanceOf(AuthenticationError)
    await expect(authenticate(`Bearer ${await sign({ expiresIn: '5m' })}`))
      .resolves.toEqual({ id: 'user-1', kind: 'user' })
  })

  it('rejects a short-lived token whose issued-at time is in the future', async () => {
    const futureIssuedAt = Math.floor(Date.now() / 1_000) + 365 * 24 * 60 * 60
    await expect(authenticate(`Bearer ${await sign({
      issuedAt: futureIssuedAt,
      expiresIn: futureIssuedAt + 300,
    })}`)).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('rejects tokens without required access-token claims or with an unknown actor type', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const strictAuthenticate = createJwtAuthenticator({
      issuer: 'https://identity.relay.test/', audience: 'relay-api',
      jwksUri: 'https://identity.relay.test/.well-known/jwks.json', getKey: async () => publicKey,
    })
    const noExpiry = await new SignJWT({ actor_type: 'user' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('user-1').setIssuedAt()
      .sign(privateKey)
    const unknownActor = await new SignJWT({ actor_type: 'root' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('user-1').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey)
    const noActorType = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('user-1').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey)
    const noIssuedAt = await new SignJWT({ actor_type: 'user' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('user-1').setExpirationTime('5m')
      .sign(privateKey)
    const wrongType = await new SignJWT({ actor_type: 'user' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer('https://identity.relay.test/').setAudience('relay-api').setSubject('user-1').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey)

    await expect(strictAuthenticate(`Bearer ${noExpiry}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(strictAuthenticate(`Bearer ${unknownActor}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(strictAuthenticate(`Bearer ${noActorType}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(strictAuthenticate(`Bearer ${noIssuedAt}`)).rejects.toBeInstanceOf(AuthenticationError)
    await expect(strictAuthenticate(`Bearer ${wrongType}`)).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('rejects unsafe fixed development actor ids at configuration time', () => {
    expect(() => createDevelopmentAuthenticator('')).toThrow('Development actor id')
    expect(() => createDevelopmentAuthenticator(' user-1')).toThrow('Development actor id')
    expect(() => createDevelopmentAuthenticator('system:bootstrap')).toThrow('Development actor id')
  })
})
