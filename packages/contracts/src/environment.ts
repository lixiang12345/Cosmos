import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const NameSchema = z.string().trim().min(1).max(160)
const TimestampSchema = z.string().datetime({ offset: true })

export const EnvironmentTypeSchema = z.enum(['cloud', 'daemon'])
export type EnvironmentType = z.infer<typeof EnvironmentTypeSchema>

export const EnvironmentStatusSchema = z.enum([
  'draft',
  'provisioning',
  'ready',
  'updating',
  'failed',
  'disabled',
])
export type EnvironmentStatus = z.infer<typeof EnvironmentStatusSchema>

export const EnvironmentVisibilitySchema = z.enum(['private', 'space'])
export type EnvironmentVisibility = z.infer<typeof EnvironmentVisibilitySchema>

export const EnvironmentRepositoryBindingSchema = z.object({
  repositoryId: IdentifierSchema,
  repository: z.string().trim().min(1).max(512),
  baseBranch: z.string().trim().min(1).max(255),
  isDefault: z.boolean(),
}).strict()
export type EnvironmentRepositoryBinding = z.infer<typeof EnvironmentRepositoryBindingSchema>

export const EnvironmentDefaultRepositorySchema = EnvironmentRepositoryBindingSchema.extend({
  isDefault: z.literal(true),
}).strict()
export type EnvironmentDefaultRepository = z.infer<typeof EnvironmentDefaultRepositorySchema>

export const EnvironmentActiveRevisionSummarySchema = z.object({
  id: IdentifierSchema,
  environmentId: IdentifierSchema,
  revision: z.number().int().positive(),
  status: z.literal('ready'),
  defaultRepository: EnvironmentDefaultRepositorySchema,
  createdAt: TimestampSchema,
}).strict()
export type EnvironmentActiveRevisionSummary = z.infer<typeof EnvironmentActiveRevisionSummarySchema>

function uniqueRepositoryIds(bindings: EnvironmentRepositoryBinding[]) {
  return new Set(bindings.map((binding) => binding.repositoryId)).size === bindings.length
}

export const EnvironmentActiveRevisionDetailSchema = EnvironmentActiveRevisionSummarySchema.extend({
  repositoryBindings: z.array(EnvironmentRepositoryBindingSchema)
    .min(1)
    .refine(uniqueRepositoryIds, { message: 'Repository ids must be unique within an Environment revision.' }),
}).strict().superRefine((revision, context) => {
  const defaultBindings = revision.repositoryBindings.filter((binding) => binding.isDefault)
  if (defaultBindings.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryBindings'],
      message: 'A ready Environment revision must have exactly one default repository.',
    })
    return
  }

  const defaultBinding = defaultBindings[0]
  if (
    defaultBinding?.repositoryId !== revision.defaultRepository.repositoryId
    || defaultBinding.repository !== revision.defaultRepository.repository
    || defaultBinding.baseBranch !== revision.defaultRepository.baseBranch
  ) {
    context.addIssue({
      code: 'custom',
      path: ['defaultRepository'],
      message: 'defaultRepository must match the default repository binding.',
    })
  }
})
export type EnvironmentActiveRevisionDetail = z.infer<typeof EnvironmentActiveRevisionDetailSchema>

const EnvironmentDtoFields = {
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: NameSchema,
  description: z.string().max(10_000),
  status: EnvironmentStatusSchema,
  activeRevisionId: IdentifierSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
} as const

export const EnvironmentSummaryDtoSchema = z.object({
  ...EnvironmentDtoFields,
  activeRevision: EnvironmentActiveRevisionSummarySchema.nullable(),
}).strict().superRefine((environment, context) => {
  if ((environment.activeRevisionId === null) !== (environment.activeRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['activeRevision'],
      message: 'activeRevision and activeRevisionId must either both be present or both be null.',
    })
    return
  }

  if (environment.activeRevision !== null) {
    if (environment.activeRevision.id !== environment.activeRevisionId) {
      context.addIssue({
        code: 'custom',
        path: ['activeRevision', 'id'],
        message: 'activeRevision.id must match activeRevisionId.',
      })
    }
    if (environment.activeRevision.environmentId !== environment.id) {
      context.addIssue({
        code: 'custom',
        path: ['activeRevision', 'environmentId'],
        message: 'activeRevision.environmentId must match the Environment id.',
      })
    }
  }

  if (environment.status === 'ready' && environment.activeRevision === null) {
    context.addIssue({
      code: 'custom',
      path: ['activeRevision'],
      message: 'A ready Environment requires an active revision.',
    })
  }
})
export type EnvironmentSummaryDto = z.infer<typeof EnvironmentSummaryDtoSchema>

export const EnvironmentDetailDtoSchema = z.object({
  ...EnvironmentDtoFields,
  activeRevision: EnvironmentActiveRevisionDetailSchema.nullable(),
}).strict().superRefine((environment, context) => {
  if ((environment.activeRevisionId === null) !== (environment.activeRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['activeRevision'],
      message: 'activeRevision and activeRevisionId must either both be present or both be null.',
    })
    return
  }

  if (environment.activeRevision !== null) {
    if (environment.activeRevision.id !== environment.activeRevisionId) {
      context.addIssue({
        code: 'custom',
        path: ['activeRevision', 'id'],
        message: 'activeRevision.id must match activeRevisionId.',
      })
    }
    if (environment.activeRevision.environmentId !== environment.id) {
      context.addIssue({
        code: 'custom',
        path: ['activeRevision', 'environmentId'],
        message: 'activeRevision.environmentId must match the Environment id.',
      })
    }
  }

  if (environment.status === 'ready' && environment.activeRevision === null) {
    context.addIssue({
      code: 'custom',
      path: ['activeRevision'],
      message: 'A ready Environment requires an active revision.',
    })
  }
})
export type EnvironmentDetailDto = z.infer<typeof EnvironmentDetailDtoSchema>

export const EnvironmentListResponseSchema = z.object({
  items: z.array(EnvironmentSummaryDtoSchema).max(100),
  page: z.object({
    nextCursor: z.string().trim().min(1).nullable(),
    hasMore: z.boolean(),
    projectionUpdatedAt: TimestampSchema.nullable(),
  }).strict().superRefine((page, context) => {
    if (page.hasMore !== (page.nextCursor !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['nextCursor'],
        message: 'nextCursor must be present exactly when hasMore is true',
      })
    }
  }),
}).strict()
export type EnvironmentListResponse = z.infer<typeof EnvironmentListResponseSchema>
