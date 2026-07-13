import { z } from 'zod'

export const RuntimeCapabilitiesSchema = z.object({
  execution: z.object({
    enabled: z.boolean(),
    events: z.enum(['polling', 'sse']),
  }).strict(),
}).strict()

export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>
