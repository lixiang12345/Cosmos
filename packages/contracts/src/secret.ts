import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })
const SecretNameSchema = z.string().trim().min(1).max(256).regex(/^[A-Z][A-Z0-9_]*$/)

export const SecretScopeSchema = z.enum(['private', 'shared'])
export type SecretScope = z.infer<typeof SecretScopeSchema>

export const SecretStatusSchema = z.enum(['active', 'archived'])
export type SecretStatus = z.infer<typeof SecretStatusSchema>

export const SecretDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: SecretNameSchema,
  scope: SecretScopeSchema,
  description: z.string().nullable(),
  vmInstall: z.boolean(),
  lastFour: z.string().min(1).max(4).nullable(),
  status: SecretStatusSchema,
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type SecretDto = z.infer<typeof SecretDtoSchema>

export const SecretListResponseSchema = z.object({
  items: z.array(SecretDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type SecretListResponse = z.infer<typeof SecretListResponseSchema>

export const CreateSecretRequestSchema = z.object({
  name: SecretNameSchema,
  scope: SecretScopeSchema.default('private'),
  value: z.string().min(1),
  description: z.string().nullable().optional(),
  vmInstall: z.boolean().default(true),
})
export type CreateSecretRequest = z.infer<typeof CreateSecretRequestSchema>

export const SecretMutationResponseSchema = z.object({
  secret: SecretDtoSchema,
  replayed: z.boolean(),
})
export type SecretMutationResponse = z.infer<typeof SecretMutationResponseSchema>
