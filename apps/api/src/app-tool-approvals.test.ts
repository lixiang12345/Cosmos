import type { ApprovalDto, MeOrganization, ToolCallDto } from '@cosmos/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator } from './auth.js'
import { InMemorySessionRepository } from './session-repository.js'
import {
  ApprovalAlreadyDecidedError,
  ApprovalPermissionDeniedError,
  ApprovalVersionConflictError,
  type ToolApprovalRepository,
} from './tool-approval-repository.js'

const organizationId = 'cosmos'
const spaceId = 'platform'
const sessionId = 'session-1'
const actorId = 'reviewer-1'
const toolCall: ToolCallDto = {
  organizationId,
  spaceId,
  sessionId,
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  id: 'tool-call-1',
  workerId: 'worker-1',
  toolName: 'github',
  operation: 'merge_pull_request',
  riskLevel: 'high',
  status: 'approval_required',
  inputSummary: 'Merge cosmos/cosmos#42 into main.',
  outputSummary: null,
  approvalId: 'approval-1',
  createdAt: '2026-07-13T01:00:00.000Z',
  startedAt: null,
  completedAt: null,
  version: 2,
}
const approval: ApprovalDto = {
  organizationId,
  spaceId,
  id: 'approval-1',
  sessionId,
  turnId: toolCall.turnId,
  toolCallId: toolCall.id,
  action: 'Merge pull request #42',
  riskLevel: 'high',
  reasons: ['Protected branch write', 'Production deployment follows merge'],
  evidence: [{ type: 'test', label: 'CI', value: 'All required checks passed' }],
  status: 'pending',
  requestedBy: 'requester-1',
  assignedTo: [actorId],
  requiredApprovals: 1,
  approvalCount: 0,
  actorHasDecided: false,
  expiresAt: '2026-07-14T01:00:00.000Z',
  decidedBy: null,
  decisionNote: null,
  decidedAt: null,
  createdAt: toolCall.createdAt,
  updatedAt: toolCall.createdAt,
  version: 1,
}
const organizations: MeOrganization[] = [{
  id: organizationId,
  name: 'Cosmos',
  role: 'member',
  spaces: [{ id: spaceId, name: 'Platform', role: 'member' }],
}]

function repository(overrides: Partial<ToolApprovalRepository> = {}): ToolApprovalRepository {
  return {
    async listToolCalls() {
      return { items: [toolCall], hasMore: false, nextCursor: null }
    },
    async listApprovals() {
      return { items: [approval], hasMore: false, nextCursor: null }
    },
    async getApproval() {
      return approval
    },
    async decideApproval() {
      return {
        approval: {
          ...approval,
          status: 'approved',
          approvalCount: 1,
          decidedBy: actorId,
          decisionNote: 'Evidence reviewed.',
          decidedAt: '2026-07-13T02:00:00.000Z',
          updatedAt: '2026-07-13T02:00:00.000Z',
          version: 2,
        },
        replayed: false,
      }
    },
    ...overrides,
  }
}

function application(
  toolApprovalRepository: ToolApprovalRepository,
  authenticate = createDevelopmentAuthenticator(actorId),
) {
  return createApp({
    authenticate,
    toolApprovalRepository,
    sessionRepository: new InMemorySessionRepository({
      actorOrganizations: { [actorId]: organizations },
    }),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ToolCall and Approval API', () => {
  it('lists redacted ToolCalls with a filter-bound cursor', async () => {
    const listToolCalls = vi.fn<ToolApprovalRepository['listToolCalls']>(async () => ({
      items: [toolCall],
      hasMore: true,
      nextCursor: { createdAt: toolCall.createdAt, id: toolCall.id },
    }))
    const app = application(repository({ listToolCalls }))
    const base = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/sessions/${sessionId}/tool-calls`
    const first = await app.inject({ method: 'GET', url: `${base}?limit=1&status=approval_required` })
    const cursor = first.json().page.nextCursor as string
    const second = await app.inject({
      method: 'GET',
      url: `${base}?limit=1&status=approval_required&cursor=${encodeURIComponent(cursor)}`,
    })
    const crossFilter = await app.inject({
      method: 'GET',
      url: `${base}?status=running&cursor=${encodeURIComponent(cursor)}`,
    })

    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ items: [{ id: toolCall.id }], page: { hasMore: true } })
    expect(second.statusCode).toBe(200)
    expect(crossFilter.statusCode).toBe(400)
    expect(listToolCalls).toHaveBeenLastCalledWith(
      organizationId,
      spaceId,
      sessionId,
      actorId,
      expect.objectContaining({
        limit: 1,
        status: 'approval_required',
        cursor: { createdAt: toolCall.createdAt, id: toolCall.id },
      }),
    )
    await app.close()
  })

  it('lists assigned pending Approvals and returns version metadata', async () => {
    const listApprovals = vi.fn<ToolApprovalRepository['listApprovals']>(async () => ({
      items: [approval], hasMore: false, nextCursor: null,
    }))
    const app = application(repository({ listApprovals }))
    const base = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/approvals`
    const list = await app.inject({
      method: 'GET',
      url: `${base}?status=pending&assignedToMe=true&sessionId=${sessionId}`,
    })
    const detail = await app.inject({ method: 'GET', url: `${base}/${approval.id}` })

    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ items: [{ id: approval.id, assignedTo: [actorId] }] })
    expect(listApprovals).toHaveBeenCalledWith(organizationId, spaceId, actorId, {
      limit: 25, status: 'pending', assignedToMe: true, sessionId,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.headers.etag).toBe('"1"')
    await app.close()
  })

  it('requires idempotency and If-Match before recording a decision', async () => {
    const decideApproval = vi.fn<ToolApprovalRepository['decideApproval']>()
    const app = application(repository({ decideApproval }))
    const url = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/approvals/${approval.id}/decision`
    const missingKey = await app.inject({
      method: 'POST', url, headers: { 'if-match': '"1"' }, payload: { decision: 'approved' },
    })
    const missingVersion = await app.inject({
      method: 'POST', url, headers: { 'idempotency-key': 'decision-1' }, payload: { decision: 'approved' },
    })

    expect(missingKey.statusCode).toBe(400)
    expect(missingKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
    expect(missingVersion.statusCode).toBe(428)
    expect(decideApproval).not.toHaveBeenCalled()
    await app.close()
  })

  it('records a one-shot decision and maps concurrency and policy failures', async () => {
    const base = `/api/v1/organizations/${organizationId}/spaces/${spaceId}/approvals/${approval.id}/decision`
    const approveApp = application(repository())
    const approved = await approveApp.inject({
      method: 'POST',
      url: base,
      headers: { 'idempotency-key': 'decision-1', 'if-match': '"1"' },
      payload: { decision: 'approved', note: 'Evidence reviewed.' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.headers.etag).toBe('"2"')
    expect(approved.json()).toMatchObject({ status: 'approved', decidedBy: actorId })
    await approveApp.close()

    for (const [error, statusCode, code] of [
      [new ApprovalVersionConflictError(1, 2), 412, 'PRECONDITION_FAILED'],
      [new ApprovalAlreadyDecidedError('rejected'), 409, 'APPROVAL_ALREADY_DECIDED'],
      [new ApprovalPermissionDeniedError(), 403, 'PERMISSION_DENIED'],
    ] as const) {
      const app = application(repository({ decideApproval: async () => { throw error } }))
      const response = await app.inject({
        method: 'POST', url: base,
        headers: { 'idempotency-key': `decision-${code}`, 'if-match': '"1"' },
        payload: { decision: 'approved' },
      })
      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toMatchObject({ code })
      await app.close()
    }
  })

  it('denies Service Accounts before calling Approval repositories', async () => {
    const listApprovals = vi.fn<ToolApprovalRepository['listApprovals']>()
    const app = application(
      repository({ listApprovals }),
      async () => ({ id: actorId, kind: 'service_account', audience: 'cosmos-api' }),
    )
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}/spaces/${spaceId}/approvals`,
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(listApprovals).not.toHaveBeenCalled()
    await app.close()
  })
})
