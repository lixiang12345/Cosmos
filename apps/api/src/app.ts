import cors from '@fastify/cors'
import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  EnvironmentDetailDtoSchema,
  EnvironmentListResponseSchema,
  ExpertDetailDtoSchema,
  ExpertListResponseSchema,
  MeResponseSchema,
  MessageCreateSchema,
  RuntimeCapabilitiesSchema,
  SessionDtoSchema,
  SessionEventPageSchema,
  SessionListResponseSchema,
  SessionMessagePageSchema,
  SendSessionMessageResponseSchema,
  StartSessionResponseSchema,
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

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/
const SPACE_ID_PATTERN = /^.{1,128}$/u

type SpaceParams = {
  organizationId: string
  spaceId: string
}

type SessionParams = SpaceParams & {
  sessionId: string
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
  configurationCatalogRepository?: ConfigurationCatalogRepository
  readinessCheck?: () => Promise<void>
  logger?: FastifyServerOptions['logger']
  corsOrigin?: boolean | string
  bodyLimit?: number
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
  })
  const sessionRepository = options.sessionRepository ?? new InMemorySessionRepository()
  const sessionTimelineRepository = options.sessionTimelineRepository
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
  const actorsByRequest = new WeakMap<FastifyRequest, AuthenticatedActor>()

  void app.register(cors, {
    origin: options.corsOrigin ?? false,
  })

  app.addHook('onRequest', async (request, reply) => {
    const path = request.raw.url?.split('?', 1)[0]
    const isPublicHealthRequest = (request.method === 'GET' || request.method === 'HEAD') && path === '/api/health'
    if (request.method === 'OPTIONS' || isPublicHealthRequest) return
    reply.header('Cache-Control', 'private, no-store')
    reply.header('Vary', 'Authorization')
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

    if (error instanceof SessionStateConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'SESSION_STATE_CONFLICT',
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
      actor,
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

  async function authorizeSessionSpace(
    request: FastifyRequest,
    reply: FastifyReply,
    params: SpaceParams,
  ) {
    const actor = actorsByRequest.get(request)
    if (!actor) throw new AuthenticationError()
    if (actor.kind === 'service_account') {
      sendApiError(reply, 403, request, {
        code: 'PERMISSION_DENIED',
        message: 'Service accounts cannot access Sessions until operation scopes and bindings are enforced.',
        retryable: false,
      })
      return null
    }
    return authorizeSpace(request, reply, params)
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
      const authorization = await authorizeSessionSpace(request, reply, request.params)
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
    const authorization = await authorizeSessionSpace(request, reply, request.params)
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

      const expectedVersion = readIfMatchVersion(request)
      if (expectedVersion === undefined) {
        return sendApiError(reply, 428, request, {
          code: 'PRECONDITION_REQUIRED',
          message: 'An If-Match header containing the current Session ETag is required.',
          retryable: false,
          fieldErrors: { 'header.If-Match': ['Use the quoted ETag returned by the Session detail API.'] },
        })
      }
      if (expectedVersion === null) {
        return sendApiError(reply, 400, request, {
          code: 'VALIDATION_FAILED',
          message: 'The If-Match header is invalid.',
          retryable: false,
          fieldErrors: { 'header.If-Match': ['Use a quoted positive integer such as "1".'] },
        })
      }
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
