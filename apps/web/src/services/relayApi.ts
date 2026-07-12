import {
  ApiErrorSchema,
  CreateSessionResponseSchema,
  MeResponseSchema,
  SessionDtoSchema,
  SessionListResponseSchema,
  type ApiError,
  type CreateSessionRequestInput,
  type CreateSessionResponse,
  type MeResponse,
  type SessionDto,
  type SessionListResponse,
} from '@relay/contracts'

const DEFAULT_RELAY_API_BASE_URL = '/api'

export type RelayApiAuthContext = {
  accessToken?: string
  onUnauthorized?: (failedAccessToken: string | undefined) => void | Promise<void>
}

const sessionListRequests = new Map<string, Promise<SessionListResponse>>()

type RelayApiLocation = {
  applicationOrigin: string
  configuredBaseUrl?: string
  allowedOrigins?: string
}

type RelayApiErrorInit = {
  code: string
  status?: number
  correlationId?: string
  retryable?: boolean
  fieldErrors?: ApiError['fieldErrors']
  details?: ApiError['details']
  cause?: unknown
}

type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

export class RelayApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly correlationId?: string
  readonly retryable: boolean
  readonly fieldErrors?: ApiError['fieldErrors']
  readonly details?: ApiError['details']

  constructor(message: string, init: RelayApiErrorInit) {
    super(message, { cause: init.cause })
    this.name = 'RelayApiError'
    this.code = init.code
    this.status = init.status
    this.correlationId = init.correlationId
    this.retryable = init.retryable ?? false
    this.fieldErrors = init.fieldErrors
    this.details = init.details
  }
}

function configuredOrigins(value: string | undefined) {
  return new Set((value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item)
      if (url.href !== `${url.origin}/`) {
        throw new RelayApiError('VITE_API_ALLOWED_ORIGINS entries must be origins without paths.', {
          code: 'API_CONFIGURATION_ERROR',
        })
      }
      return url.origin
    }))
}

export function resolveRelayApiBaseUrl(
  configured: string | undefined,
  applicationOrigin: string,
  allowedOrigins: string | undefined,
) {
  const value = configured?.trim()
  if (!value) return DEFAULT_RELAY_API_BASE_URL
  if (value.includes('\\') || value.startsWith('//')) {
    throw new RelayApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  const rootRelative = value.startsWith('/')
  if (!rootRelative && !URL.canParse(value)) {
    throw new RelayApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }

  let apiUrl: URL
  try {
    apiUrl = new URL(value, `${new URL(applicationOrigin).origin}/`)
  } catch (cause) {
    throw new RelayApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR', cause,
    })
  }
  const appOrigin = new URL(applicationOrigin).origin
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new RelayApiError('VITE_API_BASE_URL cannot contain credentials, a query, or a fragment.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  if (apiUrl.origin !== appOrigin) {
    if (apiUrl.protocol !== 'https:' || !configuredOrigins(allowedOrigins).has(apiUrl.origin)) {
      throw new RelayApiError('The configured API origin is not allowed to receive access tokens.', {
        code: 'API_ORIGIN_NOT_ALLOWED',
      })
    }
  }
  const path = apiUrl.pathname.replace(/\/+$/, '')
  if (path.startsWith('//')) {
    throw new RelayApiError('VITE_API_BASE_URL resolves to an ambiguous network path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  return rootRelative ? (path || '/') : `${apiUrl.origin}${path}`
}

function apiLocation(): RelayApiLocation {
  return {
    applicationOrigin: window.location.origin,
    configuredBaseUrl: import.meta.env.VITE_API_BASE_URL,
    allowedOrigins: import.meta.env.VITE_API_ALLOWED_ORIGINS,
  }
}

export function getRelayApiBaseUrl(location: RelayApiLocation = apiLocation()) {
  return resolveRelayApiBaseUrl(
    location.configuredBaseUrl,
    location.applicationOrigin,
    location.allowedOrigins,
  )
}

export function resolveRelayApiRequestUrl(path: string, location: RelayApiLocation = apiLocation()) {
  const baseUrl = getRelayApiBaseUrl(location)
  const target = new URL(`${baseUrl === '/' ? '' : baseUrl}${path}`, `${location.applicationOrigin}/`)
  const allowed = configuredOrigins(location.allowedOrigins)
  if (target.origin !== new URL(location.applicationOrigin).origin
    && (target.protocol !== 'https:' || !allowed.has(target.origin))) {
    throw new RelayApiError('The final API request origin is not allowed to receive access tokens.', {
      code: 'API_ORIGIN_NOT_ALLOWED',
    })
  }
  return baseUrl.startsWith('/') ? `${baseUrl === '/' ? '' : baseUrl}${path}` : target.toString()
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function getCorrelationId(response: Response, body: unknown) {
  if (typeof body === 'object' && body !== null && 'correlationId' in body) {
    const value = body.correlationId
    if (typeof value === 'string' && value.trim()) return value
  }
  return response.headers.get('x-correlation-id') ?? response.headers.get('x-request-id') ?? undefined
}

async function request<T>(
  path: string,
  init: RequestInit,
  schema: ResponseSchema<T>,
  auth: RelayApiAuthContext = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  const requestUrl = resolveRelayApiRequestUrl(path)
  let response: Response
  try {
    response = await fetch(requestUrl, { ...init, headers })
  } catch (cause) {
    throw new RelayApiError('Unable to reach the Relay API.', { code: 'NETWORK_ERROR', retryable: true, cause })
  }

  const body = await readJson(response)
  const correlationId = getCorrelationId(response, body)
  if (!response.ok) {
    if (response.status === 401 && auth.onUnauthorized) {
      await Promise.resolve(auth.onUnauthorized(auth.accessToken)).catch(() => undefined)
    }
    const parsedError = ApiErrorSchema.safeParse(body)
    if (parsedError.success) {
      throw new RelayApiError(parsedError.data.message, {
        code: parsedError.data.code,
        status: response.status,
        correlationId: parsedError.data.correlationId ?? correlationId,
        retryable: parsedError.data.retryable,
        fieldErrors: parsedError.data.fieldErrors,
        details: parsedError.data.details,
      })
    }
    throw new RelayApiError(`Relay API request failed with status ${response.status}.`, {
      code: 'HTTP_ERROR', status: response.status, correlationId, retryable: response.status >= 500,
    })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new RelayApiError('Relay API returned an invalid response.', {
      code: 'INVALID_RESPONSE', status: response.status, correlationId,
    })
  }
  return parsed.data
}

function sessionsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/sessions`
}

function assertSessionScope(
  session: SessionDto,
  organizationId: string,
  spaceId: string,
  sessionId?: string,
) {
  if (
    session.organizationId !== organizationId
    || session.spaceId !== spaceId
    || (sessionId !== undefined && session.id !== sessionId)
  ) {
    throw new RelayApiError('Relay API returned a Session outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function createSession(
  organizationId: string,
  spaceId: string,
  input: CreateSessionRequestInput,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<CreateSessionResponse> {
  return request(sessionsPath(organizationId, spaceId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }, CreateSessionResponseSchema, auth)
}

export function listSessions(
  organizationId: string,
  spaceId: string,
  auth?: RelayApiAuthContext,
): Promise<SessionListResponse> {
  const path = sessionsPath(organizationId, spaceId)
  const requestKey = JSON.stringify([path, auth?.accessToken])
  const existing = sessionListRequests.get(requestKey)
  if (existing) return existing
  const pending = request(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, SessionListResponseSchema, auth).then((response) => {
    for (const session of response.items) assertSessionScope(session, organizationId, spaceId)
    return response
  })
  sessionListRequests.set(requestKey, pending)
  void pending.finally(() => {
    if (sessionListRequests.get(requestKey) === pending) sessionListRequests.delete(requestKey)
  }).catch(() => undefined)
  return pending
}

export function getSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: RelayApiAuthContext,
): Promise<SessionDto> {
  return request(`${sessionsPath(organizationId, spaceId)}/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, SessionDtoSchema, auth).then((session) => {
    assertSessionScope(session, organizationId, spaceId, sessionId)
    return session
  })
}

export function getMe(auth?: RelayApiAuthContext): Promise<MeResponse> {
  return request('/v1/me', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, MeResponseSchema, auth)
}
