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
  'archived',
])
export type EnvironmentStatus = z.infer<typeof EnvironmentStatusSchema>

export const EnvironmentVisibilitySchema = z.enum(['private', 'space'])
export type EnvironmentVisibility = z.infer<typeof EnvironmentVisibilitySchema>

export const EnvironmentRevisionStatusSchema = z.enum(['provisioning', 'ready', 'failed'])
export type EnvironmentRevisionStatus = z.infer<typeof EnvironmentRevisionStatusSchema>

export const EnvironmentProvisioningPhaseSchema = z.enum([
  'queued',
  'validating',
  'pulling_image',
  'configuring',
  'connecting_daemon',
  'ready',
  'failed',
])
export type EnvironmentProvisioningPhase = z.infer<typeof EnvironmentProvisioningPhaseSchema>

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

export const EnvironmentVariableReferenceSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128),
  secretId: IdentifierSchema,
}).strict()
export type EnvironmentVariableReference = z.infer<typeof EnvironmentVariableReferenceSchema>

export const EnvironmentHookSchema = z.object({
  phase: z.enum(['setup', 'start', 'stop']),
  command: z.string().trim().min(1).max(10_000),
  timeoutSeconds: z.number().int().min(1).max(3_600).default(300),
}).strict()
export type EnvironmentHook = z.infer<typeof EnvironmentHookSchema>

export const EnvironmentNetworkPolicySchema = z.object({
  mode: z.enum(['restricted', 'allowlist', 'unrestricted']),
  allowedHosts: z.array(z.string().trim().min(1).max(253)).max(256)
    .refine((hosts) => new Set(hosts).size === hosts.length, { message: 'Allowed hosts must be unique.' }),
}).strict().superRefine((policy, context) => {
  if (policy.mode !== 'allowlist' && policy.allowedHosts.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['allowedHosts'],
      message: 'allowedHosts is only valid when network mode is allowlist.',
    })
  }
})
export type EnvironmentNetworkPolicy = z.infer<typeof EnvironmentNetworkPolicySchema>

export const EnvironmentProvisioningErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(1_000),
  retryable: z.boolean(),
}).strict()
export type EnvironmentProvisioningError = z.infer<typeof EnvironmentProvisioningErrorSchema>

export const EnvironmentProvisioningDtoSchema = z.object({
  jobId: IdentifierSchema,
  revisionId: IdentifierSchema,
  phase: EnvironmentProvisioningPhaseSchema,
  progress: z.number().int().min(0).max(100),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  error: EnvironmentProvisioningErrorSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict()
export type EnvironmentProvisioningDto = z.infer<typeof EnvironmentProvisioningDtoSchema>

function uniqueRepositoryIds(bindings: EnvironmentRepositoryBinding[]) {
  return new Set(bindings.map((binding) => binding.repositoryId)).size === bindings.length
}

function validateRepositoryBindings(
  bindings: EnvironmentRepositoryBinding[],
  context: z.RefinementCtx,
) {
  if (!uniqueRepositoryIds(bindings)) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryBindings'],
      message: 'Repository ids must be unique within an Environment revision.',
    })
  }
  if (bindings.filter((binding) => binding.isDefault).length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryBindings'],
      message: 'An Environment revision must have exactly one default repository.',
    })
  }
}

const environmentRevisionConfigurationFields = {
  image: z.string().trim().min(1).max(1_000),
  repositoryBindings: z.array(EnvironmentRepositoryBindingSchema).min(1).max(64),
  variableReferences: z.array(EnvironmentVariableReferenceSchema).max(128)
    .refine((references) => new Set(references.map((reference) => reference.name)).size === references.length, {
      message: 'Variable reference names must be unique.',
    }),
  hooks: z.array(EnvironmentHookSchema).max(32),
  networkPolicy: EnvironmentNetworkPolicySchema,
  sharing: EnvironmentVisibilitySchema,
  daemonPoolId: IdentifierSchema.nullable(),
} as const

const EnvironmentRevisionDtoBaseSchema = z.object({
  id: IdentifierSchema,
  environmentId: IdentifierSchema,
  revision: z.number().int().positive(),
  status: EnvironmentRevisionStatusSchema,
  ...environmentRevisionConfigurationFields,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: TimestampSchema,
}).strict().superRefine((revision, context) => {
  validateRepositoryBindings(revision.repositoryBindings, context)
})

export const EnvironmentRevisionDtoSchema = EnvironmentRevisionDtoBaseSchema
export type EnvironmentRevisionDto = z.infer<typeof EnvironmentRevisionDtoSchema>

export const EnvironmentActiveRevisionSummarySchema = z.object({
  id: IdentifierSchema,
  environmentId: IdentifierSchema,
  revision: z.number().int().positive(),
  status: z.literal('ready'),
  defaultRepository: EnvironmentDefaultRepositorySchema,
  createdAt: TimestampSchema,
}).strict()
export type EnvironmentActiveRevisionSummary = z.infer<typeof EnvironmentActiveRevisionSummarySchema>

export const EnvironmentActiveRevisionDetailSchema = EnvironmentRevisionDtoBaseSchema.safeExtend({
  status: z.literal('ready'),
  defaultRepository: EnvironmentDefaultRepositorySchema,
}).strict().superRefine((revision, context) => {
  validateRepositoryBindings(revision.repositoryBindings, context)
  const defaultBinding = revision.repositoryBindings.find((binding) => binding.isDefault)
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
  type: EnvironmentTypeSchema,
  name: NameSchema,
  description: z.string().max(10_000),
  visibility: EnvironmentVisibilitySchema,
  status: EnvironmentStatusSchema,
  activeRevisionId: IdentifierSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
} as const

function validateActiveRevision(
  environment: {
    id: string
    status: EnvironmentStatus
    activeRevisionId: string | null
    activeRevision: EnvironmentActiveRevisionSummary | EnvironmentActiveRevisionDetail | null
  },
  context: z.RefinementCtx,
) {
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
      context.addIssue({ code: 'custom', path: ['activeRevision', 'id'], message: 'activeRevision.id must match activeRevisionId.' })
    }
    if (environment.activeRevision.environmentId !== environment.id) {
      context.addIssue({ code: 'custom', path: ['activeRevision', 'environmentId'], message: 'activeRevision.environmentId must match the Environment id.' })
    }
  }
  if (environment.status === 'ready' && environment.activeRevision === null) {
    context.addIssue({ code: 'custom', path: ['activeRevision'], message: 'A ready Environment requires an active revision.' })
  }
}

export const EnvironmentSummaryDtoSchema = z.object({
  ...EnvironmentDtoFields,
  activeRevision: EnvironmentActiveRevisionSummarySchema.nullable(),
  provisioning: EnvironmentProvisioningDtoSchema.nullable(),
}).strict().superRefine(validateActiveRevision)
export type EnvironmentSummaryDto = z.infer<typeof EnvironmentSummaryDtoSchema>

export const EnvironmentDetailDtoSchema = z.object({
  ...EnvironmentDtoFields,
  activeRevision: EnvironmentActiveRevisionDetailSchema.nullable(),
  latestRevision: EnvironmentRevisionDtoSchema,
  provisioning: EnvironmentProvisioningDtoSchema.nullable(),
  provisioningHistory: z.array(EnvironmentProvisioningDtoSchema).max(100),
}).strict().superRefine((environment, context) => {
  validateActiveRevision(environment, context)
  if (environment.latestRevision.environmentId !== environment.id) {
    context.addIssue({ code: 'custom', path: ['latestRevision', 'environmentId'], message: 'latestRevision must belong to the Environment.' })
  }
  if (environment.type === 'cloud' && environment.latestRevision.daemonPoolId !== null) {
    context.addIssue({ code: 'custom', path: ['latestRevision', 'daemonPoolId'], message: 'Cloud Environments cannot reference a daemon pool.' })
  }
  if (environment.type === 'daemon' && environment.latestRevision.daemonPoolId === null) {
    context.addIssue({ code: 'custom', path: ['latestRevision', 'daemonPoolId'], message: 'Daemon Environments require a daemon pool.' })
  }
})
export type EnvironmentDetailDto = z.infer<typeof EnvironmentDetailDtoSchema>

const createEnvironmentFields = {
  type: EnvironmentTypeSchema,
  name: NameSchema,
  description: z.string().max(10_000).default(''),
  visibility: EnvironmentVisibilitySchema.default('space'),
  ...environmentRevisionConfigurationFields,
} as const

export const CreateEnvironmentRequestSchema = z.object(createEnvironmentFields).strict()
  .superRefine((request, context) => {
    validateRepositoryBindings(request.repositoryBindings, context)
    if (request.sharing !== request.visibility) {
      context.addIssue({ code: 'custom', path: ['sharing'], message: 'sharing must match Environment visibility.' })
    }
    if (request.type === 'cloud' && request.daemonPoolId !== null) {
      context.addIssue({ code: 'custom', path: ['daemonPoolId'], message: 'Cloud Environments cannot reference a daemon pool.' })
    }
    if (request.type === 'daemon' && request.daemonPoolId === null) {
      context.addIssue({ code: 'custom', path: ['daemonPoolId'], message: 'Daemon Environments require a daemon pool.' })
    }
  })
export type CreateEnvironmentRequest = z.infer<typeof CreateEnvironmentRequestSchema>
export type CreateEnvironmentRequestInput = z.input<typeof CreateEnvironmentRequestSchema>

const mutableEnvironmentFields = {
  name: NameSchema,
  description: z.string().max(10_000),
  visibility: EnvironmentVisibilitySchema,
  ...environmentRevisionConfigurationFields,
} as const

export const UpdateEnvironmentRequestSchema = z.object(Object.fromEntries(
  Object.entries(mutableEnvironmentFields).map(([key, schema]) => [key, schema.optional()]),
) as { [Key in keyof typeof mutableEnvironmentFields]: z.ZodOptional<(typeof mutableEnvironmentFields)[Key]> })
  .strict()
  .superRefine((request, context) => {
    if (Object.keys(request).length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one Environment field must be provided.' })
    }
    if (request.repositoryBindings !== undefined) {
      validateRepositoryBindings(request.repositoryBindings, context)
    }
    if (request.visibility !== undefined && request.sharing !== undefined && request.visibility !== request.sharing) {
      context.addIssue({ code: 'custom', path: ['sharing'], message: 'sharing must match Environment visibility.' })
    }
  })
export type UpdateEnvironmentRequest = z.infer<typeof UpdateEnvironmentRequestSchema>
export type UpdateEnvironmentRequestInput = z.input<typeof UpdateEnvironmentRequestSchema>

export const EnvironmentMutationResponseSchema = z.object({
  environment: EnvironmentDetailDtoSchema,
  replayed: z.boolean(),
}).strict()
export type EnvironmentMutationResponse = z.infer<typeof EnvironmentMutationResponseSchema>

export const EnvironmentRevisionListResponseSchema = z.object({
  items: z.array(EnvironmentRevisionDtoSchema).max(100),
}).strict()
export type EnvironmentRevisionListResponse = z.infer<typeof EnvironmentRevisionListResponseSchema>

export const EnvironmentListResponseSchema = z.object({
  items: z.array(EnvironmentSummaryDtoSchema).max(100),
  page: z.object({
    nextCursor: z.string().trim().min(1).nullable(),
    hasMore: z.boolean(),
    projectionUpdatedAt: TimestampSchema.nullable(),
  }).strict().superRefine((page, context) => {
    if (page.hasMore !== (page.nextCursor !== null)) {
      context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'nextCursor must be present exactly when hasMore is true' })
    }
  }),
}).strict()
export type EnvironmentListResponse = z.infer<typeof EnvironmentListResponseSchema>
