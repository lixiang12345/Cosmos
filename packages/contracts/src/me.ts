import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const ActorIdentifierSchema = z.string().trim().min(1).max(256)
const NameSchema = z.string().trim().min(1).max(160)

export const ActorKindSchema = z.enum(['user', 'service_account'])
export type ActorKind = z.infer<typeof ActorKindSchema>

export const OrganizationRoleSchema = z.enum([
  'organization_owner',
  'organization_admin',
  'member',
  'viewer',
])
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>

export const SpaceRoleSchema = z.enum(['space_manager', 'member', 'viewer'])
export type SpaceRole = z.infer<typeof SpaceRoleSchema>

export const MeActorSchema = z.object({
  id: ActorIdentifierSchema,
  kind: ActorKindSchema,
}).strict()
export type MeActor = z.infer<typeof MeActorSchema>

export const MeSpaceSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  role: SpaceRoleSchema,
  isDefault: z.boolean().optional(),
}).strict()
export type MeSpace = z.infer<typeof MeSpaceSchema>

function uniqueIds<T extends { id: string }>(items: T[]) {
  return new Set(items.map((item) => item.id)).size === items.length
}

export const MeOrganizationSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  role: OrganizationRoleSchema,
  spaces: z.array(MeSpaceSchema).max(10_000).refine(uniqueIds, {
    message: 'Space ids must be unique within an organization.',
  }),
}).strict()
export type MeOrganization = z.infer<typeof MeOrganizationSchema>

export const MeResponseSchema = z.object({
  actor: MeActorSchema,
  organizations: z.array(MeOrganizationSchema).max(1_000).refine(uniqueIds, {
    message: 'Organization ids must be unique.',
  }),
}).strict()
export type MeResponse = z.infer<typeof MeResponseSchema>
