import { describe, expect, it } from 'vitest'
import {
  RuntimeCapabilitiesSchema,
  AttemptDtoSchema,
  SessionEventCursorSchema,
  SessionEventDtoSchema,
  SessionEventPageSchema,
  SessionMessagePageSchema,
  SessionTurnSchema,
} from '../src/index.js'

const scope = {
  organizationId: 'organization-relay',
  spaceId: 'space-commerce',
  sessionId: 'session-123',
} as const

const eventBase = {
  ...scope,
  eventId: 'event-1',
  sequence: 1,
  actorId: 'user-123',
  commandId: 'command-123',
  requestId: 'request-123',
  occurredAt: '2026-07-13T08:00:00.000Z',
} as const

const messageEvent = {
  ...eventBase,
  type: 'message.created',
  resourceType: 'message',
  resourceId: 'message-123',
  payload: { messageId: 'message-123' },
} as const

describe('conversation runtime contracts', () => {
  it('publishes an explicit execution and event transport capability', () => {
    expect(RuntimeCapabilitiesSchema.parse({
      execution: { enabled: true, events: 'sse' },
    })).toEqual({ execution: { enabled: true, events: 'sse' } })
    expect(RuntimeCapabilitiesSchema.safeParse({
      execution: { enabled: true, events: 'websocket' },
    }).success).toBe(false)
  })

  it('accepts actor identifiers up to the OIDC subject limit', () => {
    const actorId = `user-${'a'.repeat(251)}`
    expect(SessionMessagePageSchema.parse({
      ...scope,
      items: [{
        ...scope,
        id: 'message-long-actor',
        sequence: 1,
        role: 'user',
        actorId,
        content: 'Long actor subject.',
        attachments: [],
        createdAt: eventBase.occurredAt,
      }],
      page: { nextCursor: null, hasMore: false },
    }).items[0]?.actorId).toBe(actorId)
    expect(SessionEventDtoSchema.parse({ ...messageEvent, actorId }).actorId).toBe(actorId)
    expect(SessionTurnSchema.parse({
      id: 'turn-long-actor',
      sessionId: scope.sessionId,
      ordinal: 1,
      initiatorType: 'user',
      initiatorId: actorId,
      inputMessageId: 'message-long-actor',
      status: 'queued',
      queuedAt: eventBase.occurredAt,
      version: 1,
    }).initiatorId).toBe(actorId)
  })

  it('accepts a scoped, redacted message event and ordered event page', () => {
    const event = SessionEventDtoSchema.parse(messageEvent)

    expect(SessionEventPageSchema.parse({
      ...scope,
      items: [event],
      page: {
        nextCursor: { ...scope, sequence: event.sequence },
        hasMore: true,
      },
    }).items).toEqual([event])
  })

  it('keeps Message content out of message.created events', () => {
    expect(SessionEventDtoSchema.safeParse({
      ...messageEvent,
      payload: { messageId: 'message-123', content: 'secret prompt' },
    }).success).toBe(false)
  })

  it('accepts a redacted Session status update event', () => {
    expect(SessionEventDtoSchema.parse({
      ...eventBase,
      type: 'session.updated',
      resourceType: 'session',
      resourceId: scope.sessionId,
      payload: { status: 'canceled', version: 2 },
    }).payload).toEqual({ status: 'canceled', version: 2 })
  })

  it('validates scoped Message pages with full content in the Messages API only', () => {
    const message = {
      ...scope,
      id: 'message-123',
      sequence: 1,
      role: 'agent',
      actorId: null,
      content: 'The checkout latency comes from the inventory call.',
      attachments: [],
      createdAt: '2026-07-13T08:00:01.000Z',
    } as const

    expect(SessionMessagePageSchema.parse({
      ...scope,
      items: [message],
      page: { nextCursor: null, hasMore: false },
    }).items).toEqual([message])
    expect(SessionMessagePageSchema.safeParse({
      ...scope,
      items: [{ ...message, sequence: 0 }],
      page: { nextCursor: null, hasMore: false },
    }).success).toBe(false)
  })

  it('accepts failed Attempts with terminal time and a failure code', () => {
    const model = 'm'.repeat(256)
    const attempt = AttemptDtoSchema.parse({
      ...scope,
      id: 'attempt-1',
      turnId: 'turn-1',
      number: 1,
      status: 'failed',
      model,
      providerModel: 'provider-model-20260701',
      runtimeId: 'runtime-1',
      failureCode: 'MODEL_TIMEOUT',
      createdAt: '2026-07-13T08:00:00.000Z',
      startedAt: '2026-07-13T08:00:01.000Z',
      finishedAt: '2026-07-13T08:01:00.000Z',
    })
    expect(attempt.failureCode).toBe('MODEL_TIMEOUT')
    expect(attempt.model).toBe(model)
    expect(attempt.providerModel).toBe('provider-model-20260701')
  })

  it('rejects invalid status, sequence, missing tenant scope, and inconsistent failure state', () => {
    const attempt = {
      ...scope,
      id: 'attempt-1',
      turnId: 'turn-1',
      number: 1,
      status: 'running',
      model: 'gpt-runtime',
      providerModel: null,
      runtimeId: 'runtime-1',
      failureCode: null,
      createdAt: '2026-07-13T08:00:00.000Z',
      startedAt: '2026-07-13T08:00:01.000Z',
      finishedAt: null,
    } as const

    expect(AttemptDtoSchema.safeParse({ ...attempt, status: 'unknown' }).success).toBe(false)
    expect(AttemptDtoSchema.safeParse({ ...attempt, organizationId: undefined }).success).toBe(false)
    expect(AttemptDtoSchema.safeParse({ ...attempt, providerModel: 'm'.repeat(257) }).success).toBe(false)
    expect(AttemptDtoSchema.safeParse({
      ...attempt,
      status: 'failed',
      finishedAt: '2026-07-13T08:01:00.000Z',
    }).success).toBe(false)
    expect(SessionEventDtoSchema.safeParse({ ...messageEvent, sequence: 0 }).success).toBe(false)
    expect(SessionEventCursorSchema.safeParse({ ...scope, organizationId: undefined, sequence: 0 }).success)
      .toBe(false)
  })
})
