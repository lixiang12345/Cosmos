import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const ActorIdentifierSchema = z.string().trim().min(1).max(256)
const TimestampSchema = z.string().datetime({ offset: true })

export const FileScopeSchema = z.enum(['workspace', 'user', 'organization'])
export type FileScope = z.infer<typeof FileScopeSchema>

function filePathIssue(value: string) {
  if (value.length < 1 || value.length > 1_024) return 'File paths must contain 1 to 1024 characters'
  if (value !== value.normalize('NFKC')) return 'File paths must use NFKC Unicode normalization'
  if (value.startsWith('/') || value.startsWith('~') || value.includes('\\') || value.includes('\0')) {
    return 'File paths must be relative and use forward slashes'
  }
  if (/\p{Cf}/u.test(value)) return 'File paths cannot contain invisible Unicode format characters'
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'File paths cannot contain empty, current-directory, or parent-directory segments'
  }
  return null
}

export const FilePathSchema = z.string().superRefine((value, context) => {
  const issue = filePathIssue(value)
  if (issue) context.addIssue({ code: 'custom', message: issue })
})

export const FilePrefixSchema = z.string().max(1_024).superRefine((value, context) => {
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value
  if (normalized === '') return
  const issue = filePathIssue(normalized)
  if (issue) context.addIssue({ code: 'custom', message: issue })
})

export const FileDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema.nullable(),
  id: IdentifierSchema,
  scope: FileScopeSchema,
  ownerUserId: ActorIdentifierSchema.nullable(),
  sessionId: IdentifierSchema.nullable(),
  path: FilePathSchema,
  mimeType: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(1_048_576),
  latestVersionId: IdentifierSchema,
  lastWrittenByToolCallId: IdentifierSchema,
  lastWrittenByExpertId: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((file, context) => {
  const workspace = file.scope === 'workspace'
  const user = file.scope === 'user'
  if (workspace !== (file.spaceId !== null && file.sessionId !== null)) {
    context.addIssue({
      code: 'custom', path: ['sessionId'],
      message: 'Only Workspace Files must reference a Space and Session',
    })
  }
  if (user !== (file.ownerUserId !== null)) {
    context.addIssue({
      code: 'custom', path: ['ownerUserId'],
      message: 'Only User Files must reference an owner user',
    })
  }
  if (Date.parse(file.updatedAt) < Date.parse(file.createdAt)) {
    context.addIssue({
      code: 'custom', path: ['updatedAt'], message: 'updatedAt cannot precede createdAt',
    })
  }
})

export type FileDto = z.infer<typeof FileDtoSchema>

export const FileVersionDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema.nullable(),
  fileId: IdentifierSchema,
  id: IdentifierSchema,
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative().max(1_048_576),
  createdByToolCallId: IdentifierSchema,
  sourceSessionId: IdentifierSchema,
  sourceTurnId: IdentifierSchema,
  createdAt: TimestampSchema,
}).strict()

export type FileVersionDto = z.infer<typeof FileVersionDtoSchema>

const PageSchema = z.object({
  nextCursor: z.string().trim().min(1).max(2_048).nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom', path: ['nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }
})

export const FileListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  requestedSpaceId: IdentifierSchema,
  scope: FileScopeSchema,
  ownerUserId: ActorIdentifierSchema.nullable(),
  sessionId: IdentifierSchema.nullable(),
  items: z.array(FileDtoSchema).max(100),
  page: PageSchema,
}).strict().superRefine((response, context) => {
  for (const [index, file] of response.items.entries()) {
    if (
      file.organizationId !== response.organizationId
      || file.scope !== response.scope
      || file.ownerUserId !== response.ownerUserId
      || file.sessionId !== response.sessionId
      || file.archivedAt !== null
    ) {
      context.addIssue({
        code: 'custom', path: ['items', index],
        message: 'File scope must match the page and archived Files cannot be listed',
      })
    }
  }
})

export type FileListResponse = z.infer<typeof FileListResponseSchema>

export const FileVersionListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  requestedSpaceId: IdentifierSchema,
  fileId: IdentifierSchema,
  items: z.array(FileVersionDtoSchema).max(100),
  page: PageSchema,
}).strict().superRefine((response, context) => {
  for (const [index, version] of response.items.entries()) {
    if (version.organizationId !== response.organizationId || version.fileId !== response.fileId) {
      context.addIssue({
        code: 'custom', path: ['items', index],
        message: 'FileVersion scope must match the page',
      })
    }
  }
})

export type FileVersionListResponse = z.infer<typeof FileVersionListResponseSchema>
