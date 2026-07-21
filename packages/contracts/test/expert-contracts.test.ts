import { describe, expect, it } from 'vitest'
import {
  ExpertDetailDtoSchema,
  ExpertDraftRevisionDtoSchema,
  ExpertKindSchema,
  ExpertListResponseSchema,
  ExpertPublishedRevisionDtoSchema,
  ExpertStatusSchema,
  ExpertSummaryDtoSchema,
  ExpertVisibilitySchema,
} from '../src/expert.js'

const publishedRevisionSummary = {
  id: 'expert-revision-3',
  expertId: 'expert-incident-investigator',
  revision: 3,
  status: 'published',
  model: 'default',
  environmentId: 'environment-production',
  environmentRevisionId: 'environment-revision-5',
  allowRepositoryOverride: true,
  allowBaseBranchOverride: false,
  createdAt: '2026-07-12T10:00:00.000Z',
} as const

const expertSummary = {
  id: 'expert-incident-investigator',
  organizationId: 'organization-relay',
  spaceId: 'space-platform',
  name: 'Incident Investigator',
  description: 'Investigates production incidents.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: publishedRevisionSummary.id,
  publishedRevisionSummary,
  version: 1,
  createdAt: '2026-07-12T09:00:00.000Z',
  updatedAt: '2026-07-12T10:00:00.000Z',
} as const

const publishedRevision = {
  ...publishedRevisionSummary,
  instructions: 'Inspect evidence, make a minimal fix, and verify it.',
  capabilities: ['code-search', 'read-code', 'git'],
  launchGuidance: 'Describe the incident, affected service, and available evidence.',
} as const

const expertDetail = {
  ...expertSummary,
  publishedRevision,
  draftRevisionId: null,
  draftRevision: null,
} as const

describe('Expert control-plane contracts', () => {
  it('accepts every supported Expert classification', () => {
    for (const status of ['draft', 'published', 'disabled', 'archived']) {
      expect(ExpertStatusSchema.parse(status)).toBe(status)
    }
    for (const kind of ['managed_template', 'custom', 'built_in']) {
      expect(ExpertKindSchema.parse(kind)).toBe(kind)
    }
    expect(ExpertVisibilitySchema.parse('private')).toBe('private')
    expect(ExpertVisibilitySchema.parse('space')).toBe('space')
    expect(ExpertStatusSchema.safeParse('active').success).toBe(false)
    expect(ExpertKindSchema.safeParse('template').success).toBe(false)
    expect(ExpertVisibilitySchema.safeParse('workspace').success).toBe(false)
  })

  it('accepts a database-backed list item and rejects management-only fields', () => {
    expect(ExpertSummaryDtoSchema.parse(expertSummary)).toEqual(expertSummary)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      kind: 'custom',
      draftRevisionId: null,
      upstreamTemplateId: null,
    }).success).toBe(false)
  })

  it('keeps list responses lightweight and strict', () => {
    expect(ExpertListResponseSchema.parse({
      items: [expertSummary],
      page: {
        nextCursor: null,
        hasMore: false,
        projectionUpdatedAt: expertSummary.updatedAt,
      },
    }).items).toEqual([expertSummary])

    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      instructions: publishedRevision.instructions,
    }).success).toBe(false)
    expect(ExpertListResponseSchema.safeParse({
      items: [expertSummary],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: null, total: 1 },
    }).success).toBe(false)
    expect(ExpertListResponseSchema.safeParse({
      items: [expertSummary],
      page: { nextCursor: null, hasMore: true, projectionUpdatedAt: expertSummary.updatedAt },
    }).success).toBe(false)
    expect(ExpertListResponseSchema.safeParse({
      items: Array.from({ length: 101 }, () => expertSummary),
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: expertSummary.updatedAt },
    }).success).toBe(false)
  })

  it('accepts immutable published and mutable draft revision shapes', () => {
    expect(ExpertPublishedRevisionDtoSchema.parse(publishedRevision)).toEqual(publishedRevision)
    expect(ExpertDraftRevisionDtoSchema.parse({
      ...publishedRevision,
      id: 'expert-revision-draft-4',
      revision: 4,
      status: 'draft',
    }).status).toBe('draft')
    expect(ExpertPublishedRevisionDtoSchema.safeParse({
      ...publishedRevision,
      status: 'draft',
    }).success).toBe(false)
  })

  it('accepts detail data while keeping instructions out of summaries', () => {
    expect(ExpertDetailDtoSchema.parse(expertDetail)).toEqual(expertDetail)
    expect(ExpertSummaryDtoSchema.safeParse(expertDetail).success).toBe(false)
  })

  it('rejects unvalidated raw configuration from summaries and details', () => {
    expect(ExpertPublishedRevisionDtoSchema.safeParse({
      ...publishedRevision,
      configuration: { secret: 'plaintext-value' },
    }).success).toBe(false)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      configuration: { secret: 'plaintext-value' },
    }).success).toBe(false)
  })

  it('requires current revision pointers to match their nested revisions', () => {
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      publishedRevisionId: 'expert-revision-other',
    }).success).toBe(false)
    expect(ExpertDetailDtoSchema.safeParse({
      ...expertDetail,
      publishedRevision: { ...publishedRevision, expertId: 'expert-other' },
    }).success).toBe(false)

    expect(ExpertDetailDtoSchema.safeParse({
      ...expertDetail,
      publishedRevision: { ...publishedRevision, model: 'different-model' },
    }).success).toBe(false)
    expect(ExpertDetailDtoSchema.safeParse({
      ...expertSummary,
      draftRevision: {
        ...publishedRevision,
        id: 'expert-revision-draft-4',
        revision: 4,
        status: 'draft',
      },
      publishedRevision,
    }).success).toBe(false)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      publishedRevisionId: null,
      publishedRevisionSummary: null,
    }).success).toBe(false)
  })

  it('rejects unknown fields and invalid identifiers or timestamps', () => {
    expect(ExpertPublishedRevisionDtoSchema.safeParse({
      ...publishedRevision,
      unexpected: true,
    }).success).toBe(false)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      id: 'x'.repeat(129),
    }).success).toBe(false)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      updatedAt: '2026-07-12 10:00:00',
    }).success).toBe(false)
    expect(ExpertSummaryDtoSchema.safeParse({
      ...expertSummary,
      version: 0,
    }).success).toBe(false)
  })
})
