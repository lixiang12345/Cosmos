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

export const CreateSessionRequestSchema = z.object({
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
  title: z.string().trim().min(1).max(240),
  visibility: SessionVisibilitySchema.default('private'),
  start: z.boolean().default(true),
  message: MessageCreateSchema,
  repository: z.string().trim().min(1).max(512),
  baseBranch: z.string().trim().min(1).max(255),
}).strict()

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>
export type CreateSessionRequestInput = z.input<typeof CreateSessionRequestSchema>

export const SessionDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().max(100_000),
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
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

export type SessionDto = z.infer<typeof SessionDtoSchema>

export const CreateSessionResponseSchema = z.object({
  session: SessionDtoSchema,
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
