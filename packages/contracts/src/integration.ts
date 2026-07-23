import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const IntegrationTypeSchema = z.enum(['github', 'slack', 'jira', 'pagerduty', 'linear', 'custom'])
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>

export const IntegrationConnectionStatusSchema = z.enum(['connected', 'action_required', 'disconnected', 'archived'])
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatusSchema>

export const IntegrationHealthSchema = z.enum(['healthy', 'degraded', 'unknown'])
export type IntegrationHealth = z.infer<typeof IntegrationHealthSchema>

export const IntegrationScopeSchema = z.string().trim().min(1).max(256)

export const IntegrationDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  type: IntegrationTypeSchema,
  name: z.string().trim().min(1).max(256),
  connectionStatus: IntegrationConnectionStatusSchema,
  health: IntegrationHealthSchema,
  scopes: z.array(IntegrationScopeSchema).max(64),
  externalAccount: z.string().trim().max(256).nullable(),
  diagnostic: z.string().trim().max(2048).nullable(),
  connectedAt: TimestampSchema.nullable(),
  lastEventAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type IntegrationDto = z.infer<typeof IntegrationDtoSchema>

export const IntegrationListResponseSchema = z.object({
  items: z.array(IntegrationDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type IntegrationListResponse = z.infer<typeof IntegrationListResponseSchema>

export const CreateIntegrationRequestSchema = z.object({
  type: IntegrationTypeSchema,
  name: z.string().trim().min(1).max(256),
  externalAccount: z.string().trim().max(256).optional(),
  scopes: z.array(IntegrationScopeSchema).max(64).optional(),
})
export type CreateIntegrationRequest = z.infer<typeof CreateIntegrationRequestSchema>

export const UpdateIntegrationRequestSchema = z.object({
  connectionStatus: z.enum(['connected', 'action_required', 'disconnected']).optional(),
  health: IntegrationHealthSchema.optional(),
  scopes: z.array(IntegrationScopeSchema).max(64).optional(),
  externalAccount: z.string().trim().max(256).nullable().optional(),
  diagnostic: z.string().trim().max(2048).nullable().optional(),
})
export type UpdateIntegrationRequest = z.infer<typeof UpdateIntegrationRequestSchema>

export const IntegrationMutationResponseSchema = z.object({
  integration: IntegrationDtoSchema,
  replayed: z.boolean(),
})
export type IntegrationMutationResponse = z.infer<typeof IntegrationMutationResponseSchema>
