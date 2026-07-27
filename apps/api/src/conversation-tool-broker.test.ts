import type { AdvisorPlanDto, FileDto, FileVersionDto, ToolCallDto } from '@cosmos/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovedWebhookClient } from './approved-webhook-client.js'
import type { FileRepository } from './file-repository.js'
import type { AdvisorPlanRepository } from './advisor-plan-repository.js'
import {
  GovernedConversationToolBroker,
  type ConversationToolContext,
} from './conversation-tool-broker.js'
import type { ToolCoordinatorRepository } from './tool-coordinator-repository.js'

const context: ConversationToolContext = {
  organizationId: 'organization-a',
  spaceId: 'space-a',
  sessionId: 'session-a',
  turnId: 'turn-a',
  attemptId: 'attempt-a',
  workerId: 'worker-a',
  requestedBy: 'user-a',
  requestedByKind: 'user',
  requestId: 'request-a',
}

const toolCall = (
  status: ToolCallDto['status'],
  version: number,
  overrides: Partial<ToolCallDto> = {},
): ToolCallDto => ({
  organizationId: context.organizationId,
  spaceId: context.spaceId,
  sessionId: context.sessionId,
  turnId: context.turnId,
  attemptId: context.attemptId,
  id: 'tool-call-a',
  workerId: context.workerId,
  toolName: 'workspace_files_list',
  operation: 'list',
  riskLevel: 'low',
  status,
  inputSummary: 'List workspace files.',
  outputSummary: status === 'succeeded' ? 'Listed workspace files.' : null,
  approvalId: null,
  createdAt: '2026-07-13T08:00:00.000Z',
  startedAt: status === 'queued' ? null : '2026-07-13T08:00:01.000Z',
  completedAt: ['succeeded', 'failed', 'canceled'].includes(status)
    ? '2026-07-13T08:00:02.000Z'
    : null,
  version,
  ...overrides,
})

const file: FileDto = {
  organizationId: context.organizationId,
  spaceId: context.spaceId,
  id: 'file-a',
  scope: 'workspace',
  ownerUserId: null,
  sessionId: context.sessionId,
  path: 'src/index.ts',
  mimeType: 'text/typescript',
  size: 20,
  latestVersionId: 'file-version-a',
  lastWrittenByToolCallId: 'previous-tool',
  lastWrittenByExpertId: 'expert-a',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
  archivedAt: null,
  version: 1,
}

const fileVersion: FileVersionDto = {
  organizationId: context.organizationId,
  spaceId: context.spaceId,
  fileId: file.id,
  id: file.latestVersionId,
  version: 1,
  contentHash: 'a'.repeat(64),
  size: file.size,
  createdByToolCallId: file.lastWrittenByToolCallId,
  sourceSessionId: context.sessionId,
  sourceTurnId: context.turnId,
  createdAt: file.createdAt,
}

const advisorPlan: AdvisorPlanDto = {
  organizationId: context.organizationId, spaceId: context.spaceId,
  sessionId: context.sessionId, id: 'advisor-plan-a',
  summary: 'Update the Space description.', dependencies: [], risks: [], status: 'proposed',
  steps: [{
    id: 'advisor-step-a', ordinal: 1, kind: 'control_plane', operation: 'space.update',
    targetType: 'space', targetId: context.spaceId, rationale: 'Clarify ownership.',
    before: { name: 'Space A', description: '', defaultExpertId: null, defaultEnvironmentId: null, isDefault: false, version: 1 },
    after: { name: 'Space A', description: 'Delivery Space.', defaultExpertId: null, defaultEnvironmentId: null, isDefault: false, version: 2 },
    manualAction: null, riskLevel: 'medium', status: 'proposed', failureCode: null,
    failureMessage: null, startedAt: null, completedAt: null, version: 1,
  }],
  requestedBy: context.requestedBy, confirmedBy: null, confirmedAt: null,
  createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z', version: 1,
}

function advisorPlans(): AdvisorPlanRepository {
  return {
    proposePlan: vi.fn().mockResolvedValue(advisorPlan),
    listPlans: vi.fn(), getPlan: vi.fn(), decidePlan: vi.fn(), prepareRetry: vi.fn(),
    startStep: vi.fn(), finishStep: vi.fn(), finishPlan: vi.fn(),
  }
}

function coordinator(): ToolCoordinatorRepository {
  return {
    createToolCall: vi.fn().mockResolvedValue(toolCall('queued', 1)),
    getToolCall: vi.fn(),
    expireApproval: vi.fn(),
    reapExpiredApprovals: vi.fn().mockResolvedValue(0),
    requestApproval: vi.fn(),
    startToolCall: vi.fn().mockResolvedValue(toolCall('running', 2)),
    finishToolCall: vi.fn().mockImplementation(async (record) => (
      toolCall(record.status, 3)
    )),
    prepareSideEffect: vi.fn(),
    resolveSideEffect: vi.fn(),
  }
}

function files(overrides: Partial<FileRepository> = {}): FileRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [file], hasMore: false, nextCursor: null }),
    get: vi.fn().mockResolvedValue(file),
    listVersions: vi.fn(),
    getContent: vi.fn().mockResolvedValue({
      file,
      version: fileVersion,
      content: Buffer.from('export const value = 1'),
    }),
    ...overrides,
  }
}

describe('GovernedConversationToolBroker', () => {
  it('lists only the current Session workspace through an audited low-risk ToolCall', async () => {
    const toolCoordinator = coordinator()
    const fileRepository = files()
    const broker = new GovernedConversationToolBroker(toolCoordinator, fileRepository)

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-tool-a',
      name: 'workspace_files_list',
      input: { prefix: 'src/', limit: 5 },
    }, 1)

    expect(toolCoordinator.createToolCall).toHaveBeenCalledWith(expect.objectContaining({
      riskLevel: 'low',
      operation: 'list',
      input: { prefix: 'src/', limit: 5 },
      requestedBy: context.requestedBy,
      requestedByKind: 'user',
    }))
    expect(fileRepository.list).toHaveBeenCalledWith(
      context.organizationId,
      context.spaceId,
      context.requestedBy,
      { scope: 'workspace', sessionId: context.sessionId, prefix: 'src/', limit: 5 },
    )
    expect(toolCoordinator.finishToolCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded', expectedVersion: 2,
    }))
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      files: [{
        id: file.id,
        path: file.path,
        mimeType: file.mimeType,
        size: file.size,
        version: file.version,
        updatedAt: file.updatedAt,
      }],
      hasMore: false,
    })
  })

  it('records invalid arguments as a failed ToolCall without reaching the File repository', async () => {
    const toolCoordinator = coordinator()
    const fileRepository = files()
    const broker = new GovernedConversationToolBroker(toolCoordinator, fileRepository)

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-tool-invalid',
      name: 'workspace_files_list',
      input: { limit: 0, unexpected: true },
    }, 1)

    expect(fileRepository.list).not.toHaveBeenCalled()
    expect(toolCoordinator.finishToolCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      output: expect.objectContaining({ ok: false }),
    }))
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })
  })

  it('reads bounded UTF-8 text by immutable version and returns content to the Provider', async () => {
    const toolCoordinator = coordinator()
    const fileRepository = files()
    const broker = new GovernedConversationToolBroker(toolCoordinator, fileRepository)

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-tool-read',
      name: 'workspace_file_read',
      input: { fileId: file.id, version: 1 },
    }, 2)

    expect(fileRepository.getContent).toHaveBeenCalledWith(
      context.organizationId,
      context.spaceId,
      file.id,
      context.requestedBy,
      1,
    )
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      file: { id: file.id, path: file.path },
      version: 1,
      content: 'export const value = 1',
    })
  })

  it('persists an Advisor proposal without applying the control-plane change', async () => {
    const repository = advisorPlans()
    const toolCoordinator = coordinator()
    const broker = new GovernedConversationToolBroker(toolCoordinator, files(), repository)
    const proposal = {
      summary: 'Update the Space description.', dependencies: [], risks: [],
      steps: [{
        kind: 'control_plane' as const, operation: 'space.update' as const,
        changes: { description: 'Delivery Space.' }, rationale: 'Clarify ownership.',
      }],
    }
    const result = await broker.execute(context, {
      providerToolCallId: 'provider-advisor-plan', name: 'advisor_plan_propose', input: proposal,
    }, 1)

    expect(broker.definitions.map(({ name }) => name)).toContain('advisor_plan_propose')
    expect(repository.proposePlan).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      actorId: context.requestedBy,
      providerToolCallId: 'provider-advisor-plan',
      proposal,
    }))
    expect(toolCoordinator.createToolCall).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'propose', riskLevel: 'low',
    }))
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true, planId: advisorPlan.id, status: 'proposed',
    })
  })

  it('fails closed for binary, oversized, inaccessible, and repository-error reads', async () => {
    const escapedFile = { ...file, size: 20_000 }
    const cases: Array<[string, FileRepository, string]> = [
      ['binary', files({ get: vi.fn().mockResolvedValue({ ...file, mimeType: 'application/octet-stream' }) }), 'unsupported_media_type'],
      ['oversized', files({ get: vi.fn().mockResolvedValue({ ...file, size: 65_537 }) }), 'content_too_large'],
      ['escaped result', files({
        get: vi.fn().mockResolvedValue(escapedFile),
        getContent: vi.fn().mockResolvedValue({
          file: escapedFile,
          version: { ...fileVersion, size: escapedFile.size },
          content: Buffer.alloc(escapedFile.size),
        }),
      }), 'content_too_large'],
      ['inaccessible', files({ get: vi.fn().mockResolvedValue(null) }), 'not_found'],
      ['repository error', files({ get: vi.fn().mockRejectedValue(new Error('database secret')) }), 'tool_unavailable'],
    ]

    for (const [label, repository, code] of cases) {
      const result = await new GovernedConversationToolBroker(coordinator(), repository).execute(
        context,
        {
          providerToolCallId: `provider-tool-${label}`,
          name: 'workspace_file_read',
          input: { fileId: file.id },
        },
        1,
      )
      expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: { code } })
      expect(result.content).not.toContain('database secret')
    }
  })

  it('waits for independent Approval before one idempotent configured Webhook write', async () => {
    const toolCoordinator = coordinator()
    const approved = toolCall('queued', 3, {
      toolName: 'approved_webhook_delivery',
      operation: 'deliver',
      riskLevel: 'high',
      approvalId: 'approval-a',
    })
    vi.mocked(toolCoordinator.requestApproval).mockResolvedValue({
      toolCall: toolCall('approval_required', 2, {
        toolName: 'approved_webhook_delivery', operation: 'deliver', riskLevel: 'high', approvalId: 'approval-a',
      }),
      approval: {} as never,
    })
    vi.mocked(toolCoordinator.getToolCall).mockResolvedValue(approved)
    vi.mocked(toolCoordinator.startToolCall).mockResolvedValue(toolCall('running', 4, {
      toolName: 'approved_webhook_delivery', operation: 'deliver', riskLevel: 'high', approvalId: 'approval-a',
    }))
    vi.mocked(toolCoordinator.prepareSideEffect).mockResolvedValue({
      organizationId: context.organizationId, spaceId: context.spaceId, sessionId: context.sessionId,
      toolCallId: 'tool-call-a', id: 'side-effect-a', provider: 'configured_webhook',
      operation: 'deliver_verification_event', status: 'prepared', providerOperationId: null,
      resultSummary: null, createdAt: '2026-07-13T08:00:00.000Z',
      updatedAt: '2026-07-13T08:00:00.000Z', version: 1,
    })
    vi.mocked(toolCoordinator.resolveSideEffect).mockImplementation(async (record) => ({
      organizationId: context.organizationId, spaceId: context.spaceId, sessionId: context.sessionId,
      toolCallId: 'tool-call-a', id: 'side-effect-a', provider: 'configured_webhook',
      operation: 'deliver_verification_event', status: record.status, providerOperationId: null,
      resultSummary: record.resultSummary ?? null, createdAt: '2026-07-13T08:00:00.000Z',
      updatedAt: '2026-07-13T08:00:01.000Z', version: 2,
    }))
    const client: ApprovedWebhookClient = {
      deliver: vi.fn().mockResolvedValue({ status: 'succeeded', statusCode: 202 }),
    }
    const broker = new GovernedConversationToolBroker(
      toolCoordinator,
      files(),
      undefined,
      {
        client,
        approverIds: ['reviewer-a'],
        approvalTtlMs: 60_000,
        approvalPollIntervalMs: 1,
        now: () => new Date('2026-07-13T08:00:00.000Z'),
      },
    )

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-approved-webhook',
      name: 'approved_webhook_delivery',
      input: { label: 'staging-smoke-1' },
    }, 1)

    expect(broker.definitions.map(({ name }) => name)).toContain('approved_webhook_delivery')
    expect(toolCoordinator.createToolCall).toHaveBeenCalledWith(expect.objectContaining({
      riskLevel: 'high', operation: 'deliver', input: { label: 'staging-smoke-1' },
    }))
    expect(toolCoordinator.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      assignedTo: ['reviewer-a'], requiredApprovals: 1,
      evidence: expect.arrayContaining([
        { type: 'input', label: 'Verification label', value: 'staging-smoke-1' },
      ]),
    }))
    expect(client.deliver).toHaveBeenCalledWith({
      label: 'staging-smoke-1',
      idempotencyKey: 'attempt-a:provider-approved-webhook',
      signal: expect.any(AbortSignal),
    })
    expect(vi.mocked(toolCoordinator.prepareSideEffect).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(client.deliver).mock.invocationCallOrder[0]!)
    expect(toolCoordinator.finishToolCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded', expectedVersion: 4,
    }))
    expect(JSON.parse(result.content)).toEqual({
      ok: true, status: 'accepted', statusCode: 202, replayed: false,
    })
  })

  it('does not send when Approval is rejected', async () => {
    const toolCoordinator = coordinator()
    vi.mocked(toolCoordinator.requestApproval).mockResolvedValue({
      toolCall: toolCall('approval_required', 2, { approvalId: 'approval-a' }),
      approval: {} as never,
    })
    vi.mocked(toolCoordinator.getToolCall).mockResolvedValue(toolCall('canceled', 3, {
      approvalId: 'approval-a',
    }))
    const client: ApprovedWebhookClient = { deliver: vi.fn() }
    const broker = new GovernedConversationToolBroker(toolCoordinator, files(), undefined, {
      client, approverIds: ['reviewer-a'], approvalTtlMs: 60_000, approvalPollIntervalMs: 1,
    })

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-rejected', name: 'approved_webhook_delivery', input: { label: 'smoke' },
    }, 1)

    expect(client.deliver).not.toHaveBeenCalled()
    expect(toolCoordinator.prepareSideEffect).not.toHaveBeenCalled()
    expect(toolCoordinator.finishToolCall).not.toHaveBeenCalled()
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false, error: { code: 'approval_not_granted' },
    })
  })

  it('expires an undecided Approval and resumes without sending', async () => {
    const toolCoordinator = coordinator()
    vi.mocked(toolCoordinator.requestApproval).mockResolvedValue({
      toolCall: toolCall('approval_required', 2, { approvalId: 'approval-a' }),
      approval: {
        id: 'approval-a',
        expiresAt: '2026-07-13T08:00:01.000Z',
      } as never,
    })
    vi.mocked(toolCoordinator.getToolCall).mockResolvedValue(toolCall('approval_required', 2, {
      approvalId: 'approval-a',
    }))
    vi.mocked(toolCoordinator.expireApproval).mockResolvedValue(toolCall('canceled', 3, {
      approvalId: 'approval-a',
    }))
    const client: ApprovedWebhookClient = { deliver: vi.fn() }
    const broker = new GovernedConversationToolBroker(toolCoordinator, files(), undefined, {
      client,
      approverIds: ['reviewer-a'],
      approvalTtlMs: 1_000,
      approvalPollIntervalMs: 1,
      now: () => new Date('2026-07-13T08:00:02.000Z'),
    })

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-expired', name: 'approved_webhook_delivery', input: { label: 'smoke' },
    }, 1)

    expect(toolCoordinator.expireApproval).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: 'approval-a', workerId: context.workerId,
    }))
    expect(client.deliver).not.toHaveBeenCalled()
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false, error: { code: 'approval_not_granted' },
    })
  })

  it('records a failed ToolCall when independent Approval policy is unavailable', async () => {
    const toolCoordinator = coordinator()
    vi.mocked(toolCoordinator.requestApproval).mockRejectedValue(new Error('requester cannot approve'))
    vi.mocked(toolCoordinator.getToolCall).mockResolvedValue(toolCall('queued', 1))
    const client: ApprovedWebhookClient = { deliver: vi.fn() }
    const broker = new GovernedConversationToolBroker(toolCoordinator, files(), undefined, {
      client, approverIds: [context.requestedBy], approvalTtlMs: 60_000,
    })

    const result = await broker.execute(context, {
      providerToolCallId: 'provider-self-approval',
      name: 'approved_webhook_delivery',
      input: { label: 'smoke' },
    }, 1)

    expect(client.deliver).not.toHaveBeenCalled()
    expect(toolCoordinator.finishToolCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      output: expect.objectContaining({
        ok: false, error: expect.objectContaining({ code: 'approval_unavailable' }),
      }),
    }))
    expect(result.content).not.toContain('requester cannot approve')
  })

  it('fails the execution instead of claiming success for an unknown external side effect', async () => {
    const toolCoordinator = coordinator()
    vi.mocked(toolCoordinator.requestApproval).mockResolvedValue({
      toolCall: toolCall('approval_required', 2, { approvalId: 'approval-a' }),
      approval: {} as never,
    })
    vi.mocked(toolCoordinator.getToolCall).mockResolvedValue(toolCall('queued', 3, {
      approvalId: 'approval-a',
    }))
    vi.mocked(toolCoordinator.startToolCall).mockResolvedValue(toolCall('running', 4, {
      approvalId: 'approval-a',
    }))
    vi.mocked(toolCoordinator.prepareSideEffect).mockResolvedValue({
      organizationId: context.organizationId, spaceId: context.spaceId, sessionId: context.sessionId,
      toolCallId: 'tool-call-a', id: 'side-effect-a', provider: 'configured_webhook',
      operation: 'deliver_verification_event', status: 'prepared', providerOperationId: null,
      resultSummary: null, createdAt: '2026-07-13T08:00:00.000Z',
      updatedAt: '2026-07-13T08:00:00.000Z', version: 1,
    })
    vi.mocked(toolCoordinator.resolveSideEffect).mockResolvedValue({
      organizationId: context.organizationId, spaceId: context.spaceId, sessionId: context.sessionId,
      toolCallId: 'tool-call-a', id: 'side-effect-a', provider: 'configured_webhook',
      operation: 'deliver_verification_event', status: 'unknown', providerOperationId: null,
      resultSummary: null, createdAt: '2026-07-13T08:00:00.000Z',
      updatedAt: '2026-07-13T08:00:01.000Z', version: 2,
    })
    const client: ApprovedWebhookClient = {
      deliver: vi.fn().mockResolvedValue({ status: 'unknown', statusCode: 503 }),
    }
    const broker = new GovernedConversationToolBroker(toolCoordinator, files(), undefined, {
      client, approverIds: ['reviewer-a'], approvalTtlMs: 60_000, approvalPollIntervalMs: 1,
    })

    await expect(broker.execute(context, {
      providerToolCallId: 'provider-unknown', name: 'approved_webhook_delivery', input: { label: 'smoke' },
    }, 1)).rejects.toMatchObject({ code: 'tool_side_effect_unknown' })
    expect(toolCoordinator.finishToolCall).not.toHaveBeenCalled()
  })
})
