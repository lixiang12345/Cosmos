import {
  ApprovalStatusSchema,
  ToolCallStatusSchema,
  type ApprovalStatus,
  type ToolCallStatus,
} from '@relay/contracts'
import type {
  ApprovalListCursor,
  ApprovalListOptions,
  ToolCallListCursor,
  ToolCallListOptions,
} from './tool-approval-repository.js'

export type ToolCallListQuery = {
  cursor?: unknown
  limit?: unknown
  turnId?: unknown
  status?: unknown
}
export type ApprovalListQuery = {
  cursor?: unknown
  limit?: unknown
  status?: unknown
  assignedToMe?: unknown
  sessionId?: unknown
}

type CursorKind = 'tool-calls' | 'approvals'
type EncodedCursor = {
  version: 1
  kind: CursorKind
  organizationId: string
  spaceId: string
  sessionId: string | null
  turnId: string | null
  status: ToolCallStatus | ApprovalStatus | null
  assignedToMe: boolean | null
  createdAt: string
  id: string
}

export class InvalidToolApprovalPaginationError extends Error {
  constructor(readonly resource: 'ToolCall' | 'Approval', readonly field: string) {
    super(`The ${resource} list ${field} is invalid.`)
    this.name = 'InvalidToolApprovalPaginationError'
  }
}

function limit(value: unknown, resource: 'ToolCall' | 'Approval') {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value) || Number(value) > 100) {
    throw new InvalidToolApprovalPaginationError(resource, 'limit')
  }
  return Number(value)
}

function identifier(value: unknown, resource: 'ToolCall' | 'Approval', field: string) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 128) {
    throw new InvalidToolApprovalPaginationError(resource, field)
  }
  return value
}

function decodeCursor(value: unknown, expected: Omit<EncodedCursor, 'version' | 'createdAt' | 'id'>) {
  const resource = expected.kind === 'tool-calls' ? 'ToolCall' : 'Approval'
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) {
    throw new InvalidToolApprovalPaginationError(resource, 'cursor')
  }
  let decoded: unknown
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new InvalidToolApprovalPaginationError(resource, 'cursor')
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new InvalidToolApprovalPaginationError(resource, 'cursor')
  }
  const candidate = decoded as Partial<EncodedCursor>
  const parsedAt = typeof candidate.createdAt === 'string' ? new Date(candidate.createdAt) : null
  if (
    Object.keys(candidate).sort().join(',') !== 'assignedToMe,createdAt,id,kind,organizationId,sessionId,spaceId,status,turnId,version'
    || candidate.version !== 1
    || candidate.kind !== expected.kind
    || candidate.organizationId !== expected.organizationId
    || candidate.spaceId !== expected.spaceId
    || candidate.sessionId !== expected.sessionId
    || candidate.turnId !== expected.turnId
    || candidate.status !== expected.status
    || candidate.assignedToMe !== expected.assignedToMe
    || !parsedAt
    || !Number.isFinite(parsedAt.getTime())
    || parsedAt.toISOString() !== candidate.createdAt
    || typeof candidate.id !== 'string'
    || candidate.id.trim() !== candidate.id
    || candidate.id.length < 1
    || candidate.id.length > 128
  ) throw new InvalidToolApprovalPaginationError(resource, 'cursor')
  return { createdAt: candidate.createdAt, id: candidate.id }
}

function encodeCursor(
  cursor: ToolCallListCursor | ApprovalListCursor,
  binding: Omit<EncodedCursor, 'version' | 'createdAt' | 'id'>,
) {
  const payload: EncodedCursor = {
    version: 1,
    ...binding,
    createdAt: new Date(cursor.createdAt).toISOString(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function parseToolCallPagination(
  query: ToolCallListQuery,
  organizationId: string,
  spaceId: string,
  sessionId: string,
): ToolCallListOptions {
  const parsedStatus = query.status === undefined ? undefined : ToolCallStatusSchema.safeParse(query.status)
  if (parsedStatus !== undefined && !parsedStatus.success) {
    throw new InvalidToolApprovalPaginationError('ToolCall', 'status')
  }
  const options: ToolCallListOptions = {
    limit: limit(query.limit, 'ToolCall'),
    turnId: identifier(query.turnId, 'ToolCall', 'turnId'),
    status: parsedStatus?.data,
  }
  if (query.cursor !== undefined) options.cursor = decodeCursor(query.cursor, {
    kind: 'tool-calls', organizationId, spaceId, sessionId,
    turnId: options.turnId ?? null, status: options.status ?? null, assignedToMe: null,
  })
  return options
}

export function encodeToolCallCursor(
  cursor: ToolCallListCursor,
  organizationId: string,
  spaceId: string,
  sessionId: string,
  options: ToolCallListOptions,
) {
  return encodeCursor(cursor, {
    kind: 'tool-calls', organizationId, spaceId, sessionId,
    turnId: options.turnId ?? null, status: options.status ?? null, assignedToMe: null,
  })
}

export function parseApprovalPagination(
  query: ApprovalListQuery,
  organizationId: string,
  spaceId: string,
): ApprovalListOptions {
  const parsedStatus = query.status === undefined ? undefined : ApprovalStatusSchema.safeParse(query.status)
  if (parsedStatus !== undefined && !parsedStatus.success) {
    throw new InvalidToolApprovalPaginationError('Approval', 'status')
  }
  if (query.assignedToMe !== undefined && query.assignedToMe !== 'true' && query.assignedToMe !== 'false') {
    throw new InvalidToolApprovalPaginationError('Approval', 'assignedToMe')
  }
  const options: ApprovalListOptions = {
    limit: limit(query.limit, 'Approval'),
    status: parsedStatus?.data,
    assignedToMe: query.assignedToMe === undefined ? undefined : query.assignedToMe === 'true',
    sessionId: identifier(query.sessionId, 'Approval', 'sessionId'),
  }
  if (query.cursor !== undefined) options.cursor = decodeCursor(query.cursor, {
    kind: 'approvals', organizationId, spaceId, sessionId: options.sessionId ?? null,
    turnId: null, status: options.status ?? null, assignedToMe: options.assignedToMe ?? null,
  })
  return options
}

export function encodeApprovalCursor(
  cursor: ApprovalListCursor,
  organizationId: string,
  spaceId: string,
  options: ApprovalListOptions,
) {
  return encodeCursor(cursor, {
    kind: 'approvals', organizationId, spaceId, sessionId: options.sessionId ?? null,
    turnId: null, status: options.status ?? null, assignedToMe: options.assignedToMe ?? null,
  })
}
