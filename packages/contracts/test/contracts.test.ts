import { describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  SessionDtoSchema,
  SessionListResponseSchema,
  SessionStatusSchema,
  SessionVisibilitySchema,
} from '../src/index.js'

const createSessionInput = {
  title: 'Investigate checkout latency',
  expertId: 'expert-incident-investigator',
  expertName: 'Incident Investigator',
  expertVersion: 3,
  environmentId: 'env-commerce-default',
  repository: 'commerce/payment-service',
  baseBranch: 'main',
  message: {
    content: 'Inspect the payment path and propose a verified fix.',
  },
} as const

const sessionInput = {
  id: 'session-123',
  organizationId: 'organization-relay',
  spaceId: 'space-commerce',
  title: createSessionInput.title,
  summary: createSessionInput.message.content,
  expertId: createSessionInput.expertId,
  expertName: createSessionInput.expertName,
  expertVersion: createSessionInput.expertVersion,
  environmentId: createSessionInput.environmentId,
  repository: createSessionInput.repository,
  baseBranch: createSessionInput.baseBranch,
  visibility: 'space',
  status: 'active',
  attachments: ['upload-123'],
  source: 'manual',
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:01:00.000Z',
  lastActivityAt: '2026-07-12T10:01:00.000Z',
  version: 1,
} as const

describe('session contracts', () => {
  it('accepts every supported session status and visibility', () => {
    for (const status of ['draft', 'queued', 'active', 'waiting', 'paused', 'completed', 'failed', 'canceled']) {
      expect(SessionStatusSchema.parse(status)).toBe(status)
    }
    expect(SessionStatusSchema.safeParse('unknown').success).toBe(false)
    expect(SessionVisibilitySchema.parse('private')).toBe('private')
    expect(SessionVisibilitySchema.parse('space')).toBe('space')
  })

  it('normalizes a create request and supplies safe defaults', () => {
    const result = CreateSessionRequestSchema.parse({
      ...createSessionInput,
      title: '  Investigate checkout latency  ',
    })

    expect(result).toMatchObject({
      title: 'Investigate checkout latency',
      visibility: 'private',
      start: true,
      message: { content: createSessionInput.message.content, attachments: [] },
    })
  })

  it('rejects an empty message and excessive attachments', () => {
    expect(CreateSessionRequestSchema.safeParse({
      ...createSessionInput,
      message: { content: '' },
    }).success).toBe(false)
    expect(CreateSessionRequestSchema.safeParse({
      ...createSessionInput,
      message: {
        content: createSessionInput.message.content,
        attachments: Array.from({ length: 11 }, (_, index) => `attachment-${index}`),
      },
    }).success).toBe(false)
  })

  it('validates create and list response envelopes', () => {
    const session = SessionDtoSchema.parse(sessionInput)

    expect(CreateSessionResponseSchema.parse({ session })).toEqual({ session })
    expect(SessionListResponseSchema.parse({
      items: [session],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    }).items).toEqual([session])
  })
})

describe('API error contract', () => {
  it('accepts structured field errors and correlation metadata', () => {
    expect(ApiErrorSchema.parse({
      code: 'SESSION_VALIDATION_FAILED',
      message: 'The session request is invalid.',
      retryable: false,
      fieldErrors: { message: ['Message is required.'] },
      correlationId: 'req-123',
      details: { source: 'create-session' },
    })).toMatchObject({
      code: 'SESSION_VALIDATION_FAILED',
      retryable: false,
      correlationId: 'req-123',
    })
  })

  it('rejects unknown fields and missing retryability', () => {
    expect(ApiErrorSchema.safeParse({ code: 'FAILED', message: 'Failed' }).success).toBe(false)
    expect(ApiErrorSchema.safeParse({ code: 'FAILED', message: 'Failed', retryable: true, unexpected: true }).success).toBe(false)
  })
})
