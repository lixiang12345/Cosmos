import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import {
  SessionTimelineCursorAheadError,
  SessionTimelineProjectionError,
} from './session-timeline-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const longActorId = `worker-${'a'.repeat(249)}`

describeWithDatabase('PostgresSessionTimelineRepository', () => {
  const schema = `cosmos_timeline_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const timelineRepository = new PostgresSessionTimelineRepository(pool)
  let sessionId: string
  let messageId: string
  let turnId: string
  let commandId: string

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('timeline-org', 'Timeline Org');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('timeline-org', 'timeline-space', 'Timeline Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('timeline-org', 'timeline-user', 'member'),
        ('timeline-org', 'timeline-peer', 'member');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('timeline-org', 'timeline-space', 'timeline-user', 'member'),
        ('timeline-org', 'timeline-space', 'timeline-peer', 'member');
    `)
    await seedSessionConfiguration(pool, 'timeline-org', 'timeline-space')
    const created = await new PostgresSessionRepository(pool, {
      createId: (() => {
        let next = 0
        return () => `timeline-id-${++next}`
      })(),
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    }).create({
      organizationId: 'timeline-org',
      spaceId: 'timeline-space',
      actorId: 'timeline-user',
      actorKind: 'user',
      requestId: 'timeline-create-request',
      idempotencyKey: 'timeline-create-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Timeline Session',
        visibility: 'private',
        start: true,
        message: { content: 'Initial customer prompt', attachments: ['brief.md'] },
      },
    })
    if (!created.message || !created.turn || !created.command) {
      throw new Error('The timeline fixture requires a started Session.')
    }
    sessionId = created.session.id
    messageId = created.message.id
    turnId = created.turn.id
    commandId = created.command.id

    await pool.query(`
      INSERT INTO cosmos_messages (
        id, organization_id, space_id, session_id, sequence, role, actor_id,
        content, attachments, created_at
      ) VALUES
        (
          'timeline-message-2', 'timeline-org', 'timeline-space', $1, 2,
          'agent', NULL, 'Agent output body', '[]'::jsonb,
          '2026-07-13T00:00:01.000Z'
        ),
        (
          'timeline-message-3', 'timeline-org', 'timeline-space', $1, 3,
          'system', NULL, 'System-only timeline body', '[]'::jsonb,
          '2026-07-13T00:00:02.000Z'
        )
    `, [sessionId])
    await pool.query(`
      INSERT INTO cosmos_attempts (
        organization_id, space_id, session_id, turn_id, id, number, status,
        model, runtime_id, created_at, started_at, heartbeat_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, $2, 'timeline-attempt-1', 1,
        'running', 'gpt-5.1-codex', 'runtime-1',
        '2026-07-13T00:00:03.000Z', '2026-07-13T00:00:03.000Z',
        '2026-07-13T00:00:04.000Z'
      )
    `, [sessionId, turnId])
    await pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        attempt_id, command_id, request_id, occurred_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, 'timeline-attempt-event', 4,
        'attempt.updated', 'attempt', 'timeline-attempt-1',
        '{
          "attemptId":"timeline-attempt-1",
          "turnId":"placeholder",
          "number":1,
          "status":"running",
          "failureCode":null,
          "secret":"must-not-leave-the-database",
          "prompt":"must-not-leave-the-database"
        }'::jsonb || jsonb_build_object('turnId', $2::text),
        $4, 'worker', $2, 'timeline-attempt-1', $3,
        'timeline-attempt-request', '2026-07-13T00:00:04.000Z'
      )
    `, [sessionId, turnId, commandId, longActorId])
    await pool.query(`
      UPDATE cosmos_sessions SET last_event_sequence = 4
      WHERE organization_id = 'timeline-org' AND space_id = 'timeline-space' AND id = $1
    `, [sessionId])
  })

  afterAll(async () => {
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('paginates Messages with tenant-scoped sequence keysets', async () => {
    const first = await timelineRepository.listMessages(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-user',
      { limit: 2 },
    )
    expect(first.items.map((item) => ({ sequence: item.sequence, content: item.content }))).toEqual([
      { sequence: 1, content: 'Initial customer prompt' },
      { sequence: 2, content: 'Agent output body' },
    ])
    expect(first.page).toEqual({ hasMore: true, nextCursor: '2' })

    const second = await timelineRepository.listMessages(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-user',
      { afterSequence: 2, limit: 2 },
    )
    expect(second.items.map((item) => item.sequence)).toEqual([3])
    expect(second.page).toEqual({ hasMore: false, nextCursor: null })
  })

  it('conceals missing, cross-tenant, and Private Sessions', async () => {
    await expect(timelineRepository.listMessages(
      'other-org',
      'timeline-space',
      sessionId,
      'timeline-user',
    )).resolves.toBeNull()
    await expect(timelineRepository.listEvents(
      'timeline-org',
      'other-space',
      sessionId,
      'timeline-user',
    )).resolves.toBeNull()
    await expect(timelineRepository.listMessages(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-peer',
    )).resolves.toBeNull()
  })

  it('projects only allowlisted Event fields and paginates runtime Attempt events', async () => {
    const first = await timelineRepository.listEvents(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-user',
      { limit: 2 },
    )
    expect(first.items).toMatchObject([
      {
        type: 'session.created',
        resourceType: 'session',
        resourceId: sessionId,
        payload: { status: 'queued', visibility: 'private', version: 1 },
      },
      {
        type: 'message.created',
        resourceType: 'message',
        resourceId: messageId,
        payload: { messageId },
      },
    ])
    expect(first.page).toEqual({
      hasMore: true,
      nextCursor: {
        organizationId: 'timeline-org',
        spaceId: 'timeline-space',
        sessionId,
        sequence: 2,
      },
    })

    const second = await timelineRepository.listEvents(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-user',
      { afterSequence: 2, limit: 2 },
    )
    expect(second.items).toMatchObject([
      {
        type: 'turn.queued',
        resourceType: 'turn',
        resourceId: turnId,
        payload: { turnId, status: 'queued' },
      },
      {
        type: 'attempt.updated',
        resourceType: 'attempt',
        resourceId: 'timeline-attempt-1',
        payload: {
          attemptId: 'timeline-attempt-1',
          turnId,
          number: 1,
          status: 'running',
          failureCode: null,
        },
        actorId: longActorId,
      },
    ])
    expect(second.page).toEqual({ hasMore: false, nextCursor: null })

    const serialized = JSON.stringify([...first.items, ...second.items])
    expect(serialized).not.toContain('configurationResolutionVersion')
    expect(serialized).not.toContain('must-not-leave-the-database')
    expect(serialized).not.toContain('Initial customer prompt')
  })

  it('rejects an event cursor ahead of the Session sequence while accepting the exact tail', async () => {
    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user', { afterSequence: 4 },
    )).resolves.toMatchObject({ items: [] })
    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user', { afterSequence: 5 },
    )).rejects.toBeInstanceOf(SessionTimelineCursorAheadError)
  })

  it('fails closed when a database sequence exceeds JavaScript safe integers', async () => {
    await pool.query(`
      UPDATE cosmos_sessions
      SET status = 'canceled', version = version + 1, last_event_sequence = 5
      WHERE organization_id = 'timeline-org' AND space_id = 'timeline-space' AND id = $1
    `, [sessionId])
    await pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, command_id,
        request_id, occurred_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, 'timeline-session-updated', 5,
        'session.updated', 'session', $1,
        '{"status":"canceled","version":2,"secret":"redacted"}'::jsonb,
        'system:authorization-recheck', 'system', $2,
        'timeline-session-updated-request', '2026-07-13T00:00:05.000Z'
      )
    `, [sessionId, commandId])
    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user',
      { afterSequence: 4, limit: 1 },
    )).resolves.toMatchObject({
      items: [{
        type: 'session.updated',
        resourceType: 'session',
        resourceId: sessionId,
        payload: { status: 'canceled', version: 2 },
      }],
    })

    await pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, request_id,
        occurred_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, 'unsafe-sequence-event',
        9007199254740992, 'session.created', 'session', $1,
        '{"status":"queued","visibility":"private","version":1}'::jsonb,
        'timeline-user', 'user', 'unsafe-sequence-request',
        '2026-07-13T00:00:05.000Z'
      )
    `, [sessionId])

    await expect(timelineRepository.listEvents(
      'timeline-org',
      'timeline-space',
      sessionId,
      'timeline-user',
      { afterSequence: 5 },
    )).rejects.toBeInstanceOf(SessionTimelineProjectionError)
  })

  it('fails closed for unknown Event and resource types', async () => {
    await pool.query(`
      ALTER TABLE cosmos_session_events
        DROP CONSTRAINT cosmos_session_events_runtime_event_type_check,
        DROP CONSTRAINT cosmos_session_events_runtime_resource_type_check,
        DROP CONSTRAINT cosmos_session_events_runtime_typed_resource_check
    `)
    await pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, request_id,
        occurred_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, 'future-event', 6,
        'future.event', 'session', $1, '{"secret":"hidden"}'::jsonb,
        'timeline-user', 'user', 'future-event-request',
        '2026-07-13T00:00:05.000Z'
      )
    `, [sessionId])
    await pool.query(`
      INSERT INTO cosmos_session_events (
        organization_id, space_id, session_id, event_id, sequence, event_type,
        resource_type, resource_id, payload, actor_id, actor_kind, turn_id,
        attempt_id, command_id, request_id, occurred_at
      ) VALUES (
        'timeline-org', 'timeline-space', $1, 'future-resource', 7,
        'attempt.updated', 'future', 'timeline-attempt-1',
        '{"number":1,"status":"running","failureCode":null}'::jsonb,
        'timeline-worker', 'worker', $2, 'timeline-attempt-1', $3,
        'future-resource-request', '2026-07-13T00:00:06.000Z'
      )
    `, [sessionId, turnId, commandId])
    await pool.query(`
      UPDATE cosmos_sessions SET last_event_sequence = 7
      WHERE organization_id = 'timeline-org' AND space_id = 'timeline-space' AND id = $1
    `, [sessionId])

    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user',
      { afterSequence: 5, limit: 1 },
    )).rejects.toBeInstanceOf(SessionTimelineProjectionError)
    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user',
      { afterSequence: 6, limit: 1 },
    )).rejects.toBeInstanceOf(SessionTimelineProjectionError)
  })

  it('rejects unsafe cursors and out-of-range limits before querying', async () => {
    await expect(timelineRepository.listMessages(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user',
      { afterSequence: Number.MAX_SAFE_INTEGER + 1 },
    )).rejects.toBeInstanceOf(RangeError)
    await expect(timelineRepository.listMessages(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user', { limit: 101 },
    )).rejects.toBeInstanceOf(RangeError)
    await expect(timelineRepository.listEvents(
      'timeline-org', 'timeline-space', sessionId, 'timeline-user', { limit: 501 },
    )).rejects.toBeInstanceOf(RangeError)
  })

  it('rechecks membership in the same query and conceals a revoked actor', async () => {
    await pool.query(`
      DELETE FROM cosmos_space_memberships
      WHERE organization_id = 'timeline-org'
        AND space_id = 'timeline-space'
        AND actor_id = 'timeline-user'
    `)
    try {
      await expect(timelineRepository.listEvents(
        'timeline-org', 'timeline-space', sessionId, 'timeline-user',
      )).resolves.toBeNull()
    } finally {
      await pool.query(`
        INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ('timeline-org', 'timeline-space', 'timeline-user', 'member')
      `)
    }
  })
})
