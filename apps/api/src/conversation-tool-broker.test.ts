import type { AdvisorPlanDto, FileDto, FileVersionDto, ToolCallDto } from '@cosmos/contracts'
import { describe, expect, it, vi } from 'vitest'
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

const toolCall = (status: ToolCallDto['status'], version: number): ToolCallDto => ({
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
})
