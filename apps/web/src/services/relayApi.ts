import {
  ApiErrorSchema,
  ApprovalDtoSchema,
  ApprovalListResponseSchema,
  CreateSessionResponseSchema,
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  ExpertDetailDtoSchema,
  ExpertListResponseSchema,
  FileDtoSchema,
  FileListResponseSchema,
  FileVersionListResponseSchema,
  MeResponseSchema,
  RuntimeCapabilitiesSchema,
  RetryTurnResponseSchema,
  SessionDtoSchema,
  SessionControlResponseSchema,
  SessionEventDtoSchema,
  SessionEventPageSchema,
  SessionListResponseSchema,
  SessionMessagePageSchema,
  SendSessionMessageResponseSchema,
  StartSessionResponseSchema,
  type ApiError,
  type ApprovalDecisionRequestInput,
  type ApprovalDto,
  type ApprovalListResponse,
  type ApprovalStatus,
  type CreateSessionRequestInput,
  type CreateSessionResponse,
  type EnvironmentDetailDto,
  type EnvironmentListResponse,
  type ExpertDetailDto,
  type ExpertListResponse,
  type FileDto,
  type FileListResponse,
  type FileScope,
  type FileVersionListResponse,
  type MeResponse,
  type MessageCreateInput,
  type RuntimeCapabilities,
  type RetryTurnResponse,
  type SessionDto,
  type SessionControlResponse,
  type SessionEventCursor,
  type SessionEventDto,
  type SessionEventPage,
  type SessionListResponse,
  type SessionMessagePage,
  type SendSessionMessageResponse,
  type StartSessionResponse,
} from '@relay/contracts'

const DEFAULT_RELAY_API_BASE_URL = '/api'
export const RELAY_API_TIMEOUT_MS = 20_000

export type RelayApiAuthContext = {
  accessToken?: string
  requestIdentity?: string
  onUnauthorized?: (failedAccessToken: string | undefined) => void | Promise<void>
}

export type RelayCatalogListOptions = {
  cursor?: string
  limit?: number
}

export type RelaySessionListOptions = RelayCatalogListOptions & {
  status?: SessionDto['status']
  archived?: boolean | 'all'
  search?: string
}

export type RelaySessionMessageListOptions = {
  cursor?: string | SessionEventCursor
  limit?: number
}

export type RelaySessionEventListOptions = {
  cursor?: SessionEventCursor
  limit?: number
}

export type RelaySessionEventStreamOptions = {
  cursor?: SessionEventCursor
  lastEventId?: string
  onEvent: (event: SessionEventDto) => void | Promise<void>
}

export type RelaySessionEventStreamResult = {
  lastEventId?: string
  reconnect: boolean
}

export type RelayFileListOptions = RelayCatalogListOptions & {
  scope: FileScope
  ownerUserId?: string
  sessionId?: string
  prefix?: string
  search?: string
}

export type RelayFileContent = {
  blob: Blob
  contentType: string
  fileName?: string
  etag?: string
}

export type RelayApprovalListOptions = RelayCatalogListOptions & {
  status?: ApprovalStatus
  assignedToMe?: boolean
  sessionId?: string
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

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw signal.reason
  try {
    return await response.json()
  } catch (cause) {
    if (signal.aborted) throw cause
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
  const timeoutSignal = AbortSignal.timeout(RELAY_API_TIMEOUT_MS)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  let response: Response
  let body: unknown
  try {
    response = await fetch(requestUrl, { ...init, headers, signal })
    body = await readJson(response, signal)
  } catch (cause) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new RelayApiError('The Relay API request timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (init.signal?.aborted) {
      throw new RelayApiError('The Relay API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new RelayApiError('Unable to reach the Relay API.', { code: 'NETWORK_ERROR', retryable: true, cause })
  }

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

async function requestBlob(
  path: string,
  init: RequestInit,
  auth: RelayApiAuthContext = {},
): Promise<RelayFileContent> {
  const headers = new Headers(init.headers)
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  const timeoutSignal = AbortSignal.timeout(RELAY_API_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await fetch(resolveRelayApiRequestUrl(path), { ...init, headers, signal })
  } catch (cause) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new RelayApiError('The Relay API request timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (init.signal?.aborted) {
      throw new RelayApiError('The Relay API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new RelayApiError('Unable to reach the Relay API.', {
      code: 'NETWORK_ERROR', retryable: true, cause,
    })
  }
  if (!response.ok) {
    const body = await readJson(response, signal)
    const correlationId = getCorrelationId(response, body)
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
  const disposition = response.headers.get('content-disposition') ?? ''
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const fallbackName = /filename="([^"]*)"/i.exec(disposition)?.[1]
  let fileName = fallbackName
  if (encodedName) {
    try {
      fileName = decodeURIComponent(encodedName)
    } catch {
      fileName = fallbackName
    }
  }
  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    fileName,
    etag: response.headers.get('etag') ?? undefined,
  }
}

function sessionsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/sessions`
}

function sessionPath(organizationId: string, spaceId: string, sessionId: string) {
  return `${sessionsPath(organizationId, spaceId)}/${encodeURIComponent(sessionId)}`
}

function expertsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/experts`
}

function environmentsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/environments`
}

function filesPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/files`
}

function approvalsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/approvals`
}

function approvalPath(organizationId: string, spaceId: string, approvalId: string) {
  return `${approvalsPath(organizationId, spaceId)}/${encodeURIComponent(approvalId)}`
}

function filePath(organizationId: string, spaceId: string, fileId: string) {
  return `${filesPath(organizationId, spaceId)}/${encodeURIComponent(fileId)}`
}

function fileListPath(path: string, options: RelayFileListOptions) {
  const query = new URLSearchParams({ scope: options.scope })
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.ownerUserId) query.set('ownerUserId', options.ownerUserId)
  if (options.sessionId) query.set('sessionId', options.sessionId)
  if (options.prefix) query.set('prefix', options.prefix)
  if (options.search) query.set('search', options.search)
  return `${path}?${query.toString()}`
}

function catalogListPath(path: string, options: RelayCatalogListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', options.cursor)
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function approvalListPath(path: string, options: RelayApprovalListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', options.cursor)
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  if (options?.status) query.set('status', options.status)
  if (options?.assignedToMe !== undefined) query.set('assignedToMe', String(options.assignedToMe))
  if (options?.sessionId) query.set('sessionId', options.sessionId)
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function sessionListPath(path: string, options: RelaySessionListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', options.cursor)
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  if (options?.status) query.set('status', options.status)
  if (options?.archived !== undefined) query.set('archived', String(options.archived))
  if (options?.search) query.set('search', options.search)
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function encodeBase64UrlJson(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function eventListPath(path: string, options: RelaySessionEventListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', encodeBase64UrlJson(options.cursor))
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function eventStreamPath(path: string, cursor: SessionEventCursor | undefined) {
  if (!cursor) return path
  const query = new URLSearchParams({ cursor: encodeBase64UrlJson(cursor) })
  return `${path}?${query.toString()}`
}

function messageListPath(path: string, options: RelaySessionMessageListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) {
    query.set('cursor', typeof options.cursor === 'string'
      ? options.cursor
      : encodeBase64UrlJson(options.cursor))
  }
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

type TenantScopedResource = {
  id: string
  organizationId: string
  spaceId: string
}

function assertControlPlaneScope(
  resource: TenantScopedResource,
  organizationId: string,
  spaceId: string,
  resourceType: 'Expert' | 'Environment',
  resourceId?: string,
) {
  if (
    resource.organizationId !== organizationId
    || resource.spaceId !== spaceId
    || (resourceId !== undefined && resource.id !== resourceId)
  ) {
    throw new RelayApiError(`Relay API returned an ${resourceType} outside the requested scope.`, {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
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

function assertSessionTimelineScope(
  page: { organizationId: string; spaceId: string; sessionId: string },
  organizationId: string,
  spaceId: string,
  sessionId: string,
) {
  if (
    page.organizationId !== organizationId
    || page.spaceId !== spaceId
    || page.sessionId !== sessionId
  ) {
    throw new RelayApiError('Relay API returned a Session timeline outside the requested scope.', {
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
  options?: RelaySessionListOptions,
): Promise<SessionListResponse> {
  const path = sessionListPath(sessionsPath(organizationId, spaceId), options)
  if (!auth?.requestIdentity) return loadSessions(path, organizationId, spaceId, auth)
  const requestKey = JSON.stringify([path, auth.requestIdentity])
  const existing = sessionListRequests.get(requestKey)
  if (existing) return existing
  const pending = loadSessions(path, organizationId, spaceId, auth)
  sessionListRequests.set(requestKey, pending)
  void pending.finally(() => {
    if (sessionListRequests.get(requestKey) === pending) sessionListRequests.delete(requestKey)
  }).catch(() => undefined)
  return pending
}

function loadSessions(
  path: string,
  organizationId: string,
  spaceId: string,
  auth: RelayApiAuthContext | undefined,
) {
  return request(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, SessionListResponseSchema, auth).then((response) => {
    for (const session of response.items) assertSessionScope(session, organizationId, spaceId)
    return response
  })
}

export function getSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<SessionDto> {
  return request(sessionPath(organizationId, spaceId, sessionId), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, SessionDtoSchema, auth).then((session) => {
    assertSessionScope(session, organizationId, spaceId, sessionId)
    return session
  })
}

function assertFileScope(
  file: FileDto,
  organizationId: string,
  requestedSpaceId: string,
  fileId?: string,
) {
  if (
    file.organizationId !== organizationId
    || (file.scope === 'workspace' && file.spaceId !== requestedSpaceId)
    || (fileId !== undefined && file.id !== fileId)
  ) {
    throw new RelayApiError('Relay API returned a File outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function listFiles(
  organizationId: string,
  spaceId: string,
  options: RelayFileListOptions,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<FileListResponse> {
  return request(fileListPath(filesPath(organizationId, spaceId), options), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, FileListResponseSchema, auth).then((response) => {
    if (
      response.organizationId !== organizationId
      || response.requestedSpaceId !== spaceId
      || response.scope !== options.scope
      || response.sessionId !== (options.scope === 'workspace' ? (options.sessionId ?? null) : null)
      || (options.scope !== 'user' && response.ownerUserId !== null)
      || (options.ownerUserId !== undefined && response.ownerUserId !== options.ownerUserId)
    ) {
      throw new RelayApiError('Relay API returned a File page outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    for (const item of response.items) assertFileScope(item, organizationId, spaceId)
    return response
  })
}

export function getFile(
  organizationId: string,
  spaceId: string,
  fileId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<FileDto> {
  return request(filePath(organizationId, spaceId, fileId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, FileDtoSchema, auth).then((file) => {
    assertFileScope(file, organizationId, spaceId, fileId)
    return file
  })
}

export function listFileVersions(
  organizationId: string,
  spaceId: string,
  fileId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: RelayCatalogListOptions,
): Promise<FileVersionListResponse> {
  return request(catalogListPath(`${filePath(organizationId, spaceId, fileId)}/versions`, options), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, FileVersionListResponseSchema, auth).then((response) => {
    if (
      response.organizationId !== organizationId
      || response.requestedSpaceId !== spaceId
      || response.fileId !== fileId
    ) {
      throw new RelayApiError('Relay API returned File versions outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return response
  })
}

export function getFileContent(
  organizationId: string,
  spaceId: string,
  fileId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: { version?: number; disposition?: 'inline' | 'attachment' },
) {
  const query = new URLSearchParams()
  if (options?.version !== undefined) query.set('version', String(options.version))
  if (options?.disposition) query.set('disposition', options.disposition)
  const suffix = query.size ? `?${query.toString()}` : ''
  return requestBlob(`${filePath(organizationId, spaceId, fileId)}/content${suffix}`, {
    method: 'GET', headers: { Accept: '*/*' }, signal,
  }, auth)
}

function assertApprovalScope(
  approval: ApprovalDto,
  organizationId: string,
  spaceId: string,
  approvalId?: string,
) {
  if (
    approval.organizationId !== organizationId
    || approval.spaceId !== spaceId
    || (approvalId !== undefined && approval.id !== approvalId)
  ) {
    throw new RelayApiError('Relay API returned an Approval outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function listApprovals(
  organizationId: string,
  spaceId: string,
  options?: RelayApprovalListOptions,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<ApprovalListResponse> {
  return request(approvalListPath(approvalsPath(organizationId, spaceId), options), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, ApprovalListResponseSchema, auth).then((response) => {
    if (response.organizationId !== organizationId || response.spaceId !== spaceId) {
      throw new RelayApiError('Relay API returned an Approval page outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    for (const approval of response.items) assertApprovalScope(approval, organizationId, spaceId)
    return response
  })
}

export function getApproval(
  organizationId: string,
  spaceId: string,
  approvalId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<ApprovalDto> {
  return request(approvalPath(organizationId, spaceId, approvalId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, ApprovalDtoSchema, auth).then((approval) => {
    assertApprovalScope(approval, organizationId, spaceId, approvalId)
    return approval
  })
}

export function decideApproval(
  organizationId: string,
  spaceId: string,
  approvalId: string,
  decision: ApprovalDecisionRequestInput,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<ApprovalDto> {
  return request(`${approvalPath(organizationId, spaceId, approvalId)}/decision`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
    body: JSON.stringify(decision),
  }, ApprovalDtoSchema, auth).then((approval) => {
    assertApprovalScope(approval, organizationId, spaceId, approvalId)
    return approval
  })
}

export function renameSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  title: string,
  version: number,
  auth?: RelayApiAuthContext,
): Promise<SessionDto> {
  return request(sessionPath(organizationId, spaceId, sessionId), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/merge-patch+json',
      'If-Match': `"${version}"`,
    },
    body: JSON.stringify({ title }),
  }, SessionDtoSchema, auth).then((session) => {
    assertSessionScope(session, organizationId, spaceId, sessionId)
    return session
  })
}

function setSessionArchived(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  action: 'archive' | 'restore',
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<SessionDto> {
  return request(`${sessionPath(organizationId, spaceId, sessionId)}/${action}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
  }, SessionDtoSchema, auth).then((session) => {
    assertSessionScope(session, organizationId, spaceId, sessionId)
    return session
  })
}

export function archiveSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
) {
  return setSessionArchived(
    organizationId, spaceId, sessionId, 'archive', version, idempotencyKey, auth,
  )
}

export function restoreSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
) {
  return setSessionArchived(
    organizationId, spaceId, sessionId, 'restore', version, idempotencyKey, auth,
  )
}

function controlSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  action: 'pause' | 'resume' | 'cancel',
  version: number,
  idempotencyKey: string,
  reason: string | undefined,
  auth?: RelayApiAuthContext,
): Promise<SessionControlResponse> {
  const hasBody = action === 'cancel' && reason !== undefined
  return request(`${sessionPath(organizationId, spaceId, sessionId)}/${action}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
    ...(hasBody ? { body: JSON.stringify({ reason }) } : {}),
  }, SessionControlResponseSchema, auth).then((response) => {
    assertSessionScope(response.session, organizationId, spaceId, sessionId)
    return response
  })
}

export function pauseSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
) {
  return controlSession(
    organizationId, spaceId, sessionId, 'pause', version, idempotencyKey, undefined, auth,
  )
}

export function resumeSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
) {
  return controlSession(
    organizationId, spaceId, sessionId, 'resume', version, idempotencyKey, undefined, auth,
  )
}

export function cancelSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  reason: string | undefined,
  auth?: RelayApiAuthContext,
) {
  return controlSession(
    organizationId, spaceId, sessionId, 'cancel', version, idempotencyKey, reason, auth,
  )
}

export function retrySessionTurn(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  turnId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<RetryTurnResponse> {
  return request(`${sessionPath(organizationId, spaceId, sessionId)}/turns/${encodeURIComponent(turnId)}/retry`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
  }, RetryTurnResponseSchema, auth).then((response) => {
    assertSessionScope(response.session, organizationId, spaceId, sessionId)
    if (response.attempt.sessionId !== sessionId || response.attempt.turnId !== turnId) {
      throw new RelayApiError('The retry response scope does not match the requested Turn.', {
        code: 'INVALID_RESPONSE',
      })
    }
    return response
  })
}

export function startSession(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  version: number,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<StartSessionResponse> {
  return request(`${sessionPath(organizationId, spaceId, sessionId)}/start`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
  }, StartSessionResponseSchema, auth).then((response) => {
    assertSessionScope(response.session, organizationId, spaceId, sessionId)
    if (
      response.turn.sessionId !== sessionId
      || response.command.resourceId !== response.turn.id
    ) {
      throw new RelayApiError('Relay API returned a start result outside the requested Session.', {
        code: 'INVALID_RESPONSE', status: 202,
      })
    }
    return response
  })
}

export function sendSessionMessage(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  input: MessageCreateInput,
  idempotencyKey: string,
  auth?: RelayApiAuthContext,
): Promise<SendSessionMessageResponse> {
  return request(`${sessionPath(organizationId, spaceId, sessionId)}/messages`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, SendSessionMessageResponseSchema, auth).then((response) => {
    assertSessionScope(response.session, organizationId, spaceId, sessionId)
    if (
      response.message.sessionId !== sessionId
      || response.turn.sessionId !== sessionId
      || response.turn.inputMessageId !== response.message.id
      || response.command.type !== 'session.send'
      || response.command.resourceId !== response.turn.id
    ) {
      throw new RelayApiError('Relay API returned a send result outside the requested Session.', {
        code: 'INVALID_RESPONSE', status: 202,
      })
    }
    return response
  })
}

export function listSessionMessages(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: RelaySessionMessageListOptions,
): Promise<SessionMessagePage> {
  return request(messageListPath(`${sessionPath(organizationId, spaceId, sessionId)}/messages`, options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, SessionMessagePageSchema, auth).then((page) => {
    assertSessionTimelineScope(page, organizationId, spaceId, sessionId)
    return page
  })
}

export function listSessionEvents(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: RelaySessionEventListOptions,
): Promise<SessionEventPage> {
  return request(eventListPath(`${sessionPath(organizationId, spaceId, sessionId)}/events`, options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, SessionEventPageSchema, auth).then((page) => {
    assertSessionTimelineScope(page, organizationId, spaceId, sessionId)
    return page
  })
}

function streamHttpError(response: Response, body: unknown) {
  const correlationId = getCorrelationId(response, body)
  const parsedError = ApiErrorSchema.safeParse(body)
  if (parsedError.success) {
    return new RelayApiError(parsedError.data.message, {
      code: parsedError.data.code,
      status: response.status,
      correlationId: parsedError.data.correlationId ?? correlationId,
      retryable: parsedError.data.retryable,
      fieldErrors: parsedError.data.fieldErrors,
      details: parsedError.data.details,
    })
  }
  return new RelayApiError(`Relay API request failed with status ${response.status}.`, {
    code: 'HTTP_ERROR', status: response.status, correlationId, retryable: response.status >= 500,
  })
}

type ParsedSseFrame = {
  data: string
  event?: string
  id?: string
}

function parseSseFrame(value: string): ParsedSseFrame | undefined {
  const data: string[] = []
  let event: string | undefined
  let id: string | undefined
  for (const line of value.replaceAll('\r\n', '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const raw = separator === -1 ? '' : line.slice(separator + 1)
    const fieldValue = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'data') data.push(fieldValue)
    else if (field === 'event') event = fieldValue
    else if (field === 'id' && !fieldValue.includes('\u0000')) id = fieldValue
  }
  if (!data.length && event === undefined && id === undefined) return undefined
  return { data: data.join('\n'), event, id }
}

const MAX_SSE_BUFFER_CHARACTERS = 1_000_000

export async function streamSessionEvents(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth: RelayApiAuthContext,
  signal: AbortSignal,
  options: RelaySessionEventStreamOptions,
): Promise<RelaySessionEventStreamResult> {
  const path = eventStreamPath(
    `${sessionPath(organizationId, spaceId, sessionId)}/events/stream`,
    options.lastEventId ? undefined : options.cursor,
  )
  const headers = new Headers({ Accept: 'text/event-stream' })
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  if (options.lastEventId) headers.set('Last-Event-ID', options.lastEventId)
  const connectionTimeout = new AbortController()
  const connectionTimer = window.setTimeout(
    () => connectionTimeout.abort(),
    RELAY_API_TIMEOUT_MS,
  )
  const connectionSignal = AbortSignal.any([signal, connectionTimeout.signal])
  let response: Response
  try {
    response = await fetch(resolveRelayApiRequestUrl(path), {
      method: 'GET', headers, signal: connectionSignal,
    })
  } catch (cause) {
    if (connectionTimeout.signal.aborted && !signal.aborted) {
      throw new RelayApiError('The Relay API event stream connection timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (signal.aborted) {
      throw new RelayApiError('The Relay API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new RelayApiError('Unable to reach the Relay API.', {
      code: 'NETWORK_ERROR', retryable: true, cause,
    })
  } finally {
    window.clearTimeout(connectionTimer)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => undefined)
    if (response.status === 401 && auth.onUnauthorized) {
      await Promise.resolve(auth.onUnauthorized(auth.accessToken)).catch(() => undefined)
    }
    throw streamHttpError(response, body)
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel().catch(() => undefined)
    throw new RelayApiError('Relay API returned an invalid event stream.', {
      code: 'INVALID_RESPONSE', status: response.status,
    })
  }
  if (!response.body) {
    throw new RelayApiError('Relay API returned an empty event stream.', {
      code: 'INVALID_RESPONSE', status: response.status,
    })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEventId = options.lastEventId
  let reconnect = false
  const consumeFrame = async (rawFrame: string) => {
    const frame = parseSseFrame(rawFrame)
    if (!frame) return
    if (frame.id) lastEventId = frame.id
    if (frame.event === 'reconnect') {
      reconnect = true
      return
    }
    if (!frame.data) return
    let value: unknown
    try {
      value = JSON.parse(frame.data)
    } catch (cause) {
      throw new RelayApiError('Relay API returned invalid event stream JSON.', {
        code: 'INVALID_RESPONSE', status: response.status, cause,
      })
    }
    const parsed = SessionEventDtoSchema.safeParse(value)
    if (!parsed.success || (frame.event !== undefined && frame.event !== parsed.data.type)) {
      throw new RelayApiError('Relay API returned an invalid Session event.', {
        code: 'INVALID_RESPONSE', status: response.status,
      })
    }
    assertSessionTimelineScope(parsed.data, organizationId, spaceId, sessionId)
    await options.onEvent(parsed.data)
  }

  try {
    while (!reconnect) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer = `${buffer}${decoder.decode(chunk.value, { stream: true })}`.replaceAll('\r\n', '\n')
      if (buffer.length > MAX_SSE_BUFFER_CHARACTERS) {
        throw new RelayApiError('Relay API event stream exceeded the buffer limit.', {
          code: 'INVALID_RESPONSE', status: response.status,
        })
      }
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        await consumeFrame(frame)
        if (reconnect) break
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (!reconnect) {
      buffer += decoder.decode()
      if (buffer.trim()) await consumeFrame(buffer)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return { lastEventId, reconnect }
}

export function listExperts(
  organizationId: string,
  spaceId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: RelayCatalogListOptions,
): Promise<ExpertListResponse> {
  return request(catalogListPath(expertsPath(organizationId, spaceId), options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, ExpertListResponseSchema, auth).then((response) => {
    for (const expert of response.items) {
      assertControlPlaneScope(expert, organizationId, spaceId, 'Expert')
    }
    return response
  })
}

export function getExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<ExpertDetailDto> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, ExpertDetailDtoSchema, auth).then((expert) => {
    assertControlPlaneScope(expert, organizationId, spaceId, 'Expert', expertId)
    return expert
  })
}

export function listEnvironments(
  organizationId: string,
  spaceId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
  options?: RelayCatalogListOptions,
): Promise<EnvironmentListResponse> {
  return request(catalogListPath(environmentsPath(organizationId, spaceId), options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, EnvironmentListResponseSchema, auth).then((response) => {
    for (const environment of response.items) {
      assertControlPlaneScope(environment, organizationId, spaceId, 'Environment')
    }
    return response
  })
}

export function getEnvironment(
  organizationId: string,
  spaceId: string,
  environmentId: string,
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<EnvironmentDetailDto> {
  return request(`${environmentsPath(organizationId, spaceId)}/${encodeURIComponent(environmentId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, EnvironmentDetailDtoSchema, auth).then((environment) => {
    assertControlPlaneScope(environment, organizationId, spaceId, 'Environment', environmentId)
    return environment
  })
}

export function getMe(auth?: RelayApiAuthContext): Promise<MeResponse> {
  return request('/v1/me', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, MeResponseSchema, auth)
}

export function getRuntimeCapabilities(
  auth?: RelayApiAuthContext,
  signal?: AbortSignal,
): Promise<RuntimeCapabilities> {
  return request('/v1/capabilities', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, RuntimeCapabilitiesSchema, auth)
}
