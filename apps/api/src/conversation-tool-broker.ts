import { AdvisorPlanProposalSchema, FilePrefixSchema, type FileDto, type ToolCallDto } from '@cosmos/contracts'
import type { ApprovedWebhookClient } from './approved-webhook-client.js'
import type { AdvisorPlanRepository } from './advisor-plan-repository.js'
import type {
  ConversationAgentToolCall,
  ConversationAgentToolDefinition,
} from './conversation-agent-provider.js'
import type { FileRepository } from './file-repository.js'
import type { ToolCoordinatorRepository } from './tool-coordinator-repository.js'

export type ConversationToolContext = Readonly<{
  organizationId: string
  spaceId: string
  sessionId: string
  turnId: string
  attemptId: string
  workerId: string
  requestedBy: string
  requestedByKind: 'user' | 'service_account'
  requestId: string
  signal?: AbortSignal
}>

export type ConversationToolExecutionResult = Readonly<{
  content: string
}>

export interface ConversationToolBroker {
  readonly definitions: readonly ConversationAgentToolDefinition[]
  reapExpiredApprovals?(limit?: number): Promise<number>
  execute(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
    invocation: number,
  ): Promise<ConversationToolExecutionResult>
}

export class ConversationToolExecutionError extends Error {
  constructor(
    readonly code: 'tool_approval_unavailable' | 'tool_side_effect_unknown',
    message: string,
  ) {
    super(message)
    this.name = 'ConversationToolExecutionError'
  }
}

export type ApprovedWebhookToolOptions = Readonly<{
  client: ApprovedWebhookClient
  approverIds: readonly string[]
  approvalTtlMs: number
  approvalPollIntervalMs?: number
  now?: () => Date
}>

const MAX_WORKSPACE_FILE_BYTES = 65_536
const MAX_TOOL_RESULT_CHARACTERS = 95_000

const workspaceDefinitions = [
  {
    name: 'workspace_files_list',
    description: 'List readable files in the current Session workspace. Use this before reading a file when its id is unknown.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', maxLength: 1024 },
        search: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workspace_file_read',
    description: 'Read one UTF-8 text file from the current Session workspace by file id. Binary files and files larger than 64 KiB are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', minLength: 1, maxLength: 128 },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ConversationAgentToolDefinition[]

const advisorDefinition = {
  name: 'advisor_plan_propose',
  description: 'Propose a bounded Cosmos control-plane plan for explicit human confirmation. This tool never applies the change. Use manual_action steps for OAuth or Secret work and never request Secret values or OAuth tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', minLength: 1, maxLength: 2000 },
      dependencies: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 1000 } },
      risks: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 1000 } },
      steps: {
        type: 'array', minItems: 1, maxItems: 10,
        items: {
          oneOf: [
            {
              type: 'object', additionalProperties: false,
              properties: {
                kind: { const: 'control_plane' }, operation: { const: 'space.update' },
                changes: {
                  type: 'object', additionalProperties: false, minProperties: 1,
                  properties: {
                    description: { type: 'string', maxLength: 2000 },
                    defaultExpertId: { type: ['string', 'null'], maxLength: 128 },
                    defaultEnvironmentId: { type: ['string', 'null'], maxLength: 128 },
                  },
                },
                rationale: { type: 'string', minLength: 1, maxLength: 1000 },
              },
              required: ['kind', 'operation', 'changes', 'rationale'],
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                kind: { const: 'control_plane' }, operation: { const: 'organization.set_default_space' },
                rationale: { type: 'string', minLength: 1, maxLength: 1000 },
              },
              required: ['kind', 'operation', 'rationale'],
            },
            {
              type: 'object', additionalProperties: false,
              properties: {
                kind: { const: 'manual_action' }, action: { enum: ['oauth', 'secret'] },
                label: { type: 'string', minLength: 1, maxLength: 240 },
                instructions: { type: 'string', minLength: 1, maxLength: 2000 },
              },
              required: ['kind', 'action', 'label', 'instructions'],
            },
          ],
        },
      },
    },
    required: ['summary', 'steps'],
    additionalProperties: false,
  },
} as const satisfies ConversationAgentToolDefinition

const approvedWebhookDefinition = {
  name: 'approved_webhook_delivery',
  description: 'Emit one bounded verification event to the operator-configured HTTPS receiver. This is a high-risk external write and always pauses for independent human approval. The destination, credentials, headers, and payload shape are fixed by the Worker and cannot be supplied by the model.',
  inputSchema: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$',
        description: 'A non-sensitive verification label containing only safe identifier characters.',
      },
    },
    required: ['label'],
    additionalProperties: false,
  },
} as const satisfies ConversationAgentToolDefinition

type ToolOutcome = {
  status: 'succeeded' | 'failed'
  output: unknown
  summary: string
}

class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new ToolInputError('Tool arguments contain unsupported fields.')
  }
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum) {
    throw new ToolInputError(`${key} must be a trimmed string of at most ${maximum} characters.`)
  }
  return value
}

function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
) {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ToolInputError(`${key} must be an integer between ${minimum} and ${maximum}.`)
  }
  return Number(value)
}

function visibleFile(file: FileDto) {
  return {
    id: file.id,
    path: file.path,
    mimeType: file.mimeType,
    size: file.size,
    version: file.version,
    updatedAt: file.updatedAt,
  }
}

function isTextMimeType(mimeType: string) {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  return normalized?.startsWith('text/') || [
    'application/json',
    'application/javascript',
    'application/typescript',
    'application/xml',
    'application/yaml',
    'application/x-yaml',
  ].includes(normalized ?? '')
}

function failure(code: string, message: string): ToolOutcome {
  return {
    status: 'failed',
    output: { ok: false, error: { code, message } },
    summary: message,
  }
}

function delay(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export class GovernedConversationToolBroker implements ConversationToolBroker {
  readonly definitions: readonly ConversationAgentToolDefinition[]

  constructor(
    private readonly coordinator: ToolCoordinatorRepository,
    private readonly files: FileRepository,
    private readonly advisorPlans?: AdvisorPlanRepository,
    private readonly approvedWebhook?: ApprovedWebhookToolOptions,
  ) {
    this.definitions = [
      ...workspaceDefinitions,
      ...(advisorPlans ? [advisorDefinition] : []),
      ...(approvedWebhook ? [approvedWebhookDefinition] : []),
    ]
  }

  reapExpiredApprovals(limit = 20) {
    return this.coordinator.reapExpiredApprovals(limit)
  }

  async execute(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
    invocation: number,
  ): Promise<ConversationToolExecutionResult> {
    if (!this.definitions.some((definition) => definition.name === call.name)) {
      throw new Error('The Provider requested a tool outside the governed catalog.')
    }
    const requestPrefix = `${context.requestId}:tool:${invocation}`
    const isApprovedWebhook = call.name === approvedWebhookDefinition.name
    const created = await this.coordinator.createToolCall({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      attemptId: context.attemptId,
      workerId: context.workerId,
      requestedBy: context.requestedBy,
      requestedByKind: context.requestedByKind,
      requestId: `${requestPrefix}:create`,
      toolName: call.name,
      operation: call.name === 'workspace_files_list'
        ? 'list'
        : call.name === 'workspace_file_read'
          ? 'read'
          : call.name === 'advisor_plan_propose'
            ? 'propose'
            : 'deliver',
      riskLevel: isApprovedWebhook ? 'high' : 'low',
      input: call.input,
      inputSummary: call.name === 'workspace_files_list'
        ? 'List files in the current Session workspace.'
        : call.name === 'workspace_file_read'
          ? 'Read a text file from the current Session workspace.'
          : call.name === 'advisor_plan_propose'
            ? 'Propose a bounded Advisor control-plane plan for explicit confirmation.'
            : 'Emit one bounded event to the operator-configured Webhook after independent approval.',
    })

    let approvedLabel: string | undefined
    let startCandidate = created
    if (isApprovedWebhook) {
      try {
        approvedLabel = this.approvedWebhookLabel(call.input)
      } catch (error) {
        const started = await this.startToolCall(context, call, requestPrefix, created)
        return this.finishToolCall(
          context,
          requestPrefix,
          started,
          error instanceof ToolInputError
            ? failure('invalid_input', error.message)
            : failure('invalid_input', 'The approved Webhook input is invalid.'),
        )
      }
      try {
        startCandidate = await this.requestAndWaitForApproval(
          context, requestPrefix, created, approvedLabel,
        )
      } catch (error) {
        if (context.signal?.aborted) throw error
        const current = await this.coordinator.getToolCall({
          organizationId: context.organizationId,
          spaceId: context.spaceId,
          sessionId: context.sessionId,
          toolCallId: created.id,
          workerId: context.workerId,
        })
        if (current?.status === 'queued') {
          const started = await this.startToolCall(context, call, requestPrefix, current)
          return this.finishToolCall(
            context,
            requestPrefix,
            started,
            failure(
              'approval_unavailable',
              'Independent Approval is unavailable for this requester; no external request was sent.',
            ),
          )
        }
        throw error
      }
      if (startCandidate.status === 'canceled') {
        return {
          content: JSON.stringify(failure(
            'approval_not_granted',
            'The external write was not approved and no request was sent.',
          ).output),
        }
      }
    }
    const started = await this.startToolCall(context, call, requestPrefix, startCandidate)

    let outcome: ToolOutcome
    try {
      outcome = call.name === 'workspace_files_list'
        ? await this.listFiles(context, call.input)
        : call.name === 'workspace_file_read'
          ? await this.readFile(context, call.input)
          : call.name === 'advisor_plan_propose'
            ? await this.proposeAdvisorPlan(context, call)
            : await this.deliverApprovedWebhook(context, call, started, approvedLabel!)
    } catch (error) {
      if (error instanceof ConversationToolExecutionError) throw error
      outcome = error instanceof ToolInputError
        ? failure('invalid_input', error.message)
        : failure('tool_unavailable', 'The workspace tool is temporarily unavailable.')
    }

    return this.finishToolCall(context, requestPrefix, started, outcome)
  }

  private startToolCall(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
    requestPrefix: string,
    toolCall: ToolCallDto,
  ) {
    return this.coordinator.startToolCall({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: toolCall.id,
      expectedVersion: toolCall.version,
      workerId: context.workerId,
      requestId: `${requestPrefix}:start`,
      providerIdempotencyKey: `${context.attemptId}:${call.providerToolCallId}`,
    })
  }

  private async finishToolCall(
    context: ConversationToolContext,
    requestPrefix: string,
    started: ToolCallDto,
    outcome: ToolOutcome,
  ): Promise<ConversationToolExecutionResult> {
    let content = JSON.stringify(outcome.output)
    if (content.length > MAX_TOOL_RESULT_CHARACTERS) {
      outcome = failure('content_too_large', 'The workspace tool result exceeds the model-read limit.')
      content = JSON.stringify(outcome.output)
    }
    await this.coordinator.finishToolCall({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: started.id,
      expectedVersion: started.version,
      workerId: context.workerId,
      requestId: `${requestPrefix}:finish`,
      status: outcome.status,
      output: outcome.output,
      outputSummary: outcome.summary,
    })
    return { content }
  }

  private approvedWebhookLabel(input: Readonly<Record<string, unknown>>) {
    if (!isRecord(input)) throw new ToolInputError('Tool arguments must be an object.')
    exactKeys(input, ['label'])
    const label = input.label
    if (typeof label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(label)) {
      throw new ToolInputError('label must contain 1 to 64 safe identifier characters.')
    }
    return label
  }

  private async requestAndWaitForApproval(
    context: ConversationToolContext,
    requestPrefix: string,
    created: ToolCallDto,
    label: string,
  ) {
    if (!this.approvedWebhook) {
      throw new ConversationToolExecutionError(
        'tool_approval_unavailable',
        'Approved external writes are not configured for this Worker.',
      )
    }
    const requested = await this.coordinator.requestApproval({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: created.id,
      expectedVersion: created.version,
      requestedBy: context.requestedBy,
      requestedByKind: context.requestedByKind,
      assignedTo: [...this.approvedWebhook.approverIds],
      requiredApprovals: 1,
      action: 'Emit an operator-configured Webhook verification event',
      reasons: [
        'This operation performs an external network write.',
        'The exact destination and credential are controlled by Worker configuration.',
      ],
      evidence: [
        { type: 'tool', label: 'Tool', value: approvedWebhookDefinition.name },
        { type: 'input', label: 'Verification label', value: label },
      ],
      expiresAt: new Date((this.approvedWebhook.now?.() ?? new Date()).getTime()
        + this.approvedWebhook.approvalTtlMs).toISOString(),
      requestId: `${requestPrefix}:approval`,
    })
    const signal = context.signal ?? new AbortController().signal
    const pollIntervalMs = this.approvedWebhook.approvalPollIntervalMs ?? 500
    const expiresAt = Date.parse(requested.approval.expiresAt)
    while (!signal.aborted) {
      const current = await this.coordinator.getToolCall({
        organizationId: context.organizationId,
        spaceId: context.spaceId,
        sessionId: context.sessionId,
        toolCallId: requested.toolCall.id,
        workerId: context.workerId,
      })
      if (!current) {
        throw new ConversationToolExecutionError(
          'tool_approval_unavailable',
          'The approved ToolCall is no longer accessible to the Worker.',
        )
      }
      if (current.status === 'queued' || current.status === 'canceled') return current
      if (current.status !== 'approval_required') {
        throw new ConversationToolExecutionError(
          'tool_approval_unavailable',
          'The approved ToolCall entered an invalid state.',
        )
      }
      if (Number.isFinite(expiresAt)
        && (this.approvedWebhook.now?.() ?? new Date()).getTime() >= expiresAt) {
        const expired = await this.coordinator.expireApproval({
          organizationId: context.organizationId,
          spaceId: context.spaceId,
          sessionId: context.sessionId,
          toolCallId: requested.toolCall.id,
          approvalId: requested.approval.id,
          workerId: context.workerId,
          requestId: `${requestPrefix}:approval-expired`,
        })
        if (!expired) {
          throw new ConversationToolExecutionError(
            'tool_approval_unavailable',
            'The expired ToolCall is no longer accessible to the Worker.',
          )
        }
        if (expired.status === 'queued' || expired.status === 'canceled') return expired
      }
      await delay(pollIntervalMs, signal)
    }
    throw new ConversationToolExecutionError(
      'tool_approval_unavailable',
      'Approval waiting was interrupted before a decision.',
    )
  }

  private async deliverApprovedWebhook(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
    started: ToolCallDto,
    label: string,
  ): Promise<ToolOutcome> {
    if (!this.approvedWebhook) {
      throw new ConversationToolExecutionError(
        'tool_approval_unavailable',
        'Approved external writes are not configured for this Worker.',
      )
    }
    const idempotencyKey = `${context.attemptId}:${call.providerToolCallId}`
    const sideEffect = await this.coordinator.prepareSideEffect({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: started.id,
      provider: 'configured_webhook',
      operation: 'deliver_verification_event',
      idempotencyKey,
      request: { type: 'cosmos.approved_webhook_delivery', label },
      requestId: `${context.requestId}:tool:side-effect:prepare`,
    })
    if (sideEffect.status === 'unknown') {
      throw new ConversationToolExecutionError(
        'tool_side_effect_unknown',
        'The external write outcome is unknown and requires operator reconciliation.',
      )
    }
    if (sideEffect.status === 'succeeded') {
      return {
        status: 'succeeded',
        output: { ok: true, status: 'accepted', replayed: true },
        summary: 'The approved Webhook delivery was already accepted.',
      }
    }
    if (sideEffect.status === 'failed') {
      return failure('external_write_rejected', 'The configured receiver rejected the approved write.')
    }

    let delivered: Awaited<ReturnType<ApprovedWebhookClient['deliver']>>
    try {
      delivered = await this.approvedWebhook.client.deliver({
        label,
        idempotencyKey,
        signal: context.signal ?? new AbortController().signal,
      })
    } catch {
      delivered = { status: 'unknown', statusCode: null }
    }
    const resolved = await this.coordinator.resolveSideEffect({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: started.id,
      sideEffectId: sideEffect.id,
      expectedVersion: sideEffect.version,
      status: delivered.status,
      ...(delivered.status === 'unknown' ? {} : {
        result: { statusCode: delivered.statusCode },
        resultSummary: delivered.status === 'succeeded'
          ? `Configured receiver accepted the write with HTTP ${delivered.statusCode}.`
          : `Configured receiver rejected the write with HTTP ${delivered.statusCode}.`,
      }),
      requestId: `${context.requestId}:tool:side-effect:resolve`,
    })
    if (resolved.status === 'unknown') {
      throw new ConversationToolExecutionError(
        'tool_side_effect_unknown',
        'The external write outcome is unknown and requires operator reconciliation.',
      )
    }
    if (resolved.status === 'failed') {
      return failure('external_write_rejected', 'The configured receiver rejected the approved write.')
    }
    return {
      status: 'succeeded',
      output: { ok: true, status: 'accepted', statusCode: delivered.statusCode, replayed: false },
      summary: `Configured receiver accepted the approved write with HTTP ${delivered.statusCode}.`,
    }
  }

  private async proposeAdvisorPlan(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
  ): Promise<ToolOutcome> {
    if (!this.advisorPlans) return failure('tool_unavailable', 'Advisor planning is not enabled for this Worker.')
    const proposal = AdvisorPlanProposalSchema.safeParse(call.input)
    if (!proposal.success) return failure('invalid_input', 'The Advisor plan is outside the supported controlled schema.')
    try {
      const plan = await this.advisorPlans.proposePlan({
        ...context,
        actorId: context.requestedBy,
        providerToolCallId: call.providerToolCallId,
        proposal: proposal.data,
      })
      return {
        status: 'succeeded',
        output: {
          ok: true,
          planId: plan.id,
          status: plan.status,
          message: 'The plan is visible in the Session and requires explicit confirmation before any controlled write.',
        },
        summary: `Proposed Advisor plan ${plan.id}; no control-plane change has been applied.`,
      }
    } catch {
      return failure('plan_rejected', 'The Advisor plan could not be proposed under the current scope and policy.')
    }
  }

  private async listFiles(
    context: ConversationToolContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolOutcome> {
    if (!isRecord(input)) throw new ToolInputError('Tool arguments must be an object.')
    exactKeys(input, ['prefix', 'search', 'limit'])
    const prefixValue = input.prefix
    if (prefixValue !== undefined && typeof prefixValue !== 'string') {
      throw new ToolInputError('prefix must be a string.')
    }
    const prefix = prefixValue === undefined ? undefined : FilePrefixSchema.safeParse(prefixValue)
    if (prefix && !prefix.success) throw new ToolInputError('prefix must be a safe relative path prefix.')
    const search = optionalString(input, 'search', 200)
    const limit = optionalInteger(input, 'limit', 1, 50) ?? 25
    const page = await this.files.list(
      context.organizationId,
      context.spaceId,
      context.requestedBy,
      {
        scope: 'workspace',
        sessionId: context.sessionId,
        ...(prefix ? { prefix: prefix.data } : {}),
        ...(search ? { search } : {}),
        limit,
      },
    )
    if (!page) return failure('not_found', 'The Session workspace is not accessible.')
    return {
      status: 'succeeded',
      output: { ok: true, files: page.items.map(visibleFile), hasMore: page.hasMore },
      summary: `Listed ${page.items.length} workspace file${page.items.length === 1 ? '' : 's'}.`,
    }
  }

  private async readFile(
    context: ConversationToolContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolOutcome> {
    if (!isRecord(input)) throw new ToolInputError('Tool arguments must be an object.')
    exactKeys(input, ['fileId', 'version'])
    const fileId = optionalString(input, 'fileId', 128)
    if (!fileId) throw new ToolInputError('fileId is required.')
    const version = optionalInteger(input, 'version', 1, Number.MAX_SAFE_INTEGER)
    const file = await this.files.get(
      context.organizationId,
      context.spaceId,
      fileId,
      context.requestedBy,
    )
    if (!file || file.scope !== 'workspace' || file.sessionId !== context.sessionId) {
      return failure('not_found', 'The workspace file was not found.')
    }
    if (!isTextMimeType(file.mimeType)) {
      return failure('unsupported_media_type', 'Only UTF-8 text workspace files can be read by the model.')
    }
    if (version === undefined && file.size > MAX_WORKSPACE_FILE_BYTES) {
      return failure('content_too_large', 'The workspace file exceeds the 64 KiB model-read limit.')
    }
    const content = await this.files.getContent(
      context.organizationId,
      context.spaceId,
      fileId,
      context.requestedBy,
      version ?? file.version,
    )
    if (!content || content.file.sessionId !== context.sessionId) {
      return failure('not_found', 'The requested workspace file version was not found.')
    }
    if (content.content.byteLength > MAX_WORKSPACE_FILE_BYTES) {
      return failure('content_too_large', 'The workspace file exceeds the 64 KiB model-read limit.')
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content.content)
    } catch {
      return failure('invalid_encoding', 'The workspace file is not valid UTF-8 text.')
    }
    return {
      status: 'succeeded',
      output: {
        ok: true,
        file: visibleFile(content.file),
        version: content.version.version,
        contentHash: content.version.contentHash,
        content: text,
      },
      summary: `Read workspace file ${content.file.path} version ${content.version.version}.`,
    }
  }
}
