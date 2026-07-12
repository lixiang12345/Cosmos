import type { CreateSessionRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { IdempotencyConflictError } from './session-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

const request: CreateSessionRequest = {
  title: 'Persist the checkout Session',
  expertId: 'expert-pr-author',
  expertName: 'PR Author',
  expertVersion: 2,
  environmentId: 'environment-commerce',
  repository: 'commerce/checkout',
  baseBranch: 'main',
  visibility: 'private',
  start: true,
  message: { content: 'Verify persistence and concurrent idempotency.', attachments: [] },
}

describeWithDatabase('PostgresSessionRepository', () => {
  const pool = new Pool({ connectionString: databaseUrl })

  beforeAll(async () => {
    await runMigrations(pool)
    await pool.query('TRUNCATE relay_idempotency_records, relay_sessions')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('persists Sessions and isolates list results by organization and Space', async () => {
    const repository = new PostgresSessionRepository(pool)
    const created = await repository.create({
      organizationId: 'relay', spaceId: 'space-commerce', idempotencyKey: 'persist-1', request,
    })
    await repository.create({
      organizationId: 'other', spaceId: 'space-commerce', idempotencyKey: 'persist-1', request,
    })

    const reconnectedRepository = new PostgresSessionRepository(pool)
    await expect(reconnectedRepository.listBySpace('relay', 'space-commerce')).resolves.toEqual([created.session])
  })

  it('creates one Session when the same command arrives concurrently', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      organizationId: 'relay', spaceId: 'space-platform', idempotencyKey: 'concurrent-command', request,
    }

    const results = await Promise.all(Array.from({ length: 6 }, () => repository.create(record)))
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1)
    expect(results.filter((result) => result.replayed)).toHaveLength(5)
    await expect(repository.listBySpace('relay', 'space-platform')).resolves.toHaveLength(1)
  })

  it('rejects a different request that reuses the same idempotency key', async () => {
    const repository = new PostgresSessionRepository(pool)
    const record = {
      organizationId: 'relay', spaceId: 'space-conflict', idempotencyKey: 'conflicting-command', request,
    }
    await repository.create(record)
    await expect(repository.create({
      ...record, request: { ...request, title: 'A different request' },
    })).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('allows a key to create a new Session after its idempotency window expires', async () => {
    let now = new Date('2026-07-12T12:00:00.000Z')
    const repository = new PostgresSessionRepository(pool, {
      now: () => now,
      idempotencyTtlMs: 1_000,
    })
    const record = {
      organizationId: 'relay', spaceId: 'space-expiry', idempotencyKey: 'expiring-command', request,
    }
    const first = await repository.create(record)

    now = new Date('2026-07-12T12:00:02.000Z')
    const afterExpiry = await repository.create({
      ...record, request: { ...request, title: 'A command after expiry' },
    })

    expect(afterExpiry.replayed).toBe(false)
    expect(afterExpiry.session.id).not.toBe(first.session.id)
    await expect(repository.listBySpace('relay', 'space-expiry')).resolves.toHaveLength(2)
  })
})
