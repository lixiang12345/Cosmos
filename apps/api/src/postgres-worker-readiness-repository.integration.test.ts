import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgresWorkerReadinessRepository', () => {
  const schema = `relay_worker_readiness_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })
  const repository = new PostgresWorkerReadinessRepository(pool)

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE relay_worker_heartbeats')
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('reports only heartbeats inside the inclusive freshness window', async () => {
    const now = new Date('2026-07-13T08:00:00.000Z')
    await repository.recordHeartbeat('worker-fresh', new Date('2026-07-13T07:59:30.000Z'))
    await repository.recordHeartbeat('worker-stale', new Date('2026-07-13T07:59:29.999Z'))

    await expect(repository.hasRecentHeartbeat({
      workerId: 'worker-fresh', maxAgeMs: 30_000, now,
    })).resolves.toBe(true)
    await expect(repository.hasRecentHeartbeat({
      workerId: 'worker-stale', maxAgeMs: 30_000, now,
    })).resolves.toBe(false)
    await expect(repository.hasRecentHeartbeat({ maxAgeMs: 30_000, now })).resolves.toBe(true)
  })

  it('upserts one row per Worker and removes readiness on shutdown', async () => {
    await repository.recordHeartbeat('worker-a', new Date('2026-07-13T08:00:00.000Z'))
    await repository.recordHeartbeat('worker-a', new Date('2026-07-13T08:00:05.000Z'))
    const rows = await pool.query<{ worker_id: string; last_seen_at: Date }>(`
      SELECT worker_id, last_seen_at FROM relay_worker_heartbeats
    `)

    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].worker_id).toBe('worker-a')
    expect(rows.rows[0].last_seen_at.toISOString()).toBe('2026-07-13T08:00:05.000Z')

    await repository.removeHeartbeat('worker-a')
    await expect(repository.hasRecentHeartbeat({
      workerId: 'worker-a',
      maxAgeMs: 30_000,
      now: new Date('2026-07-13T08:00:05.000Z'),
    })).resolves.toBe(false)
  })

  it('enforces bounded identifiers and readiness windows before querying', async () => {
    await expect(repository.recordHeartbeat('worker with spaces')).rejects.toThrow('Worker id')
    await expect(repository.hasRecentHeartbeat({ maxAgeMs: 99 })).rejects.toThrow('heartbeat age')
    await expect(repository.hasRecentHeartbeat({ maxAgeMs: 300_001 })).rejects.toThrow('heartbeat age')
  })
})
