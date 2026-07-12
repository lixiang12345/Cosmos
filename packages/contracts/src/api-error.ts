import { z } from 'zod'

export const ApiErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(2_000),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
  correlationId: z.string().trim().min(1).max(256).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict()

export type ApiError = z.infer<typeof ApiErrorSchema>
