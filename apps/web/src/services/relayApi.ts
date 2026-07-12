import {
  ApiErrorSchema,
  CreateSessionResponseSchema,
  SessionListResponseSchema,
  type ApiError,
  type CreateSessionRequestInput,
  type CreateSessionResponse,
  type SessionListResponse,
} from '@relay/contracts'

const DEFAULT_RELAY_API_BASE_URL = '/api'

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

export function getRelayApiBaseUrl() {
  const meta = import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }
  const configured = meta.env?.VITE_API_BASE_URL?.trim()
  if (!configured) return DEFAULT_RELAY_API_BASE_URL
  return configured.replace(/\/+$/, '') || DEFAULT_RELAY_API_BASE_URL
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

async function request<T>(path: string, init: RequestInit, schema: ResponseSchema<T>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${getRelayApiBaseUrl()}${path}`, init)
  } catch (cause) {
    throw new RelayApiError('Unable to reach the Relay API.', { code: 'NETWORK_ERROR', retryable: true, cause })
  }

  const body = await readJson(response)
  const correlationId = getCorrelationId(response, body)
  if (!response.ok) {
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

export function createSession(
  organizationId: string,
  spaceId: string,
  input: CreateSessionRequestInput,
  idempotencyKey: string,
): Promise<CreateSessionResponse> {
  return request(sessionsPath(organizationId, spaceId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }, CreateSessionResponseSchema)
}

export function listSessions(organizationId: string, spaceId: string): Promise<SessionListResponse> {
  return request(sessionsPath(organizationId, spaceId), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, SessionListResponseSchema)
}
