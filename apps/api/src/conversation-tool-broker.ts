import { AdvisorPlanProposalSchema, FilePrefixSchema, type FileDto } from '@cosmos/contracts'
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
}>

export type ConversationToolExecutionResult = Readonly<{
  content: string
}>

export interface ConversationToolBroker {
  readonly definitions: readonly ConversationAgentToolDefinition[]
  execute(
    context: ConversationToolContext,
    call: ConversationAgentToolCall,
    invocation: number,
  ): Promise<ConversationToolExecutionResult>
}

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

export class GovernedConversationToolBroker implements ConversationToolBroker {
  readonly definitions: readonly ConversationAgentToolDefinition[]

  constructor(
    private readonly coordinator: ToolCoordinatorRepository,
    private readonly files: FileRepository,
    private readonly advisorPlans?: AdvisorPlanRepository,
  ) {
    this.definitions = advisorPlans
      ? [...workspaceDefinitions, advisorDefinition]
      : workspaceDefinitions
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
          : 'propose',
      riskLevel: 'low',
      input: call.input,
      inputSummary: call.name === 'workspace_files_list'
        ? 'List files in the current Session workspace.'
        : call.name === 'workspace_file_read'
          ? 'Read a text file from the current Session workspace.'
          : 'Propose a bounded Advisor control-plane plan for explicit confirmation.',
    })
    const started = await this.coordinator.startToolCall({
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      sessionId: context.sessionId,
      toolCallId: created.id,
      expectedVersion: created.version,
      workerId: context.workerId,
      requestId: `${requestPrefix}:start`,
      providerIdempotencyKey: `${context.attemptId}:${call.providerToolCallId}`,
    })

    let outcome: ToolOutcome
    try {
      outcome = call.name === 'workspace_files_list'
        ? await this.listFiles(context, call.input)
        : call.name === 'workspace_file_read'
          ? await this.readFile(context, call.input)
          : await this.proposeAdvisorPlan(context, call)
    } catch (error) {
      outcome = error instanceof ToolInputError
        ? failure('invalid_input', error.message)
        : failure('tool_unavailable', 'The workspace tool is temporarily unavailable.')
    }

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
