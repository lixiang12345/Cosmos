import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresExecutionRepository } from './postgres-execution-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { PostgresToolApprovalRepository } from './postgres-tool-approval-repository.js'
import { PostgresToolCoordinatorRepository } from './postgres-tool-coordinator-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import {
  ApprovalAlreadyDecidedError,
} from './tool-approval-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Postgres ToolCall and Approval governance', () => {
  const schema = `relay_tools_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    max: 12,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=relay_worker_runtime -c search_path=${schema}`,
  })
  let sequence = 0
  let now = new Date('2026-07-13T03:00:00.000Z')
  const coordinator = new PostgresToolCoordinatorRepository(workerPool, {
    createId: () => `tool-runtime-${++sequence}`,
    now: () => new Date(now),
  })
  const approvals = new PostgresToolApprovalRepository(apiPool, {
    createId: () => `approval-runtime-${++sequence}`,
    now: () => new Date(now),
  })
  const timeline = new PostgresSessionTimelineRepository(apiPool)
  let sessionId = ''
  let turnId = ''
  let attemptId = ''

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES ('tool-org', 'Tool Organization');
      INSERT INTO relay_spaces (organization_id, id, name)
      VALUES ('tool-org', 'tool-space', 'Tool Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('tool-org', 'tool-requester', 'member'),
        ('tool-org', 'tool-reviewer-1', 'member'),
        ('tool-org', 'tool-reviewer-2', 'member'),
        ('tool-org', 'tool-admin', 'organization_admin');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('tool-org', 'tool-space', 'tool-requester', 'member'),
        ('tool-org', 'tool-space', 'tool-reviewer-1', 'member'),
        ('tool-org', 'tool-space', 'tool-reviewer-2', 'member'),
        ('tool-org', 'tool-space', 'tool-admin', 'space_manager');
    `)
    await seedSessionConfiguration(migrationPool, 'tool-org', 'tool-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: () => `tool-fixture-${++sequence}`,
      now: () => new Date('2026-07-13T02:00:00.000Z'),
    }).create({
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      actorId: 'tool-requester',
      actorKind: 'user',
      requestId: 'tool-session-request',
      idempotencyKey: 'tool-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Governed Tool Session',
        visibility: 'private',
        start: true,
        message: { content: 'Execute governed external operations.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('Tool fixture requires a Turn.')
    const claim = await new PostgresExecutionRepository(workerPool).claimNext({
      leaseOwner: 'tool-worker',
      leaseDurationMs: 60_000,
      now: new Date('2026-07-13T02:00:01.000Z'),
    })
    if (!claim) throw new Error('Tool fixture requires a running Attempt.')
    sessionId = claim.sessionId
    turnId = claim.turnId
    attemptId = claim.attemptId
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  function createRecord(operation: string) {
    return {
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      sessionId,
      turnId,
      attemptId,
      workerId: 'tool-worker',
      requestedBy: 'tool-requester',
      requestedByKind: 'user' as const,
      requestId: `tool-create-${operation}`,
      toolName: 'github',
      operation,
      riskLevel: 'high' as const,
      input: { repository: 'relay/cosmos', pullRequest: 42, token: '[secret-reference]' },
      inputSummary: `Perform ${operation} for relay/cosmos#42.`,
    }
  }

  it('records external side effects and blocks completion while provider outcome is unknown', async () => {
    const queued = await coordinator.createToolCall(createRecord('create_check_run'))
    const running = await coordinator.startToolCall({
      organizationId: queued.organizationId,
      spaceId: queued.spaceId,
      sessionId: queued.sessionId,
      toolCallId: queued.id,
      expectedVersion: queued.version,
      workerId: 'tool-worker',
      requestId: 'tool-start-side-effect',
      providerIdempotencyKey: 'github-check-run-42',
    })
    const prepared = await coordinator.prepareSideEffect({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      provider: 'github',
      operation: 'create_check_run',
      idempotencyKey: 'github-check-run-42',
      request: { repository: 'relay/cosmos', headSha: 'abc123' },
      requestId: 'side-effect-prepare',
    })
    await expect(coordinator.prepareSideEffect({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      provider: 'github',
      operation: 'create_check_run',
      idempotencyKey: 'github-check-run-42',
      request: { repository: 'other/repository', headSha: 'abc123' },
      requestId: 'side-effect-conflict',
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const unknown = await coordinator.resolveSideEffect({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      sideEffectId: prepared.id,
      expectedVersion: prepared.version,
      status: 'unknown',
      requestId: 'side-effect-unknown',
    })
    await expect(coordinator.finishToolCall({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      expectedVersion: running.version,
      workerId: 'tool-worker',
      requestId: 'tool-finish-too-early',
      status: 'succeeded',
    })).rejects.toMatchObject({ code: 'side_effect_unresolved' })

    await coordinator.resolveSideEffect({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      sideEffectId: prepared.id,
      expectedVersion: unknown.version,
      status: 'succeeded',
      providerOperationId: 'check-run-9001',
      result: { id: 9001, status: 'queued' },
      resultSummary: 'GitHub accepted check run 9001.',
      requestId: 'side-effect-resolved',
    })
    const completed = await coordinator.finishToolCall({
      organizationId: running.organizationId,
      spaceId: running.spaceId,
      sessionId: running.sessionId,
      toolCallId: running.id,
      expectedVersion: running.version,
      workerId: 'tool-worker',
      requestId: 'tool-finish-after-query',
      status: 'succeeded',
      output: { checkRunId: 9001 },
      outputSummary: 'Created check run 9001.',
    })
    expect(completed).toMatchObject({ status: 'succeeded', outputSummary: 'Created check run 9001.' })

    const ledger = await migrationPool.query<{ request_hash: string; result_hash: string }>(`
      SELECT request_hash, result_hash FROM relay_tool_side_effects WHERE id = $1
    `, [prepared.id])
    expect(ledger.rows[0].request_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(ledger.rows[0].result_hash).toMatch(/^[a-f0-9]{64}$/)
    const serializedEvents = await migrationPool.query<{ payload: string }>(`
      SELECT jsonb_agg(payload)::text AS payload FROM relay_session_events
      WHERE session_id = $1 AND event_type = 'tool_call.updated'
    `, [sessionId])
    expect(serializedEvents.rows[0].payload).not.toContain('abc123')
    expect(serializedEvents.rows[0].payload).not.toContain('token')
  })

  it('binds two-person Approval to the exact input and resumes the parent execution once', async () => {
    const queued = await coordinator.createToolCall(createRecord('merge_pull_request'))
    now = new Date('2026-07-13T03:01:00.000Z')
    const requested = await coordinator.requestApproval({
      organizationId: queued.organizationId,
      spaceId: queued.spaceId,
      sessionId: queued.sessionId,
      toolCallId: queued.id,
      expectedVersion: queued.version,
      requestedBy: 'tool-requester',
      requestedByKind: 'user',
      assignedTo: ['tool-reviewer-1', 'tool-reviewer-2'],
      requiredApprovals: 2,
      action: 'Merge pull request #42',
      reasons: ['Protected branch write', 'Production release gate'],
      evidence: [{ type: 'test', label: 'Required checks', value: 'All checks passed' }],
      expiresAt: '2026-07-13T04:00:00.000Z',
      requestId: 'approval-request',
    })
    expect(requested).toMatchObject({
      toolCall: { status: 'approval_required', version: 2 },
      approval: { status: 'pending', requiredApprovals: 2, assignedTo: ['tool-reviewer-1', 'tool-reviewer-2'] },
    })

    const first = await approvals.decideApproval({
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      approvalId: requested.approval.id,
      actorId: 'tool-reviewer-1',
      requestId: 'approval-first',
      idempotencyKey: 'approval-first-key',
      expectedVersion: 1,
      request: { decision: 'approved', note: 'CI evidence verified.' },
    })
    expect(first).toMatchObject({
      approval: { status: 'pending', approvalCount: 1, actorHasDecided: true, version: 2 },
    })
    const replay = await approvals.decideApproval({
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      approvalId: requested.approval.id,
      actorId: 'tool-reviewer-1',
      requestId: 'approval-first-replay',
      idempotencyKey: 'approval-first-key',
      expectedVersion: 1,
      request: { decision: 'approved', note: 'CI evidence verified.' },
    })
    expect(replay).toMatchObject({
      replayed: true,
      approval: { approvalCount: 1, actorHasDecided: true },
    })
    await expect(approvals.getApproval(
      'tool-org', 'tool-space', requested.approval.id, 'tool-reviewer-1',
    )).resolves.toMatchObject({ actorHasDecided: true })
    await expect(approvals.getApproval(
      'tool-org', 'tool-space', requested.approval.id, 'tool-reviewer-2',
    )).resolves.toMatchObject({ actorHasDecided: false })

    now = new Date('2026-07-13T03:02:00.000Z')
    const second = await approvals.decideApproval({
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      approvalId: requested.approval.id,
      actorId: 'tool-reviewer-2',
      requestId: 'approval-second',
      idempotencyKey: 'approval-second-key',
      expectedVersion: 2,
      request: { decision: 'approved', note: 'Rollback plan verified.' },
    })
    expect(second).toMatchObject({
      approval: { status: 'approved', approvalCount: 2, actorHasDecided: true, version: 3 },
    })
    const released = await approvals.listToolCalls(
      'tool-org', 'tool-space', sessionId, 'tool-requester', { limit: 25 },
    )
    expect(released?.items.find(({ id }) => id === queued.id)).toMatchObject({
      status: 'queued', approvalId: requested.approval.id, version: 3,
    })
    const started = await coordinator.startToolCall({
      organizationId: 'tool-org',
      spaceId: 'tool-space',
      sessionId,
      toolCallId: queued.id,
      expectedVersion: 3,
      workerId: 'tool-worker',
      requestId: 'approved-tool-start',
    })
    expect(started.status).toBe('running')

    const parent = await migrationPool.query<{ session_status: string; turn_status: string; attempt_status: string }>(`
      SELECT session.status AS session_status, turn_record.status AS turn_status,
        attempt.status AS attempt_status
      FROM relay_sessions session
      JOIN relay_turns turn_record ON turn_record.organization_id = session.organization_id
        AND turn_record.space_id = session.space_id AND turn_record.session_id = session.id
      JOIN relay_attempts attempt ON attempt.organization_id = turn_record.organization_id
        AND attempt.space_id = turn_record.space_id AND attempt.session_id = turn_record.session_id
        AND attempt.turn_id = turn_record.id
      WHERE session.id = $1 AND turn_record.id = $2 AND attempt.id = $3
    `, [sessionId, turnId, attemptId])
    expect(parent.rows[0]).toEqual({
      session_status: 'active', turn_status: 'running', attempt_status: 'running',
    })
    const events = await timeline.listEvents('tool-org', 'tool-space', sessionId, 'tool-requester', { limit: 500 })
    expect(events?.items.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'tool_call.updated', 'approval.requested', 'approval.decided', 'session.updated',
    ]))
  })

  it('allows only one concurrent terminal decision and preserves immutable decision history', async () => {
    const queued = await coordinator.createToolCall(createRecord('delete_release'))
    now = new Date('2026-07-13T03:10:00.000Z')
    const requested = await coordinator.requestApproval({
      organizationId: 'tool-org', spaceId: 'tool-space', sessionId,
      toolCallId: queued.id, expectedVersion: queued.version,
      requestedBy: 'tool-requester', requestedByKind: 'user',
      assignedTo: ['tool-reviewer-1', 'tool-reviewer-2'], requiredApprovals: 1,
      action: 'Delete release', reasons: ['Destructive external write'], evidence: [],
      expiresAt: '2026-07-13T04:00:00.000Z', requestId: 'concurrent-approval-request',
    })
    const decisions = await Promise.allSettled([
      approvals.decideApproval({
        organizationId: 'tool-org', spaceId: 'tool-space', approvalId: requested.approval.id,
        actorId: 'tool-reviewer-1', requestId: 'concurrent-approve', idempotencyKey: 'concurrent-approve-key',
        expectedVersion: 1, request: { decision: 'approved' },
      }),
      approvals.decideApproval({
        organizationId: 'tool-org', spaceId: 'tool-space', approvalId: requested.approval.id,
        actorId: 'tool-reviewer-2', requestId: 'concurrent-reject', idempotencyKey: 'concurrent-reject-key',
        expectedVersion: 1, request: { decision: 'rejected', note: 'Unsafe rollback plan.' },
      }),
    ])
    expect(decisions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(decisions.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((decisions.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toBeInstanceOf(ApprovalAlreadyDecidedError)
    const history = await migrationPool.query<{ decisions: string; status: string }>(`
      SELECT (SELECT count(*)::text FROM relay_approval_decisions WHERE approval_id = $1) AS decisions,
        status FROM relay_approvals WHERE id = $1
    `, [requested.approval.id])
    expect(history.rows[0].decisions).toBe('1')
    expect(['approved', 'rejected']).toContain(history.rows[0].status)
    await expect(migrationPool.query(`
      UPDATE relay_approval_decisions SET note = 'tampered' WHERE approval_id = $1
    `, [requested.approval.id])).rejects.toBeDefined()
  })

  it('conceals unassigned approvals while privileged reviewers retain policy visibility', async () => {
    const visible = await approvals.listApprovals('tool-org', 'tool-space', 'tool-reviewer-1', {
      limit: 100, assignedToMe: true,
    })
    expect(visible.items.length).toBeGreaterThan(0)
    await expect(approvals.getApproval(
      'tool-org', 'tool-space', visible.items[0].id, 'tool-requester',
    )).resolves.toBeNull()
    const adminVisible = await approvals.getApproval(
      'tool-org', 'tool-space', visible.items[0].id, 'tool-admin',
    )
    expect(adminVisible?.id).toBe(visible.items[0].id)
  })

  it('keeps terminal ToolCalls and ledger rows immutable at the database boundary', async () => {
    const succeeded = await migrationPool.query<{ id: string }>(`
      SELECT id FROM relay_tool_calls WHERE status = 'succeeded' LIMIT 1
    `)
    await expect(migrationPool.query(`
      UPDATE relay_tool_calls SET output_summary = 'tampered', version = version + 1 WHERE id = $1
    `, [succeeded.rows[0].id])).rejects.toBeDefined()
    await expect(migrationPool.query('TRUNCATE relay_tool_side_effects')).rejects.toBeDefined()
    const protectedTables = await migrationPool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM pg_class
      WHERE relnamespace = current_schema()::regnamespace AND relname LIKE 'relay_%'
        AND relkind = 'r' AND relname NOT IN ('relay_schema_migrations', 'relay_worker_heartbeats')
        AND relrowsecurity AND relforcerowsecurity
    `)
    expect(protectedTables.rows[0].count).toBe('33')
  })
})
