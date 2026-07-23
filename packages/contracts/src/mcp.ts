import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })

export const McpTransportSchema = z.enum(['stdio', 'sse', 'http'])
export type McpTransport = z.infer<typeof McpTransportSchema>

export const McpConnectionStatusSchema = z.enum(['connected', 'action_required', 'archived'])
export type McpConnectionStatus = z.infer<typeof McpConnectionStatusSchema>

export const McpServerDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  name: z.string().trim().min(1).max(256),
  transport: McpTransportSchema,
  // Exactly one of endpoint (http/sse) or command (stdio) is populated.
  endpoint: z.string().trim().min(1).max(2048).nullable(),
  command: z.string().trim().min(1).max(2048).nullable(),
  connectionStatus: McpConnectionStatusSchema,
  toolCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
})
export type McpServerDto = z.infer<typeof McpServerDtoSchema>

export const McpServerListResponseSchema = z.object({
  items: z.array(McpServerDtoSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
})
export type McpServerListResponse = z.infer<typeof McpServerListResponseSchema>

export const CreateMcpServerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    transport: McpTransportSchema,
    endpoint: z.string().trim().min(1).max(2048).optional(),
    command: z.string().trim().min(1).max(2048).optional(),
  })
  .refine(
    (input) => (input.transport === 'stdio' ? Boolean(input.command) : Boolean(input.endpoint)),
    { message: 'stdio transport requires a command; http/sse transport requires an endpoint.' },
  )
export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>

export const UpdateMcpServerRequestSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048).nullable().optional(),
  command: z.string().trim().min(1).max(2048).nullable().optional(),
})
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>

export const McpServerMutationResponseSchema = z.object({
  server: McpServerDtoSchema,
  replayed: z.boolean(),
})
export type McpServerMutationResponse = z.infer<typeof McpServerMutationResponseSchema>
