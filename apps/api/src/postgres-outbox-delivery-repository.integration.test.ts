import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresOutboxDeliveryRepository } from './postgres-outbox-delivery-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Postgres core Outbox delivery governance', () => {
  const schema = `cosmos_outbox_delivery_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_worker_runtime -c search_path=${schema}`,
  })
  let now = new Date('2026-07-27T06:00:00.000Z')
  let sequence = 0
  let sessionId = ''
  const repository = new PostgresOutboxDeliveryRepository(workerPool, {
    createId: () => `delivery-audit-${++sequence}`,
    now: () => new Date(now),
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('outbox-org', 'Outbox Organization');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES
        ('outbox-org', 'outbox-space', 'Outbox Space'),
        ('outbox-org', 'outbox-space-b', 'Outbox Space B');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES ('outbox-org', 'outbox-user', 'member');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('outbox-org', 'outbox-space', 'outbox-user', 'member');
    `)
    await seedSessionConfiguration(migrationPool, 'outbox-org', 'outbox-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: () => `outbox-fixture-${++sequence}`,
      now: () => new Date('2026-07-27T05:59:00.000Z'),
    }).create({
      organizationId: 'outbox-org',
      spaceId: 'outbox-space',
      actorId: 'outbox-user',
      actorKind: 'user',
      requestId: 'outbox-session-request',
      idempotencyKey: 'outbox-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Outbox Delivery Fixture',
        visibility: 'private',
        start: true,
        message: { content: 'Create one Outbox event.', attachments: [] },
      },
    })
    sessionId = created.session.id
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('claims, retries, fences, publishes, dead-letters, and replays without exposing payloads', async () => {
    const first = await repository.claimNext({ leaseOwner: 'outbox-worker-a', leaseDurationMs: 30_000 })
    expect(first).toMatchObject({
      stream: 'session', organizationId: 'outbox-org', spaceId: 'outbox-space',
      eventType: 'session.created', attempt: 1, leaseOwner: 'outbox-worker-a',
    })
    if (!first) throw new Error('Expected the Session Outbox delivery claim.')

    now = new Date('2026-07-27T06:00:05.000Z')
    await expect(repository.markFailed({
      claim: first,
      errorCode: 'receiver_server_error',
      retryAt: new Date('2026-07-27T06:00:10.000Z'),
    })).resolves.toBe('retrying')
    await expect(repository.markDelivered(first)).resolves.toBe(false)
    await expect(repository.claimNext({
      leaseOwner: 'outbox-worker-a', leaseDurationMs: 30_000,
    })).resolves.toBeNull()

    now = new Date('2026-07-27T06:00:10.000Z')
    const retried = await repository.claimNext({
      leaseOwner: 'outbox-worker-b', leaseDurationMs: 30_000,
    })
    expect(retried).toMatchObject({ attempt: 2, leaseOwner: 'outbox-worker-b' })
    if (!retried) throw new Error('Expected the retry Outbox delivery claim.')
    now = new Date('2026-07-27T06:00:11.000Z')
    await expect(repository.markDelivered(retried)).resolves.toBe(true)

    const published = await migrationPool.query<{
      published_at: Date | null
      delivery_status: string
      delivery_attempts: number
    }>(`
      SELECT source.published_at, delivery.status AS delivery_status,
        delivery.attempts AS delivery_attempts
      FROM cosmos_outbox_events source
      JOIN cosmos_outbox_deliveries delivery
        ON delivery.stream = 'session'
        AND delivery.organization_id = source.organization_id
        AND delivery.source_id = source.id
      WHERE source.organization_id = 'outbox-org' AND source.id = $1
    `, [retried.sourceId])
    expect(published.rows[0]).toMatchObject({
      published_at: expect.any(Date), delivery_status: 'delivered', delivery_attempts: 2,
    })

    await migrationPool.query(`
      INSERT INTO cosmos_outbox_events (
        id, organization_id, space_id, session_id, aggregate_type, aggregate_id,
        event_type, payload, occurred_at
      ) VALUES (
        'dead-letter-source', 'outbox-org', 'outbox-space', $1,
        'session', $1, 'session.updated', '{"secret":"must-not-be-forwarded"}'::jsonb,
        '2026-07-27T06:01:00.000Z'
      )
    `, [sessionId])
    now = new Date('2026-07-27T06:01:01.000Z')
    const rejected = await repository.claimNext({
      leaseOwner: 'outbox-worker-a', leaseDurationMs: 30_000,
    })
    expect(rejected).toMatchObject({ sourceId: 'dead-letter-source', attempt: 1 })
    if (!rejected) throw new Error('Expected the rejected Outbox delivery claim.')
    now = new Date('2026-07-27T06:01:02.000Z')
    await expect(repository.markFailed({
      claim: rejected, errorCode: 'receiver_rejected',
    })).resolves.toBe('dead_letter')

    const deadLetters = await repository.listDeadLetters(20)
    expect(deadLetters).toEqual([expect.objectContaining({
      sourceId: 'dead-letter-source', lastErrorCode: 'receiver_rejected', attempts: 1,
    })])
    expect(JSON.stringify(deadLetters)).not.toContain('must-not-be-forwarded')
    const deadLetter = deadLetters[0]!
    now = new Date('2026-07-27T06:01:03.000Z')
    await expect(repository.replayDeadLetter({
      stream: deadLetter.stream,
      organizationId: deadLetter.organizationId,
      spaceId: deadLetter.spaceId,
      sourceId: deadLetter.sourceId,
      expectedVersion: deadLetter.version,
      actorId: 'operator-a',
      reason: 'receiver_policy_fixed',
    })).resolves.toBe(true)
    await expect(repository.replayDeadLetter({
      stream: deadLetter.stream,
      organizationId: deadLetter.organizationId,
      spaceId: deadLetter.spaceId,
      sourceId: deadLetter.sourceId,
      expectedVersion: deadLetter.version,
      actorId: 'operator-a',
      reason: 'operator_reconciled',
    })).resolves.toBe(false)

    const audit = await migrationPool.query<{ action: string; actor_id: string }>(`
      SELECT action, actor_id FROM cosmos_outbox_delivery_audit_events
      WHERE stream = 'session' AND organization_id = 'outbox-org'
      ORDER BY occurred_at, id
    `)
    expect(audit.rows.map(({ action }) => action)).toEqual([
      'delivery.claimed', 'delivery.retry_scheduled', 'delivery.claimed',
      'delivery.delivered', 'delivery.claimed', 'delivery.dead_lettered',
      'delivery.replayed',
    ])
    expect(audit.rows.at(-1)).toEqual({ action: 'delivery.replayed', actor_id: 'operator-a' })
  })

  it('keeps identical source identifiers isolated by Space in the delivery key', async () => {
    await migrationPool.query(`
      INSERT INTO cosmos_outbox_deliveries (
        stream, organization_id, space_id, source_id, event_type, occurred_at,
        status, attempts, next_attempt_at, delivered_at
      ) VALUES
        ('environment', 'outbox-org', 'outbox-space', 'same-source-id',
          'environment.updated', now(), 'delivered', 1, now(), now()),
        ('environment', 'outbox-org', 'outbox-space-b', 'same-source-id',
          'environment.updated', now(), 'delivered', 1, now(), now())
    `)
    const rows = await migrationPool.query<{ space_id: string }>(`
      SELECT space_id FROM cosmos_outbox_deliveries
      WHERE stream = 'environment' AND organization_id = 'outbox-org'
        AND source_id = 'same-source-id'
      ORDER BY space_id
    `)
    expect(rows.rows).toEqual([
      { space_id: 'outbox-space' },
      { space_id: 'outbox-space-b' },
    ])
  })
})
