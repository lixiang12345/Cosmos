import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  OutboxDeadLetter,
  OutboxDeliveryClaim,
  OutboxDeliveryErrorCode,
  OutboxDeliveryRepository,
  OutboxReplayReason,
  OutboxStream,
} from './outbox-delivery-repository.js'

type DeliveryRow = {
  stream: OutboxStream
  organization_id: string
  space_id: string
  source_id: string
  event_type: string
  occurred_at: Date | string
  attempts: number
  lease_owner: string | null
  last_error_code: OutboxDeliveryErrorCode | null
  dead_lettered_at: Date | string | null
  version: number
}

const sourceTables: Readonly<Record<OutboxStream, string>> = {
  session: 'cosmos_outbox_events',
  environment: 'cosmos_environment_outbox_events',
  automation: 'cosmos_automation_outbox_events',
  space: 'cosmos_space_outbox_events',
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function safeLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Outbox dead-letter limit must be an integer between 1 and 100.')
  }
  return limit
}

function safeLease(value: number) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new RangeError('Outbox lease duration must be an integer between 1000 and 300000 milliseconds.')
  }
  return value
}

function safeActor(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Outbox actor identifier must contain 1 to 128 safe characters.')
  }
  return value
}

const replayReasons = new Set<OutboxReplayReason>([
  'receiver_policy_fixed', 'receiver_recovered', 'operator_reconciled',
])

function safeReason(value: OutboxReplayReason) {
  if (!replayReasons.has(value)) {
    throw new Error('Outbox replay reason is not an allowed operational reason code.')
  }
  return value
}

function mapClaim(row: DeliveryRow): OutboxDeliveryClaim {
  if (!row.lease_owner) throw new Error('Claimed Outbox delivery is missing its lease owner.')
  return {
    stream: row.stream,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sourceId: row.source_id,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at),
    attempt: row.attempts,
    leaseOwner: row.lease_owner,
    version: row.version,
  }
}

export class PostgresOutboxDeliveryRepository implements OutboxDeliveryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly options: Readonly<{ createId?: () => string; now?: () => Date }> = {},
  ) {}

  async claimNext(input: { leaseOwner: string; leaseDurationMs: number }) {
    const leaseOwner = safeActor(input.leaseOwner)
    const leaseDurationMs = safeLease(input.leaseDurationMs)
    const occurredAt = (this.options.now?.() ?? new Date()).toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<DeliveryRow>(`
        WITH candidate AS (
          SELECT stream, organization_id, space_id, source_id, status
          FROM cosmos_outbox_deliveries
          WHERE (
              status IN ('pending', 'retrying') AND next_attempt_at <= $1
            ) OR (
              status = 'delivering' AND lease_expires_at <= $1
            )
          ORDER BY next_attempt_at, occurred_at, stream, source_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE cosmos_outbox_deliveries delivery
        SET status = 'delivering', attempts = delivery.attempts + 1,
          lease_owner = $2, lease_expires_at = $1::timestamptz
            + ($3::double precision * interval '1 millisecond'),
          updated_at = $1, version = delivery.version + 1
        FROM candidate
        WHERE delivery.stream = candidate.stream
          AND delivery.organization_id = candidate.organization_id
          AND delivery.space_id = candidate.space_id
          AND delivery.source_id = candidate.source_id
        RETURNING delivery.*
      `, [occurredAt, leaseOwner, leaseDurationMs])
      const row = result.rows[0]
      if (!row) {
        await client.query('COMMIT')
        return null
      }
      const claim = mapClaim(row)
      await this.appendAudit(client, claim, 'delivery.claimed', null, null, occurredAt)
      await client.query('COMMIT')
      return claim
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markDelivered(claim: OutboxDeliveryClaim) {
    const occurredAt = (this.options.now?.() ?? new Date()).toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query<{ version: number }>(`
        UPDATE cosmos_outbox_deliveries
        SET status = 'delivered', delivered_at = $7, dead_lettered_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL,
          updated_at = $7, version = version + 1
        WHERE stream = $1 AND organization_id = $2 AND space_id = $3
          AND source_id = $4 AND status = 'delivering'
          AND lease_owner = $5 AND version = $6 AND lease_expires_at > $7
        RETURNING version
      `, [
        claim.stream, claim.organizationId, claim.spaceId, claim.sourceId,
        claim.leaseOwner, claim.version, occurredAt,
      ])
      const resolved = updated.rows[0]
      if (!resolved) {
        await client.query('ROLLBACK')
        return false
      }
      const source = sourceTables[claim.stream]
      const published = await client.query(`
        UPDATE ${source} SET published_at = COALESCE(published_at, $4)
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
      `, [claim.organizationId, claim.spaceId, claim.sourceId, occurredAt])
      if (published.rowCount !== 1) throw new Error('Outbox source event could not be marked published.')
      await this.appendAudit(
        client, { ...claim, version: resolved.version },
        'delivery.delivered', null, null, occurredAt,
      )
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markFailed(input: {
    claim: OutboxDeliveryClaim
    errorCode: OutboxDeliveryErrorCode
    retryAt?: Date
  }) {
    const occurredAt = (this.options.now?.() ?? new Date()).toISOString()
    const retryAt = input.retryAt?.toISOString() ?? null
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query<{ version: number }>(`
        UPDATE cosmos_outbox_deliveries
        SET status = CASE WHEN $8::timestamptz IS NULL THEN 'dead_letter' ELSE 'retrying' END,
          next_attempt_at = COALESCE($8::timestamptz, next_attempt_at),
          lease_owner = NULL, lease_expires_at = NULL, last_error_code = $7,
          dead_lettered_at = CASE WHEN $8::timestamptz IS NULL THEN $9::timestamptz ELSE NULL END,
          delivered_at = NULL, updated_at = $9, version = version + 1
        WHERE stream = $1 AND organization_id = $2 AND space_id = $3
          AND source_id = $4 AND status = 'delivering'
          AND lease_owner = $5 AND version = $6 AND lease_expires_at > $9
        RETURNING version
      `, [
        input.claim.stream, input.claim.organizationId, input.claim.spaceId,
        input.claim.sourceId, input.claim.leaseOwner, input.claim.version,
        input.errorCode, retryAt, occurredAt,
      ])
      const resolved = updated.rows[0]
      if (!resolved) {
        await client.query('ROLLBACK')
        return 'fence_lost' as const
      }
      const action = retryAt ? 'delivery.retry_scheduled' : 'delivery.dead_lettered'
      await this.appendAudit(
        client, { ...input.claim, version: resolved.version },
        action, input.errorCode, null, occurredAt,
      )
      await client.query('COMMIT')
      return retryAt ? 'retrying' as const : 'dead_letter' as const
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listDeadLetters(limit: number): Promise<readonly OutboxDeadLetter[]> {
    const result = await this.pool.query<DeliveryRow>(`
      SELECT * FROM cosmos_outbox_deliveries
      WHERE status = 'dead_letter'
      ORDER BY dead_lettered_at DESC, stream, source_id
      LIMIT $1
    `, [safeLimit(limit)])
    return result.rows.map((row) => {
      if (!row.last_error_code || !row.dead_lettered_at) {
        throw new Error('Dead-letter Outbox delivery is missing terminal metadata.')
      }
      return {
        stream: row.stream,
        organizationId: row.organization_id,
        spaceId: row.space_id,
        sourceId: row.source_id,
        eventType: row.event_type,
        occurredAt: iso(row.occurred_at),
        attempts: row.attempts,
        lastErrorCode: row.last_error_code,
        deadLetteredAt: iso(row.dead_lettered_at),
        version: row.version,
      }
    })
  }

  async replayDeadLetter(input: {
    stream: OutboxStream
    organizationId: string
    spaceId: string
    sourceId: string
    expectedVersion: number
    actorId: string
    reason: OutboxReplayReason
  }) {
    const actorId = safeActor(input.actorId)
    const reason = safeReason(input.reason)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('Outbox replay expected version must be a positive integer.')
    }
    const occurredAt = (this.options.now?.() ?? new Date()).toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query<DeliveryRow>(`
        UPDATE cosmos_outbox_deliveries
        SET status = 'retrying', next_attempt_at = $6, dead_lettered_at = NULL,
          last_error_code = NULL, updated_at = $6, version = version + 1
        WHERE stream = $1 AND organization_id = $2 AND space_id = $3 AND source_id = $4
          AND status = 'dead_letter' AND version = $5
        RETURNING *
      `, [
        input.stream, input.organizationId, input.spaceId, input.sourceId,
        input.expectedVersion, occurredAt,
      ])
      const row = updated.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return false
      }
      const replayed = mapClaim({ ...row, lease_owner: actorId })
      await this.appendAudit(
        client, replayed, 'delivery.replayed', null, reason, occurredAt, actorId,
      )
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private appendAudit(
    client: PoolClient,
    delivery: OutboxDeliveryClaim,
    action: 'delivery.claimed' | 'delivery.delivered' | 'delivery.retry_scheduled'
      | 'delivery.dead_lettered' | 'delivery.replayed',
    errorCode: OutboxDeliveryErrorCode | null,
    reason: string | null,
    occurredAt: string,
    actorId = delivery.leaseOwner,
  ) {
    return client.query(`
      INSERT INTO cosmos_outbox_delivery_audit_events (
        id, stream, organization_id, space_id, source_id, action, actor_id,
        attempt, delivery_version, error_code, reason, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      this.options.createId?.() ?? randomUUID(), delivery.stream,
      delivery.organizationId, delivery.spaceId, delivery.sourceId, action,
      actorId, delivery.attempt, delivery.version, errorCode, reason, occurredAt,
    ])
  }
}
