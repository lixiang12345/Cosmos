import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import {
  ApiErrorSchema,
  ApprovalDecisionRequestSchema,
  ApprovalDtoSchema,
  ApprovalListResponseSchema,
  ArtifactDtoSchema,
  ArtifactListResponseSchema,
  CancelSessionRequestSchema,
  CreateArtifactRequestSchema,
  CreateShareGrantRequestSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  ExpertDetailDtoSchema,
  ExpertListResponseSchema,
  FileDtoSchema,
  FileListResponseSchema,
  FileVersionListResponseSchema,
  MeResponseSchema,
  MessageCreateSchema,
  RenameSessionRequestSchema,
  RetryTurnResponseSchema,
  RuntimeCapabilitiesSchema,
  SessionDtoSchema,
  SessionControlResponseSchema,
  SessionEventPageSchema,
  SessionListResponseSchema,
  SessionShareListResponseSchema,
  SessionWorkerListResponseSchema,
  ShareGrantDtoSchema,
  SessionMessagePageSchema,
  SendSessionMessageResponseSchema,
  StartSessionResponseSchema,
  ToolCallListResponseSchema,
  UpdateArtifactRequestSchema,
  type ApiError,
  type SessionEventDto,
  type SessionEventPage,
} from '@relay/contracts'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify'
import {
  ArtifactConflictError,
  ArtifactValidationError,
  ArtifactVersionConflictError,
  EmptyArtifactRepository,
  type ArtifactRepository,
} from './artifact-repository.js'
import {
  InvalidArtifactPaginationError,
  encodeArtifactCursor,
  parseArtifactPagination,
  type ArtifactListQuery,
} from './artifact-pagination.js'
import {
  AuthenticationError,
  rejectAuthentication,
  type AuthenticateRequest,
  type AuthenticatedActor,
} from './auth.js'
import {
  InvalidCatalogPaginationError,
  encodeCatalogCursor,
  parseCatalogPagination,
  type CatalogResource,
} from './catalog-pagination.js'
import {
  EmptyConfigurationCatalogRepository,
  type ConfigurationCatalogRepository,
} from './configuration-catalog-repository.js'
import {
  EmptyFileRepository,
  type FileRepository,
} from './file-repository.js'
import {
  InvalidFilePaginationError,
  encodeFileCursor,
  encodeFileVersionCursor,
  parseFileContentDisposition,
  parseFileContentVersion,
  parseFilePagination,
  parseFileVersionPagination,
  type FileContentQuery,
  type FileListQuery,
  type FileVersionListQuery,
} from './file-pagination.js'
import {
  AuthorizationChangedError,
  EnvironmentNotReadyError,
  ExecutionUnavailableError,
  ExpertNotPublishedError,
  IdempotencyConflictError,
  InMemorySessionRepository,
  SessionConfigurationNotFoundError,
  SessionConfigurationValidationError,
  SessionStateConflictError,
  SessionVersionConflictError,
  ShareGrantConflictError,
  ShareGrantValidationError,
  ShareGrantVersionConflictError,
  SharePrincipalNotFoundError,
  TurnStateConflictError,
  canWriteSpace,
  type SessionRepository,
} from './session-repository.js'
import {
  InvalidSessionListPaginationError,
  encodeSessionListCursor,
  parseSessionListPagination,
  type SessionListQuery,
} from './session-list-pagination.js'
import {
  InvalidSessionSharePaginationError,
  encodeSessionShareCursor,
  parseSessionSharePagination,
  type SessionShareListQuery,
} from './session-share-pagination.js'
import {
  InvalidSessionTimelinePaginationError,
  encodeSessionTimelineCursor,
  parseSessionTimelineCursor,
  parseSessionTimelinePagination,
  type SessionTimelineQuery,
} from './session-timeline-pagination.js'
import {
  SessionTimelineCursorAheadError,
  type SessionTimelineRepository,
} from './session-timeline-repository.js'
import {
  EmptySessionWorkerRepository,
  type SessionWorkerRepository,
} from './session-worker-repository.js'
import {
  InvalidSessionWorkerPaginationError,
  encodeSessionWorkerCursor,
  parseSessionWorkerPagination,
  type SessionWorkerListQuery,
} from './session-worker-pagination.js'
import {
  ApprovalAlreadyDecidedError,
  ApprovalDecisionConflictError,
  ApprovalPermissionDeniedError,
  ApprovalVersionConflictError,
  EmptyToolApprovalRepository,
  type ToolApprovalRepository,
} from './tool-approval-repository.js'
import {
  InvalidToolApprovalPaginationError,
  encodeApprovalCursor,
  encodeToolCallCursor,
  parseApprovalPagination,
  parseToolCallPagination,
  type ApprovalListQuery,
  type ToolCallListQuery,
} from './tool-approval-pagination.js'
import {
  DenyServiceAccountPolicyRepository,
  type ServiceAccountPolicyRepository,
  type ServiceAccountSessionResourceType,
  type ServiceAccountSessionScope,
} from './service-account-policy-repository.js'

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/
const SPACE_ID_PATTERN = /^.{1,128}$/u

type SpaceParams = {
  organizationId: string
  spaceId: string
}

type SessionParams = SpaceParams & {
  sessionId: string
}

type TurnParams = SessionParams & {
  turnId: string
}

type ShareParams = SessionParams & {
  shareId: string
}

type ArtifactParams = SessionParams & {
  artifactId: string
}

type ApprovalParams = SpaceParams & {
  approvalId: string
}

type FileParams = SpaceParams & {
  fileId: string
}

type SessionEventStreamOptions = {
  heartbeatMs?: number
  pollMs?: number
  maxDurationMs?: number
  batchSize?: number
  maxConnections?: number
  maxConnectionsPerActor?: number
  maxConnectionsPerSession?: number
  retryAfterSeconds?: number
}

type ExpertParams = SpaceParams & {
  expertId: string
}

type EnvironmentParams = SpaceParams & {
  environmentId: string
}

type CatalogQuery = {
  cursor?: string
  limit?: string
}

type ValidationIssue = {
  path: PropertyKey[]
  message: string
}

export type CreateAppOptions = {
  sessionRepository?: SessionRepository
  sessionTimelineRepository?: SessionTimelineRepository
  artifactRepository?: ArtifactRepository
  fileRepository?: FileRepository
  toolApprovalRepository?: ToolApprovalRepository
  sessionWorkerRepository?: SessionWorkerRepository
  serviceAccountPolicyRepository?: ServiceAccountPolicyRepository
  configurationCatalogRepository?: ConfigurationCatalogRepository
  readinessCheck?: () => Promise<void>
  logger?: FastifyServerOptions['logger']
  corsOrigin?: boolean | string
  bodyLimit?: number
  trustProxy?: false | string[]
  connectionTimeoutMs?: number
  requestTimeoutMs?: number
  keepAliveTimeoutMs?: number
  securityHeaders?: {
    hsts?: boolean
  }
  rateLimit?: false | {
    max: number
    timeWindowMs: number
    cache: number
  }
  authenticate?: AuthenticateRequest
  executionEnabled?: boolean
  executionReadinessCheck?: () => Promise<boolean>
  sessionEventStream?: SessionEventStreamOptions
}

function validationFieldErrors(issues: readonly ValidationIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : 'body'
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message]
  }

  return fieldErrors
}

function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  request: FastifyRequest,
  error: Omit<ApiError, 'correlationId'>,
) {
  const payload = ApiErrorSchema.parse({
    ...error,
    correlationId: request.id,
  })

  return reply.code(statusCode).send(payload)
}

function sendResourceNotFound(reply: FastifyReply, request: FastifyRequest) {
  return sendApiError(reply, 404, request, {
    code: 'RESOURCE_NOT_FOUND',
    message: 'The requested API resource was not found.',
    retryable: false,
  })
}

function parseSpaceId(spaceId: string) {
  const normalized = spaceId.trim()
  return SPACE_ID_PATTERN.test(normalized) ? normalized : null
}

function readIdempotencyKey(request: FastifyRequest) {
  const value = request.headers['idempotency-key']
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) return null
  return value
}

function readIfMatchVersion(request: FastifyRequest) {
  const value = request.headers['if-match']
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const match = /^"([1-9][0-9]*)"$/.exec(value)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

function requireIfMatchVersion(
  request: FastifyRequest,
  reply: FastifyReply,
  resource = 'Session',
) {
  const expectedVersion = readIfMatchVersion(request)
  if (expectedVersion === undefined) {
    sendApiError(reply, 428, request, {
      code: 'PRECONDITION_REQUIRED',
      message: `An If-Match header containing the current ${resource} ETag is required.`,
      retryable: false,
      fieldErrors: { 'header.If-Match': ['Use the quoted ETag returned by the Session detail API.'] },
    })
    return null
  }
  if (expectedVersion === null) {
    sendApiError(reply, 400, request, {
      code: 'VALIDATION_FAILED',
      message: 'The If-Match header is invalid.',
      retryable: false,
      fieldErrors: { 'header.If-Match': ['Use a quoted positive integer such as "1".'] },
    })
    return null
  }
  return expectedVersion
}

function errorStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined
  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

function sessionEtag(session: { version: number }) {
  return `"${session.version}"`
}

function resourceEtag(resource: { version: number }) {
  return `"${resource.version}"`
}

const INLINE_FILE_MIME_TYPES = new Set([
  'application/json',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/markdown',
  'text/plain',
])

function safeFileMimeType(value: string) {
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/.test(value)
    ? value
    : 'application/octet-stream'
}

function contentDisposition(path: string, requested: 'inline' | 'attachment', mimeType: string) {
  const name = path.split('/').at(-1) ?? 'download'
  const fallback = name.replaceAll(/[^\x20-\x21\x23-\x5b\x5d-\x7e]/g, '_').slice(0, 180) || 'download'
  const baseMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const disposition = requested === 'inline' && INLINE_FILE_MIME_TYPES.has(baseMimeType)
    ? 'inline'
    : 'attachment'
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number) {
  const candidate = value ?? fallback
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new Error(`Session event stream option must be an integer between 1 and ${maximum}.`)
  }
  return candidate
}

function createSessionEventStreamLimiter(options: {
  maxConnections: number
  maxConnectionsPerActor: number
  maxConnectionsPerSession: number
}) {
  let connections = 0
  const connectionsByActor = new Map<string, number>()
  const connectionsBySession = new Map<string, number>()

  function decrement(counter: Map<string, number>, key: string) {
    const next = (counter.get(key) ?? 1) - 1
    if (next === 0) counter.delete(key)
    else counter.set(key, next)
  }

  return {
    acquire(actorId: string, sessionKey: string) {
      const actorConnections = connectionsByActor.get(actorId) ?? 0
      const sessionConnections = connectionsBySession.get(sessionKey) ?? 0
      if (
        connections >= options.maxConnections
        || actorConnections >= options.maxConnectionsPerActor
        || sessionConnections >= options.maxConnectionsPerSession
      ) {
        return null
      }

      connections += 1
      connectionsByActor.set(actorId, actorConnections + 1)
      connectionsBySession.set(sessionKey, sessionConnections + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        connections -= 1
        decrement(connectionsByActor, actorId)
        decrement(connectionsBySession, sessionKey)
      }
    },
  }
}

function createRequestRateLimiter(options: { max: number; timeWindowMs: number; cache: number }) {
  if (
    !Number.isSafeInteger(options.max)
    || options.max < 1
    || options.max > 100_000
    || !Number.isSafeInteger(options.timeWindowMs)
    || options.timeWindowMs < 1_000
    || options.timeWindowMs > 3_600_000
    || !Number.isSafeInteger(options.cache)
    || options.cache < 100
    || options.cache > 1_000_000
  ) {
    throw new Error('API rate-limit options are outside the supported production bounds.')
  }
  type Bucket = { count: number; resetAt: number }
  const buckets = new Map<string, Bucket>()
  let overflow: Bucket | null = null

  function activeBucket(bucket: Bucket | undefined | null, now: number) {
    return bucket && bucket.resetAt > now ? bucket : null
  }

  return {
    consume(key: string, now = Date.now()) {
      let bucket = activeBucket(buckets.get(key), now)
      if (!bucket) {
        buckets.delete(key)
        if (buckets.size >= options.cache) {
          for (const [candidateKey, candidate] of buckets) {
            if (candidate.resetAt <= now) buckets.delete(candidateKey)
            if (buckets.size < options.cache) break
          }
        }
        if (buckets.size < options.cache) {
          bucket = { count: 0, resetAt: now + options.timeWindowMs }
          buckets.set(key, bucket)
        } else {
          overflow = activeBucket(overflow, now)
            ?? { count: 0, resetAt: now + options.timeWindowMs }
          bucket = overflow
        }
      }
      bucket.count += 1
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
      return {
        allowed: bucket.count <= options.max,
        remaining: Math.max(0, options.max - bucket.count),
        retryAfterSeconds,
      }
    },
  }
}

function writeSse(response: FastifyReply['raw'], value: string) {
  if (response.destroyed || response.writableEnded) return Promise.resolve(false)
  if (response.write(value)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const onDrain = () => done(true)
    const onClose = () => done(false)
    function done(writable: boolean) {
      response.off('drain', onDrain)
      response.off('close', onClose)
      resolve(writable)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
  })
}

function eventFrame(event: SessionEventDto) {
  const cursor = encodeSessionTimelineCursor({
    organizationId: event.organizationId,
    spaceId: event.spaceId,
    sessionId: event.sessionId,
    sequence: event.sequence,
  })
  return `id: ${cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function abortableDelay(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 1_048_576,
    trustProxy: options.trustProxy ?? false,
    connectionTimeout: options.connectionTimeoutMs ?? 10_000,
    requestTimeout: options.requestTimeoutMs ?? 15_000,
    keepAliveTimeout: options.keepAliveTimeoutMs ?? 5_000,
  })
  app.addContentTypeParser(
    'application/merge-patch+json',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(typeof body === 'string' ? body : body.toString('utf8')))
      } catch (error) {
        done(error as Error)
      }
    },
  )
  const sessionRepository = options.sessionRepository ?? new InMemorySessionRepository()
  const sessionTimelineRepository = options.sessionTimelineRepository
  const artifactRepository = options.artifactRepository ?? new EmptyArtifactRepository()
  const fileRepository = options.fileRepository ?? new EmptyFileRepository()
  const toolApprovalRepository = options.toolApprovalRepository ?? new EmptyToolApprovalRepository()
  const sessionWorkerRepository = options.sessionWorkerRepository ?? new EmptySessionWorkerRepository()
  const serviceAccountPolicyRepository = options.serviceAccountPolicyRepository
    ?? new DenyServiceAccountPolicyRepository()
  const configurationCatalogRepository = options.configurationCatalogRepository
    ?? new EmptyConfigurationCatalogRepository()
  const authenticate = options.authenticate ?? rejectAuthentication
  const executionEnabled = options.executionEnabled ?? true
  async function executionAvailable(request: FastifyRequest) {
    if (!executionEnabled || !options.executionReadinessCheck) return false
    try {
      return await options.executionReadinessCheck()
    } catch (error) {
      request.log.error({ err: error }, 'Execution readiness check failed')
      return false
    }
  }
  const eventStream = {
    heartbeatMs: positiveInteger(options.sessionEventStream?.heartbeatMs, 15_000, 60_000),
    pollMs: positiveInteger(options.sessionEventStream?.pollMs, 1_000, 60_000),
    maxDurationMs: positiveInteger(options.sessionEventStream?.maxDurationMs, 55_000, 300_000),
    batchSize: positiveInteger(options.sessionEventStream?.batchSize, 100, 500),
    maxConnections: positiveInteger(options.sessionEventStream?.maxConnections, 1_000, 100_000),
    maxConnectionsPerActor: positiveInteger(options.sessionEventStream?.maxConnectionsPerActor, 10, 1_000),
    maxConnectionsPerSession: positiveInteger(options.sessionEventStream?.maxConnectionsPerSession, 50, 1_000),
    retryAfterSeconds: positiveInteger(options.sessionEventStream?.retryAfterSeconds, 5, 3_600),
  }
  const eventStreamLimiter = createSessionEventStreamLimiter(eventStream)
  const requestRateLimitOptions = options.rateLimit === false
    ? null
    : (options.rateLimit ?? { max: 600, timeWindowMs: 60_000, cache: 10_000 })
  const requestRateLimiter = requestRateLimitOptions
    ? createRequestRateLimiter(requestRateLimitOptions)
    : null
  const actorsByRequest = new WeakMap<FastifyRequest, AuthenticatedActor>()

  void app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: options.securityHeaders?.hsts
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  })

  void app.register(cors, {
    origin: options.corsOrigin ?? false,
    exposedHeaders: [
      'ETag',
      'X-Request-ID',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-ID', request.id)
    const path = request.raw.url?.split('?', 1)[0]
    const isPublicHealthRequest = (request.method === 'GET' || request.method === 'HEAD') && path === '/api/health'
    if (request.method === 'OPTIONS' || isPublicHealthRequest) return
    reply.header('Cache-Control', 'private, no-store')
    reply.header('Vary', 'Authorization')
    const rate = requestRateLimiter?.consume(request.ip)
    if (rate) {
      reply.header('RateLimit-Limit', requestRateLimitOptions?.max)
      reply.header('RateLimit-Remaining', rate.remaining)
      reply.header('RateLimit-Reset', rate.retryAfterSeconds)
      if (!rate.allowed) {
        reply.header('Retry-After', rate.retryAfterSeconds)
        return sendApiError(reply, 429, request, {
          code: 'RATE_LIMITED',
          message: 'The API request rate limit was exceeded.',
          retryable: true,
        })
      }
    }
    actorsByRequest.set(request, await authenticate(request.headers.authorization))
  })

  app.setNotFoundHandler((request, reply) => sendApiError(reply, 404, request, {
    code: 'RESOURCE_NOT_FOUND',
    message: 'The requested API resource was not found.',
    retryable: false,
  }))

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof AuthenticationError) {
      reply.header('WWW-Authenticate', 'Bearer realm="relay-api"')
      return sendApiError(reply, 401, request, {
        code: 'AUTHENTICATION_REQUIRED',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof AuthorizationChangedError) {
      return sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof SessionVersionConflictError) {
      return sendApiError(reply, 412, request, {
        code: 'PRECONDITION_FAILED',
        message: error.message,
        retryable: false,
        details: {
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        },
      })
    }

    if (error instanceof ShareGrantVersionConflictError) {
      return sendApiError(reply, 412, request, {
        code: 'PRECONDITION_FAILED',
        message: error.message,
        retryable: false,
        details: {
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        },
      })
    }

    if (error instanceof ArtifactVersionConflictError) {
      return sendApiError(reply, 412, request, {
        code: 'PRECONDITION_FAILED',
        message: error.message,
        retryable: false,
        details: {
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        },
      })
    }

    if (error instanceof ApprovalVersionConflictError) {
      return sendApiError(reply, 412, request, {
        code: 'PRECONDITION_FAILED',
        message: error.message,
        retryable: false,
        details: {
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        },
      })
    }

    if (error instanceof ApprovalAlreadyDecidedError) {
      return sendApiError(reply, 409, request, {
        code: 'APPROVAL_ALREADY_DECIDED',
        message: error.message,
        retryable: false,
        details: { status: error.currentStatus },
      })
    }

    if (error instanceof ApprovalDecisionConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'APPROVAL_DECISION_CONFLICT',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof ApprovalPermissionDeniedError) {
      return sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof ArtifactConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'ARTIFACT_CONFLICT',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof ArtifactValidationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: error.message,
        retryable: false,
        fieldErrors: { [`body.${error.field}`]: [error.message] },
      })
    }

    if (error instanceof ShareGrantConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'SHARE_GRANT_CONFLICT',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof ShareGrantValidationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: error.message,
        retryable: false,
        fieldErrors: { 'body.expiresAt': [error.message] },
      })
    }

    if (error instanceof SharePrincipalNotFoundError) return sendResourceNotFound(reply, request)

    if (error instanceof SessionStateConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'SESSION_STATE_CONFLICT',
        message: error.message,
        retryable: false,
        details: { status: error.status, operation: error.operation },
      })
    }

    if (error instanceof TurnStateConflictError) {
      return sendApiError(reply, error.status === 'missing' ? 404 : 409, request, {
        code: error.status === 'missing' ? 'RESOURCE_NOT_FOUND' : 'TURN_STATE_CONFLICT',
        message: error.message,
        retryable: false,
        details: { status: error.status },
      })
    }

    if (error instanceof SessionConfigurationNotFoundError) {
      return sendResourceNotFound(reply, request)
    }

    if (error instanceof ExpertNotPublishedError) {
      return sendApiError(reply, 422, request, {
        code: 'EXPERT_NOT_PUBLISHED',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof EnvironmentNotReadyError) {
      return sendApiError(reply, 422, request, {
        code: 'ENVIRONMENT_NOT_READY',
        message: error.message,
        retryable: false,
      })
    }

    if (error instanceof ExecutionUnavailableError) {
      return sendApiError(reply, 503, request, {
        code: 'EXECUTION_UNAVAILABLE',
        message: error.message,
        retryable: error.retryable,
      })
    }

    if (error instanceof SessionConfigurationValidationError) {
      return sendApiError(reply, 422, request, {
        code: 'VALIDATION_FAILED',
        message: error.message,
        retryable: false,
        fieldErrors: error.fieldErrors,
      })
    }

    if (error instanceof InvalidCatalogPaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The catalog pagination parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: [`Use a valid ${error.field} for this Workspace and resource.`],
        },
      })
    }

    if (error instanceof InvalidSessionListPaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The Session list parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor for this Workspace and filter set.'],
        },
      })
    }

    if (error instanceof InvalidSessionSharePaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The Session ShareGrant list parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor for this Session.'],
        },
      })
    }

    if (error instanceof InvalidArtifactPaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The Artifact list parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor for this Session and filter.'],
        },
      })
    }

    if (error instanceof InvalidFilePaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The File request parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor bound to this File scope.'],
        },
      })
    }

    if (error instanceof InvalidToolApprovalPaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: `The ${error.resource} list parameters are invalid.`,
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor bound to this filter set.'],
        },
      })
    }

    if (error instanceof InvalidSessionWorkerPaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The Session Worker list parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [`query.${error.field}`]: ['Use a valid value and a cursor bound to this Session.'],
        },
      })
    }

    if (error instanceof InvalidSessionTimelinePaginationError) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The Session timeline pagination parameters are invalid.',
        retryable: false,
        fieldErrors: {
          [error.field === 'last-event-id' ? 'header.Last-Event-ID' : `query.${error.field}`]: [
            'Use a valid cursor and limit for this Session.',
          ],
        },
      })
    }

    request.log.error({ err: error }, 'Unhandled API request error')

    const statusCode = errorStatusCode(error)

    if (statusCode === 413) {
      return sendApiError(reply, 413, request, {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body exceeds the configured limit.',
        retryable: false,
      })
    }

    if (statusCode === 400) {
      return sendApiError(reply, 400, request, {
        code: 'INVALID_REQUEST',
        message: 'The request could not be parsed.',
        retryable: false,
      })
    }

    return sendApiError(reply, 500, request, {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      retryable: true,
    })
  })

  app.get('/api/health', async () => ({ status: 'ok' as const }))

  app.get('/api/ready', async (request, reply) => {
    try {
      await options.readinessCheck?.()
      return { status: 'ready' as const }
    } catch {
      return sendApiError(reply, 503, request, {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'A required service is unavailable.',
        retryable: true,
      })
    }
  })

  app.get('/api/v1/me', async (request, reply) => {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    reply.header('Cache-Control', 'no-store')
    return MeResponseSchema.parse({
      actor: { id: actor.id, kind: actor.kind },
      organizations: await sessionRepository.listActorOrganizations(actor.id),
    })
  })

  app.get('/api/v1/capabilities', async (request) => RuntimeCapabilitiesSchema.parse({
    execution: {
      enabled: await executionAvailable(request),
      events: sessionTimelineRepository ? 'sse' : 'polling',
    },
  }))

  async function authorizeSpace(request: FastifyRequest, reply: FastifyReply, params: SpaceParams) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    const organizationId = parseSpaceId(params.organizationId)
    const spaceId = parseSpaceId(params.spaceId)
    if (!organizationId || !spaceId) {
      sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The request parameters are invalid.',
        retryable: false,
        fieldErrors: { path: ['Organization and Space ids must contain between 1 and 128 characters.'] },
      })
      return null
    }
    const access = await sessionRepository.getSpaceAccess(organizationId, spaceId, actor.id)
    if (!access) {
      sendResourceNotFound(reply, request)
      return null
    }
    return { access, actor, organizationId, spaceId }
  }

  async function authorizeCatalogSpace(
    request: FastifyRequest,
    reply: FastifyReply,
    params: SpaceParams,
  ) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    if (actor.kind === 'service_account') {
      sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'Service accounts cannot enumerate control-plane configuration.',
        retryable: false,
      })
      return null
    }
    return authorizeSpace(request, reply, params)
  }

  async function authorizeFileSpace(
    request: FastifyRequest,
    reply: FastifyReply,
    params: SpaceParams,
  ) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    if (actor.kind === 'service_account') {
      sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'Service accounts cannot browse or download Files.',
        retryable: false,
      })
      return null
    }
    return authorizeSpace(request, reply, params)
  }

  async function authorizeApprovalSpace(
    request: FastifyRequest,
    reply: FastifyReply,
    params: SpaceParams,
  ) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    if (actor.kind === 'service_account') {
      sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'Service accounts cannot view or record human Approval decisions.',
        retryable: false,
      })
      return null
    }
    return authorizeSpace(request, reply, params)
  }

  async function authorizeSessionSpace(
    request: FastifyRequest,
    reply: FastifyReply,
    params: SpaceParams,
    operation?: {
      scope: ServiceAccountSessionScope
      resourceType: ServiceAccountSessionResourceType
      resourceId: string
    },
  ) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    const authorization = await authorizeSpace(request, reply, params)
    if (!authorization) return null
    if (actor.kind === 'service_account' && !await authorizeServiceAccountOperation(
      request,
      reply,
      actor,
      authorization.organizationId,
      authorization.spaceId,
      operation,
    )) return null
    return authorization
  }

  async function authorizeServiceAccountOperation(
    request: FastifyRequest,
    reply: FastifyReply,
    actor: AuthenticatedActor,
    organizationId: string,
    spaceId: string,
    operation?: {
      scope: ServiceAccountSessionScope
      resourceType: ServiceAccountSessionResourceType
      resourceId: string
    },
  ) {
    if (actor.kind !== 'service_account') return true
    const allowed = actor.audience !== undefined && operation !== undefined
      && await serviceAccountPolicyRepository.authorizeSessionOperation({
        organizationId,
        spaceId,
        serviceAccountId: actor.id,
        audience: actor.audience,
        ...operation,
      })
    if (!allowed) {
      sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'The service account is not bound to this Session operation and resource.',
        retryable: false,
      })
      return false
    }
    return true
  }

  function catalogListResponse<T extends { updatedAt: string }>(
    page: { items: T[]; hasMore: boolean; nextCursor: { updatedAt: string; id: string } | null },
    resource: CatalogResource,
    organizationId: string,
    spaceId: string,
  ) {
    return {
      items: page.items,
      page: {
        nextCursor: page.nextCursor
          ? encodeCatalogCursor(page.nextCursor, resource, organizationId, spaceId)
          : null,
        hasMore: page.hasMore,
        projectionUpdatedAt: page.items[0]?.updatedAt ?? null,
      },
    }
  }

  app.get<{ Params: SpaceParams; Querystring: CatalogQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/experts',
    async (request, reply) => {
      const authorization = await authorizeCatalogSpace(request, reply, request.params)
      if (!authorization) return
      const pagination = parseCatalogPagination(
        request.query,
        'experts',
        authorization.organizationId,
        authorization.spaceId,
      )
      const page = await configurationCatalogRepository.listExperts(
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return ExpertListResponseSchema.parse(catalogListResponse(
        page,
        'experts',
        authorization.organizationId,
        authorization.spaceId,
      ))
    },
  )

  app.get<{ Params: ExpertParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/experts/:expertId',
    async (request, reply) => {
      const authorization = await authorizeCatalogSpace(request, reply, request.params)
      if (!authorization) return
      const expertId = parseSpaceId(request.params.expertId)
      if (!expertId) return sendResourceNotFound(reply, request)
      const candidate = await configurationCatalogRepository.getExpert(
        authorization.organizationId,
        authorization.spaceId,
        expertId,
        authorization.actor.id,
      )
      if (!candidate) return sendResourceNotFound(reply, request)
      const expert = ExpertDetailDtoSchema.parse(candidate)
      reply.header('ETag', resourceEtag(expert))
      return expert
    },
  )

  app.get<{ Params: SpaceParams; Querystring: CatalogQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/environments',
    async (request, reply) => {
      const authorization = await authorizeCatalogSpace(request, reply, request.params)
      if (!authorization) return
      const pagination = parseCatalogPagination(
        request.query,
        'environments',
        authorization.organizationId,
        authorization.spaceId,
      )
      const page = await configurationCatalogRepository.listEnvironments(
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return EnvironmentListResponseSchema.parse(catalogListResponse(
        page,
        'environments',
        authorization.organizationId,
        authorization.spaceId,
      ))
    },
  )

  app.get<{ Params: EnvironmentParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/environments/:environmentId',
    async (request, reply) => {
      const authorization = await authorizeCatalogSpace(request, reply, request.params)
      if (!authorization) return
      const environmentId = parseSpaceId(request.params.environmentId)
      if (!environmentId) return sendResourceNotFound(reply, request)
      const candidate = await configurationCatalogRepository.getEnvironment(
        authorization.organizationId,
        authorization.spaceId,
        environmentId,
        authorization.actor.id,
      )
      if (!candidate) return sendResourceNotFound(reply, request)
      const environment = EnvironmentDetailDtoSchema.parse(candidate)
      reply.header('ETag', resourceEtag(environment))
      return environment
    },
  )

  app.get<{ Params: SpaceParams; Querystring: SessionListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return

      const options = parseSessionListPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
      )
      const page = await sessionRepository.listBySpace(
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
        options,
      )
      return SessionListResponseSchema.parse({
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeSessionListCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              options,
            )
            : null,
          hasMore: page.hasMore,
          projectionUpdatedAt: page.projectionUpdatedAt,
        },
      })
    },
  )

  app.get<{ Params: SessionParams }>('/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId', async (request, reply) => {
    const authorization = await authorizeSessionSpace(request, reply, request.params)
    if (!authorization) return
    const sessionId = parseSpaceId(request.params.sessionId)
    if (!sessionId) return sendResourceNotFound(reply, request)

    const candidate = await sessionRepository.getById(
      authorization.organizationId,
      authorization.spaceId,
      sessionId,
      authorization.actor.id,
    )
    if (!candidate) return sendResourceNotFound(reply, request)

    const session = SessionDtoSchema.parse(candidate)
    reply.header('ETag', sessionEtag(session))
    reply.header('Cache-Control', 'private, no-store')
    reply.header('Vary', 'Authorization')
    return session
  })

  app.get<{ Params: SessionParams; Querystring: SessionShareListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/shares',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      const options = parseSessionSharePagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
      )
      const page = await sessionRepository.listShares(
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
        authorization.actor.id,
        options,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return SessionShareListResponseSchema.parse({
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeSessionShareCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              sessionId,
            )
            : null,
          hasMore: page.hasMore,
          projectionUpdatedAt: page.projectionUpdatedAt,
        },
      })
    },
  )

  app.post<{ Params: SessionParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/shares',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to share Sessions in this Space.',
          retryable: false,
        })
      }
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const parsed = CreateShareGrantRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The ShareGrant request is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }
      const result = await sessionRepository.createShare({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        idempotencyKey,
        request: parsed.data,
      })
      if (!result) return sendResourceNotFound(reply, request)
      const grant = ShareGrantDtoSchema.parse(result.grant)
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('Location', `/api/v1/organizations/${authorization.organizationId}/spaces/${authorization.spaceId}/sessions/${sessionId}/shares/${grant.id}`)
      reply.header('ETag', resourceEtag(grant))
      return reply.code(201).send(grant)
    },
  )

  app.delete<{ Params: ShareParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/shares/:shareId',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      const shareId = parseSpaceId(request.params.shareId)
      if (!sessionId || !shareId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to revoke Session shares in this Space.',
          retryable: false,
        })
      }
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply, 'ShareGrant')
      if (expectedVersion === null) return
      if (request.body !== undefined) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'Revoking a ShareGrant does not accept a request body.',
          retryable: false,
          fieldErrors: { body: ['Send the request without a body.'] },
        })
      }
      const result = await sessionRepository.revokeShare({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        shareId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        idempotencyKey,
        expectedVersion,
      })
      if (!result) return sendResourceNotFound(reply, request)
      const grant = ShareGrantDtoSchema.parse(result.grant)
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('ETag', resourceEtag(grant))
      return grant
    },
  )

  app.get<{ Params: SpaceParams; Querystring: FileListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/files',
    async (request, reply) => {
      const authorization = await authorizeFileSpace(request, reply, request.params)
      if (!authorization) return
      const pagination = parseFilePagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
      )
      const page = await fileRepository.list(
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return FileListResponseSchema.parse({
        organizationId: authorization.organizationId,
        requestedSpaceId: authorization.spaceId,
        scope: pagination.scope,
        ownerUserId: pagination.ownerUserId ?? null,
        sessionId: pagination.sessionId ?? null,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeFileCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              pagination,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.get<{ Params: FileParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/files/:fileId',
    async (request, reply) => {
      const authorization = await authorizeFileSpace(request, reply, request.params)
      if (!authorization) return
      const fileId = parseSpaceId(request.params.fileId)
      if (!fileId) return sendResourceNotFound(reply, request)
      const file = await fileRepository.get(
        authorization.organizationId,
        authorization.spaceId,
        fileId,
        authorization.actor.id,
      )
      if (!file) return sendResourceNotFound(reply, request)
      const response = FileDtoSchema.parse(file)
      reply.header('ETag', resourceEtag(response))
      return response
    },
  )

  app.get<{ Params: FileParams; Querystring: FileContentQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/files/:fileId/content',
    async (request, reply) => {
      const authorization = await authorizeFileSpace(request, reply, request.params)
      if (!authorization) return
      const fileId = parseSpaceId(request.params.fileId)
      if (!fileId) return sendResourceNotFound(reply, request)
      const version = parseFileContentVersion(request.query.version)
      const disposition = parseFileContentDisposition(request.query.disposition)
      const result = await fileRepository.getContent(
        authorization.organizationId,
        authorization.spaceId,
        fileId,
        authorization.actor.id,
        version,
      )
      if (!result) return sendResourceNotFound(reply, request)
      const mimeType = safeFileMimeType(result.file.mimeType)
      reply.header('Content-Disposition', contentDisposition(result.file.path, disposition, mimeType))
      reply.header('Content-Length', result.content.byteLength)
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'")
      reply.header('ETag', `"sha256:${result.version.contentHash}"`)
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.type(mimeType)
      return reply.send(result.content)
    },
  )

  app.get<{ Params: FileParams; Querystring: FileVersionListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/files/:fileId/versions',
    async (request, reply) => {
      const authorization = await authorizeFileSpace(request, reply, request.params)
      if (!authorization) return
      const fileId = parseSpaceId(request.params.fileId)
      if (!fileId) return sendResourceNotFound(reply, request)
      const pagination = parseFileVersionPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        fileId,
      )
      const page = await fileRepository.listVersions(
        authorization.organizationId,
        authorization.spaceId,
        fileId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return FileVersionListResponseSchema.parse({
        organizationId: authorization.organizationId,
        requestedSpaceId: authorization.spaceId,
        fileId,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeFileVersionCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              fileId,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.get<{ Params: SessionParams; Querystring: ArtifactListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/artifacts',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      const options = parseArtifactPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
      )
      const page = await artifactRepository.list(
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
        authorization.actor.id,
        options,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return ArtifactListResponseSchema.parse({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeArtifactCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              sessionId,
              options.type,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.post<{ Params: SessionParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/artifacts',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to associate Artifacts in this Space.',
          retryable: false,
        })
      }
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const parsed = CreateArtifactRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Artifact request is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }
      const result = await artifactRepository.create({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        idempotencyKey,
        request: parsed.data,
      })
      if (!result) return sendResourceNotFound(reply, request)
      const artifact = ArtifactDtoSchema.parse(result.artifact)
      const location = `/api/v1/organizations/${authorization.organizationId}/spaces/${authorization.spaceId}/sessions/${sessionId}/artifacts/${artifact.id}`
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('Location', location)
      reply.header('ETag', resourceEtag(artifact))
      return reply.code(201).send(artifact)
    },
  )

  app.patch<{ Params: ArtifactParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/artifacts/:artifactId',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      const artifactId = parseSpaceId(request.params.artifactId)
      if (!sessionId || !artifactId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to update Artifacts in this Space.',
          retryable: false,
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply, 'Artifact')
      if (expectedVersion === null) return
      const parsed = UpdateArtifactRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Artifact patch is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }
      const candidate = await artifactRepository.update({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        artifactId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        expectedVersion,
        request: parsed.data,
      })
      if (!candidate) return sendResourceNotFound(reply, request)
      const artifact = ArtifactDtoSchema.parse(candidate)
      reply.header('ETag', resourceEtag(artifact))
      return artifact
    },
  )

  app.delete<{ Params: ArtifactParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/artifacts/:artifactId',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      const artifactId = parseSpaceId(request.params.artifactId)
      if (!sessionId || !artifactId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to remove Artifacts in this Space.',
          retryable: false,
        })
      }
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply, 'Artifact')
      if (expectedVersion === null) return
      if (request.body !== undefined) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'Removing an Artifact does not accept a request body.',
          retryable: false,
          fieldErrors: { body: ['Send the request without a body.'] },
        })
      }
      const result = await artifactRepository.remove({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        artifactId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        idempotencyKey,
        expectedVersion,
      })
      if (!result) return sendResourceNotFound(reply, request)
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('ETag', resourceEtag(result.artifact))
      return reply.code(204).send()
    },
  )

  app.get<{ Params: SessionParams; Querystring: SessionWorkerListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/workers',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      const pagination = parseSessionWorkerPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
      )
      const page = await sessionWorkerRepository.list(
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return SessionWorkerListResponseSchema.parse({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeSessionWorkerCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              sessionId,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.get<{ Params: SessionParams; Querystring: ToolCallListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/tool-calls',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      const pagination = parseToolCallPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
      )
      const page = await toolApprovalRepository.listToolCalls(
        authorization.organizationId,
        authorization.spaceId,
        sessionId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      return ToolCallListResponseSchema.parse({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeToolCallCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              sessionId,
              pagination,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.get<{ Params: SpaceParams; Querystring: ApprovalListQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/approvals',
    async (request, reply) => {
      const authorization = await authorizeApprovalSpace(request, reply, request.params)
      if (!authorization) return
      const pagination = parseApprovalPagination(
        request.query,
        authorization.organizationId,
        authorization.spaceId,
      )
      const page = await toolApprovalRepository.listApprovals(
        authorization.organizationId,
        authorization.spaceId,
        authorization.actor.id,
        pagination,
      )
      return ApprovalListResponseSchema.parse({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        items: page.items,
        page: {
          nextCursor: page.nextCursor
            ? encodeApprovalCursor(
              page.nextCursor,
              authorization.organizationId,
              authorization.spaceId,
              pagination,
            )
            : null,
          hasMore: page.hasMore,
        },
      })
    },
  )

  app.get<{ Params: ApprovalParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/approvals/:approvalId',
    async (request, reply) => {
      const authorization = await authorizeApprovalSpace(request, reply, request.params)
      if (!authorization) return
      const approvalId = parseSpaceId(request.params.approvalId)
      if (!approvalId) return sendResourceNotFound(reply, request)
      const candidate = await toolApprovalRepository.getApproval(
        authorization.organizationId,
        authorization.spaceId,
        approvalId,
        authorization.actor.id,
      )
      if (!candidate) return sendResourceNotFound(reply, request)
      const approval = ApprovalDtoSchema.parse(candidate)
      reply.header('ETag', resourceEtag(approval))
      return approval
    },
  )

  app.post<{ Params: ApprovalParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/approvals/:approvalId/decision',
    async (request, reply) => {
      const authorization = await authorizeApprovalSpace(request, reply, request.params)
      if (!authorization) return
      const approvalId = parseSpaceId(request.params.approvalId)
      if (!approvalId) return sendResourceNotFound(reply, request)
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply, 'Approval')
      if (expectedVersion === null) return
      const parsed = ApprovalDecisionRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Approval decision is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }
      const result = await toolApprovalRepository.decideApproval({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        approvalId,
        actorId: authorization.actor.id,
        requestId: request.id,
        idempotencyKey,
        expectedVersion,
        request: parsed.data,
      })
      if (!result) return sendResourceNotFound(reply, request)
      const approval = ApprovalDtoSchema.parse(result.approval)
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('ETag', resourceEtag(approval))
      return approval
    },
  )

  app.patch<{ Params: SessionParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to rename Sessions in this Space.',
          retryable: false,
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply)
      if (expectedVersion === null) return
      const parsed = RenameSessionRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Session rename request is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }
      const candidate = await sessionRepository.rename({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        expectedVersion,
        request: parsed.data,
      })
      if (!candidate) return sendResourceNotFound(reply, request)
      const session = SessionDtoSchema.parse(candidate)
      reply.header('ETag', sessionEtag(session))
      return session
    },
  )

  for (const action of ['archive', 'restore'] as const) {
    app.post<{ Params: SessionParams }>(
      `/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/${action}`,
      async (request, reply) => {
        const authorization = await authorizeSessionSpace(
          request,
          reply,
          request.params,
          action === 'archive'
            ? { scope: 'session.archive', resourceType: 'session', resourceId: request.params.sessionId }
            : undefined,
        )
        if (!authorization) return
        const sessionId = parseSpaceId(request.params.sessionId)
        if (!sessionId) return sendResourceNotFound(reply, request)
        if (!canWriteSpace(authorization.access)) {
          return sendApiError(reply, 403, request, {
            code: 'PERMISSION_DENIED',
            message: `You do not have permission to ${action} Sessions in this Space.`,
            retryable: false,
          })
        }
        const idempotencyKey = readIdempotencyKey(request)
        if (!idempotencyKey) {
          return sendApiError(reply, 400, request, {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key header is required.',
            retryable: false,
            fieldErrors: {
              'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'],
            },
          })
        }
        const expectedVersion = requireIfMatchVersion(request, reply)
        if (expectedVersion === null) return
        if (request.body !== undefined) {
          return sendApiError(reply, 400, request, {
            code: 'VALIDATION_FAILED',
            message: `The Session ${action} operation does not accept a request body.`,
            retryable: false,
            fieldErrors: { body: ['Send the request without a body.'] },
          })
        }
        const result = await sessionRepository.setArchived({
          organizationId: authorization.organizationId,
          spaceId: authorization.spaceId,
          sessionId,
          actorId: authorization.actor.id,
          actorKind: authorization.actor.kind,
          actorAudience: authorization.actor.audience,
          requestId: request.id,
          expectedVersion,
          action,
          idempotencyKey,
        })
        if (!result) return sendResourceNotFound(reply, request)
        const session = SessionDtoSchema.parse(result.session)
        reply.header('Idempotency-Replayed', String(result.replayed))
        reply.header('ETag', sessionEtag(session))
        return session
      },
    )
  }

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    app.post<{ Params: SessionParams }>(
      `/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/${action}`,
      async (request, reply) => {
        const authorization = await authorizeSessionSpace(request, reply, request.params)
        if (!authorization) return
        const sessionId = parseSpaceId(request.params.sessionId)
        if (!sessionId) return sendResourceNotFound(reply, request)
        if (!canWriteSpace(authorization.access)) {
          return sendApiError(reply, 403, request, {
            code: 'PERMISSION_DENIED',
            message: `You do not have permission to ${action} Sessions in this Space.`,
            retryable: false,
          })
        }
        const idempotencyKey = readIdempotencyKey(request)
        if (!idempotencyKey) {
          return sendApiError(reply, 400, request, {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key header is required.',
            retryable: false,
            fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
          })
        }
        const expectedVersion = requireIfMatchVersion(request, reply)
        if (expectedVersion === null) return
        const parsed = CancelSessionRequestSchema.safeParse(
          action === 'cancel' ? (request.body ?? {}) : request.body === undefined ? {} : request.body,
        )
        if (!parsed.success || (action !== 'cancel' && request.body !== undefined)) {
          return sendApiError(reply, 400, request, {
            code: 'VALIDATION_FAILED',
            message: `The Session ${action} request is invalid.`,
            retryable: false,
            fieldErrors: parsed.success
              ? { body: ['Send the request without a body.'] }
              : validationFieldErrors(parsed.error.issues),
          })
        }
        const result = await sessionRepository.control({
          organizationId: authorization.organizationId,
          spaceId: authorization.spaceId,
          sessionId,
          actorId: authorization.actor.id,
          actorKind: authorization.actor.kind,
          requestId: request.id,
          expectedVersion,
          action,
          idempotencyKey,
          request: action === 'cancel' ? parsed.data : {},
        })
        if (!result) return sendResourceNotFound(reply, request)
        const response = SessionControlResponseSchema.parse({
          session: result.session,
          command: result.command,
        })
        reply.code(202)
        reply.header('ETag', sessionEtag(response.session))
        reply.header('Idempotency-Replayed', String(result.replayed))
        return response
      },
    )
  }

  app.post<{ Params: TurnParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/turns/:turnId/retry',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      const turnId = parseSpaceId(request.params.turnId)
      if (!sessionId || !turnId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to retry Turns in this Space.',
          retryable: false,
        })
      }
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: { 'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'] },
        })
      }
      const expectedVersion = requireIfMatchVersion(request, reply)
      if (expectedVersion === null) return
      if (request.body !== undefined) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Turn retry operation does not accept a request body.',
          retryable: false,
          fieldErrors: { body: ['Send the request without a body.'] },
        })
      }
      const result = await sessionRepository.retryTurn({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        turnId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        expectedVersion,
        idempotencyKey,
      })
      if (!result) return sendResourceNotFound(reply, request)
      const response = RetryTurnResponseSchema.parse({
        session: result.session,
        attempt: result.attempt,
        command: result.command,
      })
      reply.code(202)
      reply.header('ETag', sessionEtag(response.session))
      reply.header('Idempotency-Replayed', String(result.replayed))
      return response
    },
  )

  app.get<{ Params: SessionParams; Querystring: SessionTimelineQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/messages',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId || !sessionTimelineRepository) return sendResourceNotFound(reply, request)
      const scope = {
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
      }
      const pagination = parseSessionTimelinePagination(request.query, scope, 100)
      const page = await sessionTimelineRepository.listMessages(
        scope.organizationId,
        scope.spaceId,
        scope.sessionId,
        authorization.actor.id,
        pagination,
      )
      if (!page) return sendResourceNotFound(reply, request)
      const last = page.items.at(-1)
      return SessionMessagePageSchema.parse({
        ...page,
        page: {
          hasMore: page.page.hasMore,
          nextCursor: page.page.hasMore && last
            ? encodeSessionTimelineCursor({ ...scope, sequence: last.sequence })
            : null,
        },
      })
    },
  )

  app.post<{ Params: SessionParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/messages',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params, {
        scope: 'session.send',
        resourceType: 'session',
        resourceId: request.params.sessionId,
      })
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)
      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to send Session messages in this Space.',
          retryable: false,
        })
      }

      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: {
            'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'],
          },
        })
      }
      const parsed = MessageCreateSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The Session message is invalid.',
          retryable: false,
          fieldErrors: validationFieldErrors(parsed.error.issues),
        })
      }

      let executionAvailability: 'available' | 'disabled' | 'worker_unavailable' = 'available'
      if (!executionEnabled) {
        executionAvailability = 'disabled'
      } else if (!await executionAvailable(request)) {
        executionAvailability = 'worker_unavailable'
      }
      const result = await sessionRepository.send({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        actorAudience: authorization.actor.audience,
        requestId: request.id,
        idempotencyKey,
        request: parsed.data,
        executionAvailability,
      })
      if (!result) return sendResourceNotFound(reply, request)

      const response = SendSessionMessageResponseSchema.parse({
        session: result.session,
        message: result.message,
        turn: result.turn,
        command: result.command,
      })
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('ETag', sessionEtag(response.session))
      return reply.code(202).send(response)
    },
  )

  app.get<{ Params: SessionParams; Querystring: SessionTimelineQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/events',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId || !sessionTimelineRepository) return sendResourceNotFound(reply, request)
      const scope = {
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
      }
      const pagination = parseSessionTimelinePagination(request.query, scope, 500)
      let page: SessionEventPage | null
      try {
        page = await sessionTimelineRepository.listEvents(
          scope.organizationId,
          scope.spaceId,
          scope.sessionId,
          authorization.actor.id,
          pagination,
        )
      } catch (error) {
        if (error instanceof SessionTimelineCursorAheadError) {
          throw new InvalidSessionTimelinePaginationError('cursor', { cause: error })
        }
        throw error
      }
      if (!page) return sendResourceNotFound(reply, request)
      return SessionEventPageSchema.parse(page)
    },
  )

  app.get<{ Params: SessionParams; Querystring: SessionTimelineQuery }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/events/stream',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId || !sessionTimelineRepository) return sendResourceNotFound(reply, request)
      const scope = {
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
      }
      const querySequence = parseSessionTimelineCursor(request.query.cursor, scope)
      const lastEventId = request.headers['last-event-id']
      if (Array.isArray(lastEventId)) throw new InvalidSessionTimelinePaginationError('last-event-id')
      const headerSequence = parseSessionTimelineCursor(lastEventId, scope, 'last-event-id')
      if (request.query.cursor !== undefined && lastEventId !== undefined && querySequence !== headerSequence) {
        throw new InvalidSessionTimelinePaginationError('last-event-id')
      }
      let afterSequence = lastEventId === undefined ? querySequence : headerSequence
      const closed = new AbortController()
      const abortStream = () => {
        closed.abort()
        releaseConnection?.()
      }
      request.raw.once('aborted', abortStream)
      reply.raw.once('close', abortStream)
      const releaseConnection = eventStreamLimiter.acquire(
        authorization.actor.id,
        JSON.stringify(scope),
      ) ?? undefined
      if (!releaseConnection) {
        request.raw.off('aborted', abortStream)
        reply.raw.off('close', abortStream)
        reply.header('Retry-After', eventStream.retryAfterSeconds)
        return sendApiError(reply, 429, request, {
          code: 'SSE_CONNECTION_LIMIT_EXCEEDED',
          message: 'The concurrent Session event stream limit was exceeded.',
          retryable: true,
        })
      }

      let hijacked = false

      try {
        let page: SessionEventPage | null
        try {
          page = await sessionTimelineRepository.listEvents(
            scope.organizationId,
            scope.spaceId,
            scope.sessionId,
            authorization.actor.id,
            { afterSequence, limit: eventStream.batchSize },
          )
        } catch (error) {
          if (error instanceof SessionTimelineCursorAheadError) {
            throw new InvalidSessionTimelinePaginationError(
              lastEventId === undefined ? 'cursor' : 'last-event-id',
              { cause: error },
            )
          }
          throw error
        }
        if (closed.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) return
        if (!page) return sendResourceNotFound(reply, request)

        reply.hijack()
        hijacked = true
        reply.raw.writeHead(200, {
          'Cache-Control': 'private, no-cache, no-store, no-transform',
          Connection: 'keep-alive',
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Accel-Buffering': 'no',
          Vary: 'Authorization',
        })
        const startedAt = Date.now()
        let lastAuthorizationAt = startedAt
        const authorizationHeader = request.headers.authorization

        while (!closed.signal.aborted && Date.now() - startedAt < eventStream.maxDurationMs) {
          if (Date.now() - lastAuthorizationAt >= eventStream.heartbeatMs) {
            let currentActor: AuthenticatedActor
            try {
              currentActor = await authenticate(authorizationHeader)
            } catch {
              break
            }
            if (currentActor.id !== authorization.actor.id || currentActor.kind !== authorization.actor.kind) break
            lastAuthorizationAt = Date.now()
            if (page.items.length === 0 && !await writeSse(reply.raw, ': heartbeat\n\n')) return
          }
          for (const event of page.items) {
            if (!await writeSse(reply.raw, eventFrame(event))) return
            afterSequence = event.sequence
          }
          if (page.page.hasMore) {
            page = await sessionTimelineRepository.listEvents(
              scope.organizationId,
              scope.spaceId,
              scope.sessionId,
              authorization.actor.id,
              { afterSequence, limit: eventStream.batchSize },
            )
            if (!page) break
            continue
          }

          await abortableDelay(eventStream.pollMs, closed.signal)
          if (closed.signal.aborted) break
          page = await sessionTimelineRepository.listEvents(
            scope.organizationId,
            scope.spaceId,
            scope.sessionId,
            authorization.actor.id,
            { afterSequence, limit: eventStream.batchSize },
          )
          if (!page) break
        }

        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          await writeSse(reply.raw, 'event: reconnect\ndata: {}\n\n')
        }
      } catch (error) {
        if (!hijacked) throw error
        request.log.error({ err: error }, 'Session event stream failed')
      } finally {
        request.raw.off('aborted', abortStream)
        reply.raw.off('close', abortStream)
        releaseConnection()
        if (hijacked && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
      }
    },
  )

  app.post<{ Params: SpaceParams }>('/api/v1/organizations/:organizationId/spaces/:spaceId/sessions', async (request, reply) => {
    const authorization = await authorizeSpace(request, reply, request.params)
    if (!authorization) return

    if (!canWriteSpace(authorization.access)) {
      return sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to create Sessions in this Space.',
        retryable: false,
      })
    }

    const idempotencyKey = readIdempotencyKey(request)
    if (!idempotencyKey) {
      return sendApiError(reply, 400, request, {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
        retryable: false,
        fieldErrors: {
          'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'],
        },
      })
    }

    const parsed = CreateSessionRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The session request is invalid.',
        retryable: false,
        fieldErrors: validationFieldErrors(parsed.error.issues),
      })
    }

    if (!await authorizeServiceAccountOperation(
      request,
      reply,
      authorization.actor,
      authorization.organizationId,
      authorization.spaceId,
      { scope: 'session.create', resourceType: 'expert', resourceId: parsed.data.expertId },
    )) return

    let executionAvailability: 'available' | 'disabled' | 'worker_unavailable' = 'available'
    if (parsed.data.start) {
      if (!executionEnabled) {
        executionAvailability = 'disabled'
      } else if (!await executionAvailable(request)) {
        executionAvailability = 'worker_unavailable'
      }
    }

    const result = await sessionRepository.create({
      organizationId: authorization.organizationId,
      spaceId: authorization.spaceId,
      actorId: authorization.actor.id,
      actorKind: authorization.actor.kind,
      actorAudience: authorization.actor.audience,
      requestId: request.id,
      idempotencyKey,
      request: parsed.data,
      executionAvailability,
    })
    const session = SessionDtoSchema.parse(result.session)

    reply.header('Idempotency-Replayed', String(result.replayed))
    reply.header('Location', `/api/v1/organizations/${authorization.organizationId}/spaces/${authorization.spaceId}/sessions/${session.id}`)
    reply.header('ETag', sessionEtag(session))
    return reply.code(201).send(CreateSessionResponseSchema.parse({
      session,
      message: result.message,
      turn: result.turn,
      command: result.command,
    }))
  })

  app.post<{ Params: SessionParams }>(
    '/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/start',
    async (request, reply) => {
      const authorization = await authorizeSessionSpace(request, reply, request.params)
      if (!authorization) return
      const sessionId = parseSpaceId(request.params.sessionId)
      if (!sessionId) return sendResourceNotFound(reply, request)

      if (!canWriteSpace(authorization.access)) {
        return sendApiError(reply, 403, request, {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to start Sessions in this Space.',
          retryable: false,
        })
      }

      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) {
        return sendApiError(reply, 400, request, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A valid Idempotency-Key header is required.',
          retryable: false,
          fieldErrors: {
            'Idempotency-Key': ['Use 1 to 128 visible ASCII characters.'],
          },
        })
      }

      const expectedVersion = requireIfMatchVersion(request, reply)
      if (expectedVersion === null) return
      if (request.body !== undefined) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'Starting a draft Session does not accept a request body.',
          retryable: false,
          fieldErrors: { body: ['The saved first Message is reused when the Session starts.'] },
        })
      }

      let executionAvailability: 'available' | 'disabled' | 'worker_unavailable' = 'available'
      if (!executionEnabled) {
        executionAvailability = 'disabled'
      } else if (!await executionAvailable(request)) {
        executionAvailability = 'worker_unavailable'
      }
      const result = await sessionRepository.start({
        organizationId: authorization.organizationId,
        spaceId: authorization.spaceId,
        sessionId,
        actorId: authorization.actor.id,
        actorKind: authorization.actor.kind,
        requestId: request.id,
        idempotencyKey,
        expectedVersion,
        executionAvailability,
      })
      if (!result) return sendResourceNotFound(reply, request)

      const response = StartSessionResponseSchema.parse({
        session: result.session,
        turn: result.turn,
        command: result.command,
      })
      reply.header('Idempotency-Replayed', String(result.replayed))
      reply.header('ETag', sessionEtag(response.session))
      return reply.code(202).send(response)
    },
  )

  return app
}
