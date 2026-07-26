import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })
const NameSchema = z.string().trim().min(1).max(120)
const DescriptionSchema = z.string().max(2_000)
const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120)
const SettingsSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if (JSON.stringify(value).length > 16_384) {
    context.addIssue({ code: 'custom', message: 'Space settings may contain at most 16 KiB of JSON.' })
  }
})

export const SpaceStatusSchema = z.enum(['active', 'migrating', 'archived'])
export type SpaceStatus = z.infer<typeof SpaceStatusSchema>

export const SpaceDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: NameSchema,
  slug: SlugSchema,
  description: DescriptionSchema,
  isDefault: z.boolean(),
  status: SpaceStatusSchema,
  defaultExpertId: IdentifierSchema.nullable(),
  defaultEnvironmentId: IdentifierSchema.nullable(),
  settings: SettingsSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict()
export type SpaceDto = z.infer<typeof SpaceDtoSchema>

export const SpaceListResponseSchema = z.object({
  items: z.array(SpaceDtoSchema).max(10_000),
  projectionUpdatedAt: TimestampSchema.nullable(),
}).strict()
export type SpaceListResponse = z.infer<typeof SpaceListResponseSchema>

export const CreateSpaceRequestSchema = z.object({
  name: NameSchema,
  slug: SlugSchema.optional(),
  description: DescriptionSchema.default(''),
}).strict()
export type CreateSpaceRequest = z.infer<typeof CreateSpaceRequestSchema>
export type CreateSpaceRequestInput = z.input<typeof CreateSpaceRequestSchema>

export const UpdateSpaceRequestSchema = z.object({
  name: NameSchema.optional(),
  description: DescriptionSchema.optional(),
  defaultExpertId: IdentifierSchema.nullable().optional(),
  defaultEnvironmentId: IdentifierSchema.nullable().optional(),
  settings: SettingsSchema.optional(),
}).strict().refine((request) => Object.keys(request).length > 0, {
  message: 'At least one Space field must be provided.',
})
export type UpdateSpaceRequest = z.infer<typeof UpdateSpaceRequestSchema>
export type UpdateSpaceRequestInput = z.input<typeof UpdateSpaceRequestSchema>

export const SpaceMutationResponseSchema = z.object({
  space: SpaceDtoSchema,
  replayed: z.boolean(),
}).strict()
export type SpaceMutationResponse = z.infer<typeof SpaceMutationResponseSchema>

export const SpaceResourceCountsSchema = z.object({
  sessions: z.number().int().nonnegative(),
  experts: z.number().int().nonnegative(),
  environments: z.number().int().nonnegative(),
  automations: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  webhooks: z.number().int().nonnegative(),
}).strict()
export type SpaceResourceCounts = z.infer<typeof SpaceResourceCountsSchema>

export const SpaceMigrationPreviewSchema = z.object({
  source: SpaceDtoSchema,
  target: SpaceDtoSchema,
  resourceCounts: SpaceResourceCountsSchema,
  canMigrate: z.boolean(),
  blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict()
export type SpaceMigrationPreview = z.infer<typeof SpaceMigrationPreviewSchema>

export const SpaceMigrationResourceTypeSchema = z.enum(['webhooks'])
export type SpaceMigrationResourceType = z.infer<typeof SpaceMigrationResourceTypeSchema>

export const SpaceMigrationStatusSchema = z.enum(['pending', 'executing', 'completed', 'failed'])
export type SpaceMigrationStatus = z.infer<typeof SpaceMigrationStatusSchema>

export const SpaceMigrationDtoSchema = z.object({
  organizationId: IdentifierSchema,
  id: IdentifierSchema,
  sourceSpaceId: IdentifierSchema,
  targetSpaceId: IdentifierSchema,
  resourceType: SpaceMigrationResourceTypeSchema,
  status: SpaceMigrationStatusSchema,
  resourceTotal: z.number().int().nonnegative(),
  resourceMigrated: z.number().int().nonnegative(),
  errorMessage: z.string().min(1).max(2_000).nullable(),
  requestedBy: IdentifierSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((migration, context) => {
  if ((migration.status === 'failed') !== (migration.errorMessage !== null)) {
    context.addIssue({ code: 'custom', path: ['errorMessage'], message: 'Only failed migrations carry an error message.' })
  }
})
export type SpaceMigrationDto = z.infer<typeof SpaceMigrationDtoSchema>

export const CreateSpaceMigrationRequestSchema = z.object({
  targetSpaceId: IdentifierSchema,
  resourceType: SpaceMigrationResourceTypeSchema,
}).strict()
export type CreateSpaceMigrationRequest = z.infer<typeof CreateSpaceMigrationRequestSchema>

export const SpaceMigrationListResponseSchema = z.object({
  items: z.array(SpaceMigrationDtoSchema).max(100),
}).strict()
export type SpaceMigrationListResponse = z.infer<typeof SpaceMigrationListResponseSchema>
