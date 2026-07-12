import { describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  CreateSessionAdvancedOverridesSchema,
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  MeResponseSchema,
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

  it('accepts the minimal authoritative create request', () => {
    expect(CreateSessionRequestSchema.parse({
      expertId: createSessionInput.expertId,
      title: createSessionInput.title,
      message: { content: createSessionInput.message.content },
    })).toEqual({
      expertId: createSessionInput.expertId,
      title: createSessionInput.title,
      visibility: 'private',
      start: true,
      message: { content: createSessionInput.message.content, attachments: [] },
    })
  })

  it('accepts strict advanced overrides and transitional top-level hints', () => {
    expect(CreateSessionRequestSchema.parse({
      ...createSessionInput,
      advancedOverrides: { repositoryId: 'repository-checkout', baseBranch: 'release' },
    }).advancedOverrides).toEqual({
      repositoryId: 'repository-checkout',
      baseBranch: 'release',
    })
    expect(CreateSessionAdvancedOverridesSchema.safeParse({
      repositoryId: 'repository-checkout',
      unknown: true,
    }).success).toBe(false)
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
    const message = {
      id: 'message-1', sessionId: session.id, sequence: 1, role: 'user' as const,
      actorId: 'user-1', content: session.summary, attachments: [], createdAt: session.createdAt,
    }
    const turn = {
      id: 'turn-1', sessionId: session.id, ordinal: 1, initiatorType: 'user' as const,
      initiatorId: 'user-1', inputMessageId: message.id, status: 'queued' as const,
      queuedAt: session.createdAt, version: 1,
    }
    const command = {
      id: 'command-1', type: 'session.start' as const, status: 'accepted' as const,
      resourceType: 'turn' as const, resourceId: turn.id, acceptedAt: session.createdAt,
    }

    expect(CreateSessionResponseSchema.parse({ session, message, turn, command })).toEqual({
      session, message, turn, command,
    })
    expect(SessionListResponseSchema.parse({
      items: [session],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: session.updatedAt },
    }).items).toEqual([session])
  })

  it('requires every authoritative configuration id for resolved sessions', () => {
    const authoritativeSession = {
      ...sessionInput,
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-3',
      environmentRevisionId: 'environment-revision-5',
      repositoryId: 'repository-checkout',
    } as const

    expect(SessionDtoSchema.parse(authoritativeSession)).toMatchObject({
      configurationResolutionVersion: 1,
      expertRevisionId: 'expert-revision-3',
      environmentRevisionId: 'environment-revision-5',
      repositoryId: 'repository-checkout',
    })
    expect(SessionDtoSchema.safeParse({
      ...authoritativeSession,
      repositoryId: undefined,
    }).success).toBe(false)
  })

  it('defaults legacy sessions to unresolved configuration without authoritative ids', () => {
    expect(SessionDtoSchema.parse(sessionInput)).toMatchObject({
      configurationResolutionVersion: 0,
    })
    expect(SessionDtoSchema.safeParse({
      ...sessionInput,
      expertRevisionId: 'expert-revision-3',
    }).success).toBe(false)
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

describe('identity discovery contract', () => {
  const response = {
    actor: { id: 'user-123', kind: 'user' },
    organizations: [{
      id: 'organization-relay',
      name: 'Relay Engineering',
      role: 'organization_admin',
      spaces: [{ id: 'space-platform', name: 'Platform', role: 'space_manager' }],
    }],
  } as const

  it('accepts an authenticated actor and strongly typed membership hierarchy', () => {
    expect(MeResponseSchema.parse(response)).toEqual(response)
    expect(MeResponseSchema.parse({
      actor: { id: 'automation-123', kind: 'service_account' },
      organizations: [],
    }).organizations).toEqual([])
  })

  it('rejects invalid roles, duplicate ids, and unknown fields', () => {
    expect(MeResponseSchema.safeParse({
      ...response,
      organizations: [{ ...response.organizations[0], role: 'owner' }],
    }).success).toBe(false)
    expect(MeResponseSchema.safeParse({
      ...response,
      organizations: [{
        ...response.organizations[0],
        spaces: [response.organizations[0].spaces[0], response.organizations[0].spaces[0]],
      }],
    }).success).toBe(false)
    expect(MeResponseSchema.safeParse({
      ...response,
      organizations: [response.organizations[0], response.organizations[0]],
    }).success).toBe(false)
    expect(MeResponseSchema.safeParse({ ...response, unexpected: true }).success).toBe(false)
  })
})
