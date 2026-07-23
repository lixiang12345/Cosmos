import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const DaemonStatusSchema = z.enum(['online', 'offline', 'degraded', 'archived'])
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>

export const DaemonCapabilitySchema = z.string().trim().min(1).max(128)

export const DaemonDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  environmentId: IdentifierSchema,
  name: z.string().trim().min(1).max(256),
  description: z.string().trim().max(2048),
  capabilities: z.array(DaemonCapabilitySchema).max(64),
  enabled: z.boolean(),
  status: DaemonStatusSchema,
  concurrencySlots: z.number().int().min(1).max(64),
  lastHeartbeatAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type DaemonDto = z.infer<typeof DaemonDtoSchema>

export const DaemonListResponseSchema = z.object({
  items: z.array(DaemonDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type DaemonListResponse = z.infer<typeof DaemonListResponseSchema>

export const CreateDaemonRequestSchema = z.object({
  name: z.string().trim().min(1).max(256),
  environmentId: IdentifierSchema,
  description: z.string().trim().max(2048).optional(),
  capabilities: z.array(DaemonCapabilitySchema).max(64).optional(),
  concurrencySlots: z.number().int().min(1).max(64).optional(),
})
export type CreateDaemonRequest = z.infer<typeof CreateDaemonRequestSchema>

export const UpdateDaemonRequestSchema = z.object({
  description: z.string().trim().max(2048).optional(),
  capabilities: z.array(DaemonCapabilitySchema).max(64).optional(),
  concurrencySlots: z.number().int().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
})
export type UpdateDaemonRequest = z.infer<typeof UpdateDaemonRequestSchema>

export const DaemonMutationResponseSchema = z.object({
  daemon: DaemonDtoSchema,
  replayed: z.boolean(),
})
export type DaemonMutationResponse = z.infer<typeof DaemonMutationResponseSchema>
