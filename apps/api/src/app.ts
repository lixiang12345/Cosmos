import cors from '@fastify/cors'
import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
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
  IdempotencyConflictError,
  InMemorySessionRepository,
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
  logger?: FastifyServerOptions['logger']
  corsOrigin?: boolean | string
  bodyLimit?: number
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

  void app.register(cors, {
    origin: options.corsOrigin ?? false,
  })

  app.setNotFoundHandler((request, reply) => sendApiError(reply, 404, request, {
    code: 'RESOURCE_NOT_FOUND',
    message: 'The requested API resource was not found.',
    retryable: false,
  }))

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled API request error')

    if (error instanceof IdempotencyConflictError) {
      return sendApiError(reply, 409, request, {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: error.message,
        retryable: false,
      })
    }

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

  app.get<{ Params: SpaceParams }>('/api/v1/organizations/:organizationId/spaces/:spaceId/sessions', async (request, reply) => {
    const organizationId = parseSpaceId(request.params.organizationId)
    const spaceId = parseSpaceId(request.params.spaceId)
    if (!organizationId || !spaceId) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The request parameters are invalid.',
        retryable: false,
        fieldErrors: { path: ['Organization and Space ids must contain between 1 and 128 characters.'] },
      })
    }

    const items = await sessionRepository.listBySpace(organizationId, spaceId)
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
    const organizationId = parseSpaceId(request.params.organizationId)
    const spaceId = parseSpaceId(request.params.spaceId)
    if (!organizationId || !spaceId) {
      return sendApiError(reply, 400, request, {
        code: 'VALIDATION_FAILED',
        message: 'The request parameters are invalid.',
        retryable: false,
        fieldErrors: { path: ['Organization and Space ids must contain between 1 and 128 characters.'] },
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
      organizationId,
      spaceId,
      idempotencyKey,
      request: parsed.data,
    })
    const session = SessionDtoSchema.parse(result.session)

    reply.header('Idempotency-Replayed', String(result.replayed))
    return reply.code(201).send(CreateSessionResponseSchema.parse({ session }))
  })

  return app
}
