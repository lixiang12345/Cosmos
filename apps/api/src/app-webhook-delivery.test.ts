import type { AutomationEventDto } from '@cosmos/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import {
  EmptyAutomationRepository,
  type AutomationEventMatchResult,
  type AutomationRepository,
} from './automation-repository.js'
import {
  EmptyWebhookRepository,
  type WebhookRepository,
} from './webhook-repository.js'

const organizationId = 'cosmos'
const spaceId = 'platform'
const webhookId = 'webhook-1'
const deliveryPath = `/api/v1/webhook-deliveries/${webhookId}`

const event: AutomationEventDto = {
  id: 'event-1',
  organizationId,
  spaceId,
  source: 'webhook',
  eventType: 'delivery',
  externalId: `${webhookId}:delivery-1`,
  headers: { webhookId },
  payload: { alert: 'cpu' },
  payloadHash: 'a'.repeat(64),
  status: 'ignored',
  automationId: null,
  sessionId: null,
  matchExplanation: 'No active Automation matched the event.',
  errorCode: null,
  errorMessage: null,
  receivedAt: '2026-07-26T10:00:00.000Z',
  processedAt: '2026-07-26T10:00:00.000Z',
}

function webhookRepository(overrides: Partial<WebhookRepository> = {}): WebhookRepository {
  const base = new EmptyWebhookRepository()
  return Object.assign(base, {
    resolveDelivery: vi.fn(async (id: string, secret: string) => (
      id === webhookId && secret === 'whsec_valid'
        ? { organizationId, spaceId, createdBy: 'user-owner' }
        : null
    )),
    recordDelivery: vi.fn(async () => undefined),
    ...overrides,
  })
}

function automationRepository(overrides: Partial<AutomationRepository> = {}): AutomationRepository {
  const base = new EmptyAutomationRepository()
  return Object.assign(base, {
    receiveEvent: vi.fn(async () => ({ event, duplicate: false, match: null })),
    deferDispatch: vi.fn(async () => null),
    failDispatch: vi.fn(async () => null),
    ...overrides,
  })
}

function application(
  webhooks: WebhookRepository = webhookRepository(),
  automations: AutomationRepository = automationRepository(),
) {
  return createApp({ webhookRepository: webhooks, automationRepository: automations })
}

afterEach(() => vi.restoreAllMocks())

describe('Webhook delivery endpoint', () => {
  it('rejects missing, unknown, and wrong credentials identically', async () => {
    const app = application()
    const missing = await app.inject({ method: 'POST', url: deliveryPath, payload: { a: 1 } })
    const wrong = await app.inject({
      method: 'POST', url: deliveryPath, payload: { a: 1 },
      headers: { authorization: 'Bearer whsec_wrong' },
    })
    const unknown = await app.inject({
      method: 'POST', url: '/api/v1/webhook-deliveries/other', payload: { a: 1 },
      headers: { authorization: 'Bearer whsec_valid' },
    })

    for (const response of [missing, wrong, unknown]) {
      expect(response.statusCode).toBe(401)
      expect(response.json().code).toBe('UNAUTHENTICATED')
    }
  })

  it('accepts an authenticated delivery, records it, and reports the event receipt', async () => {
    const webhooks = webhookRepository()
    const automations = automationRepository()
    const app = application(webhooks, automations)

    const response = await app.inject({
      method: 'POST',
      url: deliveryPath,
      payload: { alert: 'cpu', value: 97 },
      headers: {
        authorization: 'Bearer whsec_valid',
        'x-event-type': 'alert.fired',
        'x-delivery-id': 'delivery-1',
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ eventId: event.id, duplicate: false })
    expect(automations.receiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      spaceId,
      actorId: 'user-owner',
      request: expect.objectContaining({
        source: 'webhook',
        eventType: 'alert.fired',
        externalId: `${webhookId}:delivery-1`,
      }),
    }))
    expect(webhooks.recordDelivery).toHaveBeenCalledWith(organizationId, spaceId, webhookId)
  })

  it('replays duplicates with 200 and skips the delivery counter', async () => {
    const webhooks = webhookRepository()
    const automations = automationRepository({
      receiveEvent: vi.fn(async () => ({ event, duplicate: true, match: null })),
    })
    const app = application(webhooks, automations)

    const response = await app.inject({
      method: 'POST',
      url: deliveryPath,
      payload: { alert: 'cpu' },
      headers: { authorization: 'Bearer whsec_valid', 'x-delivery-id': 'delivery-1' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ eventId: event.id, duplicate: true })
    expect(response.headers['idempotency-replayed']).toBe('true')
    expect(webhooks.recordDelivery).not.toHaveBeenCalled()
  })

  it('rejects non-object payloads before touching the pipeline', async () => {
    const automations = automationRepository()
    const app = application(webhookRepository(), automations)

    const response = await app.inject({
      method: 'POST',
      url: deliveryPath,
      payload: [1, 2, 3],
      headers: { authorization: 'Bearer whsec_valid' },
    })

    expect(response.statusCode).toBe(400)
    expect(automations.receiveEvent).not.toHaveBeenCalled()
  })
})

describe('Automation dispatch retry pipeline', () => {
  const matchedEvent: AutomationEventDto = { ...event, status: 'matched', automationId: 'automation-1' }
  const match: NonNullable<AutomationEventMatchResult['match']> = {
    automation: {
      id: 'automation-1', organizationId, spaceId, expertId: 'expert-1', expertRevisionId: 'expert-revision-1',
      triggerId: 'automation-1',
      name: 'On alert', source: 'webhook' as const, eventType: 'alert.fired', filter: {},
      scheduleCron: null, scheduleTimezone: null, maxRunsPerMinute: 10,
      status: 'active' as const, autoArchive: false, serviceAccountId: 'sa-1',
      lastTestedAt: null, lastMatchedAt: null, archivedAt: null, matchCount: 1, version: 1,
      createdAt: matchedEvent.receivedAt, updatedAt: matchedEvent.receivedAt,
    },
    serviceAccountAudience: 'audience-1',
  }

  it('defers a failed dispatch instead of finalizing it', async () => {
    const automations = automationRepository({
      receiveEvent: vi.fn(async () => ({ event: matchedEvent, duplicate: false, match })),
      deferDispatch: vi.fn(async () => ({ ...matchedEvent, errorCode: 'automation_dispatch_failed', errorMessage: 'x' })),
    })
    const app = application(webhookRepository(), automations)

    const response = await app.inject({
      method: 'POST',
      url: deliveryPath,
      payload: { alert: 'cpu' },
      headers: { authorization: 'Bearer whsec_valid', 'x-delivery-id': 'delivery-retry' },
    })

    expect(response.statusCode).toBe(202)
    expect(automations.deferDispatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId, spaceId, eventId: matchedEvent.id, maxAttempts: 5,
    }))
    expect(automations.failDispatch).not.toHaveBeenCalled()
  })

  it('sweeps due retries and finalizes unresolvable ones', async () => {
    const automations = automationRepository({
      claimDispatchRetries: vi.fn(async () => [
        { organizationId, spaceId, eventId: matchedEvent.id, receivedBy: 'user-owner' },
      ]),
      resolveRetryMatch: vi.fn(async () => null),
      failDispatch: vi.fn(async () => ({ ...matchedEvent, status: 'failed' as const })),
    })
    const app = application(webhookRepository(), automations) as ReturnType<typeof application> & {
      sweepAutomationDispatchRetries: () => Promise<number>
    }

    await app.ready()
    await app.sweepAutomationDispatchRetries()

    expect(automations.resolveRetryMatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId, spaceId, eventId: matchedEvent.id, actorId: 'user-owner',
    }))
    expect(automations.failDispatch).toHaveBeenCalledWith(expect.objectContaining({
      code: 'automation_retry_unresolvable',
    }))
  })
})
