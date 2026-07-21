import { z } from 'zod'
import { SupportedAgentModelSchema } from './model.js'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })
const CapabilitySchema = z.string().trim().min(1).max(128)
const CapabilitiesSchema = z.array(CapabilitySchema).max(32)
  .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
    message: 'Expert capabilities must be unique',
  })

export const ExpertStatusSchema = z.enum(['draft', 'published', 'disabled', 'archived'])
export type ExpertStatus = z.infer<typeof ExpertStatusSchema>

export const ExpertVisibilitySchema = z.enum(['private', 'space'])
export type ExpertVisibility = z.infer<typeof ExpertVisibilitySchema>

export const ExpertKindSchema = z.enum(['managed_template', 'custom', 'built_in'])
export type ExpertKind = z.infer<typeof ExpertKindSchema>

export const ExpertRevisionStatusSchema = z.enum(['draft', 'published'])
export type ExpertRevisionStatus = z.infer<typeof ExpertRevisionStatusSchema>

const expertRevisionExecutionFields = {
  id: IdentifierSchema,
  expertId: IdentifierSchema,
  revision: z.number().int().positive(),
  model: z.string().trim().min(1).max(256),
  environmentId: IdentifierSchema,
  environmentRevisionId: IdentifierSchema,
  allowRepositoryOverride: z.boolean(),
  allowBaseBranchOverride: z.boolean(),
  createdAt: TimestampSchema,
}

export const ExpertPublishedRevisionSummarySchema = z.object({
  ...expertRevisionExecutionFields,
  status: z.literal('published'),
}).strict()

export type ExpertPublishedRevisionSummary = z.infer<typeof ExpertPublishedRevisionSummarySchema>

const expertRevisionFields = {
  ...expertRevisionExecutionFields,
  instructions: z.string().max(100_000),
  capabilities: CapabilitiesSchema,
  launchGuidance: z.string().max(10_000),
}

export const ExpertPublishedRevisionDtoSchema = z.object({
  ...expertRevisionFields,
  status: z.literal('published'),
}).strict()

export type ExpertPublishedRevisionDto = z.infer<typeof ExpertPublishedRevisionDtoSchema>

export const ExpertDraftRevisionDtoSchema = z.object({
  ...expertRevisionFields,
  status: z.literal('draft'),
}).strict()

export type ExpertDraftRevisionDto = z.infer<typeof ExpertDraftRevisionDtoSchema>

const expertSummaryFields = {
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2_000),
  visibility: ExpertVisibilitySchema,
  status: ExpertStatusSchema,
  publishedRevisionId: IdentifierSchema.nullable(),
  publishedRevisionSummary: ExpertPublishedRevisionSummarySchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}

type RevisionReference = { id: string, expertId: string }

function revisionPointerIssues(
  expertId: string,
  pointerId: string | null | undefined,
  revision: RevisionReference | null | undefined,
  revisionField: string,
) {
  const issues: Array<{ path: string[], message: string }> = []

  if (pointerId === undefined || revision === undefined) {
    if (pointerId !== revision) {
      issues.push({
        path: [revisionField],
        message: `${revisionField} and its revision pointer must be provided together`,
      })
    }
    return issues
  }

  if (pointerId === null || revision === null) {
    if (pointerId !== revision) {
      issues.push({
        path: [revisionField],
        message: `${revisionField} and its revision pointer must both be null or both be set`,
      })
    }
    return issues
  }

  if (revision.id !== pointerId) {
    issues.push({
      path: [revisionField, 'id'],
      message: `${revisionField}.id must match its revision pointer`,
    })
  }
  if (revision.expertId !== expertId) {
    issues.push({
      path: [revisionField, 'expertId'],
      message: `${revisionField}.expertId must match the Expert id`,
    })
  }
  return issues
}

export const ExpertSummaryDtoSchema = z.object(expertSummaryFields).strict()
  .superRefine((expert, context) => {
    for (const issue of revisionPointerIssues(
      expert.id,
      expert.publishedRevisionId,
      expert.publishedRevisionSummary,
      'publishedRevisionSummary',
    )) {
      context.addIssue({ code: 'custom', ...issue })
    }
    if (expert.status === 'published' && expert.publishedRevisionSummary === null) {
      context.addIssue({
        code: 'custom',
        path: ['publishedRevisionSummary'],
        message: 'A published Expert requires a published revision',
      })
    }
  })

export type ExpertSummaryDto = z.infer<typeof ExpertSummaryDtoSchema>

export const ExpertDetailDtoSchema = z.object({
  ...expertSummaryFields,
  publishedRevision: ExpertPublishedRevisionDtoSchema.nullable(),
  draftRevisionId: IdentifierSchema.nullable(),
  draftRevision: ExpertDraftRevisionDtoSchema.nullable(),
}).strict().superRefine((expert, context) => {
  for (const [pointer, revision, field] of [
    [expert.publishedRevisionId, expert.publishedRevisionSummary, 'publishedRevisionSummary'],
    [expert.publishedRevisionId, expert.publishedRevision, 'publishedRevision'],
  ] as const) {
    for (const issue of revisionPointerIssues(expert.id, pointer, revision, field)) {
      context.addIssue({ code: 'custom', ...issue })
    }
  }
  for (const issue of revisionPointerIssues(
    expert.id,
    expert.draftRevisionId,
    expert.draftRevision,
    'draftRevision',
  )) {
    context.addIssue({ code: 'custom', ...issue })
  }
  if (expert.status === 'published' && expert.publishedRevision === null) {
    context.addIssue({
      code: 'custom',
      path: ['publishedRevision'],
      message: 'A published Expert requires a published revision',
    })
  }
  if (expert.publishedRevisionSummary && expert.publishedRevision) {
    for (const field of [
      'id',
      'expertId',
      'revision',
      'status',
      'model',
      'environmentId',
      'environmentRevisionId',
      'allowRepositoryOverride',
      'allowBaseBranchOverride',
      'createdAt',
    ] as const) {
      if (expert.publishedRevisionSummary[field] !== expert.publishedRevision[field]) {
        context.addIssue({
          code: 'custom',
          path: ['publishedRevision', field],
          message: `publishedRevision.${field} must match publishedRevisionSummary.${field}`,
        })
      }
    }
  }
})

export type ExpertDetailDto = z.infer<typeof ExpertDetailDtoSchema>

const expertMutableRevisionFields = {
  instructions: z.string().max(100_000),
  model: SupportedAgentModelSchema,
  environmentId: IdentifierSchema,
  environmentRevisionId: IdentifierSchema,
  allowRepositoryOverride: z.boolean(),
  allowBaseBranchOverride: z.boolean(),
  capabilities: CapabilitiesSchema,
  launchGuidance: z.string().max(10_000),
}

export const CreateExpertRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2_000).default(''),
  visibility: ExpertVisibilitySchema.default('space'),
  ...expertMutableRevisionFields,
}).strict()

export type CreateExpertRequest = z.infer<typeof CreateExpertRequestSchema>
export type CreateExpertRequestInput = z.input<typeof CreateExpertRequestSchema>

export const UpdateExpertRequestSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(2_000).optional(),
  visibility: ExpertVisibilitySchema.optional(),
  ...Object.fromEntries(Object.entries(expertMutableRevisionFields).map(([key, schema]) => (
    [key, schema.optional()]
  ))) as { [Key in keyof typeof expertMutableRevisionFields]: z.ZodOptional<(typeof expertMutableRevisionFields)[Key]> },
}).strict().refine((expert) => Object.keys(expert).length > 0, {
  message: 'At least one Expert field must be provided',
})

export type UpdateExpertRequest = z.infer<typeof UpdateExpertRequestSchema>
export type UpdateExpertRequestInput = z.input<typeof UpdateExpertRequestSchema>

export const ExpertRevisionListResponseSchema = z.object({
  items: z.array(z.union([ExpertDraftRevisionDtoSchema, ExpertPublishedRevisionDtoSchema])).max(100),
}).strict()

export type ExpertRevisionListResponse = z.infer<typeof ExpertRevisionListResponseSchema>

export const ExpertListResponseSchema = z.object({
  items: z.array(ExpertSummaryDtoSchema).max(100),
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

export type ExpertListResponse = z.infer<typeof ExpertListResponseSchema>
