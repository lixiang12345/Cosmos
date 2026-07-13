import type { CreateSessionRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresExecutionRepository } from './postgres-execution-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

async function waitForDatabaseLock(pool: Pool, applicationName: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const activity = await pool.query<{ wait_event_type: string | null }>(`
      SELECT wait_event_type
      FROM pg_stat_activity
      WHERE application_name = $1
    `, [applicationName])
    if (activity.rows[0]?.wait_event_type === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${applicationName} to block on authorization.`)
}

function delay(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

describeWithDatabase('PostgresExecutionRepository', () => {
  const schema = `relay_execution_repository_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 24,
    options: `-c search_path=${schema}`,
  })
  let sequence = 0

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO relay_organizations (id, name)
      VALUES ('execution-organization', 'Execution Organization');
      INSERT INTO relay_spaces (organization_id, id, name)
      VALUES ('execution-organization', 'execution-space', 'Execution Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES ('execution-organization', 'execution-user', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('execution-organization', 'execution-space', 'execution-user', 'member');
    `)
    const configuration = await seedSessionConfiguration(
      pool,
      'execution-organization',
      'execution-space',
    )
    await pool.query(`
      INSERT INTO relay_experts (
        organization_id, space_id, id, name, status, visibility, created_by
      ) VALUES (
        'execution-organization', 'execution-space', 'execution-expert',
        'Execution Expert', 'draft', 'space', 'execution-user'
      )
    `)
    await pool.query(`
      INSERT INTO relay_expert_revisions (
        organization_id, space_id, expert_id, id, revision, status,
        environment_id, environment_revision_id, instructions, model, created_by
      ) VALUES (
        'execution-organization', 'execution-space', 'execution-expert',
        'execution-expert-revision', 1, 'draft', $1, $2,
        'Use the pinned execution instructions.', 'pinned-model-v1', 'execution-user'
      )
    `, [configuration.environmentId, configuration.environmentRevisionId])
    await pool.query(`
      UPDATE relay_expert_revisions SET status = 'published'
      WHERE organization_id = 'execution-organization'
        AND space_id = 'execution-space'
        AND expert_id = 'execution-expert'
        AND id = 'execution-expert-revision'
    `)
    await pool.query(`
      UPDATE relay_experts
      SET status = 'published', published_revision_id = 'execution-expert-revision'
      WHERE organization_id = 'execution-organization'
        AND space_id = 'execution-space'
        AND id = 'execution-expert'
    `)
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  async function createSession(options: { start?: boolean; maxAttempts?: number } = {}) {
    sequence += 1
    const task = `Execute pinned task ${sequence}.`
    const request: CreateSessionRequest = {
      title: `Execution Session ${sequence}`,
      expertId: 'execution-expert',
      visibility: 'private',
      start: options.start ?? true,
      message: { content: task, attachments: [] },
    }
    const result = await new PostgresSessionRepository(pool, {
      executionMaxAttempts: options.maxAttempts ?? 3,
    }).create({
      organizationId: 'execution-organization',
      spaceId: 'execution-space',
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: `execution-request-${sequence}`,
      idempotencyKey: `execution-idempotency-${sequence}`,
      request,
    })
    return { ...result, task }
  }

  it('allows exactly one of 20 concurrent workers to claim a pinned execution', async () => {
    const created = await createSession()
    const now = new Date(Date.now() + 10)
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      new PostgresExecutionRepository(pool).claimNext({
        leaseOwner: `concurrent-worker-${index}`,
        leaseDurationMs: 30_000,
        now,
      })
    )))
    const claimed = claims.filter((claim) => claim !== null)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({
      sessionId: created.session.id,
      commandId: created.command?.id,
      turnId: created.turn?.id,
      attemptNumber: 1,
      requestedBy: 'execution-user',
      model: 'pinned-model-v1',
      systemPrompt: 'Use the pinned execution instructions.',
      taskContext: created.task,
    })
    const repository = new PostgresExecutionRepository(pool)
    await expect(repository.complete({
      claim: claimed[0],
      output: 'Concurrent claim completed once.',
      providerModel: 'provider-model-concurrent',
      now: new Date(now.getTime() + 20),
    })).resolves.toBe(true)
  })

  it('fences a paused execution and resumes it with a fresh Attempt', async () => {
    const created = await createSession({ maxAttempts: 3 })
    const executionRepository = new PostgresExecutionRepository(pool)
    const sessionRepository = new PostgresSessionRepository(pool, { executionMaxAttempts: 3 })
    const claimedAt = new Date(Date.now() + 10)
    const firstClaim = await executionRepository.claimNext({
      leaseOwner: 'pause-worker-1', leaseDurationMs: 30_000, now: claimedAt,
    })
    if (!firstClaim) throw new Error('Expected an execution to pause.')
    const active = await sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )
    if (!active) throw new Error('Expected an active Session.')

    const paused = await sessionRepository.control({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'pause-control-request',
      expectedVersion: active.version,
      action: 'pause',
      idempotencyKey: 'pause-control-key',
      request: {},
    })
    expect(paused).toMatchObject({
      replayed: false,
      session: { status: 'paused', version: active.version + 1 },
      command: { type: 'session.pause', status: 'succeeded', resourceId: created.session.id },
    })
    const pausedReplay = await sessionRepository.control({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'pause-control-request-replay',
      expectedVersion: active.version,
      action: 'pause',
      idempotencyKey: 'pause-control-key',
      request: {},
    })
    expect(pausedReplay).toMatchObject({ replayed: true, session: paused?.session, command: paused?.command })
    await expect(executionRepository.heartbeat({
      claim: firstClaim,
      leaseDurationMs: 30_000,
      now: new Date(claimedAt.getTime() + 100),
    })).resolves.toBe(false)
    await expect(executionRepository.complete({
      claim: firstClaim,
      output: 'A fenced worker must not commit this output.',
      providerModel: 'provider-model-fenced',
      now: new Date(claimedAt.getTime() + 100),
    })).resolves.toBe(false)
    await expect(executionRepository.claimNext({
      leaseOwner: 'pause-worker-blocked', leaseDurationMs: 30_000,
      now: new Date(claimedAt.getTime() + 110),
    })).resolves.toBeNull()

    if (!paused) throw new Error('Expected a paused Session.')
    const resumed = await sessionRepository.control({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'resume-control-request',
      expectedVersion: paused.session.version,
      action: 'resume',
      idempotencyKey: 'resume-control-key',
      request: {},
    })
    expect(resumed).toMatchObject({
      session: { status: 'queued', version: paused.session.version + 1 },
      command: { type: 'session.resume', status: 'succeeded' },
    })

    const secondClaim = await executionRepository.claimNext({
      leaseOwner: 'pause-worker-2', leaseDurationMs: 30_000,
    })
    if (!secondClaim) throw new Error('Expected the resumed execution to be claimed.')
    expect(secondClaim).toMatchObject({
      commandId: firstClaim.commandId,
      turnId: firstClaim.turnId,
      attemptNumber: 2,
    })
    expect(secondClaim.attemptId).not.toBe(firstClaim.attemptId)
    await expect(executionRepository.complete({
      claim: secondClaim,
      output: 'The resumed execution completed on a fresh Attempt.',
      providerModel: 'provider-model-resumed',
      now: new Date(claimedAt.getTime() + 130),
    })).resolves.toBe(true)

    const attempts = await pool.query<{ number: number; status: string }>(`
      SELECT number, status FROM relay_attempts
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND turn_id = $4
      ORDER BY number
    `, [firstClaim.organizationId, firstClaim.spaceId, firstClaim.sessionId, firstClaim.turnId])
    expect(attempts.rows).toEqual([
      { number: 1, status: 'canceled' },
      { number: 2, status: 'succeeded' },
    ])
  })

  it('cancels running work and rejects every stale Worker write', async () => {
    const created = await createSession({ maxAttempts: 2 })
    const executionRepository = new PostgresExecutionRepository(pool)
    const sessionRepository = new PostgresSessionRepository(pool, { executionMaxAttempts: 2 })
    const now = new Date(Date.now() + 10)
    const claim = await executionRepository.claimNext({
      leaseOwner: 'cancel-worker', leaseDurationMs: 30_000, now,
    })
    if (!claim) throw new Error('Expected an execution to cancel.')
    const active = await sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )
    if (!active) throw new Error('Expected an active Session.')

    const canceled = await sessionRepository.control({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'cancel-control-request',
      expectedVersion: active.version,
      action: 'cancel',
      idempotencyKey: 'cancel-control-key',
      request: { reason: 'Operator canceled the execution.' },
    })
    expect(canceled).toMatchObject({
      session: { status: 'canceled', version: active.version + 1 },
      command: { type: 'session.cancel', status: 'succeeded' },
    })
    await expect(executionRepository.heartbeat({
      claim, leaseDurationMs: 30_000, now: new Date(now.getTime() + 100),
    })).resolves.toBe(false)
    await expect(executionRepository.complete({
      claim,
      output: 'Canceled output must be rejected.',
      providerModel: 'provider-model-canceled',
      now: new Date(now.getTime() + 100),
    })).resolves.toBe(false)
    await expect(executionRepository.fail({
      claim,
      classification: 'terminal',
      code: 'stale_after_cancel',
      message: 'Canceled failures must be rejected.',
      now: new Date(now.getTime() + 100),
    })).resolves.toBe('stale')

    const state = await pool.query<{
      command_status: string
      attempt_status: string
      turn_status: string
      session_status: string
      outputs: string
    }>(`
      SELECT
        (SELECT status FROM relay_commands WHERE id = $4) AS command_status,
        (SELECT status FROM relay_attempts WHERE id = $5) AS attempt_status,
        (SELECT status FROM relay_turns WHERE id = $6) AS turn_status,
        (SELECT status FROM relay_sessions WHERE id = $3) AS session_status,
        (SELECT count(*) FROM relay_messages
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent') AS outputs
    `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId, claim.attemptId, claim.turnId])
    expect(state.rows[0]).toEqual({
      command_status: 'canceled',
      attempt_status: 'canceled',
      turn_status: 'canceled',
      session_status: 'canceled',
      outputs: '0',
    })
    const outbox = await pool.query<{ event_type: string }>(`
      SELECT event_type FROM relay_outbox_events
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND event_type = 'session.canceled'
    `, [claim.organizationId, claim.spaceId, claim.sessionId])
    expect(outbox.rows).toEqual([{ event_type: 'session.canceled' }])
  })

  it('claims the exact queued Attempt created by a manual Turn retry', async () => {
    const created = await createSession({ maxAttempts: 1 })
    const executionRepository = new PostgresExecutionRepository(pool)
    const sessionRepository = new PostgresSessionRepository(pool, { executionMaxAttempts: 1 })
    const now = new Date(Date.now() + 10)
    const firstClaim = await executionRepository.claimNext({
      leaseOwner: 'manual-retry-worker-1', leaseDurationMs: 30_000, now,
    })
    if (!firstClaim) throw new Error('Expected an execution to fail before manual retry.')
    await expect(executionRepository.fail({
      claim: firstClaim,
      classification: 'terminal',
      code: 'manual_retry_required',
      message: 'The operator can retry this Turn.',
      now: new Date(now.getTime() + 10),
    })).resolves.toBe('failed')
    const failed = await sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )
    if (!failed) throw new Error('Expected a failed Session.')

    const retryRecord = {
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      turnId: firstClaim.turnId,
      actorId: 'execution-user',
      actorKind: 'user' as const,
      requestId: 'manual-retry-request',
      expectedVersion: failed.version,
      idempotencyKey: 'manual-retry-key',
    }
    const retried = await sessionRepository.retryTurn(retryRecord)
    if (!retried) throw new Error('Expected a queued manual retry.')
    expect(retried).toMatchObject({
      replayed: false,
      session: { status: 'queued', version: failed.version + 1 },
      attempt: { turnId: firstClaim.turnId, number: 2, status: 'queued' },
      command: { type: 'turn.retry', status: 'queued', resourceId: firstClaim.turnId },
    })
    await expect(sessionRepository.retryTurn(retryRecord)).resolves.toMatchObject({
      replayed: true,
      session: retried.session,
      attempt: retried.attempt,
      command: retried.command,
    })

    const secondClaim = await executionRepository.claimNext({
      leaseOwner: 'manual-retry-worker-2', leaseDurationMs: 30_000,
    })
    if (!secondClaim) throw new Error('Expected the manual retry to be claimed.')
    expect(secondClaim).toMatchObject({
      commandId: retried.command.id,
      attemptId: retried.attempt.id,
      attemptNumber: retried.attempt.number,
      turnId: firstClaim.turnId,
    })
    const attemptCount = await pool.query<{ count: string }>(`
      SELECT count(*) FROM relay_attempts
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND turn_id = $4
    `, [secondClaim.organizationId, secondClaim.spaceId, secondClaim.sessionId, secondClaim.turnId])
    expect(attemptCount.rows[0].count).toBe('2')
    await expect(executionRepository.complete({
      claim: secondClaim,
      output: 'Manual retry completed exactly once.',
      providerModel: 'provider-model-manual-retry',
      now: new Date(now.getTime() + 30),
    })).resolves.toBe(true)

    const audit = await pool.query<{ action: string; target_type: string; target_id: string }>(`
      SELECT action, target_type, target_id FROM relay_audit_events
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND action = 'turn.retry'
    `, [secondClaim.organizationId, secondClaim.spaceId, secondClaim.sessionId])
    expect(audit.rows).toEqual([{
      action: 'turn.retry', target_type: 'turn', target_id: firstClaim.turnId,
    }])
  })

  it('keeps active follow-up Turns in FIFO through success and terminal failure', async () => {
    const created = await createSession({ maxAttempts: 1 })
    const executionRepository = new PostgresExecutionRepository(pool)
    const startedAt = new Date(Date.now() + 10)
    const sessionRepository = new PostgresSessionRepository(pool, {
      executionMaxAttempts: 1,
      now: () => new Date(startedAt.getTime() + 2),
    })
    const firstClaim = await executionRepository.claimNext({
      leaseOwner: 'fifo-worker-1', leaseDurationMs: 30_000, now: startedAt,
    })
    if (!firstClaim) throw new Error('Expected the first FIFO claim.')

    const firstFollowUp = await sessionRepository.send({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'fifo-follow-up-1',
      idempotencyKey: 'fifo-follow-up-1',
      request: { content: 'First queued follow-up.', attachments: [] },
      executionAvailability: 'available',
    })
    const secondFollowUp = await sessionRepository.send({
      organizationId: created.session.organizationId,
      spaceId: created.session.spaceId,
      sessionId: created.session.id,
      actorId: 'execution-user',
      actorKind: 'user',
      requestId: 'fifo-follow-up-2',
      idempotencyKey: 'fifo-follow-up-2',
      request: { content: 'Second queued follow-up.', attachments: [] },
      executionAvailability: 'available',
    })
    expect(firstFollowUp?.session.status).toBe('active')
    expect(secondFollowUp?.session.status).toBe('active')
    await expect(executionRepository.claimNext({
      leaseOwner: 'fifo-premature-worker', leaseDurationMs: 30_000,
      now: new Date(startedAt.getTime() + 5),
    })).resolves.toBeNull()

    await expect(executionRepository.complete({
      claim: firstClaim,
      output: 'Initial Turn completed before queued follow-ups.',
      providerModel: 'provider-model-fifo-1',
      now: new Date(startedAt.getTime() + 10),
    })).resolves.toBe(true)
    await expect(sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )).resolves.toMatchObject({ status: 'queued' })

    const secondClaim = await executionRepository.claimNext({
      leaseOwner: 'fifo-worker-2', leaseDurationMs: 30_000,
      now: new Date(startedAt.getTime() + 20),
    })
    expect(secondClaim?.turnId).toBe(firstFollowUp?.turn.id)
    if (!secondClaim) throw new Error('Expected the second FIFO claim.')
    await expect(executionRepository.fail({
      claim: secondClaim,
      classification: 'terminal',
      code: 'fifo_terminal_failure',
      message: 'Continue with the next queued Turn.',
      now: new Date(startedAt.getTime() + 30),
    })).resolves.toBe('failed')
    await expect(sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )).resolves.toMatchObject({ status: 'queued' })

    const thirdClaim = await executionRepository.claimNext({
      leaseOwner: 'fifo-worker-3', leaseDurationMs: 30_000,
      now: new Date(startedAt.getTime() + 40),
    })
    expect(thirdClaim?.turnId).toBe(secondFollowUp?.turn.id)
    if (!thirdClaim) throw new Error('Expected the third FIFO claim.')
    await expect(executionRepository.complete({
      claim: thirdClaim,
      output: 'Final queued follow-up completed.',
      providerModel: 'provider-model-fifo-3',
      now: new Date(startedAt.getTime() + 50),
    })).resolves.toBe(true)
    await expect(sessionRepository.getById(
      created.session.organizationId,
      created.session.spaceId,
      created.session.id,
      'execution-user',
    )).resolves.toMatchObject({ status: 'completed' })
  })

  it('starts the claim lease from database time after a membership lock wait', async () => {
    await createSession({ maxAttempts: 1 })
    const applicationName = `relay_claim_clock_${crypto.randomUUID()}`
    const claimPool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const blocker = await pool.connect()
    let transaction = false
    try {
      await blocker.query('BEGIN')
      transaction = true
      await blocker.query(`
        UPDATE relay_space_memberships SET role = role
        WHERE organization_id = 'execution-organization'
          AND space_id = 'execution-space' AND actor_id = 'execution-user'
      `)
      const claimPromise = new PostgresExecutionRepository(claimPool).claimNext({
        leaseOwner: 'delayed-claim-worker',
        leaseDurationMs: 1_500,
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await delay(1_700)
      await blocker.query('COMMIT')
      transaction = false

      const claim = await claimPromise
      if (!claim) throw new Error('Expected delayed claim.')
      const lease = await pool.query<{ has_remaining_lease: boolean }>(`
        SELECT lease_expires_at > clock_timestamp() + interval '1 second'
          AS has_remaining_lease
        FROM relay_commands
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId])
      expect(lease.rows[0].has_remaining_lease).toBe(true)
      await expect(new PostgresExecutionRepository(pool).complete({
        claim,
        output: 'Claim lease started after the lock wait.',
        providerModel: 'provider-model-lock-wait',
      })).resolves.toBe(true)
    } finally {
      if (transaction) await blocker.query('ROLLBACK')
      blocker.release()
      await claimPool.end()
    }
  })

  it('does not heartbeat a lease that expires while waiting for the Command lock', async () => {
    await createSession({ maxAttempts: 1 })
    const repository = new PostgresExecutionRepository(pool)
    const claim = await repository.claimNext({
      leaseOwner: 'delayed-heartbeat-worker', leaseDurationMs: 1_000,
    })
    if (!claim) throw new Error('Expected delayed heartbeat claim.')
    const applicationName = `relay_heartbeat_clock_${crypto.randomUUID()}`
    const heartbeatPool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const blocker = await pool.connect()
    let transaction = false
    try {
      await blocker.query('BEGIN')
      transaction = true
      await blocker.query(`
        SELECT 1 FROM relay_commands
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        FOR UPDATE
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId])
      const heartbeat = new PostgresExecutionRepository(heartbeatPool).heartbeat({
        claim, leaseDurationMs: 1_000,
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await delay(1_200)
      await blocker.query('COMMIT')
      transaction = false

      await expect(heartbeat).resolves.toBe(false)
      await expect(repository.reapExpired()).resolves.toEqual({
        requeued: 0, failed: 1, canceled: 0,
      })
    } finally {
      if (transaction) await blocker.query('ROLLBACK')
      blocker.release()
      await heartbeatPool.end()
    }
  })

  it('does not complete a lease that expires during the permission lock wait', async () => {
    await createSession({ maxAttempts: 1 })
    const repository = new PostgresExecutionRepository(pool)
    const claim = await repository.claimNext({
      leaseOwner: 'delayed-complete-worker', leaseDurationMs: 1_000,
    })
    if (!claim) throw new Error('Expected delayed completion claim.')
    const applicationName = `relay_complete_clock_${crypto.randomUUID()}`
    const completePool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const blocker = await pool.connect()
    let transaction = false
    try {
      await blocker.query('BEGIN')
      transaction = true
      await blocker.query(`
        UPDATE relay_space_memberships SET role = role
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
      const completion = new PostgresExecutionRepository(completePool).complete({
        claim,
        output: 'This output crossed the lease boundary.',
        providerModel: 'provider-model-lease-boundary',
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await delay(1_200)
      await blocker.query('COMMIT')
      transaction = false

      await expect(completion).resolves.toBe(false)
      const messages = await pool.query<{ count: string }>(`
        SELECT count(*) FROM relay_messages
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent'
      `, [claim.organizationId, claim.spaceId, claim.sessionId])
      expect(messages.rows[0].count).toBe('0')
      await expect(repository.reapExpired()).resolves.toEqual({
        requeued: 0, failed: 1, canceled: 0,
      })
    } finally {
      if (transaction) await blocker.query('ROLLBACK')
      blocker.release()
      await completePool.end()
    }
  })

  it('does not fail a lease that expires during the permission lock wait', async () => {
    await createSession({ maxAttempts: 1 })
    const repository = new PostgresExecutionRepository(pool)
    const claim = await repository.claimNext({
      leaseOwner: 'delayed-fail-worker', leaseDurationMs: 1_000,
    })
    if (!claim) throw new Error('Expected delayed failure claim.')
    const applicationName = `relay_fail_clock_${crypto.randomUUID()}`
    const failPool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const blocker = await pool.connect()
    let transaction = false
    try {
      await blocker.query('BEGIN')
      transaction = true
      await blocker.query(`
        UPDATE relay_space_memberships SET role = role
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
      const failure = new PostgresExecutionRepository(failPool).fail({
        claim,
        classification: 'terminal',
        code: 'provider_rejected_request',
        message: 'This failure crossed the lease boundary.',
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await delay(1_200)
      await blocker.query('COMMIT')
      transaction = false

      await expect(failure).resolves.toBe('stale')
      const attempt = await pool.query<{ status: string }>(`
        SELECT status FROM relay_attempts
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.attemptId])
      expect(attempt.rows[0].status).toBe('running')
      await expect(repository.reapExpired()).resolves.toEqual({
        requeued: 0, failed: 1, canceled: 0,
      })
    } finally {
      if (transaction) await blocker.query('ROLLBACK')
      blocker.release()
      await failPool.end()
    }
  })

  it('cancels completion when a concurrent role downgrade commits first', async () => {
    await createSession({ maxAttempts: 1 })
    const repository = new PostgresExecutionRepository(pool)
    const claim = await repository.claimNext({
      leaseOwner: 'completion-downgrade-worker', leaseDurationMs: 5_000,
    })
    if (!claim) throw new Error('Expected role downgrade completion claim.')
    const applicationName = `relay_complete_auth_${crypto.randomUUID()}`
    const completePool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const blocker = await pool.connect()
    let transaction = false
    try {
      await blocker.query('BEGIN')
      transaction = true
      await blocker.query(`
        UPDATE relay_space_memberships SET role = 'viewer'
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
      const completion = new PostgresExecutionRepository(completePool).complete({
        claim,
        output: 'This output must be canceled after role downgrade.',
        providerModel: 'provider-model-role-downgrade',
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await blocker.query('COMMIT')
      transaction = false

      await expect(completion).resolves.toBe(false)
      const facts = await pool.query<{ command_status: string; attempt_status: string; outputs: string }>(`
        SELECT
          command_record.status AS command_status,
          attempt.status AS attempt_status,
          (SELECT count(*) FROM relay_messages
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent') AS outputs
        FROM relay_commands command_record
        JOIN relay_attempts attempt
          ON attempt.organization_id = command_record.organization_id
          AND attempt.space_id = command_record.space_id
          AND attempt.session_id = command_record.session_id
          AND attempt.turn_id = command_record.resource_id
        WHERE command_record.organization_id = $1 AND command_record.space_id = $2
          AND command_record.session_id = $3 AND command_record.id = $4
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId])
      expect(facts.rows[0]).toEqual({
        command_status: 'canceled', attempt_status: 'canceled', outputs: '0',
      })
    } finally {
      if (transaction) await blocker.query('ROLLBACK')
      blocker.release()
      await completePool.end()
      await pool.query(`
        UPDATE relay_space_memberships SET role = 'member'
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    }
  })

  it('cancels a running execution on the first heartbeat after write access is revoked', async () => {
    await createSession({ maxAttempts: 1 })
    const repository = new PostgresExecutionRepository(pool)
    const now = new Date()
    const claim = await repository.claimNext({
      leaseOwner: 'heartbeat-revocation-worker',
      leaseDurationMs: 5_000,
      now,
    })
    if (!claim) throw new Error('Expected heartbeat revocation claim.')

    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
    `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    try {
      await expect(repository.heartbeat({
        claim,
        leaseDurationMs: 5_000,
        now: new Date(now.getTime() + 100),
      })).resolves.toBe(false)

      const state = await pool.query<{
        command_status: string
        attempt_status: string
        turn_status: string
        session_status: string
        provider_model: string | null
        outputs: string
      }>(`
        SELECT
          command_record.status AS command_status,
          attempt.status AS attempt_status,
          turn_record.status AS turn_status,
          session_record.status AS session_status,
          attempt.provider_model,
          (SELECT count(*) FROM relay_messages message
            WHERE message.organization_id = $1
              AND message.space_id = $2
              AND message.session_id = $3
              AND message.role = 'agent') AS outputs
        FROM relay_commands command_record
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_attempts attempt
          ON attempt.organization_id = turn_record.organization_id
          AND attempt.space_id = turn_record.space_id
          AND attempt.session_id = turn_record.session_id
          AND attempt.turn_id = turn_record.id
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId])
      expect(state.rows[0]).toEqual({
        command_status: 'canceled',
        attempt_status: 'canceled',
        turn_status: 'canceled',
        session_status: 'canceled',
        provider_model: null,
        outputs: '0',
      })

      const events = await pool.query<{ event_type: string; status: string }>(`
        SELECT event_type, payload->>'status' AS status
        FROM relay_session_events
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        ORDER BY sequence DESC
        LIMIT 2
      `, [claim.organizationId, claim.spaceId, claim.sessionId])
      expect(events.rows.reverse()).toEqual([
        { event_type: 'attempt.updated', status: 'canceled' },
        { event_type: 'session.updated', status: 'canceled' },
      ])
    } finally {
      await pool.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ($1, $2, $3, 'member')
        ON CONFLICT (organization_id, space_id, actor_id) DO UPDATE SET role = EXCLUDED.role
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    }
  })

  it('heartbeats only the current unexpired owner and rejects an old attempt fence', async () => {
    await createSession({ maxAttempts: 2 })
    const repository = new PostgresExecutionRepository(pool)
    const claimAt = new Date(Date.now() + 10)
    const first = await repository.claimNext({
      leaseOwner: 'heartbeat-worker-1', leaseDurationMs: 1_000, now: claimAt,
    })
    if (!first) throw new Error('Expected first heartbeat claim.')
    const heartbeatAt = new Date(claimAt.getTime() + 100)
    await expect(repository.heartbeat({
      claim: first, leaseDurationMs: 2_000, now: heartbeatAt,
    })).resolves.toBe(true)
    const lease = await pool.query<{ lease_expires_at: Date }>(`
      SELECT lease_expires_at FROM relay_commands
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
    `, [first.organizationId, first.spaceId, first.sessionId, first.commandId])
    expect(lease.rows[0].lease_expires_at.toISOString()).toBe(
      new Date(heartbeatAt.getTime() + 2_000).toISOString(),
    )

    await expect(repository.fail({
      claim: first,
      classification: 'transient',
      code: 'provider_timeout',
      message: 'Temporary provider timeout.',
      retryDelayMs: 0,
      now: new Date(heartbeatAt.getTime() + 10),
    })).resolves.toBe('requeued')
    const retryBoundary = await pool.query<{ attempts: number; attempt_rows: string; lease_owner: string | null }>(`
      SELECT attempts, lease_owner,
        (SELECT count(*) FROM relay_attempts
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3) AS attempt_rows
      FROM relay_commands
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
    `, [first.organizationId, first.spaceId, first.sessionId, first.commandId])
    expect(retryBoundary.rows[0]).toEqual({ attempts: 1, attempt_rows: '1', lease_owner: null })
    const second = await repository.claimNext({
      leaseOwner: 'heartbeat-worker-2',
      leaseDurationMs: 1_000,
      now: new Date(heartbeatAt.getTime() + 20),
    })
    if (!second) throw new Error('Expected second heartbeat claim.')
    expect(second.attemptNumber).toBe(2)
    await expect(repository.heartbeat({
      claim: first,
      leaseDurationMs: 1_000,
      now: new Date(heartbeatAt.getTime() + 30),
    })).resolves.toBe(false)
    await expect(repository.complete({
      claim: first,
      output: 'Stale output.',
      providerModel: 'provider-model-stale',
      now: new Date(heartbeatAt.getTime() + 30),
    })).resolves.toBe(false)
    await expect(repository.fail({
      claim: first,
      classification: 'terminal',
      code: 'stale_worker',
      message: 'A stale worker must not commit.',
      now: new Date(heartbeatAt.getTime() + 30),
    })).resolves.toBe('stale')
    await expect(repository.fail({
      claim: second,
      classification: 'terminal',
      code: 'provider_output_truncated',
      message: 'Bearer secret-value api_key=another-secret ' + 'x'.repeat(2_000),
      providerModel: 'provider-model-truncated-20260701',
      retryDelayMs: 0,
      now: new Date(heartbeatAt.getTime() + 40),
    })).resolves.toBe('failed')

    const failures = await pool.query<{
      number: number
      provider_model: string | null
      failure_message: string
    }>(`
      SELECT number, provider_model, failure_message FROM relay_attempts
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
      ORDER BY number
    `, [second.organizationId, second.spaceId, second.sessionId])
    expect(failures.rows[0]).toMatchObject({ number: 1, provider_model: null })
    expect(failures.rows[1]).toMatchObject({
      number: 2,
      provider_model: 'provider-model-truncated-20260701',
    })
    expect(failures.rows[1].failure_message).toContain('[REDACTED]')
    expect(failures.rows[1].failure_message).not.toContain('secret-value')
    expect(failures.rows[1].failure_message.length).toBeLessThanOrEqual(1_000)
  })

  it('commits one agent Message and contiguous success events atomically', async () => {
    await createSession()
    const repository = new PostgresExecutionRepository(pool)
    const now = new Date(Date.now() + 10)
    const claim = await repository.claimNext({
      leaseOwner: 'success-worker', leaseDurationMs: 30_000, now,
    })
    if (!claim) throw new Error('Expected success claim.')

    await pool.query(`
      CREATE FUNCTION relay_test_reject_completion_event() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected completion event failure'; END; $$;
      CREATE TRIGGER relay_test_reject_completion_event
      BEFORE INSERT ON relay_session_events
      FOR EACH ROW WHEN (NEW.event_type = 'message.created')
      EXECUTE FUNCTION relay_test_reject_completion_event();
    `)
    try {
      await expect(repository.complete({
        claim,
        output: 'This transaction must roll back.',
        providerModel: 'provider-model-rollback',
        now: new Date(now.getTime() + 10),
      })).rejects.toThrow('injected completion event failure')
    } finally {
      await pool.query(`
        DROP TRIGGER relay_test_reject_completion_event ON relay_session_events;
        DROP FUNCTION relay_test_reject_completion_event();
      `)
    }
    const rolledBack = await pool.query<{ command_status: string; agent_messages: string }>(`
      SELECT
        (SELECT status FROM relay_commands
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS command_status,
        (SELECT count(*) FROM relay_messages
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent') AS agent_messages
    `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId])
    expect(rolledBack.rows[0]).toEqual({ command_status: 'running', agent_messages: '0' })

    await expect(repository.complete({
      claim,
      output: 'Atomic conversational output.',
      providerModel: 'provider-model-success-20260701',
      now: new Date(now.getTime() + 20),
    })).resolves.toBe(true)
    await expect(repository.complete({
      claim,
      output: 'Duplicate output.',
      providerModel: 'provider-model-duplicate',
      now: new Date(now.getTime() + 21),
    })).resolves.toBe(false)
    const facts = await pool.query<{
      command_status: string
      turn_status: string
      session_status: string
      attempt_status: string
      provider_model: string | null
      agent_messages: string
      sequences: string[]
      event_types: string[]
    }>(`
      SELECT
        (SELECT status FROM relay_commands WHERE id = $4) AS command_status,
        (SELECT status FROM relay_turns WHERE id = $5) AS turn_status,
        (SELECT status FROM relay_sessions WHERE id = $3) AS session_status,
        (SELECT status FROM relay_attempts WHERE id = $6) AS attempt_status,
        (SELECT provider_model FROM relay_attempts WHERE id = $6) AS provider_model,
        (SELECT count(*) FROM relay_messages
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent') AS agent_messages,
        ARRAY(SELECT sequence::text FROM relay_session_events
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 ORDER BY sequence) AS sequences,
        ARRAY(SELECT event_type FROM relay_session_events
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 ORDER BY sequence) AS event_types
    `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId, claim.turnId, claim.attemptId])
    expect(facts.rows[0]).toEqual({
      command_status: 'succeeded',
      turn_status: 'completed',
      session_status: 'completed',
      attempt_status: 'succeeded',
      provider_model: 'provider-model-success-20260701',
      agent_messages: '1',
      sequences: ['1', '2', '3', '4', '5', '6', '7', '8'],
      event_types: [
        'session.created', 'message.created', 'turn.queued',
        'session.updated', 'attempt.updated', 'message.created',
        'attempt.updated', 'session.updated',
      ],
    })
  })

  it('discards completion after authorization is revoked without any partial write', async () => {
    await createSession()
    const repository = new PostgresExecutionRepository(pool)
    const now = new Date(Date.now() + 10)
    const claim = await repository.claimNext({
      leaseOwner: 'authorization-worker', leaseDurationMs: 100, now,
    })
    if (!claim) throw new Error('Expected authorization claim.')
    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
    `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    await expect(repository.complete({
      claim,
      output: 'This output must be discarded.',
      providerModel: 'provider-model-revoked',
      now: new Date(now.getTime() + 10),
    })).resolves.toBe(false)
    const facts = await pool.query<{
      agent_messages: string
      attempt_status: string
      provider_model: string | null
    }>(`
      SELECT
        (SELECT count(*) FROM relay_messages
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND role = 'agent') AS agent_messages,
        (SELECT status FROM relay_attempts
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS attempt_status,
        (SELECT provider_model FROM relay_attempts
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS provider_model
    `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.attemptId])
    expect(facts.rows[0]).toEqual({
      agent_messages: '0',
      attempt_status: 'canceled',
      provider_model: 'provider-model-revoked',
    })
    const canceled = await pool.query<{ command: string; turn: string; attempt: string; session: string }>(`
      SELECT
        (SELECT status FROM relay_commands
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS command,
        (SELECT status FROM relay_turns
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $5) AS turn,
        (SELECT status FROM relay_attempts
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $6) AS attempt,
        (SELECT status FROM relay_sessions
          WHERE organization_id = $1 AND space_id = $2 AND id = $3) AS session
    `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId, claim.turnId, claim.attemptId])
    expect(canceled.rows[0]).toEqual({
      command: 'canceled', turn: 'canceled', attempt: 'canceled', session: 'canceled',
    })
    await expect(repository.reapExpired({
      limit: 10,
      retryDelayMs: 0,
      now: new Date(now.getTime() + 101),
    })).resolves.toEqual({ requeued: 0, failed: 0, canceled: 0 })
    await pool.query(`
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ($1, $2, $3, 'member')
    `, [claim.organizationId, claim.spaceId, claim.requestedBy])
  })

  it('cancels rather than fails when a terminal provider error arrives after revocation', async () => {
    await createSession()
    const repository = new PostgresExecutionRepository(pool)
    const now = new Date(Date.now() + 10)
    const claim = await repository.claimNext({
      leaseOwner: 'revoked-terminal-worker', leaseDurationMs: 1_000, now,
    })
    if (!claim) throw new Error('Expected revoked terminal claim.')
    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
    `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    try {
      await expect(repository.fail({
        claim,
        classification: 'terminal',
        code: 'provider_rejected_request',
        message: 'Provider rejected the request.',
        now: new Date(now.getTime() + 10),
      })).resolves.toBe('canceled')
      const facts = await pool.query<{
        command_status: string
        attempt_status: string
        command_failure: string | null
        attempt_failure: string | null
      }>(`
        SELECT
          command_record.status AS command_status,
          attempt.status AS attempt_status,
          command_record.failure_code AS command_failure,
          attempt.failure_code AS attempt_failure
        FROM relay_commands command_record
        JOIN relay_attempts attempt
          ON attempt.organization_id = command_record.organization_id
          AND attempt.space_id = command_record.space_id
          AND attempt.session_id = command_record.session_id
          AND attempt.turn_id = command_record.resource_id
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
          AND attempt.id = $5
      `, [claim.organizationId, claim.spaceId, claim.sessionId, claim.commandId, claim.attemptId])
      expect(facts.rows[0]).toEqual({
        command_status: 'canceled',
        attempt_status: 'canceled',
        command_failure: null,
        attempt_failure: null,
      })
    } finally {
      await pool.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ($1, $2, $3, 'member')
      `, [claim.organizationId, claim.spaceId, claim.requestedBy])
    }
  })

  it('reaps expired leases into retry and then terminal failure at max attempts', async () => {
    await createSession({ maxAttempts: 2 })
    const repository = new PostgresExecutionRepository(pool)
    const firstAt = new Date(Date.now() + 10)
    const first = await repository.claimNext({
      leaseOwner: 'expired-worker-1', leaseDurationMs: 100, now: firstAt,
    })
    if (!first) throw new Error('Expected first expired claim.')
    const expiredAt = new Date(firstAt.getTime() + 101)
    await expect(repository.complete({
      claim: first,
      output: 'Expired output.',
      providerModel: 'provider-model-expired',
      now: expiredAt,
    })).resolves.toBe(false)
    await expect(repository.fail({
      claim: first,
      classification: 'terminal',
      code: 'expired_worker',
      message: 'Expired workers must not commit.',
      now: expiredAt,
    })).resolves.toBe('stale')
    await expect(repository.reapExpired({
      limit: 10, retryDelayMs: 0, now: expiredAt,
    })).resolves.toEqual({ requeued: 1, failed: 0, canceled: 0 })
    const secondAt = new Date(firstAt.getTime() + 102)
    const second = await repository.claimNext({
      leaseOwner: 'expired-worker-2', leaseDurationMs: 100, now: secondAt,
    })
    if (!second) throw new Error('Expected second expired claim.')
    expect(second.attemptNumber).toBe(2)
    await expect(repository.reapExpired({
      limit: 10, retryDelayMs: 0, now: new Date(secondAt.getTime() + 101),
    })).resolves.toEqual({ requeued: 0, failed: 1, canceled: 0 })
    const events = await pool.query<{ actor_kind: string; failure_code: string }>(`
      SELECT actor_kind, payload->>'failureCode' AS failure_code
      FROM relay_session_events
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND event_type = 'attempt.updated' AND payload->>'status' = 'failed'
      ORDER BY sequence
    `, [second.organizationId, second.spaceId, second.sessionId])
    expect(events.rows).toEqual([
      { actor_kind: 'system', failure_code: 'lease_expired' },
      { actor_kind: 'system', failure_code: 'lease_expired' },
    ])
  })

  it('cancels an unattempted queued execution when requested_by has lost write access', async () => {
    const created = await createSession()
    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = $1 AND space_id = $2 AND actor_id = 'execution-user'
    `, [created.session.organizationId, created.session.spaceId])
    try {
      await expect(new PostgresExecutionRepository(pool).claimNext({
        leaseOwner: 'authorization-check-worker', leaseDurationMs: 1_000,
      })).resolves.toBeNull()
      const facts = await pool.query<{ command: string; turn: string; session: string; attempts: number }>(`
        SELECT
          (SELECT status FROM relay_commands
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS command,
          (SELECT status FROM relay_turns
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $5) AS turn,
          (SELECT status FROM relay_sessions
            WHERE organization_id = $1 AND space_id = $2 AND id = $3) AS session,
          (SELECT attempts FROM relay_commands
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4) AS attempts
      `, [
        created.session.organizationId,
        created.session.spaceId,
        created.session.id,
        created.command?.id,
        created.turn?.id,
      ])
      expect(facts.rows[0]).toEqual({
        command: 'canceled', turn: 'canceled', session: 'canceled', attempts: 0,
      })
      const event = await pool.query<{
        event_type: string
        sequence: string
        payload: unknown
      }>(`
        SELECT event_type, sequence, payload
        FROM relay_session_events
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        ORDER BY sequence DESC
        LIMIT 1
      `, [created.session.organizationId, created.session.spaceId, created.session.id])
      expect(event.rows).toEqual([{
        event_type: 'session.updated',
        sequence: '4',
        payload: { status: 'canceled', version: 2 },
      }])
    } finally {
      await pool.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ($1, $2, 'execution-user', 'member')
      `, [created.session.organizationId, created.session.spaceId])
    }
  })

  it('does not claim after a concurrent role downgrade commits first', async () => {
    const created = await createSession()
    const applicationName = `relay_execution_auth_${crypto.randomUUID()}`
    const claimPool = new Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`,
    })
    const authorizationClient = await pool.connect()
    let authorizationTransaction = false
    try {
      await authorizationClient.query('BEGIN')
      authorizationTransaction = true
      await authorizationClient.query(`
        UPDATE relay_space_memberships
        SET role = 'viewer'
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = 'execution-user'
      `, [created.session.organizationId, created.session.spaceId])

      const claim = new PostgresExecutionRepository(claimPool).claimNext({
        leaseOwner: 'authorization-race-worker',
        leaseDurationMs: 1_000,
      })
      await waitForDatabaseLock(adminPool, applicationName)
      await authorizationClient.query('COMMIT')
      authorizationTransaction = false

      await expect(claim).resolves.toBeNull()
      const beforeRecovery = await pool.query<{ status: string; attempts: number; attempt_rows: string }>(`
        SELECT command_record.status, command_record.attempts,
          (SELECT count(*) FROM relay_attempts attempt
            WHERE attempt.organization_id = command_record.organization_id
              AND attempt.space_id = command_record.space_id
              AND attempt.session_id = command_record.session_id) AS attempt_rows
        FROM relay_commands command_record
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
      `, [
        created.session.organizationId,
        created.session.spaceId,
        created.session.id,
        created.command?.id,
      ])
      expect(beforeRecovery.rows[0]).toEqual({ status: 'accepted', attempts: 0, attempt_rows: '0' })

      await expect(new PostgresExecutionRepository(pool).claimNext({
        leaseOwner: 'authorization-recovery-worker',
        leaseDurationMs: 1_000,
      })).resolves.toBeNull()
      const recovered = await pool.query<{ status: string }>(`
        SELECT status FROM relay_commands
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
      `, [
        created.session.organizationId,
        created.session.spaceId,
        created.session.id,
        created.command?.id,
      ])
      expect(recovered.rows[0]?.status).toBe('canceled')
    } finally {
      if (authorizationTransaction) await authorizationClient.query('ROLLBACK')
      authorizationClient.release()
      await claimPool.end()
      await pool.query(`
        UPDATE relay_space_memberships
        SET role = 'member'
        WHERE organization_id = $1 AND space_id = $2 AND actor_id = 'execution-user'
      `, [created.session.organizationId, created.session.spaceId])
    }
  })

  it('cancels a retry-queued execution when access is revoked between attempts', async () => {
    await createSession({ maxAttempts: 3 })
    const repository = new PostgresExecutionRepository(pool)
    const now = new Date(Date.now() + 10)
    const first = await repository.claimNext({
      leaseOwner: 'retry-revocation-worker-1', leaseDurationMs: 1_000, now,
    })
    if (!first) throw new Error('Expected retry revocation claim.')
    await expect(repository.fail({
      claim: first,
      classification: 'transient',
      code: 'provider_timeout',
      message: 'The provider timed out.',
      retryDelayMs: 0,
      now: new Date(now.getTime() + 10),
    })).resolves.toBe('requeued')
    await pool.query(`
      DELETE FROM relay_space_memberships
      WHERE organization_id = $1 AND space_id = $2 AND actor_id = $3
    `, [first.organizationId, first.spaceId, first.requestedBy])
    try {
      await expect(repository.claimNext({
        leaseOwner: 'retry-revocation-worker-2',
        leaseDurationMs: 1_000,
        now: new Date(now.getTime() + 20),
      })).resolves.toBeNull()
      const facts = await pool.query<{
        command_status: string
        command_attempts: number
        turn_status: string
        session_status: string
        attempt_statuses: string[]
        last_event_type: string
        last_event_payload: unknown
      }>(`
        SELECT
          command_record.status AS command_status,
          command_record.attempts AS command_attempts,
          turn_record.status AS turn_status,
          session_record.status AS session_status,
          ARRAY(SELECT status FROM relay_attempts
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            ORDER BY number) AS attempt_statuses,
          (SELECT event_type FROM relay_session_events
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            ORDER BY sequence DESC LIMIT 1) AS last_event_type,
          (SELECT payload FROM relay_session_events
            WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            ORDER BY sequence DESC LIMIT 1) AS last_event_payload
        FROM relay_commands command_record
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
      `, [first.organizationId, first.spaceId, first.sessionId, first.commandId])
      expect(facts.rows[0]).toEqual({
        command_status: 'canceled',
        command_attempts: 1,
        turn_status: 'canceled',
        session_status: 'canceled',
        attempt_statuses: ['failed'],
        last_event_type: 'session.updated',
        last_event_payload: { status: 'canceled', version: 4 },
      })
    } finally {
      await pool.query(`
        INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ($1, $2, $3, 'member')
      `, [first.organizationId, first.spaceId, first.requestedBy])
    }
  })

  it('never claims a legacy protocol-0 command', async () => {
    const draft = await createSession({ start: false })
    const turnId = `protocol-zero-turn-${sequence}`
    const commandId = `protocol-zero-command-${sequence}`
    await pool.query(`
      UPDATE relay_sessions SET status = 'queued'
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [draft.session.organizationId, draft.session.spaceId, draft.session.id])
    await pool.query(`
      INSERT INTO relay_turns (
        id, organization_id, space_id, session_id, ordinal, initiator_type,
        initiator_id, input_message_id, status, queued_at, version
      ) VALUES ($4, $1, $2, $3, 1, 'user', 'execution-user', $5, 'queued', now(), 1)
    `, [
      draft.session.organizationId,
      draft.session.spaceId,
      draft.session.id,
      turnId,
      draft.message?.id,
    ])
    await pool.query(`
      INSERT INTO relay_commands (
        id, organization_id, space_id, session_id, type, status, resource_type,
        resource_id, accepted_at, available_at, protocol_version
      ) VALUES ($5, $1, $2, $3, 'session.start', 'accepted', 'turn', $4, now(), now(), 0)
    `, [
      draft.session.organizationId,
      draft.session.spaceId,
      draft.session.id,
      turnId,
      commandId,
    ])
    await expect(new PostgresExecutionRepository(pool).claimNext({
      leaseOwner: 'protocol-worker', leaseDurationMs: 1_000,
    })).resolves.toBeNull()
    const command = await pool.query<{ status: string; attempts: number }>(`
      SELECT status, attempts FROM relay_commands
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
    `, [draft.session.organizationId, draft.session.spaceId, draft.session.id, commandId])
    expect(command.rows).toEqual([{ status: 'accepted', attempts: 0 }])
  })
})
