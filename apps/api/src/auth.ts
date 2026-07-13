import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'

export type AuthenticatedActor = {
  id: string
  kind: 'user' | 'service_account'
}

export type AuthenticateRequest = (authorization: string | undefined) => Promise<AuthenticatedActor>

export class AuthenticationError extends Error {
  constructor(message = 'A valid bearer token is required.') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 300
const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 5

function readBearerToken(authorization: string | undefined) {
  if (!authorization) throw new AuthenticationError()
  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  if (!match) throw new AuthenticationError()
  return match[1]
}

function actorFromPayload(payload: JWTPayload, currentTimeSeconds: number): AuthenticatedActor {
  const subject = payload.sub
  if (!subject || subject !== subject.trim() || subject.length > 256 || subject.startsWith('system:')) {
    throw new AuthenticationError()
  }
  const actorType = payload.actor_type
  if (actorType !== 'user' && actorType !== 'service_account') throw new AuthenticationError()
  const issuedAt = payload.iat
  const expiresAt = payload.exp
  if (
    typeof issuedAt !== 'number'
    || typeof expiresAt !== 'number'
    || !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(expiresAt)
    || issuedAt > currentTimeSeconds + ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_ACCESS_TOKEN_LIFETIME_SECONDS
  ) {
    throw new AuthenticationError()
  }
  return {
    id: subject,
    kind: actorType === 'service_account' ? 'service_account' : 'user',
  }
}

export type JwtAuthenticatorOptions = {
  issuer: string
  audience: string
  jwksUri: string
  getKey?: JWTVerifyGetKey
}

export function createJwtAuthenticator(options: JwtAuthenticatorOptions): AuthenticateRequest {
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(options.jwksUri))
  return async (authorization) => {
    try {
      const currentDate = new Date()
      const { payload, protectedHeader } = await jwtVerify(readBearerToken(authorization), getKey, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'iat', 'exp', 'actor_type'],
        clockTolerance: 0,
        currentDate,
      })
      if (protectedHeader.typ?.toLowerCase() !== 'at+jwt') throw new AuthenticationError()
      return actorFromPayload(payload, Math.floor(currentDate.getTime() / 1_000))
    } catch (error) {
      if (error instanceof AuthenticationError) throw error
      throw new AuthenticationError()
    }
  }
}

export function createDevelopmentAuthenticator(actorId: string): AuthenticateRequest {
  const normalizedActorId = actorId.trim()
  if (!normalizedActorId || normalizedActorId !== actorId || normalizedActorId.length > 256 || normalizedActorId.startsWith('system:')) {
    throw new Error('Development actor id must be a valid non-system actor id.')
  }
  const actor = { id: normalizedActorId, kind: 'user' as const }
  return async () => actor
}

export const rejectAuthentication: AuthenticateRequest = async () => {
  throw new AuthenticationError()
}
