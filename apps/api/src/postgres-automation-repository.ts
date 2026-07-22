import { createHash, randomUUID } from 'node:crypto'
import {
  AutomationDtoSchema,
  AutomationEventDtoSchema,
  AutomationMutationResponseSchema,
  AutomationRunDtoSchema,
  AutomationTestResultSchema,
  SessionDtoSchema,
  type AutomationDto,
  type AutomationEventDto,
  type AutomationRunDto,
} from '@relay/contracts'
import type { Pool, PoolClient } from 'pg'
import { evaluateAutomationFilter, redactAutomationData } from './automation-filter.js'
import {
  AutomationIdempotencyConflictError,
  AutomationStateConflictError,
  AutomationValidationError,
  AutomationVersionConflictError,
  type AutomationEventMatchResult,
  type AutomationMutationRecord,
  type AutomationMutationResult,
  type AutomationRepository,
  type AutomationScope,
  type CreateAutomationRecord,
  type ReceiveAutomationEventRecord,
  type SetAutomationStatusRecord,
  type TestAutomationRecord,
  type UpdateAutomationRecord,
} from './automation-repository.js'
import { queryWithApiDatabaseContext, withApiDatabaseContext } from './postgres-runtime-database.js'

type TimestampValue = string | Date

type AutomationRow = {
  id: string
  organization_id: string
  space_id: string
  expert_id: string
  expert_revision_id: string
  name: string
  source: 'github' | 'slack' | 'webhook' | 'schedule'
  event_type: string
  filter: unknown
  status: 'draft' | 'paused' | 'active' | 'error'
  auto_archive: boolean
  service_account_id: string
  service_account_audience?: string
  last_tested_at: TimestampValue | null
  last_matched_at: TimestampValue | null
  match_count: string | number
  version: number
  created_at: TimestampValue
  updated_at: TimestampValue
}

type EventRow = {
  id: string
  organization_id: string
  space_id: string
  source: 'github' | 'slack' | 'webhook' | 'schedule'
  event_type: string
  external_id: string
  headers_redacted: unknown
  payload_redacted: unknown
  payload_hash: string
  status: 'received' | 'matched' | 'ignored' | 'dispatching' | 'dispatched' | 'failed'
  automation_id: string | null
  session_id: string | null
  match_explanation: string
  error_code: string | null
  error_message: string | null
  received_at: TimestampValue
  processed_at: TimestampValue | null
}

const automationColumns = `
  trigger.id, trigger.organization_id, trigger.space_id, trigger.expert_id,
  trigger.expert_revision_id, trigger.name, trigger.source, trigger.event_type,
  trigger.filter, trigger.status, trigger.auto_archive, trigger.service_account_id,
  trigger.last_tested_at, trigger.last_matched_at, trigger.match_count,
  trigger.version, trigger.created_at, trigger.updated_at
`

const eventColumns = `
  event.id, event.organization_id, event.space_id, event.source, event.event_type,
  event.external_id, event.headers_redacted, event.payload_redacted, event.payload_hash,
  event.status, event.automation_id, event.session_id, event.match_explanation,
  event.error_code, event.error_message, event.received_at, event.processed_at
`

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : value
}

function nullableTimestamp(value: TimestampValue | null) {
  return value === null ? null : timestamp(value)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function mapAutomation(row: AutomationRow): AutomationDto {
  return AutomationDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    expertId: row.expert_id,
    expertRevisionId: row.expert_revision_id,
    triggerId: row.id,
    name: row.name,
    source: row.source,
    eventType: row.event_type,
    filter: row.filter,
    status: row.status,
    autoArchive: row.auto_archive,
    serviceAccountId: row.service_account_id,
    lastTestedAt: nullableTimestamp(row.last_tested_at),
    lastMatchedAt: nullableTimestamp(row.last_matched_at),
    matchCount: Number(row.match_count),
    version: row.version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

function mapEvent(row: EventRow): AutomationEventDto {
  return AutomationEventDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    source: row.source,
    eventType: row.event_type,
    externalId: row.external_id,
    headers: row.headers_redacted,
    payload: row.payload_redacted,
    payloadHash: row.payload_hash,
    status: row.status,
    automationId: row.automation_id,
    sessionId: row.session_id,
    matchExplanation: row.match_explanation,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    receivedAt: timestamp(row.received_at),
    processedAt: nullableTimestamp(row.processed_at),
  })
}

export type PostgresAutomationRepositoryOptions = {
  createId?: () => string
  now?: () => Date
  idempotencyTtlMs?: number
}

export class PostgresAutomationRepository implements AutomationRepository {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly idempotencyTtlMs: number

  constructor(private readonly pool: Pool, options: PostgresAutomationRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1000
  }

  private async prepareIdempotency(
    client: PoolClient,
    input: AutomationScope & { method: 'POST' | 'PATCH'; canonicalPath: string; idempotencyKey: string; request: unknown },
  ) {
    const keyHash = hash(input.idempotencyKey)
    const requestHash = hash(canonicalJson(input.request))
    const now = this.now()
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash]),
    ])
    const existing = await client.query<{ request_hash: string; response_body: unknown }>(`
      SELECT request_hash, response_body FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at > $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new AutomationIdempotencyConflictError()
      return { keyHash, requestHash, now, replay: existing.rows[0].response_body }
    }
    await client.query(`
      DELETE FROM relay_control_plane_idempotency
      WHERE organization_id = $1 AND actor_id = $2 AND method = $3
        AND canonical_path = $4 AND idempotency_key_hash = $5 AND expires_at <= $6
    `, [input.organizationId, input.actorId, input.method, input.canonicalPath, keyHash, now.toISOString()])
    return { keyHash, requestHash, now, replay: null }
  }

  private async saveIdempotency(
    client: PoolClient,
    input: AutomationScope & {
      method: 'POST' | 'PATCH'
      canonicalPath: string
      keyHash: string
      requestHash: string
      responseBody: unknown
      statusCode: number
    },
  ) {
    await client.query(`
      INSERT INTO relay_control_plane_idempotency (
        organization_id, space_id, actor_id, method, canonical_path,
        idempotency_key_hash, request_hash, status_code, response_body,
        response_headers, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, '{}'::jsonb, $10)
    `, [
      input.organizationId, input.spaceId, input.actorId, input.method, input.canonicalPath,
      input.keyHash, input.requestHash, input.statusCode, JSON.stringify(input.responseBody),
      new Date(this.now().getTime() + this.idempotencyTtlMs).toISOString(),
    ])
  }

  private async validateTarget(
    client: PoolClient,
    input: { organizationId: string; spaceId: string; expertId: string; serviceAccountId: string },
  ) {
    const result = await client.query<{ expert_revision_id: string; audience: string }>(`
      SELECT expert.published_revision_id AS expert_revision_id, service.audience
      FROM relay_experts expert
      JOIN relay_expert_revisions revision
        ON revision.organization_id = expert.organization_id
        AND revision.space_id = expert.space_id
        AND revision.expert_id = expert.id
        AND revision.id = expert.published_revision_id
        AND revision.status = 'published'
      JOIN relay_service_accounts service
        ON service.organization_id = expert.organization_id
        AND service.id = $4 AND service.status = 'active'
      JOIN relay_organization_memberships organization_membership
        ON organization_membership.organization_id = service.organization_id
        AND organization_membership.actor_id = service.id
        AND organization_membership.role <> 'viewer'
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = expert.organization_id
        AND space_membership.space_id = expert.space_id
        AND space_membership.actor_id = service.id
        AND space_membership.role <> 'viewer'
      JOIN relay_service_account_bindings binding
        ON binding.organization_id = expert.organization_id
        AND binding.space_id = expert.space_id
        AND binding.service_account_id = service.id
        AND binding.scope = 'session.create'
        AND binding.resource_type = 'expert'
        AND binding.resource_id = expert.id
        AND binding.revoked_at IS NULL
        AND (binding.expires_at IS NULL OR binding.expires_at > transaction_timestamp())
      WHERE expert.organization_id = $1 AND expert.space_id = $2 AND expert.id = $3
        AND expert.status = 'published'
    `, [input.organizationId, input.spaceId, input.expertId, input.serviceAccountId])
    const row = result.rows[0]
    if (!row) {
      throw new AutomationValidationError(
        'Automation requires a published Expert and an active ServiceAccount with an exact session.create binding.',
      )
    }
    return row
  }

  private async appendAudit(
    client: PoolClient,
    input: AutomationScope & {
      automationId?: string
      eventId?: string
      action: string
      resourceVersion?: number
      idempotencyKeyHash?: string
      metadata?: Record<string, unknown>
    },
  ) {
    await client.query(`
      INSERT INTO relay_automation_audit_events (
        organization_id, space_id, id, automation_id, event_id, actor_id,
        action, resource_version, request_id, idempotency_key_hash, metadata, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
    `, [
      input.organizationId, input.spaceId, this.createId(), input.automationId ?? null,
      input.eventId ?? null, input.actorId, input.action, input.resourceVersion ?? null,
      input.requestId, input.idempotencyKeyHash ?? null, JSON.stringify(input.metadata ?? {}),
      this.now().toISOString(),
    ])
  }

  async listAutomations(organizationId: string, spaceId: string, actorId: string) {
    const result = await queryWithApiDatabaseContext<AutomationRow>(this.pool, {
      organizationId, spaceId, actorId,
    }, `
      SELECT ${automationColumns}
      FROM relay_expert_triggers trigger
      WHERE trigger.organization_id = $1 AND trigger.space_id = $2
      ORDER BY trigger.updated_at DESC, trigger.id DESC LIMIT 100
    `, [organizationId, spaceId])
    return result.rows.map(mapAutomation)
  }

  async createAutomation(record: CreateAutomationRecord): Promise<AutomationMutationResult> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/automations`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath, request: record.request,
      })
      if (idempotency.replay) {
        const response = AutomationMutationResponseSchema.parse(idempotency.replay)
        return { automation: response.automation, replayed: true }
      }
      const target = await this.validateTarget(client, {
        ...record,
        expertId: record.request.expertId,
        serviceAccountId: record.request.serviceAccountId,
      })
      const id = this.createId()
      const inserted = await client.query<AutomationRow>(`
        INSERT INTO relay_expert_triggers (
          organization_id, space_id, id, expert_id, expert_revision_id,
          name, source, event_type, filter, status, auto_archive,
          service_account_id, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'paused', $10, $11, $12, $13, $13)
        RETURNING ${automationColumns.replaceAll('trigger.', '')}
      `, [
        record.organizationId, record.spaceId, id, record.request.expertId,
        target.expert_revision_id, record.request.name, record.request.source,
        record.request.eventType, JSON.stringify(record.request.filter),
        record.request.autoArchive, record.request.serviceAccountId, record.actorId,
        idempotency.now.toISOString(),
      ])
      const automation = mapAutomation(inserted.rows[0]!)
      await this.appendAudit(client, {
        ...record, automationId: id, action: 'automation.create',
        resourceVersion: automation.version, idempotencyKeyHash: idempotency.keyHash,
        metadata: { source: automation.source, eventType: automation.eventType },
      })
      await client.query(`
        INSERT INTO relay_automation_outbox_events (
          organization_id, space_id, id, automation_id, event_type, payload, occurred_at
        ) VALUES ($1, $2, $3, $4, 'automation.created', '{}'::jsonb, $5)
      `, [record.organizationId, record.spaceId, this.createId(), id, idempotency.now.toISOString()])
      const response = AutomationMutationResponseSchema.parse({ automation, replayed: false })
      await this.saveIdempotency(client, {
        ...record, method: 'POST', canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, responseBody: response, statusCode: 201,
      })
      return { automation, replayed: false }
    })
  }

  private async lockAutomation(client: PoolClient, record: AutomationMutationRecord) {
    const result = await client.query<AutomationRow>(`
      SELECT ${automationColumns}
      FROM relay_expert_triggers trigger
      WHERE trigger.organization_id = $1 AND trigger.space_id = $2 AND trigger.id = $3
      FOR UPDATE
    `, [record.organizationId, record.spaceId, record.automationId])
    const row = result.rows[0]
    if (!row) return null
    if (row.version !== record.expectedVersion) {
      throw new AutomationVersionConflictError(record.expectedVersion, row.version)
    }
    return row
  }

  async updateAutomation(record: UpdateAutomationRecord): Promise<AutomationMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/automations/${record.automationId}`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'PATCH', canonicalPath,
        request: { expectedVersion: record.expectedVersion, ...record.request },
      })
      if (idempotency.replay) {
        const response = AutomationMutationResponseSchema.parse(idempotency.replay)
        return { automation: response.automation, replayed: true }
      }
      const current = await this.lockAutomation(client, record)
      if (!current) return null
      if (record.request.serviceAccountId) {
        await this.validateTarget(client, {
          ...record, expertId: current.expert_id,
          serviceAccountId: record.request.serviceAccountId,
        })
      }
      const updated = await client.query<AutomationRow>(`
        UPDATE relay_expert_triggers SET
          name = COALESCE($4, name), event_type = COALESCE($5, event_type),
          filter = COALESCE($6::jsonb, filter), auto_archive = COALESCE($7, auto_archive),
          service_account_id = COALESCE($8, service_account_id),
          status = CASE WHEN status = 'active' THEN 'paused' ELSE status END,
          last_tested_at = CASE WHEN $5 IS NOT NULL OR $6 IS NOT NULL THEN NULL ELSE last_tested_at END,
          version = version + 1, updated_at = $9
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        RETURNING ${automationColumns.replaceAll('trigger.', '')}
      `, [
        record.organizationId, record.spaceId, record.automationId,
        record.request.name ?? null, record.request.eventType ?? null,
        record.request.filter === undefined ? null : JSON.stringify(record.request.filter),
        record.request.autoArchive ?? null, record.request.serviceAccountId ?? null,
        idempotency.now.toISOString(),
      ])
      const automation = mapAutomation(updated.rows[0]!)
      await this.appendAudit(client, {
        ...record, automationId: automation.id, action: 'automation.update',
        resourceVersion: automation.version, idempotencyKeyHash: idempotency.keyHash,
      })
      const response = AutomationMutationResponseSchema.parse({ automation, replayed: false })
      await this.saveIdempotency(client, {
        ...record, method: 'PATCH', canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, responseBody: response, statusCode: 200,
      })
      return { automation, replayed: false }
    })
  }

  async setAutomationStatus(record: SetAutomationStatusRecord): Promise<AutomationMutationResult | null> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const operation = record.status === 'active' ? 'enable' : 'pause'
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/automations/${record.automationId}/${operation}`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath,
        request: { expectedVersion: record.expectedVersion },
      })
      if (idempotency.replay) {
        const response = AutomationMutationResponseSchema.parse(idempotency.replay)
        return { automation: response.automation, replayed: true }
      }
      const current = await this.lockAutomation(client, record)
      if (!current) return null
      if (record.status === 'active' && current.last_tested_at === null) {
        throw new AutomationStateConflictError('Automation must pass a test event before it can be enabled.')
      }
      const updated = await client.query<AutomationRow>(`
        UPDATE relay_expert_triggers SET status = $4, version = version + 1, updated_at = $5
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        RETURNING ${automationColumns.replaceAll('trigger.', '')}
      `, [record.organizationId, record.spaceId, record.automationId, record.status, idempotency.now.toISOString()])
      const automation = mapAutomation(updated.rows[0]!)
      await this.appendAudit(client, {
        ...record, automationId: automation.id, action: `automation.${operation}`,
        resourceVersion: automation.version, idempotencyKeyHash: idempotency.keyHash,
      })
      const response = AutomationMutationResponseSchema.parse({ automation, replayed: false })
      await this.saveIdempotency(client, {
        ...record, method: 'POST', canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, responseBody: response, statusCode: 200,
      })
      return { automation, replayed: false }
    })
  }

  async testAutomation(record: TestAutomationRecord) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const canonicalPath = `/v1/organizations/${record.organizationId}/spaces/${record.spaceId}/automations/${record.automationId}/test`
      const idempotency = await this.prepareIdempotency(client, {
        ...record, method: 'POST', canonicalPath,
        request: { expectedVersion: record.expectedVersion, ...record.request },
      })
      if (idempotency.replay) return AutomationTestResultSchema.parse(idempotency.replay)
      const current = await this.lockAutomation(client, record)
      if (!current) return null
      const eventType = record.request.eventType ?? current.event_type
      const typeMatches = eventType === current.event_type
      const filterMatches = typeMatches && evaluateAutomationFilter(
        AutomationDtoSchema.parse(mapAutomation(current)).filter,
        record.request.payload,
      )
      const explanation = !typeMatches
        ? `Event type ${eventType} does not match ${current.event_type}.`
        : filterMatches
          ? 'Event source, type, and restricted filter all matched.'
          : 'Event type matched, but the restricted filter returned false.'
      const updated = await client.query<AutomationRow>(`
        UPDATE relay_expert_triggers SET last_tested_at = CASE WHEN $4 THEN $5 ELSE last_tested_at END,
          version = version + 1, updated_at = $5
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        RETURNING ${automationColumns.replaceAll('trigger.', '')}
      `, [record.organizationId, record.spaceId, record.automationId, filterMatches, idempotency.now.toISOString()])
      const result = AutomationTestResultSchema.parse({
        automation: mapAutomation(updated.rows[0]!), matched: filterMatches, explanation,
      })
      await this.appendAudit(client, {
        ...record, automationId: record.automationId, action: 'automation.test',
        resourceVersion: result.automation.version, idempotencyKeyHash: idempotency.keyHash,
        metadata: { matched: filterMatches },
      })
      await this.saveIdempotency(client, {
        ...record, method: 'POST', canonicalPath, keyHash: idempotency.keyHash,
        requestHash: idempotency.requestHash, responseBody: result, statusCode: 200,
      })
      return result
    })
  }

  async listEvents(organizationId: string, spaceId: string, actorId: string) {
    const result = await queryWithApiDatabaseContext<EventRow>(this.pool, {
      organizationId, spaceId, actorId,
    }, `
      SELECT ${eventColumns}
      FROM relay_automation_events event
      WHERE event.organization_id = $1 AND event.space_id = $2
      ORDER BY event.received_at DESC, event.id DESC LIMIT 100
    `, [organizationId, spaceId])
    return result.rows.map(mapEvent)
  }

  async receiveEvent(record: ReceiveAutomationEventRecord): Promise<AutomationEventMatchResult> {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const payload = redactAutomationData(record.request.payload)
      const headers = redactAutomationData(record.request.headers)
      const payloadHash = hash(canonicalJson(record.request.payload))
      const now = this.now().toISOString()
      const inserted = await client.query<EventRow>(`
        INSERT INTO relay_automation_events (
          organization_id, space_id, id, source, event_type, external_id,
          headers_redacted, payload_redacted, payload_hash, status,
          received_by, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, 'received', $10, $11)
        ON CONFLICT (organization_id, space_id, source, external_id) DO NOTHING
        RETURNING ${eventColumns.replaceAll('event.', '')}
      `, [
        record.organizationId, record.spaceId, this.createId(), record.request.source,
        record.request.eventType, record.request.externalId, JSON.stringify(headers),
        JSON.stringify(payload), payloadHash, record.actorId, now,
      ])
      if (!inserted.rows[0]) {
        const existing = await client.query<EventRow>(`
          SELECT ${eventColumns}
          FROM relay_automation_events event
          WHERE event.organization_id = $1 AND event.space_id = $2
            AND event.source = $3 AND event.external_id = $4
        `, [record.organizationId, record.spaceId, record.request.source, record.request.externalId])
        return { event: mapEvent(existing.rows[0]!), duplicate: true, match: null }
      }
      const initial = inserted.rows[0]
      const candidates = await client.query<AutomationRow>(`
        SELECT ${automationColumns}, service.audience AS service_account_audience
        FROM relay_expert_triggers trigger
        JOIN relay_service_accounts service
          ON service.organization_id = trigger.organization_id
          AND service.id = trigger.service_account_id
          AND service.status = 'active'
        WHERE trigger.organization_id = $1 AND trigger.space_id = $2
          AND trigger.source = $3 AND trigger.event_type = $4 AND trigger.status = 'active'
        ORDER BY trigger.created_at, trigger.id
        FOR SHARE OF trigger
      `, [record.organizationId, record.spaceId, record.request.source, record.request.eventType])
      const selected = candidates.rows.find((candidate) => evaluateAutomationFilter(
        mapAutomation(candidate).filter,
        record.request.payload,
      ))
      const explanation = selected
        ? `Matched active Trigger ${selected.id} by source, event type, and restricted filter.`
        : candidates.rowCount
          ? 'Active Triggers matched the source and event type, but all restricted filters returned false.'
          : 'No active Trigger matched the source and event type.'
      const status = selected ? 'matched' : 'ignored'
      const processed = await client.query<EventRow>(`
        UPDATE relay_automation_events SET status = $4, automation_id = $5,
          match_explanation = $6, processed_at = $7
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
        RETURNING ${eventColumns.replaceAll('event.', '')}
      `, [
        record.organizationId, record.spaceId, initial.id, status,
        selected?.id ?? null, explanation, now,
      ])
      if (selected) {
        await client.query(`
          UPDATE relay_expert_triggers SET last_matched_at = $4, match_count = match_count + 1
          WHERE organization_id = $1 AND space_id = $2 AND id = $3
        `, [record.organizationId, record.spaceId, selected.id, now])
      }
      await this.appendAudit(client, {
        ...record, eventId: initial.id, automationId: selected?.id,
        action: selected ? 'automation.event.matched' : 'automation.event.ignored',
        metadata: { source: record.request.source, eventType: record.request.eventType },
      })
      await client.query(`
        INSERT INTO relay_automation_outbox_events (
          organization_id, space_id, id, automation_id, event_id, event_type, payload, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)
      `, [
        record.organizationId, record.spaceId, this.createId(), selected?.id ?? null,
        initial.id, selected ? 'automation.event_matched' : 'automation.event_ignored', now,
      ])
      return {
        event: mapEvent(processed.rows[0]!), duplicate: false,
        match: selected ? {
          automation: mapAutomation(selected),
          serviceAccountAudience: selected.service_account_audience!,
        } : null,
      }
    })
  }

  async completeDispatch(record: AutomationScope & { eventId: string; sessionId: string }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const updated = await client.query<EventRow>(`
        UPDATE relay_automation_events SET status = 'dispatched', session_id = $4,
          error_code = NULL, error_message = NULL, processed_at = $5
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status IN ('matched', 'dispatching')
        RETURNING ${eventColumns.replaceAll('event.', '')}
      `, [record.organizationId, record.spaceId, record.eventId, record.sessionId, this.now().toISOString()])
      const event = updated.rows[0]
      if (!event) return null
      await this.appendAudit(client, {
        ...record, eventId: event.id, automationId: event.automation_id ?? undefined,
        action: 'automation.event.dispatched', metadata: { sessionId: record.sessionId },
      })
      return mapEvent(event)
    })
  }

  async failDispatch(record: AutomationScope & { eventId: string; code: string; message: string }) {
    return withApiDatabaseContext(this.pool, record, async (client) => {
      const updated = await client.query<EventRow>(`
        UPDATE relay_automation_events SET status = 'failed', error_code = $4,
          error_message = $5, processed_at = $6
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status IN ('matched', 'dispatching')
        RETURNING ${eventColumns.replaceAll('event.', '')}
      `, [
        record.organizationId, record.spaceId, record.eventId, record.code,
        record.message.slice(0, 2_000), this.now().toISOString(),
      ])
      const event = updated.rows[0]
      if (!event) return null
      await this.appendAudit(client, {
        ...record, eventId: event.id, automationId: event.automation_id ?? undefined,
        action: 'automation.event.failed', metadata: { code: record.code },
      })
      return mapEvent(event)
    })
  }

  async listRuns(organizationId: string, spaceId: string, actorId: string): Promise<AutomationRunDto[]> {
    const result = await queryWithApiDatabaseContext<EventRow & {
      automation_name: string
      session_id_value: string
      session_title: string
      session_summary: string
      session_expert_id: string
      session_expert_name: string
      session_expert_version: number | null
      session_environment_id: string | null
      session_configuration_resolution_version: 0 | 1
      session_expert_revision_id: string | null
      session_environment_revision_id: string | null
      session_execution_snapshot_id: string | null
      session_repository_id: string | null
      session_repository: string
      session_base_branch: string
      session_visibility: 'private' | 'space'
      session_status: string
      session_attachments: unknown
      session_source: 'manual' | 'automation'
      session_created_at: TimestampValue
      session_updated_at: TimestampValue
      session_last_activity_at: TimestampValue
      session_archived_at: TimestampValue | null
      session_version: number
    }>(this.pool, { organizationId, spaceId, actorId }, `
      SELECT ${eventColumns}, trigger.name AS automation_name,
        session.id AS session_id_value, session.title AS session_title,
        session.summary AS session_summary, session.expert_id AS session_expert_id,
        session.expert_name AS session_expert_name, session.expert_version AS session_expert_version,
        session.environment_id AS session_environment_id,
        session.configuration_resolution_version AS session_configuration_resolution_version,
        session.expert_revision_id AS session_expert_revision_id,
        session.environment_revision_id AS session_environment_revision_id,
        session.execution_snapshot_id AS session_execution_snapshot_id,
        session.repository_id AS session_repository_id, session.repository AS session_repository,
        session.base_branch AS session_base_branch, session.visibility AS session_visibility,
        session.status AS session_status, session.attachments AS session_attachments,
        session.source AS session_source, session.created_at AS session_created_at,
        session.updated_at AS session_updated_at, session.last_activity_at AS session_last_activity_at,
        session.archived_at AS session_archived_at, session.version AS session_version
      FROM relay_automation_events event
      JOIN relay_expert_triggers trigger
        ON trigger.organization_id = event.organization_id
        AND trigger.space_id = event.space_id AND trigger.id = event.automation_id
      JOIN relay_sessions session
        ON session.organization_id = event.organization_id
        AND session.space_id = event.space_id AND session.id = event.session_id
      WHERE event.organization_id = $1 AND event.space_id = $2 AND event.status = 'dispatched'
      ORDER BY event.received_at DESC, event.id DESC LIMIT 100
    `, [organizationId, spaceId])
    return result.rows.map((row) => AutomationRunDtoSchema.parse({
      automationId: row.automation_id,
      automationName: row.automation_name,
      eventId: row.id,
      source: row.source,
      eventType: row.event_type,
      receivedAt: timestamp(row.received_at),
      session: SessionDtoSchema.parse({
        id: row.session_id_value,
        organizationId: row.organization_id,
        spaceId: row.space_id,
        title: row.session_title,
        summary: row.session_summary,
        expertId: row.session_expert_id,
        expertName: row.session_expert_name,
        expertVersion: row.session_expert_version ?? undefined,
        environmentId: row.session_environment_id ?? undefined,
        configurationResolutionVersion: row.session_configuration_resolution_version,
        expertRevisionId: row.session_expert_revision_id ?? undefined,
        environmentRevisionId: row.session_environment_revision_id ?? undefined,
        executionSnapshotId: row.session_execution_snapshot_id ?? undefined,
        repositoryId: row.session_repository_id ?? undefined,
        repository: row.session_repository,
        baseBranch: row.session_base_branch,
        visibility: row.session_visibility,
        status: row.session_status,
        attachments: row.session_attachments,
        source: row.session_source,
        createdAt: timestamp(row.session_created_at),
        updatedAt: timestamp(row.session_updated_at),
        lastActivityAt: timestamp(row.session_last_activity_at),
        archivedAt: nullableTimestamp(row.session_archived_at),
        version: row.session_version,
      }),
    }))
  }
}
