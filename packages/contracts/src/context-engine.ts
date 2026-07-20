import { z } from 'zod'

const RepositorySchema = z.string().trim().min(1).max(512)
const RelativePathSchema = z.string().trim().min(1).max(4_096)

export const ContextRetrievalModeSchema = z.enum(['auto', 'bm25', 'semantic', 'hybrid'])
export type ContextRetrievalMode = z.infer<typeof ContextRetrievalModeSchema>

export const ContextEngineHitSchema = z.object({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().trim().min(1).max(512).nullable(),
  language: z.string().trim().min(1).max(80),
  content: z.string().max(200_000),
  preview: z.string().max(20_000),
  score: z.number().finite(),
  source: z.string().trim().min(1).max(80),
  intent: z.string().trim().min(1).max(80).nullable(),
  channels: z.array(z.string().trim().min(1).max(80)).max(20),
}).strict().superRefine((hit, context) => {
  if (hit.endLine < hit.startLine) {
    context.addIssue({
      code: 'custom',
      path: ['endLine'],
      message: 'endLine cannot precede startLine',
    })
  }
})

export type ContextEngineHit = z.infer<typeof ContextEngineHitSchema>

export const ContextEngineStatusRequestSchema = z.object({
  repository: RepositorySchema,
}).strict()

export type ContextEngineStatusRequest = z.infer<typeof ContextEngineStatusRequestSchema>

export const ContextEngineStatusSchema = z.object({
  provider: z.literal('contextengine-plugin'),
  repository: RepositorySchema,
  available: z.boolean(),
  indexed: z.boolean(),
  revision: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  retrievalMode: z.enum(['bm25', 'hybrid']),
  stats: z.object({
    files: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    symbols: z.number().int().nonnegative(),
    embeddedChunks: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export type ContextEngineStatus = z.infer<typeof ContextEngineStatusSchema>

export const ContextSearchRequestSchema = z.object({
  repository: RepositorySchema,
  query: z.string().trim().min(1).max(20_000),
  topK: z.number().int().min(1).max(40).default(10),
  mode: ContextRetrievalModeSchema.default('auto'),
  pathPrefix: RelativePathSchema.optional(),
  language: z.string().trim().min(1).max(80).optional(),
  expandGraph: z.boolean().default(true),
  neuralRerank: z.boolean().optional(),
}).strict()

export type ContextSearchRequest = z.infer<typeof ContextSearchRequestSchema>
export type ContextSearchRequestInput = z.input<typeof ContextSearchRequestSchema>

export const ContextSearchResponseSchema = z.object({
  provider: z.literal('contextengine-plugin'),
  repository: RepositorySchema,
  query: z.string().trim().min(1).max(20_000),
  mode: ContextRetrievalModeSchema,
  durationMs: z.number().int().nonnegative(),
  hits: z.array(ContextEngineHitSchema).max(40),
}).strict()

export type ContextSearchResponse = z.infer<typeof ContextSearchResponseSchema>

export const ContextPackRequestSchema = z.object({
  repository: RepositorySchema,
  task: z.string().trim().min(1).max(20_000),
  topK: z.number().int().min(1).max(40).default(14),
  maxTokens: z.number().int().min(256).max(100_000).default(16_000),
  pathPrefix: RelativePathSchema.optional(),
}).strict()

export type ContextPackRequest = z.infer<typeof ContextPackRequestSchema>
export type ContextPackRequestInput = z.input<typeof ContextPackRequestSchema>

export const ContextPackResponseSchema = z.object({
  provider: z.literal('contextengine-plugin'),
  repository: RepositorySchema,
  task: z.string().trim().min(1).max(20_000),
  packedText: z.string().max(1_000_000),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  hits: z.array(ContextEngineHitSchema).max(40),
}).strict()

export type ContextPackResponse = z.infer<typeof ContextPackResponseSchema>
