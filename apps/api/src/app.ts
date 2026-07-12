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
  SessionDtoSchema,
  SessionListResponseSchema,
  type ApiError,
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
  ExpertNotPublishedError,
  IdempotencyConflictError,
  InMemorySessionRepository,
  SessionConfigurationNotFoundError,
  SessionConfigurationValidationError,
  canWriteSpace,
  type SessionRepository,
} from './session-repository.js'

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/
const SPACE_ID_PATTERN = /^.{1,128}$/u

type SpaceParams = {
  organizationId: string
  spaceId: string
}

type SessionParams = SpaceParams & {
  sessionId: string
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
  configurationCatalogRepository?: ConfigurationCatalogRepository
  readinessCheck?: () => Promise<void>
  logger?: FastifyServerOptions['logger']
  corsOrigin?: boolean | string
  bodyLimit?: number
  authenticate?: AuthenticateRequest
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

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  })
  const sessionRepository = options.sessionRepository ?? new InMemorySessionRepository()
  const configurationCatalogRepository = options.configurationCatalogRepository
    ?? new EmptyConfigurationCatalogRepository()
  const authenticate = options.authenticate ?? rejectAuthentication
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

  app.get<{ Params: SpaceParams }>('/api/v1/organizations/:organizationId/spaces/:spaceId/sessions', async (request, reply) => {
    const authorization = await authorizeSpace(request, reply, request.params)
    if (!authorization) return

    const items = await sessionRepository.listBySpace(
      authorization.organizationId,
      authorization.spaceId,
      authorization.actor.id,
    )
    return SessionListResponseSchema.parse({
      items,
      page: {
        nextCursor: null,
        hasMore: false,
        projectionUpdatedAt: items[0]?.updatedAt ?? null,
      },
    })
  })

  app.get<{ Params: SessionParams }>('/api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId', async (request, reply) => {
    const authorization = await authorizeSpace(request, reply, request.params)
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

    const result = await sessionRepository.create({
      organizationId: authorization.organizationId,
      spaceId: authorization.spaceId,
      actorId: authorization.actor.id,
      idempotencyKey,
      request: parsed.data,
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

  return app
}
