import { z } from 'zod'

export const SearchResultTypeSchema = z.enum([
  'session',
  'expert',
  'artifact',
  'environment',
  'automation',
])
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>

export const SearchResultItemDtoSchema = z.object({
  id: z.string(),
  type: SearchResultTypeSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.string(),
  spaceId: z.string().optional(),
})
export type SearchResultItemDto = z.infer<typeof SearchResultItemDtoSchema>

export const SearchResponseDtoSchema = z.object({
  query: z.string(),
  items: z.array(SearchResultItemDtoSchema),
})
export type SearchResponseDto = z.infer<typeof SearchResponseDtoSchema>
