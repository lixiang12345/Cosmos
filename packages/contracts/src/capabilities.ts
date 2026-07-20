import { z } from 'zod'

export const RuntimeCapabilitiesSchema = z.object({
  execution: z.object({
    enabled: z.boolean(),
    events: z.enum(['polling', 'sse']),
  }).strict(),
  contextEngine: z.object({
    enabled: z.boolean(),
    provider: z.literal('contextengine-plugin'),
  }).strict().optional(),
}).strict()

export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>
