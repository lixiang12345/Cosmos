import { createHash, randomUUID } from 'node:crypto'
import {
  ApprovalDtoSchema,
  ToolCallDtoSchema,
  type ApprovalDto,
  type ApprovalStatus,
  type ToolCallDto,
} from '@cosmos/contracts'
import type { Pool, PoolClient } from 'pg'
import { setLocalApiDatabaseContext } from './postgres-runtime-database.js'
import { IdempotencyConflictError } from './session-repository.js'
import {
  ApprovalAlreadyDecidedError,
  ApprovalDecisionConflictError,
  ApprovalPermissionDeniedError,
  ApprovalVersionConflictError,
  type ApprovalDecisionResult,
  type ApprovalListOptions,
  type ApprovalListPage,
  type DecideApprovalRecord,
  type ToolApprovalRepository,
  type ToolCallListOptions,
  type ToolCallListPage,
} from './tool-approval-repository.js'

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
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  status: ToolCallDto['status']
  input_summary: string
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
  input_hash: string
  action: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  reasons: unknown
  evidence: unknown
  status: ApprovalStatus
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
  assigned_to?: string[]
  actor_has_decided?: boolean
}

type DecisionOutcome =
  | { kind: 'success'; result: ApprovalDecisionResult }
  | { kind: 'expired'; status: ApprovalStatus }

const toolCallColumns = `
  organization_id, space_id, session_id, turn_id, attempt_id, id, worker_id,
  tool_name, operation, risk_level, status, input_summary, output_summary,
  approval_id, created_at, started_at, completed_at, version
`
const approvalColumns = `
  approval.organization_id, approval.space_id, approval.id, approval.session_id,
  approval.turn_id, approval.tool_call_id, approval.input_hash, approval.action,
  approval.risk_level, approval.reasons, approval.evidence, approval.status,
  approval.requested_by, approval.required_approvals, approval.approval_count,
  approval.expires_at, approval.decided_by, approval.decision_note,
  approval.decided_at, approval.created_at, approval.updated_at, approval.version,
  COALESCE((
    SELECT array_agg(assignment.actor_id ORDER BY assignment.actor_id)
    FROM cosmos_approval_assignments assignment
    WHERE assignment.organization_id = approval.organization_id
      AND assignment.space_id = approval.space_id
      AND assignment.approval_id = approval.id
  ), ARRAY[]::text[]) AS assigned_to,
  EXISTS (
    SELECT 1
    FROM cosmos_approval_decisions actor_decision
    WHERE actor_decision.organization_id = approval.organization_id
      AND actor_decision.space_id = approval.space_id
      AND actor_decision.approval_id = approval.id
      AND actor_decision.actor_id = current_setting('cosmos.actor_id', true)
  ) AS actor_has_decided
`

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
    assignedTo: row.assigned_to ?? [],
    requiredApprovals: row.required_approvals,
    approvalCount: row.approval_count,
    actorHasDecided: row.actor_has_decided ?? false,
    expiresAt: timestamp(row.expires_at),
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at === null ? null : timestamp(row.decided_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: row.version,
  })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function transaction<T>(
  pool: Pool,
  context: { organizationId: string; spaceId: string; actorId: string },
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setLocalApiDatabaseContext(client, context)
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

export type PostgresToolApprovalRepositoryOptions = {
  now?: () => Date
  createId?: () => string
  idempotencyTtlMs?: number
}

export class PostgresToolApprovalRepository implements ToolApprovalRepository {
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly idempotencyTtlMs: number

  constructor(private readonly pool: Pool, options: PostgresToolApprovalRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1_000
  }

  async listToolCalls(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: ToolCallListOptions,
  ): Promise<ToolCallListPage | null> {
    return transaction(this.pool, { organizationId, spaceId, actorId }, async (client) => {
      const session = await client.query(`
        SELECT 1 FROM cosmos_sessions
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [organizationId, spaceId, sessionId])
      if (!session.rowCount) return null
      const rows = await client.query<ToolCallRow>(`
        SELECT ${toolCallColumns}
        FROM cosmos_tool_calls
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND ($4::text IS NULL OR turn_id = $4)
          AND ($5::text IS NULL OR status = $5)
          AND ($6::timestamptz IS NULL OR (created_at, id) < ($6, $7))
        ORDER BY created_at DESC, id DESC
        LIMIT $8
      `, [
        organizationId, spaceId, sessionId, options.turnId ?? null, options.status ?? null,
        options.cursor?.createdAt ?? null, options.cursor?.id ?? null, options.limit + 1,
      ])
      const hasMore = rows.rows.length > options.limit
      const items = rows.rows.slice(0, options.limit).map(mapToolCall)
      const last = hasMore ? items.at(-1) : undefined
      return {
        items,
        hasMore,
        nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    })
  }

  async listApprovals(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: ApprovalListOptions,
  ): Promise<ApprovalListPage> {
    return transaction(this.pool, { organizationId, spaceId, actorId }, async (client) => {
      const rows = await client.query<ApprovalRow>(`
        SELECT ${approvalColumns}
        FROM cosmos_approvals approval
        WHERE approval.organization_id = $1 AND approval.space_id = $2
          AND ($3::text IS NULL OR approval.status = $3)
          AND ($4::text IS NULL OR approval.session_id = $4)
          AND (NOT $5::boolean OR EXISTS (
            SELECT 1 FROM cosmos_approval_assignments mine
            WHERE mine.organization_id = approval.organization_id
              AND mine.space_id = approval.space_id
              AND mine.approval_id = approval.id AND mine.actor_id = $6
          ))
          AND ($7::timestamptz IS NULL OR (approval.created_at, approval.id) < ($7, $8))
        ORDER BY approval.created_at DESC, approval.id DESC
        LIMIT $9
      `, [
        organizationId, spaceId, options.status ?? null, options.sessionId ?? null,
        options.assignedToMe ?? false, actorId, options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null, options.limit + 1,
      ])
      const hasMore = rows.rows.length > options.limit
      const items = rows.rows.slice(0, options.limit).map(mapApproval)
      const last = hasMore ? items.at(-1) : undefined
      return {
        items,
        hasMore,
        nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    })
  }

  async getApproval(
    organizationId: string,
    spaceId: string,
    approvalId: string,
    actorId: string,
  ): Promise<ApprovalDto | null> {
    return transaction(this.pool, { organizationId, spaceId, actorId }, async (client) => {
      const result = await client.query<ApprovalRow>(`
        SELECT ${approvalColumns}
        FROM cosmos_approvals approval
        WHERE approval.organization_id = $1 AND approval.space_id = $2 AND approval.id = $3
      `, [organizationId, spaceId, approvalId])
      return result.rows[0] ? mapApproval(result.rows[0]) : null
    })
  }

  async decideApproval(record: DecideApprovalRecord): Promise<ApprovalDecisionResult | null> {
    const outcome = await transaction(this.pool, {
      organizationId: record.organizationId,
      spaceId: record.spaceId,
      actorId: record.actorId,
    }, (client) => this.decideInTransaction(client, record))
    if (outcome?.kind === 'expired') throw new ApprovalAlreadyDecidedError(outcome.status)
    return outcome?.result ?? null
  }

  private async decideInTransaction(
    client: PoolClient,
    record: DecideApprovalRecord,
  ): Promise<DecisionOutcome | null> {
    const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/approvals/${record.approvalId}/decision`
    const idempotency = await this.prepareIdempotency(client, {
      ...record,
      method: 'POST',
      canonicalPath,
      request: record.request,
    })
    if (idempotency.responseBody) {
      return { kind: 'success', result: { approval: ApprovalDtoSchema.parse(idempotency.responseBody), replayed: true } }
    }

    const selected = await client.query<ApprovalRow>(`
      SELECT approval.*
      FROM cosmos_approvals approval
      WHERE approval.organization_id = $1 AND approval.space_id = $2 AND approval.id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.approvalId])
    const row = selected.rows[0]
    if (!row) return null

    const assignments = await client.query<{ actor_id: string }>(`
      SELECT actor_id FROM cosmos_approval_assignments
      WHERE organization_id = $1 AND space_id = $2 AND approval_id = $3
      ORDER BY actor_id
    `, [record.organizationId, record.spaceId, record.approvalId])
    row.assigned_to = assignments.rows.map(({ actor_id }) => actor_id)
    const before = mapApproval(row)
    const priorDecision = await client.query<{ decision: string }>(`
      SELECT decision FROM cosmos_approval_decisions
      WHERE organization_id = $1 AND space_id = $2 AND approval_id = $3 AND actor_id = $4
    `, [record.organizationId, record.spaceId, record.approvalId, record.actorId])
    if (priorDecision.rows[0]) {
      before.actorHasDecided = true
      if (priorDecision.rows[0].decision !== record.request.decision) {
        throw new ApprovalDecisionConflictError()
      }
      await this.saveIdempotency(client, {
        ...record, canonicalPath, method: 'POST', keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, expiresAt: idempotency.expiresAt,
        sessionId: before.sessionId, response: before,
      })
      return { kind: 'success', result: { approval: before, replayed: true } }
    }
    if (before.status !== 'pending') throw new ApprovalAlreadyDecidedError(before.status)
    if (before.version !== record.expectedVersion) {
      throw new ApprovalVersionConflictError(record.expectedVersion, before.version)
    }

    const permitted = await client.query(`
      SELECT 1
      WHERE EXISTS (
        SELECT 1 FROM cosmos_approval_assignments assignment
        WHERE assignment.organization_id = $1 AND assignment.space_id = $2
          AND assignment.approval_id = $3 AND assignment.actor_id = $4
      ) OR EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = $1 AND membership.actor_id = $4
          AND membership.role IN ('organization_owner', 'organization_admin')
      ) OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = $1 AND membership.space_id = $2
          AND membership.actor_id = $4 AND membership.role = 'space_manager'
      )
    `, [record.organizationId, record.spaceId, record.approvalId, record.actorId])
    if (!permitted.rowCount || before.requestedBy === record.actorId) {
      throw new ApprovalPermissionDeniedError()
    }

    const occurredAt = idempotency.now.toISOString()
    if (Date.parse(before.expiresAt) <= idempotency.now.getTime()) {
      const expired = await this.transitionExpired(client, before, record, occurredAt)
      return { kind: 'expired', status: expired.status }
    }

    await client.query(`
      INSERT INTO cosmos_approval_decisions (
        organization_id, space_id, approval_id, id, actor_id, decision,
        note, input_hash, idempotency_key_hash, decided_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      record.organizationId, record.spaceId, record.approvalId, this.createId(),
      record.actorId, record.request.decision, record.request.note ?? '', row.input_hash,
      idempotency.keyHash, occurredAt,
    ])

    const nextApprovalCount = record.request.decision === 'approved'
      ? before.approvalCount + 1
      : before.approvalCount
    const finalStatus = record.request.decision === 'approved'
      ? (nextApprovalCount === before.requiredApprovals ? 'approved' : 'pending')
      : record.request.decision
    const terminal = finalStatus !== 'pending'
    const updated = await client.query<ApprovalRow>(`
      UPDATE cosmos_approvals approval
      SET status = $4, approval_count = $5,
        decided_by = CASE WHEN $6 THEN $7 ELSE NULL END,
        decision_note = CASE WHEN $6 THEN $8 ELSE NULL END,
        decided_at = CASE WHEN $6 THEN $9::timestamptz ELSE NULL END,
        updated_at = $9, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING approval.*
    `, [
      record.organizationId, record.spaceId, record.approvalId, finalStatus,
      nextApprovalCount, terminal, record.actorId, record.request.note ?? '', occurredAt,
    ])
    const updatedRow = updated.rows[0]
    updatedRow.assigned_to = row.assigned_to
    updatedRow.actor_has_decided = true
    const approval = mapApproval(updatedRow)

    let toolCall: ToolCallDto | null = null
    let resumedSessionVersion: number | null = null
    if (terminal) {
      const toolStatus = finalStatus === 'approved' ? 'queued' : 'canceled'
      const tool = await client.query<ToolCallRow>(`
        UPDATE cosmos_tool_calls
        SET status = $5,
          completed_at = CASE WHEN $5 = 'canceled' THEN $6::timestamptz ELSE NULL END,
          version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'approval_required' AND approval_id = $7
        RETURNING ${toolCallColumns}
      `, [
        record.organizationId, record.spaceId, before.sessionId, before.toolCallId,
        toolStatus, occurredAt, before.id,
      ])
      if (!tool.rows[0]) throw new Error('The Approval no longer gates its exact ToolCall.')
      toolCall = mapToolCall(tool.rows[0])
      resumedSessionVersion = await this.resumeParentExecution(client, toolCall, occurredAt)
    }
    await this.appendDecisionLedgers(
      client, record, before, approval, toolCall, resumedSessionVersion,
      idempotency.keyHash, occurredAt,
    )
    await this.saveIdempotency(client, {
      ...record, canonicalPath, method: 'POST', keyHash: idempotency.keyHash,
      requestHash: idempotency.requestHash, expiresAt: idempotency.expiresAt,
      sessionId: approval.sessionId, response: approval,
    })
    return { kind: 'success', result: { approval, replayed: false } }
  }

  private async transitionExpired(
    client: PoolClient,
    before: ApprovalDto,
    record: DecideApprovalRecord,
    occurredAt: string,
  ) {
    const updated = await client.query<ApprovalRow>(`
      UPDATE cosmos_approvals approval
      SET status = 'expired', decided_at = $4, updated_at = $4, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING approval.*
    `, [record.organizationId, record.spaceId, record.approvalId, occurredAt])
    const row = updated.rows[0]
    row.assigned_to = before.assignedTo
    const approval = mapApproval(row)
    const tool = await client.query<ToolCallRow>(`
      UPDATE cosmos_tool_calls
      SET status = 'canceled', completed_at = $5, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        AND status = 'approval_required'
      RETURNING ${toolCallColumns}
    `, [record.organizationId, record.spaceId, before.sessionId, before.toolCallId, occurredAt])
    if (!tool.rows[0]) throw new Error('The expired Approval no longer gates its ToolCall.')
    const toolCall = mapToolCall(tool.rows[0])
    const resumedSessionVersion = await this.resumeParentExecution(client, toolCall, occurredAt)
    await this.appendDecisionLedgers(
      client, record, before, approval, toolCall, resumedSessionVersion, null, occurredAt,
    )
    return approval
  }

  private async resumeParentExecution(
    client: PoolClient,
    toolCall: ToolCallDto,
    occurredAt: string,
  ) {
    await client.query(`
      UPDATE cosmos_attempts
      SET status = 'running', heartbeat_at = $6
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND turn_id = $4 AND id = $5 AND status = 'waiting'
    `, [
      toolCall.organizationId, toolCall.spaceId, toolCall.sessionId,
      toolCall.turnId, toolCall.attemptId, occurredAt,
    ])
    await client.query(`
      UPDATE cosmos_turns
      SET status = 'running', heartbeat_at = $5, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND id = $4 AND status = 'waiting_approval'
    `, [
      toolCall.organizationId, toolCall.spaceId, toolCall.sessionId, toolCall.turnId, occurredAt,
    ])
    const session = await client.query<{ version: number }>(`
      UPDATE cosmos_sessions
      SET status = 'active', updated_at = $4, last_activity_at = $4, version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND id = $3 AND status = 'waiting'
      RETURNING version
    `, [toolCall.organizationId, toolCall.spaceId, toolCall.sessionId, occurredAt])
    return session.rows[0]?.version ?? null
  }

  private async appendDecisionLedgers(
    client: PoolClient,
    record: DecideApprovalRecord,
    before: ApprovalDto,
    approval: ApprovalDto,
    toolCall: ToolCallDto | null,
    resumedSessionVersion: number | null,
    idempotencyKeyHash: string | null,
    occurredAt: string,
  ) {
    const eventCount = 1 + (toolCall ? 1 : 0) + (resumedSessionVersion === null ? 0 : 1)
    const reservation = await client.query<{ sequence: string }>(`
      UPDATE cosmos_sessions SET last_event_sequence = last_event_sequence + $4
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
      RETURNING last_event_sequence AS sequence
    `, [record.organizationId, record.spaceId, approval.sessionId, eventCount])
    if (!reservation.rows[0]) throw new Error('The Approval event sequence could not be reserved.')
    const lastSequence = Number(reservation.rows[0].sequence)
    const approvalSequence = lastSequence - eventCount + 1
    await client.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        tool_call_id, approval_id, request_id, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'approval.decided', 'approval', $6,
        $7::jsonb, $8, 'user', $9, $10, $6, $11, $12)
    `, [
      record.organizationId, record.spaceId, approval.sessionId, this.createId(),
      approvalSequence, approval.id, JSON.stringify({
        approvalId: approval.id,
        toolCallId: approval.toolCallId,
        recordedDecision: approval.status === 'expired' ? 'expired' : record.request.decision,
        status: approval.status,
        approvalCount: approval.approvalCount,
        requiredApprovals: approval.requiredApprovals,
        version: approval.version,
      }), record.actorId, approval.turnId, approval.toolCallId, record.requestId, occurredAt,
    ])
    if (toolCall) {
      await client.query(`
        INSERT INTO cosmos_session_events (
          organization_id, space_id, session_id, event_id, sequence, event_type,
          resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
          attempt_id, tool_call_id, approval_id, request_id, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, 'tool_call.updated', 'tool_call', $6,
          $7::jsonb, $8, 'user', $9, $10, $6, $11, $12, $13)
      `, [
        record.organizationId, record.spaceId, approval.sessionId, this.createId(),
        approvalSequence + 1, toolCall.id, JSON.stringify({
          toolCallId: toolCall.id, turnId: toolCall.turnId, attemptId: toolCall.attemptId,
          toolName: toolCall.toolName, operation: toolCall.operation,
          riskLevel: toolCall.riskLevel, status: toolCall.status,
          approvalId: toolCall.approvalId, version: toolCall.version,
        }), record.actorId, toolCall.turnId, toolCall.attemptId, approval.id,
        record.requestId, occurredAt,
      ])
    }
    if (resumedSessionVersion !== null) {
      await client.query(`
        INSERT INTO cosmos_session_events (
          organization_id, space_id, session_id, event_id, sequence, event_type,
          resource_type, resource_id, payload, actor_id, actor_kind, request_id, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, 'session.updated', 'session', $3,
          $6::jsonb, $7, 'user', $8, $9)
      `, [
        record.organizationId, record.spaceId, approval.sessionId, this.createId(),
        lastSequence, JSON.stringify({ status: 'active', version: resumedSessionVersion }),
        record.actorId, record.requestId, occurredAt,
      ])
    }
    await client.query(`
      INSERT INTO cosmos_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, delegation_chain, action, target_type, target_id, result,
        request_id, idempotency_key_hash, policy_decision, policy_reason,
        before_state, after_state, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'user', '[]'::jsonb, 'approval.decision',
        'approval', $6, 'success', $7, $8, 'allow', $9, $10::jsonb, $11::jsonb, $12)
    `, [
      record.organizationId, this.createId(), record.spaceId, approval.sessionId,
      record.actorId, approval.id, record.requestId, idempotencyKeyHash,
      approval.status === 'expired' ? 'approval_expired' : 'authorized_approval_decision',
      JSON.stringify({ status: before.status, approvalCount: before.approvalCount, version: before.version }),
      JSON.stringify({ status: approval.status, approvalCount: approval.approvalCount, version: approval.version }),
      occurredAt,
    ])
    await client.query(`
      INSERT INTO cosmos_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, 'approval', $5, 'approval.decided', $6::jsonb, $7)
    `, [
      this.createId(), record.organizationId, record.spaceId, approval.sessionId,
      approval.id, JSON.stringify({
        sessionId: approval.sessionId, toolCallId: approval.toolCallId,
        status: approval.status, version: approval.version,
      }), occurredAt,
    ])
  }

  private async prepareIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      actorId: string
      idempotencyKey: string
      canonicalPath: string
      method: 'POST'
      request: unknown
    },
  ) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([
      input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash,
    ])])
    const now = this.now()
    const existing = await client.query<{ request_hash: string; response_body: unknown | null }>(`
      SELECT idempotency.request_hash, response.response_body
      FROM cosmos_idempotency_records idempotency
      LEFT JOIN cosmos_idempotency_responses response
        ON response.organization_id = idempotency.organization_id
        AND response.actor_id = idempotency.actor_id
        AND response.method = idempotency.method
        AND response.canonical_path = idempotency.canonical_path
        AND response.idempotency_key_hash = idempotency.idempotency_key_hash
        AND response.expires_at > $6
      WHERE idempotency.organization_id = $1 AND idempotency.actor_id = $2
        AND idempotency.method = $3 AND idempotency.canonical_path = $4
        AND idempotency.idempotency_key_hash = $5 AND idempotency.expires_at > $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    if (existing.rowCount) {
      if (existing.rows[0].request_hash !== requestHash) throw new IdempotencyConflictError()
      if (!existing.rows[0].response_body) throw new Error('The idempotent Approval response is unavailable.')
      return {
        keyHash, requestHash, now,
        expiresAt: new Date(now.getTime() + this.idempotencyTtlMs).toISOString(),
        responseBody: existing.rows[0].response_body,
      }
    }
    await client.query(`
      DELETE FROM cosmos_idempotency_responses
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    await client.query(`
      DELETE FROM cosmos_idempotency_records
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    return {
      keyHash, requestHash, now,
      expiresAt: new Date(now.getTime() + this.idempotencyTtlMs).toISOString(),
      responseBody: null,
    }
  }

  private async saveIdempotency(
    client: PoolClient,
    input: {
      organizationId: string
      spaceId: string
      sessionId: string
      actorId: string
      canonicalPath: string
      method: 'POST'
      keyHash: string
      requestHash: string
      expiresAt: string
      response: ApprovalDto
    },
  ) {
    await client.query(`
      INSERT INTO cosmos_idempotency_records (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, session_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      input.organizationId, input.spaceId, input.actorId, input.method,
      input.canonicalPath, input.keyHash, input.requestHash, input.sessionId, input.expiresAt,
    ])
    await client.query(`
      INSERT INTO cosmos_idempotency_responses (
        organization_id, actor_id, method, canonical_path, idempotency_key_hash,
        status_code, response_body, response_headers, expires_at
      ) VALUES ($1, $2, $3, $4, $5, 200, $6::jsonb, $7::jsonb, $8)
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      input.keyHash, JSON.stringify(input.response),
      JSON.stringify({ etag: `"${input.response.version}"` }), input.expiresAt,
    ])
  }
}
