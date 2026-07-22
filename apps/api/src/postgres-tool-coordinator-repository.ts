import { createHash, randomUUID } from 'node:crypto'
import {
  ApprovalDtoSchema,
  ApprovalEvidenceSchema,
  ToolCallDtoSchema,
  type ApprovalDto,
  type ToolCallDto,
} from '@cosmos/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  ToolCoordinatorConflictError,
  ToolCoordinatorValidationError,
  type CreateToolCallRecord,
  type FinishToolCallRecord,
  type PrepareToolSideEffectRecord,
  type RequestToolApprovalRecord,
  type ResolveToolSideEffectRecord,
  type StartToolCallRecord,
  type ToolCoordinatorRepository,
  type ToolSideEffect,
  type ToolSideEffectStatus,
} from './tool-coordinator-repository.js'

type TimestampValue = Date | string
type ToolCallRow = {
  organization_id: string
  space_id: string
  session_id: string
  turn_id: string
  attempt_id: string
  id: string
  worker_id: string | null
  tool_name: string
  operation: string
  risk_level: ToolCallDto['riskLevel']
  status: ToolCallDto['status']
  input_summary: string
  input_hash: string
  output_summary: string | null
  approval_id: string | null
  created_at: TimestampValue
  started_at: TimestampValue | null
  completed_at: TimestampValue | null
  version: number
}
type ApprovalRow = {
  organization_id: string
  space_id: string
  id: string
  session_id: string
  turn_id: string
  tool_call_id: string
  action: string
  risk_level: ApprovalDto['riskLevel']
  reasons: unknown
  evidence: unknown
  status: ApprovalDto['status']
  requested_by: string
  required_approvals: number
  approval_count: number
  expires_at: TimestampValue
  decided_by: string | null
  decision_note: string | null
  decided_at: TimestampValue | null
  created_at: TimestampValue
  updated_at: TimestampValue
  version: number
  assigned_to: string[]
}
type SideEffectRow = {
  organization_id: string
  space_id: string
  session_id: string
  tool_call_id: string
  id: string
  provider: string
  operation: string
  request_hash: string
  status: ToolSideEffectStatus
  provider_operation_id: string | null
  result_summary: string | null
  created_at: TimestampValue
  updated_at: TimestampValue
  version: number
}

const toolColumns = `
  organization_id, space_id, session_id, turn_id, attempt_id, id, worker_id,
  tool_name, operation, risk_level, status, input_summary, input_hash,
  output_summary, approval_id, created_at, started_at, completed_at, version
`
const sideEffectColumns = `
  organization_id, space_id, session_id, tool_call_id, id, provider, operation,
  request_hash, status, provider_operation_id, result_summary, created_at, updated_at, version
`

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapToolCall(row: ToolCallRow): ToolCallDto {
  return ToolCallDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    id: row.id,
    workerId: row.worker_id,
    toolName: row.tool_name,
    operation: row.operation,
    riskLevel: row.risk_level,
    status: row.status,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    approvalId: row.approval_id,
    createdAt: timestamp(row.created_at),
    startedAt: row.started_at === null ? null : timestamp(row.started_at),
    completedAt: row.completed_at === null ? null : timestamp(row.completed_at),
    version: row.version,
  })
}

function mapApproval(row: ApprovalRow): ApprovalDto {
  return ApprovalDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    action: row.action,
    riskLevel: row.risk_level,
    reasons: row.reasons,
    evidence: row.evidence,
    status: row.status,
    requestedBy: row.requested_by,
    assignedTo: row.assigned_to,
    requiredApprovals: row.required_approvals,
    approvalCount: row.approval_count,
    expiresAt: timestamp(row.expires_at),
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at === null ? null : timestamp(row.decided_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: row.version,
  })
}

function mapSideEffect(row: SideEffectRow): ToolSideEffect {
  return {
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    toolCallId: row.tool_call_id,
    id: row.id,
    provider: row.provider,
    operation: row.operation,
    status: row.status,
    providerOperationId: row.provider_operation_id,
    resultSummary: row.result_summary,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: row.version,
  }
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function bounded(value: string, field: string, maximum: number) {
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) {
    throw new ToolCoordinatorValidationError(field, `${field} must contain 1 to ${maximum} characters.`)
  }
  return normalized
}

export type PostgresToolCoordinatorRepositoryOptions = {
  now?: () => Date
  createId?: () => string
}

export class PostgresToolCoordinatorRepository implements ToolCoordinatorRepository {
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(private readonly pool: Pool, options: PostgresToolCoordinatorRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  async createToolCall(record: CreateToolCallRecord): Promise<ToolCallDto> {
    const toolName = bounded(record.toolName, 'toolName', 160)
    const operation = bounded(record.operation, 'operation', 160)
    const inputSummary = bounded(record.inputSummary, 'inputSummary', 4_000)
    const inputHash = hash(canonicalJson(record.input))
    const occurredAt = this.now().toISOString()
    return transaction(this.pool, async (client) => {
      const parent = await client.query(`
        SELECT 1
        FROM cosmos_attempts attempt
        JOIN cosmos_turns turn_record
          ON turn_record.organization_id = attempt.organization_id
          AND turn_record.space_id = attempt.space_id
          AND turn_record.session_id = attempt.session_id
          AND turn_record.id = attempt.turn_id
        JOIN cosmos_sessions session
          ON session.organization_id = attempt.organization_id
          AND session.space_id = attempt.space_id
          AND session.id = attempt.session_id
        WHERE attempt.organization_id = $1 AND attempt.space_id = $2
          AND attempt.session_id = $3 AND attempt.turn_id = $4 AND attempt.id = $5
          AND attempt.status = 'running' AND turn_record.status = 'running'
          AND session.status = 'active'
        FOR UPDATE OF attempt, turn_record, session
      `, [record.organizationId, record.spaceId, record.sessionId, record.turnId, record.attemptId])
      if (!parent.rowCount) {
        throw new ToolCoordinatorConflictError('invalid_state', 'ToolCalls require a running Attempt, Turn, and Session.')
      }
      const id = this.createId()
      const inserted = await client.query<ToolCallRow>(`
        INSERT INTO cosmos_tool_calls (
          organization_id, space_id, session_id, turn_id, attempt_id, id,
          worker_id, tool_name, operation, risk_level, status, input_summary,
          input_hash, input_ref, created_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued', $11, $12, $13, $14, 1)
        RETURNING ${toolColumns}
      `, [
        record.organizationId, record.spaceId, record.sessionId, record.turnId,
        record.attemptId, id, record.workerId ?? null, toolName, operation,
        record.riskLevel, inputSummary, inputHash, record.inputRef ?? null, occurredAt,
      ])
      const toolCall = mapToolCall(inserted.rows[0])
      await this.appendToolEvent(client, toolCall, record.requestedBy, record.requestedByKind, record.requestId, occurredAt)
      await this.appendAudit(client, {
        toolCall,
        actorId: record.requestedBy,
        actorKind: record.requestedByKind,
        requestId: record.requestId,
        action: 'tool_call.create',
        targetType: 'tool_call',
        targetId: toolCall.id,
        before: null,
        after: { status: toolCall.status, version: toolCall.version },
        policyReason: 'worker_tool_policy_allowed',
        occurredAt,
      })
      return toolCall
    })
  }

  async requestApproval(record: RequestToolApprovalRecord) {
    const action = bounded(record.action, 'action', 240)
    if (record.reasons.length < 1 || record.reasons.length > 20) {
      throw new ToolCoordinatorValidationError('reasons', 'reasons must contain 1 to 20 redacted entries.')
    }
    const reasons = record.reasons.map((reason) => bounded(reason, 'reason', 1_000))
    const evidence = ApprovalEvidenceSchema.array().max(20).parse(record.evidence)
    const assignedTo = [...new Set(record.assignedTo)]
    if (assignedTo.length < record.requiredApprovals || assignedTo.length > 20) {
      throw new ToolCoordinatorValidationError('assignedTo', 'assignedTo must contain enough distinct approvers.')
    }
    const expiresAt = new Date(record.expiresAt)
    const occurredAt = this.now()
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= occurredAt) {
      throw new ToolCoordinatorValidationError('expiresAt', 'expiresAt must be a future timestamp.')
    }
    return transaction(this.pool, async (client) => {
      const selected = await client.query<ToolCallRow>(`
        SELECT ${toolColumns} FROM cosmos_tool_calls
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        FOR UPDATE
      `, [record.organizationId, record.spaceId, record.sessionId, record.toolCallId])
      const row = selected.rows[0]
      if (!row) throw new ToolCoordinatorConflictError('invalid_state', 'The ToolCall was not found.')
      const before = mapToolCall(row)
      if (before.version !== record.expectedVersion) {
        throw new ToolCoordinatorConflictError('version_conflict', 'The ToolCall version changed.')
      }
      if (before.status !== 'queued' || before.approvalId !== null) {
        throw new ToolCoordinatorConflictError('invalid_state', 'Only an unapproved queued ToolCall can request Approval.')
      }
      const eligible = await client.query<{ actor_id: string }>(`
        SELECT organization_membership.actor_id
        FROM cosmos_organization_memberships organization_membership
        JOIN cosmos_space_memberships space_membership
          ON space_membership.organization_id = organization_membership.organization_id
          AND space_membership.actor_id = organization_membership.actor_id
          AND space_membership.space_id = $2
        WHERE organization_membership.organization_id = $1
          AND organization_membership.actor_id = ANY($3::text[])
          AND organization_membership.role <> 'viewer'
          AND space_membership.role <> 'viewer'
          AND NOT EXISTS (
            SELECT 1 FROM cosmos_service_accounts service_account
            WHERE service_account.organization_id = organization_membership.organization_id
              AND service_account.id = organization_membership.actor_id
          )
      `, [record.organizationId, record.spaceId, assignedTo])
      if (eligible.rowCount !== assignedTo.length || assignedTo.includes(record.requestedBy)) {
        throw new ToolCoordinatorValidationError('assignedTo', 'Approvers must be active human writers and cannot include the requester.')
      }
      const approvalId = this.createId()
      await client.query(`
        INSERT INTO cosmos_approvals (
          organization_id, space_id, id, session_id, turn_id, tool_call_id,
          input_hash, action, risk_level, reasons, evidence, status, requested_by,
          required_approvals, approval_count, expires_at, created_at, updated_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
          'pending', $12, $13, 0, $14, $15, $15, 1)
      `, [
        record.organizationId, record.spaceId, approvalId, record.sessionId,
        before.turnId, before.id, row.input_hash, action, before.riskLevel,
        JSON.stringify(reasons), JSON.stringify(evidence), record.requestedBy,
        record.requiredApprovals, expiresAt.toISOString(), occurredAt.toISOString(),
      ])
      for (const actorId of assignedTo) {
        await client.query(`
          INSERT INTO cosmos_approval_assignments (
            organization_id, space_id, approval_id, actor_id, assigned_by, assigned_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          record.organizationId, record.spaceId, approvalId, actorId,
          record.requestedBy, occurredAt.toISOString(),
        ])
      }
      const updated = await client.query<ToolCallRow>(`
        UPDATE cosmos_tool_calls
        SET status = 'approval_required', approval_id = $5, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        RETURNING ${toolColumns}
      `, [record.organizationId, record.spaceId, record.sessionId, before.id, approvalId])
      const toolCall = mapToolCall(updated.rows[0])
      await client.query(`
        UPDATE cosmos_attempts SET status = 'waiting'
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND turn_id = $4 AND id = $5 AND status = 'running'
      `, [record.organizationId, record.spaceId, record.sessionId, before.turnId, before.attemptId])
      await client.query(`
        UPDATE cosmos_turns SET status = 'waiting_approval', version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND id = $4 AND status = 'running'
      `, [record.organizationId, record.spaceId, record.sessionId, before.turnId])
      const session = await client.query<{ version: number }>(`
        UPDATE cosmos_sessions
        SET status = 'waiting', updated_at = $4, last_activity_at = $4, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND id = $3 AND status = 'active'
        RETURNING version
      `, [record.organizationId, record.spaceId, record.sessionId, occurredAt.toISOString()])
      if (!session.rows[0]) throw new ToolCoordinatorConflictError('invalid_state', 'The parent Session is no longer active.')
      const approvalResult = await client.query<ApprovalRow>(`
        SELECT approval.*, $4::text[] AS assigned_to
        FROM cosmos_approvals approval
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [record.organizationId, record.spaceId, approvalId, assignedTo])
      const approval = mapApproval(approvalResult.rows[0])
      await this.appendApprovalRequestedEvents(
        client, toolCall, approval, session.rows[0].version,
        record.requestedBy, record.requestedByKind, record.requestId, occurredAt.toISOString(),
      )
      await this.appendAudit(client, {
        toolCall,
        actorId: record.requestedBy,
        actorKind: record.requestedByKind,
        requestId: record.requestId,
        action: 'approval.request',
        targetType: 'approval',
        targetId: approval.id,
        before: null,
        after: { status: approval.status, toolCallId: toolCall.id, version: approval.version },
        policyReason: 'tool_policy_requires_human_approval',
        occurredAt: occurredAt.toISOString(),
      })
      return { toolCall, approval }
    })
  }

  async startToolCall(record: StartToolCallRecord): Promise<ToolCallDto> {
    const occurredAt = this.now().toISOString()
    return transaction(this.pool, async (client) => {
      const selected = await client.query<ToolCallRow>(`
        SELECT ${toolColumns} FROM cosmos_tool_calls
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        FOR UPDATE
      `, [record.organizationId, record.spaceId, record.sessionId, record.toolCallId])
      const row = selected.rows[0]
      if (!row) throw new ToolCoordinatorConflictError('invalid_state', 'The ToolCall was not found.')
      const before = mapToolCall(row)
      if (before.version !== record.expectedVersion) {
        throw new ToolCoordinatorConflictError('version_conflict', 'The ToolCall version changed.')
      }
      if (before.status !== 'queued') {
        throw new ToolCoordinatorConflictError('invalid_state', 'Only a queued ToolCall can start.')
      }
      if (before.approvalId) {
        const approval = await client.query<{ status: string; input_hash: string }>(`
          SELECT status, input_hash FROM cosmos_approvals
          WHERE organization_id = $1 AND space_id = $2 AND id = $3
        `, [record.organizationId, record.spaceId, before.approvalId])
        if (approval.rows[0]?.status !== 'approved') {
          throw new ToolCoordinatorConflictError('approval_not_granted', 'The exact ToolCall Approval is not approved.')
        }
        if (approval.rows[0].input_hash !== row.input_hash) {
          throw new ToolCoordinatorConflictError('input_changed', 'The approved ToolCall input hash changed.')
        }
      }
      const updated = await client.query<ToolCallRow>(`
        UPDATE cosmos_tool_calls
        SET status = 'running', worker_id = $5, started_at = $6,
          provider_idempotency_key_hash = $7, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        RETURNING ${toolColumns}
      `, [
        record.organizationId, record.spaceId, record.sessionId, before.id,
        record.workerId, occurredAt,
        record.providerIdempotencyKey ? hash(record.providerIdempotencyKey) : null,
      ])
      const toolCall = mapToolCall(updated.rows[0])
      await this.appendToolEvent(client, toolCall, record.workerId, 'service_account', record.requestId, occurredAt)
      return toolCall
    })
  }

  async finishToolCall(record: FinishToolCallRecord): Promise<ToolCallDto> {
    const occurredAt = this.now().toISOString()
    const outputSummary = record.outputSummary === undefined
      ? null
      : bounded(record.outputSummary, 'outputSummary', 4_000)
    if ((record.output === undefined) !== (outputSummary === null)) {
      throw new ToolCoordinatorValidationError('output', 'output and outputSummary must be supplied together.')
    }
    return transaction(this.pool, async (client) => {
      const selected = await client.query<ToolCallRow>(`
        SELECT ${toolColumns} FROM cosmos_tool_calls
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        FOR UPDATE
      `, [record.organizationId, record.spaceId, record.sessionId, record.toolCallId])
      const row = selected.rows[0]
      if (!row) throw new ToolCoordinatorConflictError('invalid_state', 'The ToolCall was not found.')
      const before = mapToolCall(row)
      if (before.version !== record.expectedVersion) {
        throw new ToolCoordinatorConflictError('version_conflict', 'The ToolCall version changed.')
      }
      if (before.status !== 'running' || before.workerId !== record.workerId) {
        throw new ToolCoordinatorConflictError('invalid_state', 'Only the owning Worker can finish a running ToolCall.')
      }
      const unresolved = await client.query(`
        SELECT 1 FROM cosmos_tool_side_effects
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND tool_call_id = $4 AND status IN ('prepared', 'unknown')
        LIMIT 1
      `, [record.organizationId, record.spaceId, record.sessionId, before.id])
      if (unresolved.rowCount) {
        throw new ToolCoordinatorConflictError('side_effect_unresolved', 'A Tool side effect is unresolved and must be queried before completion.')
      }
      const updated = await client.query<ToolCallRow>(`
        UPDATE cosmos_tool_calls
        SET status = $5, output_summary = $6, output_hash = $7,
          output_ref = $8, completed_at = $9, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        RETURNING ${toolColumns}
      `, [
        record.organizationId, record.spaceId, record.sessionId, before.id, record.status,
        outputSummary, record.output === undefined ? null : hash(canonicalJson(record.output)),
        record.outputRef ?? null, occurredAt,
      ])
      const toolCall = mapToolCall(updated.rows[0])
      await this.appendToolEvent(client, toolCall, record.workerId, 'service_account', record.requestId, occurredAt)
      await this.appendAudit(client, {
        toolCall,
        actorId: record.workerId,
        actorKind: 'service_account',
        requestId: record.requestId,
        action: 'tool_call.update',
        targetType: 'tool_call',
        targetId: toolCall.id,
        before: { status: before.status, version: before.version },
        after: { status: toolCall.status, version: toolCall.version },
        policyReason: 'worker_tool_execution_finished',
        occurredAt,
      })
      return toolCall
    })
  }

  async prepareSideEffect(record: PrepareToolSideEffectRecord): Promise<ToolSideEffect> {
    const provider = bounded(record.provider, 'provider', 160)
    const operation = bounded(record.operation, 'operation', 160)
    const keyHash = hash(record.idempotencyKey)
    const requestHash = hash(canonicalJson(record.request))
    const occurredAt = this.now().toISOString()
    return transaction(this.pool, async (client) => {
      const tool = await client.query<ToolCallRow>(`
        SELECT ${toolColumns} FROM cosmos_tool_calls
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        FOR UPDATE
      `, [record.organizationId, record.spaceId, record.sessionId, record.toolCallId])
      if (!tool.rows[0] || tool.rows[0].status !== 'running') {
        throw new ToolCoordinatorConflictError('invalid_state', 'Side effects require a running ToolCall.')
      }
      const existing = await client.query<SideEffectRow>(`
        SELECT ${sideEffectColumns} FROM cosmos_tool_side_effects
        WHERE organization_id = $1 AND provider = $2 AND idempotency_key_hash = $3
      `, [record.organizationId, provider, keyHash])
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash
          || existing.rows[0].tool_call_id !== record.toolCallId
          || existing.rows[0].operation !== operation) {
          throw new ToolCoordinatorConflictError('idempotency_conflict', 'The provider idempotency key was reused for a different side effect.')
        }
        return mapSideEffect(existing.rows[0])
      }
      const inserted = await client.query<SideEffectRow>(`
        INSERT INTO cosmos_tool_side_effects (
          organization_id, space_id, session_id, tool_call_id, id, provider,
          operation, idempotency_key_hash, request_hash, status, created_at, updated_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'prepared', $10, $10, 1)
        RETURNING ${sideEffectColumns}
      `, [
        record.organizationId, record.spaceId, record.sessionId, record.toolCallId,
        this.createId(), provider, operation, keyHash, requestHash, occurredAt,
      ])
      const sideEffect = mapSideEffect(inserted.rows[0])
      await this.appendSideEffectAudit(client, sideEffect, record.requestId, occurredAt)
      return sideEffect
    })
  }

  async resolveSideEffect(record: ResolveToolSideEffectRecord): Promise<ToolSideEffect> {
    const occurredAt = this.now().toISOString()
    const terminal = record.status !== 'unknown'
    if (terminal && (record.result === undefined || record.resultSummary === undefined)) {
      throw new ToolCoordinatorValidationError('result', 'Terminal side effects require a redacted result and summary.')
    }
    if (!terminal && (record.result !== undefined || record.resultSummary !== undefined)) {
      throw new ToolCoordinatorValidationError('result', 'Unknown side effects cannot claim a provider result.')
    }
    const resultSummary = record.resultSummary === undefined
      ? null
      : bounded(record.resultSummary, 'resultSummary', 4_000)
    return transaction(this.pool, async (client) => {
      const selected = await client.query<SideEffectRow>(`
        SELECT ${sideEffectColumns} FROM cosmos_tool_side_effects
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND tool_call_id = $4 AND id = $5
        FOR UPDATE
      `, [
        record.organizationId, record.spaceId, record.sessionId,
        record.toolCallId, record.sideEffectId,
      ])
      const before = selected.rows[0]
      if (!before) throw new ToolCoordinatorConflictError('invalid_state', 'The Tool side effect was not found.')
      if (before.version !== record.expectedVersion) {
        throw new ToolCoordinatorConflictError('version_conflict', 'The Tool side-effect version changed.')
      }
      const updated = await client.query<SideEffectRow>(`
        UPDATE cosmos_tool_side_effects
        SET status = $6, provider_operation_id = $7, result_hash = $8,
          result_summary = $9, updated_at = $10, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND tool_call_id = $4 AND id = $5
        RETURNING ${sideEffectColumns}
      `, [
        record.organizationId, record.spaceId, record.sessionId, record.toolCallId,
        record.sideEffectId, record.status, record.providerOperationId ?? null,
        record.result === undefined ? null : hash(canonicalJson(record.result)),
        resultSummary, occurredAt,
      ])
      const sideEffect = mapSideEffect(updated.rows[0])
      await this.appendSideEffectAudit(client, sideEffect, record.requestId, occurredAt)
      return sideEffect
    })
  }

  private async appendToolEvent(
    client: PoolClient,
    toolCall: ToolCallDto,
    actorId: string,
    actorKind: 'user' | 'service_account',
    requestId: string,
    occurredAt: string,
  ) {
    const sequence = await this.reserveEvents(client, toolCall, 1)
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        attempt_id, tool_call_id, approval_id, request_id, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'tool_call.updated', 'tool_call', $6,
        $7::jsonb, $8, $9, $10, $11, $6, $12, $13, $14)
    `, [
      toolCall.organizationId, toolCall.spaceId, toolCall.sessionId, this.createId(),
      sequence, toolCall.id, JSON.stringify({
        toolCallId: toolCall.id, turnId: toolCall.turnId, attemptId: toolCall.attemptId,
        toolName: toolCall.toolName, operation: toolCall.operation,
        riskLevel: toolCall.riskLevel, status: toolCall.status,
        approvalId: toolCall.approvalId, version: toolCall.version,
      }), actorId, actorKind, toolCall.turnId, toolCall.attemptId,
      toolCall.approvalId, requestId, occurredAt,
    ])
  }

  private async appendApprovalRequestedEvents(
    client: PoolClient,
    toolCall: ToolCallDto,
    approval: ApprovalDto,
    sessionVersion: number,
    actorId: string,
    actorKind: 'user' | 'service_account',
    requestId: string,
    occurredAt: string,
  ) {
    const lastSequence = await this.reserveEvents(client, toolCall, 3)
    const firstSequence = lastSequence - 2
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        attempt_id, tool_call_id, approval_id, request_id, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'tool_call.updated', 'tool_call', $6,
        $7::jsonb, $8, $9, $10, $11, $6, $12, $13, $14)
    `, [
      toolCall.organizationId, toolCall.spaceId, toolCall.sessionId, this.createId(),
      firstSequence, toolCall.id, JSON.stringify({
        toolCallId: toolCall.id, turnId: toolCall.turnId, attemptId: toolCall.attemptId,
        toolName: toolCall.toolName, operation: toolCall.operation,
        riskLevel: toolCall.riskLevel, status: toolCall.status,
        approvalId: approval.id, version: toolCall.version,
      }), actorId, actorKind, toolCall.turnId, toolCall.attemptId,
      approval.id, requestId, occurredAt,
    ])
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        tool_call_id, approval_id, request_id, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'approval.requested', 'approval', $6,
        $7::jsonb, $8, $9, $10, $11, $6, $12, $13)
    `, [
      approval.organizationId, approval.spaceId, approval.sessionId, this.createId(),
      firstSequence + 1, approval.id, JSON.stringify({
        approvalId: approval.id, toolCallId: approval.toolCallId,
        action: approval.action, riskLevel: approval.riskLevel, status: approval.status,
        requiredApprovals: approval.requiredApprovals, expiresAt: approval.expiresAt,
        version: approval.version,
      }), actorId, actorKind, approval.turnId, approval.toolCallId, requestId, occurredAt,
    ])
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, request_id, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'session.updated', 'session', $3,
        $6::jsonb, $7, $8, $9, $10)
    `, [
      approval.organizationId, approval.spaceId, approval.sessionId, this.createId(),
      lastSequence, JSON.stringify({ status: 'waiting', version: sessionVersion }),
      actorId, actorKind, requestId, occurredAt,
    ])
  }

  private async reserveEvents(client: PoolClient, toolCall: ToolCallDto, count: number) {
    const result = await client.query<{ sequence: string }>(`
      UPDATE cosmos_sessions SET last_event_sequence = last_event_sequence + $4
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence AS sequence
    `, [toolCall.organizationId, toolCall.spaceId, toolCall.sessionId, count])
    if (!result.rows[0]) throw new Error('The ToolCall event sequence could not be reserved.')
    return Number(result.rows[0].sequence)
  }

  private async appendAudit(client: PoolClient, input: {
    toolCall: ToolCallDto
    actorId: string
    actorKind: 'user' | 'service_account'
    requestId: string
    action: 'tool_call.create' | 'tool_call.update' | 'approval.request'
    targetType: 'tool_call' | 'approval'
    targetId: string
    before: unknown | null
    after: unknown
    policyReason: string
    occurredAt: string
  }) {
    await client.query(`
      INSERT INTO cosmos_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, delegation_chain, action, target_type, target_id, result,
        request_id, idempotency_key_hash, policy_decision, policy_reason,
        before_state, after_state, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, $8, $9,
        'success', $10, NULL, 'allow', $11, $12::jsonb, $13::jsonb, $14)
    `, [
      input.toolCall.organizationId, this.createId(), input.toolCall.spaceId,
      input.toolCall.sessionId, input.actorId, input.actorKind, input.action,
      input.targetType, input.targetId, input.requestId, input.policyReason,
      input.before === null ? null : JSON.stringify(input.before), JSON.stringify(input.after),
      input.occurredAt,
    ])
  }

  private async appendSideEffectAudit(
    client: PoolClient,
    sideEffect: ToolSideEffect,
    requestId: string,
    occurredAt: string,
  ) {
    await client.query(`
      INSERT INTO cosmos_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, delegation_chain, action, target_type, target_id, result,
        request_id, idempotency_key_hash, policy_decision, policy_reason,
        before_state, after_state, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'service_account', '[]'::jsonb,
        'tool_side_effect.record', 'tool_side_effect', $6, 'success', $7,
        NULL, 'allow', 'provider_side_effect_ledger', NULL, $8::jsonb, $9)
    `, [
      sideEffect.organizationId, this.createId(), sideEffect.spaceId,
      sideEffect.sessionId, `tool:${sideEffect.toolCallId}`, sideEffect.id,
      requestId, JSON.stringify({ status: sideEffect.status, version: sideEffect.version }),
      occurredAt,
    ])
  }
}
