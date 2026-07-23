import {
  ApiErrorSchema,
  AdvisorPlanDtoSchema,
  AdvisorPlanListResponseSchema,
  AutomationEventListResponseSchema,
  AutomationEventReceiptSchema,
  AutomationListResponseSchema,
  AutomationMutationResponseSchema,
  AutomationRunListResponseSchema,
  AutomationTestResultSchema,
  ApprovalDtoSchema,
  ApprovalListResponseSchema,
  ContextEngineStatusSchema,
  ContextPackResponseSchema,
  ContextSearchResponseSchema,
  EnvironmentMutationResponseSchema,
  EnvironmentRevisionListResponseSchema,
  CreateSessionResponseSchema,
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  ExpertDetailDtoSchema,
  ExpertListResponseSchema,
  ExpertRevisionListResponseSchema,
  FileDtoSchema,
  FileListResponseSchema,
  FileVersionListResponseSchema,
  MeResponseSchema,
  RepositoryDtoSchema,
  RepositoryListResponseSchema,
  RuntimeCapabilitiesSchema,
  RetryTurnResponseSchema,
  SessionDtoSchema,
  SessionControlResponseSchema,
  SessionEventDtoSchema,
  SessionEventPageSchema,
  SessionListResponseSchema,
  SessionMessagePageSchema,
  SessionWorkerListResponseSchema,
  SendSessionMessageResponseSchema,
  SpaceDtoSchema,
  SpaceListResponseSchema,
  SpaceMigrationPreviewSchema,
  SpaceMutationResponseSchema,
  StartSessionResponseSchema,
  type ApiError,
  type AdvisorPlanDecisionRequestInput,
  type AdvisorPlanDto,
  type AdvisorPlanListResponse,
  type AutomationDto,
  type AutomationEventListResponse,
  type AutomationEventReceipt,
  type AutomationListResponse,
  type AutomationRunListResponse,
  type AutomationTestResult,
  type ApprovalDecisionRequestInput,
  type ApprovalDto,
  type ApprovalListResponse,
  type ApprovalStatus,
  type CreateSessionRequestInput,
  type CreateAutomationRequestInput,
  type CreateEnvironmentRequestInput,
  type CreateSessionResponse,
  type CreateExpertRequestInput,
  type ContextEngineStatus,
  type ContextPackRequestInput,
  type ContextPackResponse,
  type ContextSearchRequestInput,
  type ContextSearchResponse,
  type EnvironmentDetailDto,
  type EnvironmentListResponse,
  type EnvironmentRevisionListResponse,
  type ExpertDetailDto,
  type ExpertListResponse,
  type ExpertRevisionListResponse,
  type FileDto,
  type FileListResponse,
  type FileScope,
  type FileVersionListResponse,
  type MeResponse,
  type MessageCreateInput,
  type ReceiveAutomationEventRequestInput,
  type RuntimeCapabilities,
  type RetryTurnResponse,
  type SessionDto,
  type SessionControlResponse,
  type SessionEventCursor,
  type SessionEventDto,
  type SessionEventPage,
  type SessionListResponse,
  type SessionMessagePage,
  type SessionWorkerListResponse,
  type CreateSpaceRequestInput,
  type RepositoryDto,
  type RepositoryListResponse,
  type SpaceDto,
  type SpaceListResponse,
  type SpaceMigrationPreview,
  type UpdateSpaceRequestInput,
  type SendSessionMessageResponse,
  type StartSessionResponse,
  type UpdateExpertRequestInput,
  type TestAutomationRequest,
  type UpdateAutomationRequestInput,
  type UpdateEnvironmentRequestInput,
} from '@cosmos/contracts'

const DEFAULT_COSMOS_API_BASE_URL = '/api'
export const COSMOS_API_TIMEOUT_MS = 20_000

export type CosmosApiAuthContext = {
  accessToken?: string
  requestIdentity?: string
  onUnauthorized?: (failedAccessToken: string | undefined) => void | Promise<void>
}

export type CosmosCatalogListOptions = {
  cursor?: string
  limit?: number
}

export type CosmosSessionListOptions = CosmosCatalogListOptions & {
  status?: SessionDto['status']
  archived?: boolean | 'all'
  search?: string
}

export type CosmosSessionMessageListOptions = {
  cursor?: string | SessionEventCursor
  limit?: number
}

export type CosmosSessionEventListOptions = {
  cursor?: SessionEventCursor
  limit?: number
}

export type CosmosSessionEventStreamOptions = {
  cursor?: SessionEventCursor
  lastEventId?: string
  onEvent: (event: SessionEventDto) => void | Promise<void>
}

export type CosmosSessionEventStreamResult = {
  lastEventId?: string
  reconnect: boolean
}

export type CosmosFileListOptions = CosmosCatalogListOptions & {
  scope: FileScope
  ownerUserId?: string
  sessionId?: string
  prefix?: string
  search?: string
}

export type CosmosFileContent = {
  blob: Blob
  contentType: string
  fileName?: string
  etag?: string
}

export type CosmosApprovalListOptions = CosmosCatalogListOptions & {
  status?: ApprovalStatus
  assignedToMe?: boolean
  sessionId?: string
}

const sessionListRequests = new Map<string, Promise<SessionListResponse>>()

type CosmosApiLocation = {
  applicationOrigin: string
  configuredBaseUrl?: string
  allowedOrigins?: string
}

type CosmosApiErrorInit = {
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

export class CosmosApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly correlationId?: string
  readonly retryable: boolean
  readonly fieldErrors?: ApiError['fieldErrors']
  readonly details?: ApiError['details']

  constructor(message: string, init: CosmosApiErrorInit) {
    super(message, { cause: init.cause })
    this.name = 'CosmosApiError'
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
        throw new CosmosApiError('VITE_API_ALLOWED_ORIGINS entries must be origins without paths.', {
          code: 'API_CONFIGURATION_ERROR',
        })
      }
      return url.origin
    }))
}

export function resolveCosmosApiBaseUrl(
  configured: string | undefined,
  applicationOrigin: string,
  allowedOrigins: string | undefined,
) {
  const value = configured?.trim()
  if (!value) return DEFAULT_COSMOS_API_BASE_URL
  if (value.includes('\\') || value.startsWith('//')) {
    throw new CosmosApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  const rootRelative = value.startsWith('/')
  if (!rootRelative && !URL.canParse(value)) {
    throw new CosmosApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }

  let apiUrl: URL
  try {
    apiUrl = new URL(value, `${new URL(applicationOrigin).origin}/`)
  } catch (cause) {
    throw new CosmosApiError('VITE_API_BASE_URL must be an absolute URL or a root-relative path.', {
      code: 'API_CONFIGURATION_ERROR', cause,
    })
  }
  const appOrigin = new URL(applicationOrigin).origin
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new CosmosApiError('VITE_API_BASE_URL cannot contain credentials, a query, or a fragment.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  if (apiUrl.origin !== appOrigin) {
    if (apiUrl.protocol !== 'https:' || !configuredOrigins(allowedOrigins).has(apiUrl.origin)) {
      throw new CosmosApiError('The configured API origin is not allowed to receive access tokens.', {
        code: 'API_ORIGIN_NOT_ALLOWED',
      })
    }
  }
  const path = apiUrl.pathname.replace(/\/+$/, '')
  if (path.startsWith('//')) {
    throw new CosmosApiError('VITE_API_BASE_URL resolves to an ambiguous network path.', {
      code: 'API_CONFIGURATION_ERROR',
    })
  }
  return rootRelative ? (path || '/') : `${apiUrl.origin}${path}`
}

function apiLocation(): CosmosApiLocation {
  return {
    applicationOrigin: window.location.origin,
    configuredBaseUrl: import.meta.env.VITE_API_BASE_URL,
    allowedOrigins: import.meta.env.VITE_API_ALLOWED_ORIGINS,
  }
}

export function getCosmosApiBaseUrl(location: CosmosApiLocation = apiLocation()) {
  return resolveCosmosApiBaseUrl(
    location.configuredBaseUrl,
    location.applicationOrigin,
    location.allowedOrigins,
  )
}

export function resolveCosmosApiRequestUrl(path: string, location: CosmosApiLocation = apiLocation()) {
  const baseUrl = getCosmosApiBaseUrl(location)
  const target = new URL(`${baseUrl === '/' ? '' : baseUrl}${path}`, `${location.applicationOrigin}/`)
  const allowed = configuredOrigins(location.allowedOrigins)
  if (target.origin !== new URL(location.applicationOrigin).origin
    && (target.protocol !== 'https:' || !allowed.has(target.origin))) {
    throw new CosmosApiError('The final API request origin is not allowed to receive access tokens.', {
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
  auth: CosmosApiAuthContext = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  const requestUrl = resolveCosmosApiRequestUrl(path)
  const timeoutSignal = AbortSignal.timeout(COSMOS_API_TIMEOUT_MS)
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
      throw new CosmosApiError('The Cosmos API request timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (init.signal?.aborted) {
      throw new CosmosApiError('The Cosmos API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new CosmosApiError('Unable to reach the Cosmos API.', { code: 'NETWORK_ERROR', retryable: true, cause })
  }

  const correlationId = getCorrelationId(response, body)
  if (!response.ok) {
    if (response.status === 401 && auth.onUnauthorized) {
      await Promise.resolve(auth.onUnauthorized(auth.accessToken)).catch(() => undefined)
    }
    const parsedError = ApiErrorSchema.safeParse(body)
    if (parsedError.success) {
      throw new CosmosApiError(parsedError.data.message, {
        code: parsedError.data.code,
        status: response.status,
        correlationId: parsedError.data.correlationId ?? correlationId,
        retryable: parsedError.data.retryable,
        fieldErrors: parsedError.data.fieldErrors,
        details: parsedError.data.details,
      })
    }
    throw new CosmosApiError(`Cosmos API request failed with status ${response.status}.`, {
      code: 'HTTP_ERROR', status: response.status, correlationId, retryable: response.status >= 500,
    })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new CosmosApiError('Cosmos API returned an invalid response.', {
      code: 'INVALID_RESPONSE', status: response.status, correlationId,
    })
  }
  return parsed.data
}

async function requestBlob(
  path: string,
  init: RequestInit,
  auth: CosmosApiAuthContext = {},
): Promise<CosmosFileContent> {
  const headers = new Headers(init.headers)
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  const timeoutSignal = AbortSignal.timeout(COSMOS_API_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await fetch(resolveCosmosApiRequestUrl(path), { ...init, headers, signal })
  } catch (cause) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new CosmosApiError('The Cosmos API request timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (init.signal?.aborted) {
      throw new CosmosApiError('The Cosmos API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new CosmosApiError('Unable to reach the Cosmos API.', {
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
      throw new CosmosApiError(parsedError.data.message, {
        code: parsedError.data.code,
        status: response.status,
        correlationId: parsedError.data.correlationId ?? correlationId,
        retryable: parsedError.data.retryable,
        fieldErrors: parsedError.data.fieldErrors,
        details: parsedError.data.details,
      })
    }
    throw new CosmosApiError(`Cosmos API request failed with status ${response.status}.`, {
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

function advisorPlansPath(organizationId: string, spaceId: string, sessionId: string) {
  return `${sessionPath(organizationId, spaceId, sessionId)}/advisor/plans`
}

function advisorPlanPath(organizationId: string, spaceId: string, sessionId: string, planId: string) {
  return `${advisorPlansPath(organizationId, spaceId, sessionId)}/${encodeURIComponent(planId)}`
}

function expertsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/experts`
}

function spacesPath(organizationId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces`
}

function spacePath(organizationId: string, spaceId: string) {
  return `${spacesPath(organizationId)}/${encodeURIComponent(spaceId)}`
}

function environmentsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/environments`
}

function repositoriesPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/repositories`
}

function automationsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/automations`
}

function automationEventsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/automation-events`
}

function automationRunsPath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/automation-runs`
}

function contextEnginePath(organizationId: string, spaceId: string) {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/spaces/${encodeURIComponent(spaceId)}/context-engine`
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

function fileListPath(path: string, options: CosmosFileListOptions) {
  const query = new URLSearchParams({ scope: options.scope })
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.ownerUserId) query.set('ownerUserId', options.ownerUserId)
  if (options.sessionId) query.set('sessionId', options.sessionId)
  if (options.prefix) query.set('prefix', options.prefix)
  if (options.search) query.set('search', options.search)
  return `${path}?${query.toString()}`
}

function catalogListPath(path: string, options: CosmosCatalogListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', options.cursor)
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function approvalListPath(path: string, options: CosmosApprovalListOptions | undefined) {
  const query = new URLSearchParams()
  if (options?.cursor) query.set('cursor', options.cursor)
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  if (options?.status) query.set('status', options.status)
  if (options?.assignedToMe !== undefined) query.set('assignedToMe', String(options.assignedToMe))
  if (options?.sessionId) query.set('sessionId', options.sessionId)
  const value = query.toString()
  return value ? `${path}?${value}` : path
}

function sessionListPath(path: string, options: CosmosSessionListOptions | undefined) {
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

function eventListPath(path: string, options: CosmosSessionEventListOptions | undefined) {
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

function messageListPath(path: string, options: CosmosSessionMessageListOptions | undefined) {
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
  resourceType: 'Expert' | 'Environment' | 'Automation' | 'Repository',
  resourceId?: string,
) {
  if (
    resource.organizationId !== organizationId
    || resource.spaceId !== spaceId
    || (resourceId !== undefined && resource.id !== resourceId)
  ) {
    throw new CosmosApiError(`Cosmos API returned an ${resourceType} outside the requested scope.`, {
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
    throw new CosmosApiError('Cosmos API returned a Session outside the requested scope.', {
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
    throw new CosmosApiError('Cosmos API returned a Session timeline outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function createSession(
  organizationId: string,
  spaceId: string,
  input: CreateSessionRequestInput,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
  options?: CosmosSessionListOptions,
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
  auth: CosmosApiAuthContext | undefined,
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
  auth?: CosmosApiAuthContext,
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

function assertAdvisorPlanScope(
  plan: AdvisorPlanDto,
  organizationId: string,
  spaceId: string,
  sessionId: string,
  planId?: string,
) {
  if (
    plan.organizationId !== organizationId
    || plan.spaceId !== spaceId
    || plan.sessionId !== sessionId
    || (planId !== undefined && plan.id !== planId)
  ) {
    throw new CosmosApiError('Cosmos API returned an Advisor plan outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function listAdvisorPlans(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<AdvisorPlanListResponse> {
  return request(advisorPlansPath(organizationId, spaceId, sessionId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, AdvisorPlanListResponseSchema, auth).then((response) => {
    if (
      response.organizationId !== organizationId
      || response.spaceId !== spaceId
      || response.sessionId !== sessionId
    ) {
      throw new CosmosApiError('Cosmos API returned Advisor plans outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    response.items.forEach((plan) => assertAdvisorPlanScope(plan, organizationId, spaceId, sessionId))
    return response
  })
}

export function getAdvisorPlan(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  planId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<AdvisorPlanDto> {
  return request(advisorPlanPath(organizationId, spaceId, sessionId, planId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, AdvisorPlanDtoSchema, auth).then((plan) => {
    assertAdvisorPlanScope(plan, organizationId, spaceId, sessionId, planId)
    return plan
  })
}

export function decideAdvisorPlan(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  planId: string,
  decision: AdvisorPlanDecisionRequestInput,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AdvisorPlanDto> {
  return request(`${advisorPlanPath(organizationId, spaceId, sessionId, planId)}/decision`, {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey, 'If-Match': `"${version}"`,
    },
    body: JSON.stringify(decision),
  }, AdvisorPlanDtoSchema, auth).then((plan) => {
    assertAdvisorPlanScope(plan, organizationId, spaceId, sessionId, planId)
    return plan
  })
}

export function retryAdvisorPlan(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  planId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AdvisorPlanDto> {
  return request(`${advisorPlanPath(organizationId, spaceId, sessionId, planId)}/retry`, {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey, 'If-Match': `"${version}"`,
    },
    body: JSON.stringify({}),
  }, AdvisorPlanDtoSchema, auth).then((plan) => {
    assertAdvisorPlanScope(plan, organizationId, spaceId, sessionId, planId)
    return plan
  })
}

export function listSessionWorkers(
  organizationId: string,
  spaceId: string,
  sessionId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosCatalogListOptions,
): Promise<SessionWorkerListResponse> {
  return request(catalogListPath(`${sessionPath(organizationId, spaceId, sessionId)}/workers`, options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, SessionWorkerListResponseSchema, auth).then((response) => {
    if (
      response.organizationId !== organizationId
      || response.spaceId !== spaceId
      || response.sessionId !== sessionId
    ) {
      throw new CosmosApiError('Cosmos API returned Session Workers outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return response
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
    throw new CosmosApiError('Cosmos API returned a File outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function listFiles(
  organizationId: string,
  spaceId: string,
  options: CosmosFileListOptions,
  auth?: CosmosApiAuthContext,
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
      throw new CosmosApiError('Cosmos API returned a File page outside the requested scope.', {
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosCatalogListOptions,
): Promise<FileVersionListResponse> {
  return request(catalogListPath(`${filePath(organizationId, spaceId, fileId)}/versions`, options), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, FileVersionListResponseSchema, auth).then((response) => {
    if (
      response.organizationId !== organizationId
      || response.requestedSpaceId !== spaceId
      || response.fileId !== fileId
    ) {
      throw new CosmosApiError('Cosmos API returned File versions outside the requested scope.', {
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
  auth?: CosmosApiAuthContext,
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
    throw new CosmosApiError('Cosmos API returned an Approval outside the requested scope.', {
      code: 'INVALID_RESPONSE', status: 200,
    })
  }
}

export function listApprovals(
  organizationId: string,
  spaceId: string,
  options?: CosmosApprovalListOptions,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<ApprovalListResponse> {
  return request(approvalListPath(approvalsPath(organizationId, spaceId), options), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, ApprovalListResponseSchema, auth).then((response) => {
    if (response.organizationId !== organizationId || response.spaceId !== spaceId) {
      throw new CosmosApiError('Cosmos API returned an Approval page outside the requested scope.', {
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
  auth?: CosmosApiAuthContext,
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
      throw new CosmosApiError('The retry response scope does not match the requested Turn.', {
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
  auth?: CosmosApiAuthContext,
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
      throw new CosmosApiError('Cosmos API returned a start result outside the requested Session.', {
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
  auth?: CosmosApiAuthContext,
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
      throw new CosmosApiError('Cosmos API returned a send result outside the requested Session.', {
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
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosSessionMessageListOptions,
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
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosSessionEventListOptions,
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
    return new CosmosApiError(parsedError.data.message, {
      code: parsedError.data.code,
      status: response.status,
      correlationId: parsedError.data.correlationId ?? correlationId,
      retryable: parsedError.data.retryable,
      fieldErrors: parsedError.data.fieldErrors,
      details: parsedError.data.details,
    })
  }
  return new CosmosApiError(`Cosmos API request failed with status ${response.status}.`, {
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
  auth: CosmosApiAuthContext,
  signal: AbortSignal,
  options: CosmosSessionEventStreamOptions,
): Promise<CosmosSessionEventStreamResult> {
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
    COSMOS_API_TIMEOUT_MS,
  )
  const connectionSignal = AbortSignal.any([signal, connectionTimeout.signal])
  let response: Response
  try {
    response = await fetch(resolveCosmosApiRequestUrl(path), {
      method: 'GET', headers, signal: connectionSignal,
    })
  } catch (cause) {
    if (connectionTimeout.signal.aborted && !signal.aborted) {
      throw new CosmosApiError('The Cosmos API event stream connection timed out.', {
        code: 'REQUEST_TIMEOUT', retryable: true, cause,
      })
    }
    if (signal.aborted) {
      throw new CosmosApiError('The Cosmos API request was canceled.', {
        code: 'REQUEST_CANCELED', retryable: true, cause,
      })
    }
    throw new CosmosApiError('Unable to reach the Cosmos API.', {
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
    throw new CosmosApiError('Cosmos API returned an invalid event stream.', {
      code: 'INVALID_RESPONSE', status: response.status,
    })
  }
  if (!response.body) {
    throw new CosmosApiError('Cosmos API returned an empty event stream.', {
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
      throw new CosmosApiError('Cosmos API returned invalid event stream JSON.', {
        code: 'INVALID_RESPONSE', status: response.status, cause,
      })
    }
    const parsed = SessionEventDtoSchema.safeParse(value)
    if (!parsed.success || (frame.event !== undefined && frame.event !== parsed.data.type)) {
      throw new CosmosApiError('Cosmos API returned an invalid Session event.', {
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
        throw new CosmosApiError('Cosmos API event stream exceeded the buffer limit.', {
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
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosCatalogListOptions,
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

export function listRepositories(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosCatalogListOptions,
): Promise<RepositoryListResponse> {
  return request(catalogListPath(repositoriesPath(organizationId, spaceId), options), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, RepositoryListResponseSchema, auth).then((response) => {
    for (const repository of response.items) {
      assertControlPlaneScope(repository, organizationId, spaceId, 'Repository')
    }
    return response
  })
}

export function getRepository(
  organizationId: string,
  spaceId: string,
  repositoryId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<RepositoryDto> {
  return request(`${repositoriesPath(organizationId, spaceId)}/${encodeURIComponent(repositoryId)}`, {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, RepositoryDtoSchema, auth).then((repository) => {
    assertControlPlaneScope(repository, organizationId, spaceId, 'Repository')
    return repository
  })
}

export function listSpaces(
  organizationId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<SpaceListResponse> {
  return request(spacesPath(organizationId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, SpaceListResponseSchema, auth).then((response) => {
    if (response.items.some((space) => space.organizationId !== organizationId)) {
      throw new CosmosApiError('Cosmos API returned a Space outside the requested Organization.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return response
  })
}

export function getSpace(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<SpaceDto> {
  return request(spacePath(organizationId, spaceId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, SpaceDtoSchema, auth).then((space) => {
    if (space.organizationId !== organizationId || space.id !== spaceId) {
      throw new CosmosApiError('Cosmos API returned a Space outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return space
  })
}

export function createSpace(
  organizationId: string,
  input: CreateSpaceRequestInput,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<SpaceDto> {
  return request(spacesPath(organizationId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }, SpaceMutationResponseSchema, auth).then(({ space }) => space)
}

export function updateSpace(
  organizationId: string,
  spaceId: string,
  input: UpdateSpaceRequestInput,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<SpaceDto> {
  return request(spacePath(organizationId, spaceId), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/merge-patch+json',
      'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, SpaceMutationResponseSchema, auth).then(({ space }) => space)
}

export function setDefaultSpace(
  organizationId: string,
  spaceId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<SpaceDto> {
  return request(`${spacePath(organizationId, spaceId)}/default`, {
    method: 'POST', headers: {
      Accept: 'application/json', 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey,
    },
  }, SpaceMutationResponseSchema, auth).then(({ space }) => space)
}

export function previewSpaceMigration(
  organizationId: string,
  spaceId: string,
  targetSpaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<SpaceMigrationPreview> {
  const query = new URLSearchParams({ targetSpaceId }).toString()
  return request(`${spacePath(organizationId, spaceId)}/migration-preview?${query}`, {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, SpaceMigrationPreviewSchema, auth)
}

export function getExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  auth?: CosmosApiAuthContext,
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

export function createExpert(
  organizationId: string,
  spaceId: string,
  input: CreateExpertRequestInput,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<ExpertDetailDto> {
  return request(expertsPath(organizationId, spaceId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, ExpertDetailDtoSchema, auth).then((expert) => {
    assertControlPlaneScope(expert, organizationId, spaceId, 'Expert')
    return expert
  })
}

export function updateExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  input: UpdateExpertRequestInput,
  version: number,
  auth?: CosmosApiAuthContext,
): Promise<ExpertDetailDto> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/merge-patch+json',
      'If-Match': `"${version}"`,
    },
    body: JSON.stringify(input),
  }, ExpertDetailDtoSchema, auth).then((expert) => {
    assertControlPlaneScope(expert, organizationId, spaceId, 'Expert', expertId)
    return expert
  })
}

export function publishExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<ExpertDetailDto> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}/publish`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      'If-Match': `"${version}"`,
    },
  }, ExpertDetailDtoSchema, auth).then((expert) => {
    assertControlPlaneScope(expert, organizationId, spaceId, 'Expert', expertId)
    return expert
  })
}

export function disableExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  version: number,
  auth?: CosmosApiAuthContext,
): Promise<ExpertDetailDto> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}/disable`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'If-Match': `"${version}"` },
  }, ExpertDetailDtoSchema, auth).then((expert) => {
    assertControlPlaneScope(expert, organizationId, spaceId, 'Expert', expertId)
    return expert
  })
}

const VoidResponseSchema: ResponseSchema<void> = {
  safeParse: (value) => value === undefined
    ? { success: true, data: undefined }
    : { success: false },
}

export function archiveExpert(
  organizationId: string,
  spaceId: string,
  expertId: string,
  version: number,
  auth?: CosmosApiAuthContext,
): Promise<void> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', 'If-Match': `"${version}"` },
  }, VoidResponseSchema, auth)
}

export function listExpertRevisions(
  organizationId: string,
  spaceId: string,
  expertId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<ExpertRevisionListResponse> {
  return request(`${expertsPath(organizationId, spaceId)}/${encodeURIComponent(expertId)}/revisions`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, ExpertRevisionListResponseSchema, auth).then((response) => {
    if (response.items.some((revision) => revision.expertId !== expertId)) {
      throw new CosmosApiError('Cosmos API returned an Expert revision outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return response
  })
}

export function listEnvironments(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
  options?: CosmosCatalogListOptions,
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
  auth?: CosmosApiAuthContext,
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

export function createEnvironment(
  organizationId: string,
  spaceId: string,
  input: CreateEnvironmentRequestInput,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<EnvironmentDetailDto> {
  return request(environmentsPath(organizationId, spaceId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, EnvironmentMutationResponseSchema, auth).then(({ environment }) => {
    assertControlPlaneScope(environment, organizationId, spaceId, 'Environment')
    return environment
  })
}

export function updateEnvironment(
  organizationId: string,
  spaceId: string,
  environmentId: string,
  input: UpdateEnvironmentRequestInput,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<EnvironmentDetailDto> {
  return request(`${environmentsPath(organizationId, spaceId)}/${encodeURIComponent(environmentId)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/merge-patch+json',
      'If-Match': `"${version}"`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, EnvironmentMutationResponseSchema, auth).then(({ environment }) => {
    assertControlPlaneScope(environment, organizationId, spaceId, 'Environment', environmentId)
    return environment
  })
}

function mutateEnvironmentStatus(
  action: 'retry' | 'disable',
  organizationId: string,
  spaceId: string,
  environmentId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
) {
  return request(`${environmentsPath(organizationId, spaceId)}/${encodeURIComponent(environmentId)}/${action}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'If-Match': `"${version}"`,
      'Idempotency-Key': idempotencyKey,
    },
  }, EnvironmentMutationResponseSchema, auth).then(({ environment }) => {
    assertControlPlaneScope(environment, organizationId, spaceId, 'Environment', environmentId)
    return environment
  })
}

export const retryEnvironment = mutateEnvironmentStatus.bind(undefined, 'retry')
export const disableEnvironment = mutateEnvironmentStatus.bind(undefined, 'disable')

export function archiveEnvironment(
  organizationId: string,
  spaceId: string,
  environmentId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<EnvironmentDetailDto> {
  return request(`${environmentsPath(organizationId, spaceId)}/${encodeURIComponent(environmentId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'If-Match': `"${version}"`,
      'Idempotency-Key': idempotencyKey,
    },
  }, EnvironmentMutationResponseSchema, auth).then(({ environment }) => {
    assertControlPlaneScope(environment, organizationId, spaceId, 'Environment', environmentId)
    return environment
  })
}

export function listEnvironmentRevisions(
  organizationId: string,
  spaceId: string,
  environmentId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<EnvironmentRevisionListResponse> {
  return request(`${environmentsPath(organizationId, spaceId)}/${encodeURIComponent(environmentId)}/revisions`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, EnvironmentRevisionListResponseSchema, auth).then((response) => {
    if (response.items.some((revision) => revision.environmentId !== environmentId)) {
      throw new CosmosApiError('Cosmos API returned an Environment revision outside the requested scope.', {
        code: 'INVALID_RESPONSE', status: 200,
      })
    }
    return response
  })
}

export function listAutomations(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<AutomationListResponse> {
  return request(automationsPath(organizationId, spaceId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, AutomationListResponseSchema, auth).then((response) => {
    for (const automation of response.items) {
      assertControlPlaneScope(automation, organizationId, spaceId, 'Automation')
    }
    return response
  })
}

export function createAutomation(
  organizationId: string,
  spaceId: string,
  input: CreateAutomationRequestInput,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AutomationDto> {
  return request(automationsPath(organizationId, spaceId), {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, AutomationMutationResponseSchema, auth).then(({ automation }) => {
    assertControlPlaneScope(automation, organizationId, spaceId, 'Automation')
    return automation
  })
}

export function updateAutomation(
  organizationId: string,
  spaceId: string,
  automationId: string,
  input: UpdateAutomationRequestInput,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AutomationDto> {
  return request(`${automationsPath(organizationId, spaceId)}/${encodeURIComponent(automationId)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/merge-patch+json',
      'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, AutomationMutationResponseSchema, auth).then(({ automation }) => {
    assertControlPlaneScope(automation, organizationId, spaceId, 'Automation', automationId)
    return automation
  })
}

export function archiveAutomation(
  organizationId: string,
  spaceId: string,
  automationId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AutomationDto> {
  return request(`${automationsPath(organizationId, spaceId)}/${encodeURIComponent(automationId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'If-Match': `"${version}"`,
      'Idempotency-Key': idempotencyKey,
    },
  }, AutomationMutationResponseSchema, auth).then(({ automation }) => {
    assertControlPlaneScope(automation, organizationId, spaceId, 'Automation', automationId)
    return automation
  })
}

export function testAutomation(
  organizationId: string,
  spaceId: string,
  automationId: string,
  input: TestAutomationRequest,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AutomationTestResult> {
  return request(`${automationsPath(organizationId, spaceId)}/${encodeURIComponent(automationId)}/test`, {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  }, AutomationTestResultSchema, auth).then((response) => {
    assertControlPlaneScope(response.automation, organizationId, spaceId, 'Automation', automationId)
    return response
  })
}

function mutateAutomationStatus(
  action: 'enable' | 'pause',
  organizationId: string,
  spaceId: string,
  automationId: string,
  version: number,
  idempotencyKey: string,
  auth?: CosmosApiAuthContext,
): Promise<AutomationDto> {
  return request(`${automationsPath(organizationId, spaceId)}/${encodeURIComponent(automationId)}/${action}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json', 'If-Match': `"${version}"`,
      'Idempotency-Key': idempotencyKey,
    },
  }, AutomationMutationResponseSchema, auth).then(({ automation }) => {
    assertControlPlaneScope(automation, organizationId, spaceId, 'Automation', automationId)
    return automation
  })
}

export const enableAutomation = mutateAutomationStatus.bind(undefined, 'enable')
export const pauseAutomation = mutateAutomationStatus.bind(undefined, 'pause')

export function listAutomationEvents(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<AutomationEventListResponse> {
  return request(automationEventsPath(organizationId, spaceId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, AutomationEventListResponseSchema, auth)
}

export function receiveAutomationEvent(
  organizationId: string,
  spaceId: string,
  input: ReceiveAutomationEventRequestInput,
  auth?: CosmosApiAuthContext,
): Promise<AutomationEventReceipt> {
  return request(automationEventsPath(organizationId, spaceId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, AutomationEventReceiptSchema, auth)
}

export function listAutomationRuns(
  organizationId: string,
  spaceId: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<AutomationRunListResponse> {
  return request(automationRunsPath(organizationId, spaceId), {
    method: 'GET', headers: { Accept: 'application/json' }, signal,
  }, AutomationRunListResponseSchema, auth)
}

export function getMe(auth?: CosmosApiAuthContext): Promise<MeResponse> {
  return request('/v1/me', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, MeResponseSchema, auth)
}

export function getRuntimeCapabilities(
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<RuntimeCapabilities> {
  return request('/v1/capabilities', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, RuntimeCapabilitiesSchema, auth)
}

export function getContextEngineStatus(
  organizationId: string,
  spaceId: string,
  repository: string,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<ContextEngineStatus> {
  const query = new URLSearchParams({ repository })
  return request(`${contextEnginePath(organizationId, spaceId)}/status?${query}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  }, ContextEngineStatusSchema, auth)
}

export function searchContextEngine(
  organizationId: string,
  spaceId: string,
  input: ContextSearchRequestInput,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<ContextSearchResponse> {
  return request(`${contextEnginePath(organizationId, spaceId)}/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, ContextSearchResponseSchema, auth)
}

export function packContextEngine(
  organizationId: string,
  spaceId: string,
  input: ContextPackRequestInput,
  auth?: CosmosApiAuthContext,
  signal?: AbortSignal,
): Promise<ContextPackResponse> {
  return request(`${contextEnginePath(organizationId, spaceId)}/context`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, ContextPackResponseSchema, auth)
}
