import type {
  ApprovalDecisionRequest,
  ApprovalDto,
  ApprovalStatus,
  ToolCallDto,
  ToolCallStatus,
} from '@cosmos/contracts'

export type ToolCallListCursor = { createdAt: string; id: string }
export type ToolCallListOptions = {
  limit: number
  turnId?: string
  status?: ToolCallStatus
  cursor?: ToolCallListCursor
}
export type ToolCallListPage = {
  items: ToolCallDto[]
  hasMore: boolean
  nextCursor: ToolCallListCursor | null
}

export type ApprovalListCursor = { createdAt: string; id: string }
export type ApprovalListOptions = {
  limit: number
  status?: ApprovalStatus
  assignedToMe?: boolean
  sessionId?: string
  cursor?: ApprovalListCursor
}
export type ApprovalListPage = {
  items: ApprovalDto[]
  hasMore: boolean
  nextCursor: ApprovalListCursor | null
}

export type DecideApprovalRecord = {
  organizationId: string
  spaceId: string
  approvalId: string
  actorId: string
  requestId: string
  idempotencyKey: string
  expectedVersion: number
  request: ApprovalDecisionRequest
}
export type ApprovalDecisionResult = { approval: ApprovalDto; replayed: boolean }

export class ApprovalAlreadyDecidedError extends Error {
  constructor(readonly currentStatus: ApprovalStatus) {
    super(`The Approval is already ${currentStatus}.`)
    this.name = 'ApprovalAlreadyDecidedError'
  }
}

export class ApprovalDecisionConflictError extends Error {
  constructor() {
    super('The actor has already recorded a different Approval decision.')
    this.name = 'ApprovalDecisionConflictError'
  }
}

export class ApprovalPermissionDeniedError extends Error {
  constructor() {
    super('The actor is not permitted to decide this Approval.')
    this.name = 'ApprovalPermissionDeniedError'
  }
}

export class ApprovalVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`Expected Approval version ${expectedVersion}, but found ${currentVersion}.`)
    this.name = 'ApprovalVersionConflictError'
  }
}

export interface ToolApprovalRepository {
  listToolCalls(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: ToolCallListOptions,
  ): Promise<ToolCallListPage | null>
  listApprovals(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ApprovalListOptions,
  ): Promise<ApprovalListPage>
  getApproval(
    organizationId: string,
    spaceId: string,
    approvalId: string,
    actorId: string,
  ): Promise<ApprovalDto | null>
  decideApproval(record: DecideApprovalRecord): Promise<ApprovalDecisionResult | null>
}

export class EmptyToolApprovalRepository implements ToolApprovalRepository {
  async listToolCalls(): Promise<ToolCallListPage | null> {
    return null
  }

  async listApprovals(): Promise<ApprovalListPage> {
    return { items: [], hasMore: false, nextCursor: null }
  }

  async getApproval(): Promise<ApprovalDto | null> {
    return null
  }

  async decideApproval(): Promise<ApprovalDecisionResult | null> {
    return null
  }
}
