import type {
  ApprovalDto,
  ApprovalEvidence,
  ToolCallDto,
  ToolRiskLevel,
} from '@relay/contracts'

export type CreateToolCallRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  turnId: string
  attemptId: string
  workerId?: string
  requestedBy: string
  requestedByKind: 'user' | 'service_account'
  requestId: string
  toolName: string
  operation: string
  riskLevel: ToolRiskLevel
  input: unknown
  inputSummary: string
  inputRef?: string
}

export type RequestToolApprovalRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  expectedVersion: number
  requestedBy: string
  requestedByKind: 'user' | 'service_account'
  assignedTo: string[]
  requiredApprovals: 1 | 2
  action: string
  reasons: string[]
  evidence: ApprovalEvidence[]
  expiresAt: string
  requestId: string
}

export type StartToolCallRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  expectedVersion: number
  workerId: string
  requestId: string
  providerIdempotencyKey?: string
}

export type FinishToolCallRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  expectedVersion: number
  workerId: string
  requestId: string
  status: 'succeeded' | 'failed' | 'canceled'
  output?: unknown
  outputSummary?: string
  outputRef?: string
}

export type ToolSideEffectStatus = 'prepared' | 'unknown' | 'succeeded' | 'failed'
export type ToolSideEffect = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  id: string
  provider: string
  operation: string
  status: ToolSideEffectStatus
  providerOperationId: string | null
  resultSummary: string | null
  createdAt: string
  updatedAt: string
  version: number
}

export type PrepareToolSideEffectRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  provider: string
  operation: string
  idempotencyKey: string
  request: unknown
  requestId: string
}

export type ResolveToolSideEffectRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  toolCallId: string
  sideEffectId: string
  expectedVersion: number
  status: 'unknown' | 'succeeded' | 'failed'
  providerOperationId?: string
  result?: unknown
  resultSummary?: string
  requestId: string
}

export class ToolCoordinatorConflictError extends Error {
  constructor(readonly code:
    | 'invalid_state'
    | 'version_conflict'
    | 'input_changed'
    | 'approval_not_granted'
    | 'side_effect_unresolved'
    | 'idempotency_conflict',
  message: string,
  ) {
    super(message)
    this.name = 'ToolCoordinatorConflictError'
  }
}

export class ToolCoordinatorValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message)
    this.name = 'ToolCoordinatorValidationError'
  }
}

export interface ToolCoordinatorRepository {
  createToolCall(record: CreateToolCallRecord): Promise<ToolCallDto>
  requestApproval(record: RequestToolApprovalRecord): Promise<{
    toolCall: ToolCallDto
    approval: ApprovalDto
  }>
  startToolCall(record: StartToolCallRecord): Promise<ToolCallDto>
  finishToolCall(record: FinishToolCallRecord): Promise<ToolCallDto>
  prepareSideEffect(record: PrepareToolSideEffectRecord): Promise<ToolSideEffect>
  resolveSideEffect(record: ResolveToolSideEffectRecord): Promise<ToolSideEffect>
}
