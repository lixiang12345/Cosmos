import { createHash, randomUUID } from 'node:crypto'
import {
  AdvisorPlanDtoSchema,
  AdvisorPlanProposalSchema,
  AdvisorPlanStepDtoSchema,
  AdvisorSpaceStateSchema,
  type AdvisorPlanDto,
  type AdvisorPlanStepDto,
  type AdvisorSpaceState,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import {
  AdvisorPlanIdempotencyConflictError,
  AdvisorPlanPermissionError,
  AdvisorPlanStateConflictError,
  AdvisorPlanValidationError,
  AdvisorPlanVersionConflictError,
  type AdvisorPlanMutationResult,
  type AdvisorPlanRepository,
  type AdvisorPlanScope,
  type DecideAdvisorPlanRecord,
  type ProposeAdvisorPlanRecord,
  type RetryAdvisorPlanRecord,
} from './advisor-plan-repository.js'
import { queryWithApiDatabaseContext, withApiDatabaseContext } from './postgres-runtime-database.js'

type TimestampValue = Date | string
type PlanRow = {
  organization_id: string
  space_id: string
  session_id: string
  id: string
  summary: string
  dependencies: unknown
  risks: unknown
  status: AdvisorPlanDto['status']
  requested_by: string
  confirmed_by: string | null
  confirmed_at: TimestampValue | null
  created_at: TimestampValue
  updated_at: TimestampValue
  version: number
}
type StepRow = {
  organization_id: string
  space_id: string
  session_id: string
  plan_id: string
  id: string
  ordinal: number
  kind: AdvisorPlanStepDto['kind']
  operation: string | null
  target_type: 'space' | null
  target_id: string | null
  rationale: string | null
  before_state: unknown
  after_state: unknown
  manual_action: unknown
  risk_level: AdvisorPlanStepDto['riskLevel']
  status: AdvisorPlanStepDto['status']
  failure_code: string | null
  failure_message: string | null
  started_at: TimestampValue | null
  completed_at: TimestampValue | null
  version: number
}

const planColumns = `organization_id, space_id, session_id, id, summary, dependencies,
  risks, status, requested_by, confirmed_by, confirmed_at, created_at, updated_at, version`
const stepColumns = `organization_id, space_id, session_id, plan_id, id, ordinal, kind,
  operation, target_type, target_id, rationale, before_state, after_state, manual_action,
  risk_level, status, failure_code, failure_message, started_at, completed_at, version`
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

function mapStep(row: StepRow): AdvisorPlanStepDto {
  return AdvisorPlanStepDtoSchema.parse({
    id: row.id,
    ordinal: row.ordinal,
    kind: row.kind,
    operation: row.operation,
    targetType: row.target_type,
    targetId: row.target_id,
    rationale: row.rationale,
    before: row.before_state,
    after: row.after_state,
    manualAction: row.manual_action,
    riskLevel: row.risk_level,
    status: row.status,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    startedAt: row.started_at === null ? null : timestamp(row.started_at),
    completedAt: row.completed_at === null ? null : timestamp(row.completed_at),
    version: row.version,
  })
}

function mapPlan(row: PlanRow, steps: StepRow[]): AdvisorPlanDto {
  return AdvisorPlanDtoSchema.parse({
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    id: row.id,
    summary: row.summary,
    dependencies: row.dependencies,
    risks: row.risks,
    status: row.status,
    steps: steps.filter((step) => step.plan_id === row.id)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(mapStep),
    requestedBy: row.requested_by,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : timestamp(row.confirmed_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    version: row.version,
  })
}

async function readPlans(
  client: PoolClient,
  organizationId: string,
  spaceId: string,
  sessionId: string,
  planId?: string,
) {
  const plans = await client.query<PlanRow>(`
    SELECT ${planColumns} FROM relay_advisor_plans
    WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
      AND ($4::text IS NULL OR id = $4)
    ORDER BY created_at, id LIMIT 50
  `, [organizationId, spaceId, sessionId, planId ?? null])
  if (!plans.rowCount) return []
  const steps = await client.query<StepRow>(`
    SELECT ${stepColumns} FROM relay_advisor_plan_steps
    WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
      AND plan_id = ANY($4::text[])
    ORDER BY plan_id, ordinal
  `, [organizationId, spaceId, sessionId, plans.rows.map((plan) => plan.id)])
  return plans.rows.map((plan) => mapPlan(plan, steps.rows))
}

type PostgresAdvisorPlanRepositoryOptions = {
  createId?: () => string
  now?: () => Date
}

export class PostgresAdvisorPlanRepository implements AdvisorPlanRepository {
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(private readonly pool: Pool, options: PostgresAdvisorPlanRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  private async assertManager(client: PoolClient, scope: AdvisorPlanScope) {
    const result = await client.query(`
      SELECT 1 WHERE EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = $1 AND membership.actor_id = $3
          AND membership.role IN ('organization_owner', 'organization_admin')
      ) OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = $1 AND membership.space_id = $2
          AND membership.actor_id = $3 AND membership.role = 'space_manager'
      )
    `, [scope.organizationId, scope.spaceId, scope.actorId])
    if (!result.rowCount) throw new AdvisorPlanPermissionError()
  }

  private async appendLedger(client: PoolClient, input: AdvisorPlanScope & {
    planId: string
    action: 'advisor.plan.propose' | 'advisor.plan.decision' | 'advisor.plan.execute' | 'advisor.plan.retry'
    before: Record<string, unknown> | null
    after: Record<string, unknown>
    idempotencyKeyHash?: string | null
  }) {
    const occurredAt = this.now().toISOString()
    await client.query(`
      INSERT INTO relay_audit_events (
        organization_id, audit_event_id, space_id, session_id, actor_id,
        actor_kind, delegation_chain, action, target_type, target_id, result,
        request_id, idempotency_key_hash, policy_decision, policy_reason,
        before_state, after_state, occurred_at
      ) VALUES ($1,$2,$3,$4,$5,'user','[]'::jsonb,$6,'advisor_plan',$7,'success',
        $8,$9,'allow','advisor_controlled_execution',$10::jsonb,$11::jsonb,$12)
    `, [
      input.organizationId, this.createId(), input.spaceId, input.sessionId,
      input.actorId, input.action, input.planId, input.requestId,
      input.idempotencyKeyHash ?? null,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after), occurredAt,
    ])
    await client.query(`
      INSERT INTO relay_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type,
        aggregate_id, event_type, payload, occurred_at
      ) VALUES ($1,$2,$3,$4,'advisor_plan',$5,$6,$7::jsonb,$8)
    `, [
      this.createId(), input.organizationId, input.spaceId, input.sessionId,
      input.planId, input.action, JSON.stringify({ status: input.after.status }), occurredAt,
    ])
  }

  private async prepareIdempotency(client: PoolClient, input: AdvisorPlanScope & {
    method: 'POST'
    canonicalPath: string
    idempotencyKey: string
    request: unknown
  }) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    const now = this.now()
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [canonicalJson([
      input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash,
    ])])
    await client.query(`DELETE FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6`, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    const existing = await client.query<{ request_hash: string; response_body: unknown }>(`
      SELECT request_hash, response_body FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at > $6
    `, [
      input.organizationId, input.actorId, input.method, input.canonicalPath,
      keyHash, now.toISOString(),
    ])
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new AdvisorPlanIdempotencyConflictError()
      return { keyHash, requestHash, replay: AdvisorPlanDtoSchema.parse(existing.rows[0].response_body) }
    }
    return { keyHash, requestHash, replay: null }
  }

  private async saveIdempotency(client: PoolClient, input: AdvisorPlanScope & {
    canonicalPath: string
    keyHash: string
    requestHash: string
    plan: AdvisorPlanDto
  }) {
    await client.query(`
      INSERT INTO relay_control_plane_idempotency (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, status_code, response_body,
        response_headers, expires_at
      ) VALUES ($1,$2,$3,'POST',$4,$5,$6,200,$7::jsonb,$8::jsonb,$9)
    `, [
      input.organizationId, input.spaceId, input.actorId, input.canonicalPath,
      input.keyHash, input.requestHash, JSON.stringify(input.plan),
      JSON.stringify({ etag: `"${input.plan.version}"` }),
      new Date(this.now().getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    ])
  }

  async proposePlan(record: ProposeAdvisorPlanRecord): Promise<AdvisorPlanDto> {
    const proposal = AdvisorPlanProposalSchema.parse(record.proposal)
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const providerToolCallHash = hash(record.providerToolCallId)
      const existing = await client.query<{ id: string }>(`
        SELECT id FROM relay_advisor_plans
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND provider_tool_call_hash = $4
      `, [record.organizationId, record.spaceId, record.sessionId, providerToolCallHash])
      if (existing.rows[0]) {
        const replay = await readPlans(
          client, record.organizationId, record.spaceId, record.sessionId, existing.rows[0].id,
        )
        if (!replay[0]) throw new Error('The replayed Advisor plan could not be read.')
        return replay[0]
      }

      const authority = await client.query<{
        name: string
        description: string
        default_expert_id: string | null
        default_environment_id: string | null
        is_default: boolean
        version: number
      }>(`
        SELECT space.name, space.description, space.default_expert_id,
          space.default_environment_id,
          COALESCE(organization.default_space_id = space.id, false) AS is_default,
          space.version
        FROM relay_sessions session_record
        JOIN relay_experts expert ON expert.organization_id = session_record.organization_id
          AND expert.space_id = session_record.space_id AND expert.id = session_record.expert_id
        JOIN relay_expert_revisions revision
          ON revision.organization_id = session_record.organization_id
          AND revision.space_id = session_record.space_id
          AND revision.expert_id = session_record.expert_id
          AND revision.id = session_record.expert_revision_id
        JOIN relay_spaces space ON space.organization_id = session_record.organization_id
          AND space.id = session_record.space_id
        JOIN relay_organizations organization ON organization.id = space.organization_id
        JOIN relay_organization_memberships organization_membership
          ON organization_membership.organization_id = session_record.organization_id
          AND organization_membership.actor_id = $4 AND organization_membership.role <> 'viewer'
        JOIN relay_space_memberships space_membership
          ON space_membership.organization_id = session_record.organization_id
          AND space_membership.space_id = session_record.space_id
          AND space_membership.actor_id = $4 AND space_membership.role <> 'viewer'
        WHERE session_record.organization_id = $1 AND session_record.space_id = $2
          AND session_record.id = $3 AND expert.kind = 'built_in'
          AND revision.status = 'published'
          AND (revision.configuration -> 'capabilities') ? 'advisor.control_plane.plan'
          AND NOT EXISTS (SELECT 1 FROM relay_service_accounts service_account
            WHERE service_account.organization_id = $1 AND service_account.id = $4)
      `, [record.organizationId, record.spaceId, record.sessionId, record.actorId])
      const current = authority.rows[0]
      if (!current) throw new AdvisorPlanPermissionError('Only a human writer using the built-in Advisor can propose a plan.')
      const before = AdvisorSpaceStateSchema.parse({
        name: current.name,
        description: current.description,
        defaultExpertId: current.default_expert_id,
        defaultEnvironmentId: current.default_environment_id,
        isDefault: current.is_default,
        version: current.version,
      })
      const planId = this.createId()
      const occurredAt = this.now().toISOString()
      const steps: Array<{
        id: string
        ordinal: number
        kind: 'control_plane' | 'manual_action'
        operation: 'space.update' | 'organization.set_default_space' | null
        targetType: 'space' | null
        targetId: string | null
        rationale: string | null
        before: AdvisorSpaceState | null
        after: AdvisorSpaceState | null
        manualAction: { kind: 'oauth' | 'secret'; label: string; instructions: string } | null
        riskLevel: 'medium' | 'high'
      }> = []
      for (const [index, step] of proposal.steps.entries()) {
        if (step.kind === 'manual_action') {
          steps.push({
            id: this.createId(), ordinal: index + 1, kind: step.kind,
            operation: null, targetType: null, targetId: null, rationale: null,
            before: null, after: null,
            manualAction: { kind: step.action, label: step.label, instructions: step.instructions },
            riskLevel: 'high',
          })
          continue
        }
        let after: AdvisorSpaceState
        if (step.operation === 'space.update') {
          const changes = step.changes
          if (changes.defaultExpertId) {
            const valid = await client.query(`SELECT 1 FROM relay_experts
              WHERE organization_id = $1 AND space_id = $2 AND id = $3
                AND status = 'published'`, [record.organizationId, record.spaceId, changes.defaultExpertId])
            if (!valid.rowCount) throw new AdvisorPlanValidationError('Default Expert must be published in the current Space.', 'steps.changes.defaultExpertId')
          }
          if (changes.defaultEnvironmentId) {
            const valid = await client.query(`SELECT 1 FROM relay_environments
              WHERE organization_id = $1 AND space_id = $2 AND id = $3
                AND status = 'ready'`, [record.organizationId, record.spaceId, changes.defaultEnvironmentId])
            if (!valid.rowCount) throw new AdvisorPlanValidationError('Default Environment must be ready in the current Space.', 'steps.changes.defaultEnvironmentId')
          }
          after = AdvisorSpaceStateSchema.parse({
            ...before,
            ...(changes.description !== undefined ? { description: changes.description } : {}),
            ...(changes.defaultExpertId !== undefined ? { defaultExpertId: changes.defaultExpertId } : {}),
            ...(changes.defaultEnvironmentId !== undefined ? { defaultEnvironmentId: changes.defaultEnvironmentId } : {}),
            version: before.version + 1,
          })
        } else {
          after = AdvisorSpaceStateSchema.parse({ ...before, isDefault: true, version: before.version + 1 })
        }
        if (canonicalJson({ ...after, version: before.version }) === canonicalJson(before)) {
          throw new AdvisorPlanValidationError('The proposed controlled step does not change current authority.', 'steps')
        }
        steps.push({
          id: this.createId(), ordinal: index + 1, kind: step.kind,
          operation: step.operation, targetType: 'space', targetId: record.spaceId,
          rationale: step.rationale, before, after, manualAction: null,
          riskLevel: step.operation === 'organization.set_default_space' ? 'high' : 'medium',
        })
      }

      await client.query(`
        INSERT INTO relay_advisor_plans (
          organization_id, space_id, session_id, id, provider_tool_call_hash,
          summary, dependencies, risks, status, requested_by, created_at, updated_at, version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'proposed',$9,$10,$10,1)
      `, [
        record.organizationId, record.spaceId, record.sessionId, planId,
        providerToolCallHash, proposal.summary, JSON.stringify(proposal.dependencies),
        JSON.stringify(proposal.risks), record.actorId, occurredAt,
      ])
      for (const step of steps) {
        await client.query(`
          INSERT INTO relay_advisor_plan_steps (
            organization_id, space_id, session_id, plan_id, id, ordinal, kind,
            operation, target_type, target_id, rationale, before_state, after_state,
            manual_action, risk_level, status, version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,'proposed',1)
        `, [
          record.organizationId, record.spaceId, record.sessionId, planId,
          step.id, step.ordinal, step.kind, step.operation, step.targetType,
          step.targetId, step.rationale,
          step.before === null ? null : JSON.stringify(step.before),
          step.after === null ? null : JSON.stringify(step.after),
          step.manualAction === null ? null : JSON.stringify(step.manualAction),
          step.riskLevel,
        ])
      }
      const inserted = await readPlans(client, record.organizationId, record.spaceId, record.sessionId, planId)
      const plan = inserted[0]
      if (!plan) throw new Error('The proposed Advisor plan could not be read back.')
      await this.appendLedger(client, {
        ...record, planId, action: 'advisor.plan.propose', before: null,
        after: { status: plan.status, version: plan.version },
      })
      return plan
    })
  }

  async listPlans(organizationId: string, spaceId: string, sessionId: string, actorId: string) {
    return withApiDatabaseContext(this.pool, { organizationId, spaceId, actorId }, async (client) => {
      const session = await client.query(`SELECT 1 FROM relay_sessions
        WHERE organization_id = $1 AND space_id = $2 AND id = $3`, [organizationId, spaceId, sessionId])
      if (!session.rowCount) return null
      return readPlans(client, organizationId, spaceId, sessionId)
    })
  }

  async getPlan(organizationId: string, spaceId: string, sessionId: string, planId: string, actorId: string) {
    const result = await queryWithApiDatabaseContext<PlanRow>(this.pool, { organizationId, spaceId, actorId }, `
      SELECT ${planColumns} FROM relay_advisor_plans
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
    `, [organizationId, spaceId, sessionId, planId])
    if (!result.rows[0]) return null
    return withApiDatabaseContext(this.pool, { organizationId, spaceId, actorId }, async (client) => (
      (await readPlans(client, organizationId, spaceId, sessionId, planId))[0] ?? null
    ))
  }

  async decidePlan(record: DecideAdvisorPlanRecord): Promise<AdvisorPlanMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      await this.assertManager(client, record)
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/advisor/plans/${record.planId}/decision`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath, request: record.request,
      })
      if (idempotency.replay) return { plan: idempotency.replay, replayed: true }
      const selected = await client.query<PlanRow>(`SELECT ${planColumns}
        FROM relay_advisor_plans WHERE organization_id = $1 AND space_id = $2
          AND session_id = $3 AND id = $4 FOR UPDATE`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
      ])
      const before = selected.rows[0]
      if (!before) return null
      if (before.version !== record.expectedVersion) {
        throw new AdvisorPlanVersionConflictError(record.expectedVersion, before.version)
      }
      if (before.status !== 'proposed') {
        throw new AdvisorPlanStateConflictError('Only a proposed Advisor plan can be decided.')
      }
      const occurredAt = this.now().toISOString()
      const status = record.request.decision === 'confirmed' ? 'executing' : 'rejected'
      if (status === 'rejected') {
        await client.query(`UPDATE relay_advisor_plan_steps SET status = 'rejected',
          completed_at = $5, version = version + 1
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            AND plan_id = $4 AND status = 'proposed'`, [
          record.organizationId, record.spaceId, record.sessionId, record.planId, occurredAt,
        ])
      }
      await client.query(`UPDATE relay_advisor_plans SET status = $5,
        confirmed_by = CASE WHEN $5 = 'executing' THEN $6 ELSE NULL END,
        confirmed_at = CASE WHEN $5 = 'executing' THEN $7::timestamptz ELSE NULL END,
        decision_note = $8, updated_at = $7, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
        status, record.actorId, occurredAt, record.request.note ?? null,
      ])
      const plan = (await readPlans(client, record.organizationId, record.spaceId, record.sessionId, record.planId))[0]
      if (!plan) throw new Error('The decided Advisor plan could not be read back.')
      await this.appendLedger(client, {
        ...record, action: 'advisor.plan.decision',
        before: { status: before.status, version: before.version },
        after: { status: plan.status, version: plan.version },
        idempotencyKeyHash: idempotency.keyHash,
      })
      await this.saveIdempotency(client, {
        ...record, canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, plan,
      })
      return { plan, replayed: false }
    })
  }

  async prepareRetry(record: RetryAdvisorPlanRecord): Promise<AdvisorPlanMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      await this.assertManager(client, record)
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/sessions/${record.sessionId}/advisor/plans/${record.planId}/retry`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath, request: {},
      })
      if (idempotency.replay) return { plan: idempotency.replay, replayed: true }
      const selected = await client.query<PlanRow>(`SELECT ${planColumns}
        FROM relay_advisor_plans WHERE organization_id = $1 AND space_id = $2
          AND session_id = $3 AND id = $4 FOR UPDATE`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
      ])
      const before = selected.rows[0]
      if (!before) return null
      if (before.version !== record.expectedVersion) throw new AdvisorPlanVersionConflictError(record.expectedVersion, before.version)
      if (before.status !== 'failed') throw new AdvisorPlanStateConflictError('Only a failed Advisor plan can be retried.')
      const occurredAt = this.now().toISOString()
      await client.query(`UPDATE relay_advisor_plans SET status = 'executing',
        updated_at = $5, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId, occurredAt,
      ])
      const plan = (await readPlans(client, record.organizationId, record.spaceId, record.sessionId, record.planId))[0]
      if (!plan) throw new Error('The retried Advisor plan could not be read back.')
      await this.appendLedger(client, {
        ...record, action: 'advisor.plan.retry',
        before: { status: before.status, version: before.version },
        after: { status: plan.status, version: plan.version },
        idempotencyKeyHash: idempotency.keyHash,
      })
      await this.saveIdempotency(client, {
        ...record, canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, plan,
      })
      return { plan, replayed: false }
    })
  }

  async startStep(record: AdvisorPlanScope & { planId: string; stepId: string; expectedVersion: number }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      await this.assertManager(client, record)
      const plan = await client.query<{ status: string }>(`SELECT status FROM relay_advisor_plans
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4 FOR UPDATE`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
      ])
      if (plan.rows[0]?.status !== 'executing') throw new AdvisorPlanStateConflictError('The Advisor plan is not executing.')
      const occurredAt = this.now().toISOString()
      const updated = await client.query<StepRow>(`UPDATE relay_advisor_plan_steps
        SET status = 'executing', failure_code = NULL, failure_message = NULL,
          started_at = $7, completed_at = NULL, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND plan_id = $4 AND id = $5 AND version = $6 AND status IN ('proposed','failed')
        RETURNING ${stepColumns}`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
        record.stepId, record.expectedVersion, occurredAt,
      ])
      return updated.rows[0] ? mapStep(updated.rows[0]) : null
    })
  }

  async finishStep(record: AdvisorPlanScope & {
    planId: string
    stepId: string
    expectedVersion: number
    status: 'succeeded' | 'failed' | 'action_required'
    failureCode?: string
    failureMessage?: string
  }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      await this.assertManager(client, record)
      const occurredAt = this.now().toISOString()
      const expectedStatus = record.status === 'action_required' ? 'proposed' : 'executing'
      const updated = await client.query<StepRow>(`UPDATE relay_advisor_plan_steps
        SET status = $7, failure_code = $8, failure_message = $9,
          completed_at = $10, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND plan_id = $4 AND id = $5 AND version = $6 AND status = $11
        RETURNING ${stepColumns}`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
        record.stepId, record.expectedVersion, record.status,
        record.failureCode ?? null, record.failureMessage ?? null, occurredAt, expectedStatus,
      ])
      return updated.rows[0] ? mapStep(updated.rows[0]) : null
    })
  }

  async finishPlan(record: AdvisorPlanScope & {
    planId: string
    expectedVersion: number
    status: 'succeeded' | 'failed' | 'action_required'
  }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      await this.assertManager(client, record)
      const selected = await client.query<PlanRow>(`SELECT ${planColumns}
        FROM relay_advisor_plans WHERE organization_id = $1 AND space_id = $2
          AND session_id = $3 AND id = $4 FOR UPDATE`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
      ])
      const before = selected.rows[0]
      if (!before) return null
      if (before.version !== record.expectedVersion) throw new AdvisorPlanVersionConflictError(record.expectedVersion, before.version)
      if (before.status !== 'executing') throw new AdvisorPlanStateConflictError('The Advisor plan is not executing.')
      const statuses = await client.query<{ status: AdvisorPlanStepDto['status'] }>(`
        SELECT status FROM relay_advisor_plan_steps
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND plan_id = $4
      `, [record.organizationId, record.spaceId, record.sessionId, record.planId])
      const expected = statuses.rows.some((step) => step.status === 'failed')
        ? 'failed'
        : statuses.rows.some((step) => step.status === 'action_required')
          ? 'action_required'
          : statuses.rows.every((step) => step.status === 'succeeded')
            ? 'succeeded'
            : null
      if (expected !== record.status) throw new AdvisorPlanStateConflictError('Advisor step states do not match the requested plan result.')
      const occurredAt = this.now().toISOString()
      await client.query(`UPDATE relay_advisor_plans SET status = $5,
        updated_at = $6, version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4`, [
        record.organizationId, record.spaceId, record.sessionId, record.planId,
        record.status, occurredAt,
      ])
      const plan = (await readPlans(client, record.organizationId, record.spaceId, record.sessionId, record.planId))[0]
      if (!plan) throw new Error('The completed Advisor plan could not be read back.')
      await this.appendLedger(client, {
        ...record, action: 'advisor.plan.execute',
        before: { status: before.status, version: before.version },
        after: { status: plan.status, version: plan.version },
      })
      return plan
    })
  }
}
