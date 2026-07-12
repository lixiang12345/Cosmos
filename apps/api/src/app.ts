import cors from '@fastify/cors'
import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
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
  AuthorizationChangedError,
  IdempotencyConflictError,
  InMemorySessionRepository,
  canWriteSpace,
  type SessionRepository,
} from './session-repository.js'

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/
const SPACE_ID_PATTERN = /^.{1,128}$/u

type SpaceParams = {
  organizationId: string
  spaceId: string
}

type ValidationIssue = {
  path: PropertyKey[]
  message: string
}

export type CreateAppOptions = {
  sessionRepository?: SessionRepository
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

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  })
  const sessionRepository = options.sessionRepository ?? new InMemorySessionRepository()
  const authenticate = options.authenticate ?? rejectAuthentication
  const actorsByRequest = new WeakMap<FastifyRequest, AuthenticatedActor>()

  void app.register(cors, {
    origin: options.corsOrigin ?? false,
  })

  app.addHook('onRequest', async (request) => {
    const path = request.raw.url?.split('?', 1)[0]
    const isPublicHealthRequest = (request.method === 'GET' || request.method === 'HEAD') && path === '/api/health'
    if (request.method === 'OPTIONS' || isPublicHealthRequest) return
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
      sendApiError(reply, 404, request, {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested API resource was not found.',
        retryable: false,
      })
      return null
    }
    return { access, actor, organizationId, spaceId }
  }

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
    return reply.code(201).send(CreateSessionResponseSchema.parse({
      session,
      message: result.message,
      turn: result.turn,
      command: result.command,
    }))
  })

  return app
}
