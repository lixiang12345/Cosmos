import { z } from 'zod'

export const SessionStatusSchema = z.enum([
  'draft',
  'queued',
  'active',
  'waiting',
  'paused',
  'completed',
  'failed',
  'canceled',
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionVisibilitySchema = z.enum(['private', 'space'])

export type SessionVisibility = z.infer<typeof SessionVisibilitySchema>

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const MessageCreateSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10).default([]),
}).strict()

export type MessageCreate = z.infer<typeof MessageCreateSchema>
export type MessageCreateInput = z.input<typeof MessageCreateSchema>

export const CreateSessionAdvancedOverridesSchema = z.object({
  repositoryId: IdentifierSchema.optional(),
  baseBranch: z.string().trim().min(1).max(255).optional(),
}).strict()

export type CreateSessionAdvancedOverrides = z.infer<typeof CreateSessionAdvancedOverridesSchema>

export const CreateSessionRequestSchema = z.object({
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160).optional(),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
  title: z.string().trim().min(1).max(240),
  visibility: SessionVisibilitySchema.default('private'),
  start: z.boolean().default(true),
  message: MessageCreateSchema,
  repository: z.string().trim().min(1).max(512).optional(),
  baseBranch: z.string().trim().min(1).max(255).optional(),
  advancedOverrides: CreateSessionAdvancedOverridesSchema.optional(),
}).strict()

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>
export type CreateSessionRequestInput = z.input<typeof CreateSessionRequestSchema>

export const SessionConfigurationResolutionVersionSchema = z.union([
  z.literal(0),
  z.literal(1),
])

export type SessionConfigurationResolutionVersion = z.infer<typeof SessionConfigurationResolutionVersionSchema>

const SessionDtoBaseSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().max(100_000),
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
  configurationResolutionVersion: SessionConfigurationResolutionVersionSchema.default(0),
  expertRevisionId: IdentifierSchema.optional(),
  environmentRevisionId: IdentifierSchema.optional(),
  repositoryId: IdentifierSchema.optional(),
  repository: z.string().trim().min(1).max(512),
  baseBranch: z.string().trim().min(1).max(255),
  visibility: SessionVisibilitySchema,
  status: SessionStatusSchema,
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10),
  source: z.literal('manual'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastActivityAt: TimestampSchema,
  version: z.number().int().positive(),
}).strict()

const authoritativeConfigurationFields = [
  'expertRevisionId',
  'environmentRevisionId',
  'repositoryId',
] as const

export const SessionDtoSchema = SessionDtoBaseSchema.superRefine((session, context) => {
  for (const field of authoritativeConfigurationFields) {
    if (session.configurationResolutionVersion === 1 && session[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when configurationResolutionVersion is 1`,
      })
    }

    if (session.configurationResolutionVersion === 0 && session[field] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is not allowed when configurationResolutionVersion is 0`,
      })
    }
  }
})

export type SessionDto = z.infer<typeof SessionDtoSchema>
export type SessionDtoInput = z.input<typeof SessionDtoSchema>

export const SessionMessageSchema = z.object({
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  sequence: z.number().int().positive(),
  role: z.enum(['user', 'agent', 'tool', 'system', 'event']),
  actorId: IdentifierSchema.nullable(),
  content: z.string().max(100_000),
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10),
  createdAt: TimestampSchema,
}).strict()

export type SessionMessage = z.infer<typeof SessionMessageSchema>

export const SessionTurnSchema = z.object({
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  ordinal: z.number().int().positive(),
  initiatorType: z.enum(['user', 'event', 'system']),
  initiatorId: IdentifierSchema.nullable(),
  inputMessageId: IdentifierSchema,
  status: z.enum(['queued', 'running', 'waiting_tool', 'waiting_approval', 'completed', 'failed', 'canceled']),
  queuedAt: TimestampSchema,
  version: z.number().int().positive(),
}).strict()

export type SessionTurn = z.infer<typeof SessionTurnSchema>

export const SessionCommandSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('session.start'),
  status: z.enum(['accepted', 'queued', 'running', 'succeeded', 'failed', 'canceled']),
  resourceType: z.literal('turn'),
  resourceId: IdentifierSchema,
  acceptedAt: TimestampSchema,
}).strict()

export type SessionCommand = z.infer<typeof SessionCommandSchema>

export const CreateSessionResponseSchema = z.object({
  session: SessionDtoSchema,
  message: SessionMessageSchema.optional(),
  turn: SessionTurnSchema.optional(),
  command: SessionCommandSchema.optional(),
}).strict()

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const SessionListResponseSchema = z.object({
  items: z.array(SessionDtoSchema),
  page: z.object({
    nextCursor: z.string().trim().min(1).nullable(),
    hasMore: z.boolean(),
    projectionUpdatedAt: TimestampSchema.nullable(),
  }).strict(),
}).strict()

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
