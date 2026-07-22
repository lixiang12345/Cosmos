import { describe, expect, it } from 'vitest'
import {
  AutomationDtoSchema,
  AutomationFilterSchema,
  CreateAutomationRequestSchema,
  ReceiveAutomationEventRequestSchema,
} from '../src/automation.js'

describe('Automation contracts', () => {
  it('accepts restricted JSONLogic filters and rejects arbitrary operators', () => {
    expect(AutomationFilterSchema.parse({ '==': [{ var: 'action' }, 'opened'] })).toEqual({
      '==': [{ var: 'action' }, 'opened'],
    })
    expect(() => AutomationFilterSchema.parse({ execute: 'return true' })).toThrow()
    expect(() => AutomationFilterSchema.parse({ and: [] })).toThrow()
  })

  it('defaults new Triggers to a paused, non-archiving configuration', () => {
    const request = CreateAutomationRequestSchema.parse({
      expertId: 'expert-1',
      name: 'Pull request triage',
      source: 'github',
      eventType: 'pull_request.opened',
      serviceAccountId: 'service-account-1',
    })
    expect(request.filter).toEqual({})
    expect(request.autoArchive).toBe(false)
  })

  it('requires an object payload and a tenant-scoped immutable event shape', () => {
    expect(() => ReceiveAutomationEventRequestSchema.parse({
      source: 'github', eventType: 'pull_request.opened', externalId: 'event-1', payload: [],
    })).toThrow()
    expect(() => AutomationDtoSchema.parse({
      id: 'trigger-1', triggerId: 'trigger-2', organizationId: 'org', spaceId: 'space',
      expertId: 'expert', expertRevisionId: 'revision', name: 'Trigger', source: 'github',
      eventType: 'pull_request.opened', filter: {}, status: 'paused', autoArchive: false,
      serviceAccountId: 'service-account', lastTestedAt: null, lastMatchedAt: null, archivedAt: null,
      matchCount: 0, version: 1, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    })).toThrow()
  })

  it('requires an archive timestamp exactly for terminal archived Triggers', () => {
    const base = {
      id: 'trigger-1', triggerId: 'trigger-1', organizationId: 'org', spaceId: 'space',
      expertId: 'expert', expertRevisionId: 'revision', name: 'Trigger', source: 'github' as const,
      eventType: 'pull_request.opened', filter: {}, autoArchive: false,
      serviceAccountId: 'service-account', lastTestedAt: null, lastMatchedAt: null,
      matchCount: 0, version: 2, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T01:00:00.000Z',
    }
    expect(AutomationDtoSchema.parse({
      ...base, status: 'archived', archivedAt: '2026-07-22T01:00:00.000Z',
    }).status).toBe('archived')
    expect(() => AutomationDtoSchema.parse({ ...base, status: 'archived', archivedAt: null })).toThrow()
    expect(() => AutomationDtoSchema.parse({ ...base, status: 'paused', archivedAt: '2026-07-22T01:00:00.000Z' })).toThrow()
  })
})
