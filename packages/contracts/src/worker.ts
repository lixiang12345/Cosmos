import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const SessionWorkerStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'canceled',
])
export type SessionWorkerStatus = z.infer<typeof SessionWorkerStatusSchema>

const terminalStatuses = new Set<SessionWorkerStatus>(['completed', 'failed', 'canceled'])

export const SessionWorkerDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  id: IdentifierSchema,
  parentTurnId: IdentifierSchema,
  parentWorkerId: IdentifierSchema.nullable(),
  expertRevisionId: IdentifierSchema.nullable(),
  name: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(1).max(20_000),
  status: SessionWorkerStatusSchema,
  depth: z.number().int().min(1).max(16),
  ordinal: z.number().int().min(1).max(10_000),
  resultSummary: z.string().trim().min(1).max(10_000).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((worker, context) => {
  if ((worker.parentWorkerId === null) !== (worker.depth === 1)) {
    context.addIssue({
      code: 'custom',
      path: ['depth'],
      message: 'Root Workers must have depth 1 and child Workers must have greater depth',
    })
  }
  const terminal = terminalStatuses.has(worker.status)
  if ((worker.completedAt !== null) !== terminal) {
    context.addIssue({
      code: 'custom',
      path: ['completedAt'],
      message: 'completedAt must be present exactly for terminal Workers',
    })
  }
  if (!terminal && worker.resultSummary !== null) {
    context.addIssue({
      code: 'custom',
      path: ['resultSummary'],
      message: 'resultSummary is only available for terminal Workers',
    })
  }
  if (Date.parse(worker.updatedAt) < Date.parse(worker.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt cannot precede createdAt' })
  }
  if (worker.completedAt !== null && Date.parse(worker.completedAt) < Date.parse(worker.createdAt)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'completedAt cannot precede createdAt' })
  }
})
export type SessionWorkerDto = z.infer<typeof SessionWorkerDtoSchema>

export const SessionWorkerListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  items: z.array(SessionWorkerDtoSchema).max(100),
  page: z.object({
    nextCursor: z.string().min(1).nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict().superRefine((page, context) => {
  page.items.forEach((worker, index) => {
    if (
      worker.organizationId !== page.organizationId
      || worker.spaceId !== page.spaceId
      || worker.sessionId !== page.sessionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index],
        message: 'Worker scope must match the page scope',
      })
    }
  })
})
export type SessionWorkerListResponse = z.infer<typeof SessionWorkerListResponseSchema>
