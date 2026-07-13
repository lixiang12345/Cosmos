import type { Pool } from 'pg'
import type {
  WorkerReadinessQuery,
  WorkerReadinessRepository,
} from './worker-readiness-repository.js'

const MAX_READINESS_AGE_MS = 300_000

function requireWorkerId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Worker id must be 1 to 128 safe identifier characters.')
  }
}

function optionalTimestamp(value: Date | undefined) {
  if (value === undefined) return null
  if (!Number.isFinite(value.getTime())) throw new Error('Worker heartbeat time must be valid.')
  return value.toISOString()
}

function requireMaxAge(value: number) {
  if (!Number.isSafeInteger(value) || value < 100 || value > MAX_READINESS_AGE_MS) {
    throw new Error(`Worker heartbeat age must be between 100 and ${MAX_READINESS_AGE_MS} milliseconds.`)
  }
}

export class PostgresWorkerReadinessRepository implements WorkerReadinessRepository {
  constructor(private readonly pool: Pool) {}

  async recordHeartbeat(workerId: string, now?: Date): Promise<void> {
    requireWorkerId(workerId)
    const result = await this.pool.query(`
      INSERT INTO relay_worker_heartbeats (worker_id, last_seen_at)
      VALUES ($1, COALESCE($2::timestamptz, clock_timestamp()))
      ON CONFLICT (worker_id) DO UPDATE
      SET last_seen_at = GREATEST(
        relay_worker_heartbeats.last_seen_at,
        EXCLUDED.last_seen_at
      )
    `, [workerId, optionalTimestamp(now)])
    if (result.rowCount !== 1) throw new Error('Worker heartbeat could not be recorded.')
  }

  async removeHeartbeat(workerId: string): Promise<void> {
    requireWorkerId(workerId)
    await this.pool.query('DELETE FROM relay_worker_heartbeats WHERE worker_id = $1', [workerId])
  }

  async hasRecentHeartbeat(query: WorkerReadinessQuery): Promise<boolean> {
    requireMaxAge(query.maxAgeMs)
    if (query.workerId !== undefined) requireWorkerId(query.workerId)
    const result = await this.pool.query<{ ready: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM relay_worker_heartbeats
        WHERE ($1::text IS NULL OR worker_id = $1)
          AND last_seen_at >= COALESCE($2::timestamptz, clock_timestamp())
            - ($3::double precision * interval '1 millisecond')
      ) AS ready
    `, [query.workerId ?? null, optionalTimestamp(query.now), query.maxAgeMs])
    return result.rows[0]?.ready === true
  }
}
