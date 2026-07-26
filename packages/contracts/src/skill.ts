import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const SkillSourceSchema = z.enum(['inline', 'url'])
export type SkillSource = z.infer<typeof SkillSourceSchema>

export const SkillStatusSchema = z.enum(['active', 'archived'])
export type SkillStatus = z.infer<typeof SkillStatusSchema>

const SkillUrlSchema = z.string().trim().min(1).max(2048).url()
  .refine((value) => value.startsWith('https://'), { message: 'Skill package URLs must use HTTPS.' })

export const SkillDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: z.string().trim().min(1).max(256),
  description: z.string().max(2048),
  source: SkillSourceSchema,
  // Exactly one of content (inline) or url (url) is populated.
  content: z.string().min(1).max(65536).nullable(),
  url: SkillUrlSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(64)).max(32),
  status: SkillStatusSchema,
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
}).superRefine((skill, context) => {
  if ((skill.source === 'inline') !== (skill.content !== null && skill.url === null)) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'Inline Skills carry content; url Skills carry a package URL.' })
  }
  if ((skill.status === 'archived') !== (skill.archivedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['archivedAt'], message: 'Only archived Skills may have an archivedAt timestamp.' })
  }
})
export type SkillDto = z.infer<typeof SkillDtoSchema>

export const SkillListResponseSchema = z.object({
  items: z.array(SkillDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type SkillListResponse = z.infer<typeof SkillListResponseSchema>

export const CreateSkillRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    description: z.string().max(2048).default(''),
    source: SkillSourceSchema,
    content: z.string().min(1).max(65536).optional(),
    url: SkillUrlSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
  })
  .refine(
    (input) => (input.source === 'inline' ? Boolean(input.content) && !input.url : Boolean(input.url) && !input.content),
    { message: 'Inline Skills require content; url Skills require a package URL.' },
  )
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>
export type CreateSkillRequestInput = z.input<typeof CreateSkillRequestSchema>

export const UpdateSkillRequestSchema = z.object({
  description: z.string().max(2048).optional(),
  content: z.string().min(1).max(65536).optional(),
  url: SkillUrlSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
}).refine((request) => Object.keys(request).length > 0, {
  message: 'At least one Skill field must be provided.',
})
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>

export const SkillMutationResponseSchema = z.object({
  skill: SkillDtoSchema,
  replayed: z.boolean(),
})
export type SkillMutationResponse = z.infer<typeof SkillMutationResponseSchema>
