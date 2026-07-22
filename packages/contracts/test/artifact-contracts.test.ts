import { describe, expect, it } from 'vitest'
import {
  ArtifactDtoSchema,
  ArtifactListResponseSchema,
  CreateArtifactRequestSchema,
  SessionEventDtoSchema,
  UpdateArtifactRequestSchema,
} from '../src/index.js'

const artifact = {
  organizationId: 'organization-cosmos',
  spaceId: 'space-commerce',
  sessionId: 'session-123',
  id: 'artifact-123',
  turnId: null,
  type: 'pull_request',
  provider: 'github',
  externalId: 'cosmos/cosmos#42',
  label: 'Checkout latency fix',
  url: 'https://github.com/cosmos/cosmos/pull/42',
  status: 'open',
  attributes: { draft: false, checks: 7 },
  createdByToolCallId: null,
  createdBy: 'user-123',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:01:00.000Z',
  removedAt: null,
  version: 1,
} as const

describe('Artifact runtime contracts', () => {
  it('accepts scoped Artifact resources and pages', () => {
    expect(ArtifactDtoSchema.parse(artifact)).toEqual(artifact)
    expect(ArtifactListResponseSchema.parse({
      organizationId: artifact.organizationId,
      spaceId: artifact.spaceId,
      sessionId: artifact.sessionId,
      items: [artifact],
      page: { nextCursor: null, hasMore: false },
    }).items).toEqual([artifact])
  })

  it('normalizes strict create and update inputs', () => {
    expect(CreateArtifactRequestSchema.parse({
      type: 'link',
      label: '  Production trace  ',
      url: '  https://observability.example.com/traces/123  ',
    })).toEqual({
      type: 'link',
      label: 'Production trace',
      url: 'https://observability.example.com/traces/123',
      attributes: {},
    })
    expect(UpdateArtifactRequestSchema.parse({ status: null })).toEqual({ status: null })
    expect(UpdateArtifactRequestSchema.safeParse({}).success).toBe(false)
    expect(UpdateArtifactRequestSchema.safeParse({ label: 'PR', type: 'commit' }).success).toBe(false)
  })

  it('rejects unsafe URLs and incomplete external identities', () => {
    for (const url of [
      'http://example.com/pr/42',
      'https://user:secret@example.com/pr/42',
      'https://localhost/pr/42',
      'https://worker.local/pr/42',
    ]) {
      expect(CreateArtifactRequestSchema.safeParse({
        type: 'link', label: 'Unsafe link', url,
      }).success).toBe(false)
    }
    expect(CreateArtifactRequestSchema.safeParse({
      type: 'pull_request', provider: 'github', label: 'PR', url: artifact.url,
    }).success).toBe(false)
  })

  it('accepts redacted Artifact lifecycle events', () => {
    const base = {
      organizationId: artifact.organizationId,
      spaceId: artifact.spaceId,
      sessionId: artifact.sessionId,
      actorId: 'user-123',
      commandId: null,
      requestId: 'request-123',
      resourceType: 'artifact',
      resourceId: artifact.id,
      occurredAt: artifact.updatedAt,
    } as const
    const payload = {
      artifactId: artifact.id,
      type: artifact.type,
      label: artifact.label,
      status: artifact.status,
      version: 1,
      removedAt: null,
    } as const

    expect(SessionEventDtoSchema.parse({
      ...base, eventId: 'event-create', sequence: 1, type: 'artifact.created', payload,
    }).payload).toEqual(payload)
    expect(SessionEventDtoSchema.safeParse({
      ...base, eventId: 'event-remove', sequence: 2, type: 'artifact.removed', payload,
    }).success).toBe(false)
    expect(SessionEventDtoSchema.parse({
      ...base,
      eventId: 'event-remove',
      sequence: 2,
      type: 'artifact.removed',
      payload: { ...payload, version: 2, removedAt: artifact.updatedAt },
    }).type).toBe('artifact.removed')
  })
})
