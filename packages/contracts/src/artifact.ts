import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const ActorIdentifierSchema = z.string().trim().min(1).max(256)
const TimestampSchema = z.string().datetime({ offset: true })

export const ArtifactTypeSchema = z.enum([
  'pull_request',
  'branch',
  'commit',
  'issue',
  'link',
  'test_report',
  'deployment',
  'document',
])

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

const ArtifactUrlSchema = z.string().trim().min(1).max(2_048).url().superRefine((value, context) => {
  if (!value.startsWith('https://')) {
    context.addIssue({ code: 'custom', message: 'Artifact URLs must use HTTPS' })
  }
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/u, 1)[0] ?? ''
  if (authority.includes('@')) {
    context.addIssue({ code: 'custom', message: 'Artifact URLs cannot contain credentials' })
  }
  const hostname = authority.replace(/^\[|\]$/gu, '').split(':', 1)[0]?.toLowerCase() ?? ''
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    context.addIssue({ code: 'custom', message: 'Artifact URLs must use a public hostname' })
  }
})

const ArtifactAttributesSchema = z.record(z.string().trim().min(1).max(128), z.json())

export const ArtifactDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  id: IdentifierSchema,
  turnId: IdentifierSchema.nullable(),
  type: ArtifactTypeSchema,
  provider: z.string().trim().min(1).max(128).nullable(),
  externalId: z.string().trim().min(1).max(512).nullable(),
  label: z.string().trim().min(1).max(240),
  url: ArtifactUrlSchema,
  status: z.string().trim().min(1).max(128).nullable(),
  attributes: ArtifactAttributesSchema,
  createdByToolCallId: IdentifierSchema.nullable(),
  createdBy: ActorIdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  removedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((artifact, context) => {
  if ((artifact.provider === null) !== (artifact.externalId === null)) {
    context.addIssue({
      code: 'custom',
      path: ['externalId'],
      message: 'provider and externalId must be present together',
    })
  }
  if (Date.parse(artifact.updatedAt) < Date.parse(artifact.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'updatedAt cannot precede createdAt',
    })
  }
  if (artifact.removedAt !== null && Date.parse(artifact.removedAt) < Date.parse(artifact.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['removedAt'],
      message: 'removedAt cannot precede createdAt',
    })
  }
})

export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>

export const CreateArtifactRequestSchema = z.object({
  turnId: IdentifierSchema.optional(),
  type: ArtifactTypeSchema,
  provider: z.string().trim().min(1).max(128).optional(),
  externalId: z.string().trim().min(1).max(512).optional(),
  label: z.string().trim().min(1).max(240),
  url: ArtifactUrlSchema,
  status: z.string().trim().min(1).max(128).optional(),
  attributes: ArtifactAttributesSchema.default({}),
}).strict().superRefine((artifact, context) => {
  if ((artifact.provider === undefined) !== (artifact.externalId === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['externalId'],
      message: 'provider and externalId must be present together',
    })
  }
})

export type CreateArtifactRequest = z.infer<typeof CreateArtifactRequestSchema>
export type CreateArtifactRequestInput = z.input<typeof CreateArtifactRequestSchema>

export const UpdateArtifactRequestSchema = z.object({
  label: z.string().trim().min(1).max(240).optional(),
  url: ArtifactUrlSchema.optional(),
  status: z.string().trim().min(1).max(128).nullable().optional(),
  attributes: ArtifactAttributesSchema.optional(),
}).strict().refine((artifact) => Object.keys(artifact).length > 0, {
  message: 'At least one Artifact field must be provided',
})

export type UpdateArtifactRequest = z.infer<typeof UpdateArtifactRequestSchema>
export type UpdateArtifactRequestInput = z.input<typeof UpdateArtifactRequestSchema>

export const ArtifactListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  items: z.array(ArtifactDtoSchema).max(100),
  page: z.object({
    nextCursor: z.string().trim().min(1).max(2_048).nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict().superRefine((response, context) => {
  if (response.page.hasMore !== (response.page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['page', 'nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }
  for (const [index, artifact] of response.items.entries()) {
    if (
      artifact.organizationId !== response.organizationId
      || artifact.spaceId !== response.spaceId
      || artifact.sessionId !== response.sessionId
      || artifact.removedAt !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index],
        message: 'Artifact scope must match the page and removed Artifacts cannot be listed',
      })
    }
  }
})

export type ArtifactListResponse = z.infer<typeof ArtifactListResponseSchema>
