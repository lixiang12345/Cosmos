import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AdvisorPlanExecutor } from './advisor-plan-executor.js'
import { bootstrapDevelopmentDatabase } from './development-database-bootstrap.js'
import { runMigrations } from './migrations.js'
import { PostgresAdvisorPlanRepository } from './postgres-advisor-plan-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSpaceRepository } from './postgres-space-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Advisor controlled execution under restricted runtime roles', () => {
  const schema = `relay_advisor_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=relay_worker_runtime -c search_path=${schema}`,
  })
  let sequence = 0
  let sessionId = ''
  let planId = ''

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await bootstrapDevelopmentDatabase(migrationPool, 'user-local-admin')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: () => `advisor-fixture-${++sequence}`,
      now: () => new Date('2026-07-22T02:00:00.000Z'),
    }).create({
      organizationId: 'relay',
      spaceId: 'space-platform',
      actorId: 'user-local-admin',
      actorKind: 'user',
      requestId: 'advisor-session-request',
      idempotencyKey: 'advisor-session-key',
      request: {
        expertId: 'expert-advisor-space-platform',
        title: 'Configure delivery ownership',
        visibility: 'private',
        start: true,
        message: { content: 'Clarify this Space purpose.', attachments: [] },
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

  it('proposes once from the built-in Advisor and conceals the plan across tenants', async () => {
    const repository = new PostgresAdvisorPlanRepository(workerPool, {
      createId: () => `advisor-plan-${++sequence}`,
      now: () => new Date('2026-07-22T02:01:00.000Z'),
    })
    const proposal = {
      summary: 'Clarify the Platform Space ownership before future Sessions start.',
      dependencies: ['The current Space remains active.'],
      risks: ['The description is visible to Space members.'],
      steps: [{
        kind: 'control_plane' as const,
        operation: 'space.update' as const,
        changes: { description: 'Platform delivery and runtime ownership.' },
        rationale: 'Make the authoritative Space purpose explicit.',
      }],
    }
    const first = await repository.proposePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId,
      actorId: 'user-local-admin', requestId: 'advisor-proposal-request',
      providerToolCallId: 'provider-advisor-plan-1', proposal,
    })
    const replay = await repository.proposePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId,
      actorId: 'user-local-admin', requestId: 'advisor-proposal-replay',
      providerToolCallId: 'provider-advisor-plan-1', proposal,
    })
    expect(replay.id).toBe(first.id)
    expect(first).toMatchObject({
      status: 'proposed', requestedBy: 'user-local-admin',
      steps: [{
        operation: 'space.update', status: 'proposed',
        before: { description: '', version: 1 },
        after: { description: 'Platform delivery and runtime ownership.', version: 2 },
      }],
    })
    planId = first.id

    const apiRepository = new PostgresAdvisorPlanRepository(apiPool)
    await expect(apiRepository.listPlans('other', 'space-platform', sessionId, 'user-local-admin'))
      .resolves.toBeNull()
  })

  it('requires confirmation, applies the authority write idempotently, and audits both facts', async () => {
    const plans = new PostgresAdvisorPlanRepository(apiPool, {
      createId: () => `advisor-api-${++sequence}`,
      now: () => new Date('2026-07-22T02:02:00.000Z'),
    })
    const proposed = await plans.getPlan('relay', 'space-platform', sessionId, planId, 'user-local-admin')
    if (!proposed) throw new Error('Expected the Advisor plan fixture.')
    const decision = await plans.decidePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId, planId,
      actorId: 'user-local-admin', requestId: 'advisor-confirm-request',
      expectedVersion: proposed.version, idempotencyKey: 'advisor-confirm-key',
      request: { decision: 'confirmed', note: 'The diff is bounded and expected.' },
    })
    expect(decision).toMatchObject({ replayed: false, plan: { status: 'executing' } })
    const executed = await new AdvisorPlanExecutor(
      plans,
      new PostgresSpaceRepository(apiPool, {
        createId: () => `advisor-space-${++sequence}`,
        now: () => new Date('2026-07-22T02:03:00.000Z'),
      }),
    ).execute({
      organizationId: 'relay', spaceId: 'space-platform', sessionId, planId,
      actorId: 'user-local-admin', requestId: 'advisor-execute-request',
    })
    expect(executed).toMatchObject({
      status: 'succeeded', steps: [{ status: 'succeeded' }],
    })
    await expect(new PostgresSpaceRepository(apiPool).getSpace(
      'relay', 'space-platform', 'user-local-admin',
    )).resolves.toMatchObject({
      description: 'Platform delivery and runtime ownership.', version: 2,
    })

    const replay = await plans.decidePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId, planId,
      actorId: 'user-local-admin', requestId: 'advisor-confirm-replay',
      expectedVersion: proposed.version, idempotencyKey: 'advisor-confirm-key',
      request: { decision: 'confirmed', note: 'The diff is bounded and expected.' },
    })
    expect(replay).toMatchObject({ replayed: true, plan: { status: 'executing' } })

    const evidence = await migrationPool.query<{ advisor_audits: number; space_audits: number }>(`
      SELECT
        (SELECT count(*)::integer FROM relay_audit_events
          WHERE target_type = 'advisor_plan' AND target_id = $1) AS advisor_audits,
        (SELECT count(*)::integer FROM relay_space_audit_events
          WHERE space_id = 'space-platform' AND action = 'space.updated') AS space_audits
    `, [planId])
    expect(evidence.rows[0]).toMatchObject({ advisor_audits: 3, space_audits: 1 })
  })

  it('stops OAuth and Secret work at an explicit manual action', async () => {
    const workerRepository = new PostgresAdvisorPlanRepository(workerPool, {
      createId: () => `advisor-manual-${++sequence}`,
      now: () => new Date('2026-07-22T02:04:00.000Z'),
    })
    const manual = await workerRepository.proposePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId,
      actorId: 'user-local-admin', requestId: 'advisor-manual-proposal',
      providerToolCallId: 'provider-advisor-manual-1',
      proposal: {
        summary: 'Complete authorization without exposing credentials.',
        dependencies: [], risks: [],
        steps: [{
          kind: 'manual_action', action: 'oauth', label: 'Authorize provider',
          instructions: 'Open the trusted Integrations settings and complete authorization.',
        }],
      },
    })
    const plans = new PostgresAdvisorPlanRepository(apiPool, {
      createId: () => `advisor-manual-api-${++sequence}`,
      now: () => new Date('2026-07-22T02:05:00.000Z'),
    })
    await plans.decidePlan({
      organizationId: 'relay', spaceId: 'space-platform', sessionId, planId: manual.id,
      actorId: 'user-local-admin', requestId: 'advisor-manual-confirm',
      expectedVersion: manual.version, idempotencyKey: 'advisor-manual-confirm-key',
      request: { decision: 'confirmed' },
    })
    const result = await new AdvisorPlanExecutor(plans, new PostgresSpaceRepository(apiPool)).execute({
      organizationId: 'relay', spaceId: 'space-platform', sessionId, planId: manual.id,
      actorId: 'user-local-admin', requestId: 'advisor-manual-execute',
    })
    expect(result).toMatchObject({
      status: 'action_required',
      steps: [{ kind: 'manual_action', status: 'action_required', manualAction: { kind: 'oauth' } }],
    })
  })
})
