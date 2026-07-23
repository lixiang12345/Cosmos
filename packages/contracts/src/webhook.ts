import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const WebhookScopeSchema = z.enum(['shared', 'personal'])
export type WebhookScope = z.infer<typeof WebhookScopeSchema>

export const WebhookStatusSchema = z.enum(['active', 'archived'])
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>

export const WebhookDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: z.string().trim().min(1).max(256),
  url: z.string().trim().url().max(2048),
  scope: WebhookScopeSchema,
  description: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
  secretLastFour: z.string().min(1).max(4).nullable(),
  status: WebhookStatusSchema,
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type WebhookDto = z.infer<typeof WebhookDtoSchema>

export const WebhookListResponseSchema = z.object({
  items: z.array(WebhookDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type WebhookListResponse = z.infer<typeof WebhookListResponseSchema>

export const CreateWebhookRequestSchema = z.object({
  name: z.string().trim().min(1).max(256),
  url: z.string().trim().url().max(2048),
  scope: WebhookScopeSchema.default('shared'),
  description: z.string().nullable().optional(),
})
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>

// The signing secret is returned exactly once, on creation. Read paths never
// echo it back — only `secretLastFour` remains visible for identification.
export const WebhookMutationResponseSchema = z.object({
  webhook: WebhookDtoSchema,
  signingSecret: z.string().min(1).nullable(),
  replayed: z.boolean(),
})
export type WebhookMutationResponse = z.infer<typeof WebhookMutationResponseSchema>
