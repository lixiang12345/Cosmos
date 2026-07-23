import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const RepositoryProviderSchema = z.enum(['github', 'gitlab', 'unknown'])
export type RepositoryProvider = z.infer<typeof RepositoryProviderSchema>

export const RepositoryConnectionStatusSchema = z.enum(['connected', 'action_required', 'archived'])
export type RepositoryConnectionStatus = z.infer<typeof RepositoryConnectionStatusSchema>

export const RepositoryDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  provider: RepositoryProviderSchema,
  fullName: z.string().trim().min(1).max(512),
  defaultBranch: z.string().trim().min(1).max(256),
  installationId: z.string().trim().min(1).max(256).nullable(),
  connectionStatus: RepositoryConnectionStatusSchema,
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type RepositoryDto = z.infer<typeof RepositoryDtoSchema>

export const RepositoryListResponseSchema = z.object({
  items: z.array(RepositoryDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type RepositoryListResponse = z.infer<typeof RepositoryListResponseSchema>

export const CreateRepositoryRequestSchema = z.object({
  provider: RepositoryProviderSchema,
  fullName: z.string().trim().min(1).max(512),
  defaultBranch: z.string().trim().min(1).max(256).default('main'),
  installationId: z.string().trim().min(1).max(256).optional(),
})
export type CreateRepositoryRequest = z.infer<typeof CreateRepositoryRequestSchema>

export const UpdateRepositoryRequestSchema = z.object({
  defaultBranch: z.string().trim().min(1).max(256).optional(),
  installationId: z.string().trim().min(1).max(256).nullable().optional(),
})
export type UpdateRepositoryRequest = z.infer<typeof UpdateRepositoryRequestSchema>

export const RepositoryMutationResponseSchema = z.object({
  repository: RepositoryDtoSchema,
  replayed: z.boolean(),
})
export type RepositoryMutationResponse = z.infer<typeof RepositoryMutationResponseSchema>
