import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import {
  PostgresSessionWorkerRepository,
  PostgresSessionWorkerWriterRepository,
} from './postgres-session-worker-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import {
  SessionWorkerConflictError,
  SessionWorkerVersionConflictError,
} from './session-worker-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Postgres Session Worker repositories', () => {
  const schema = `relay_session_worker_${crypto.randomUUID().replaceAll('-', '')}`
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
  let now = new Date('2026-07-13T08:00:00.000Z')
  let nextId = 0
  let sessionId = ''
  let turnId = ''
  const reader = new PostgresSessionWorkerRepository(apiPool)
  const writer = new PostgresSessionWorkerWriterRepository(workerPool, {
    createId: () => `session-worker-${++nextId}`,
    now: () => new Date(now),
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES ('worker-org', 'Worker Organization');
      INSERT INTO relay_spaces (organization_id, id, name)
      VALUES ('worker-org', 'worker-space', 'Worker Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('worker-org', 'worker-owner', 'organization_owner'),
        ('worker-org', 'worker-reader', 'member');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('worker-org', 'worker-space', 'worker-owner', 'space_manager'),
        ('worker-org', 'worker-space', 'worker-reader', 'member');
    `)
    await seedSessionConfiguration(migrationPool, 'worker-org', 'worker-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: (() => {
        let id = 0
        return () => `worker-session-${++id}`
      })(),
      now: () => new Date('2026-07-13T07:00:00.000Z'),
    }).create({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      actorId: 'worker-owner',
      actorKind: 'user',
      requestId: 'worker-session-create',
      idempotencyKey: 'worker-session-create',
      request: {
        expertId: 'expert-pr-author',
        title: 'Session Worker tree',
        visibility: 'space',
        start: true,
        message: { content: 'Delegate review work.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('Session Worker fixture requires a Turn.')
    sessionId = created.session.id
    turnId = created.turn.id
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('persists a parent-first tree and advances Workers with optimistic versions', async () => {
    const root = await writer.create({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      parentTurnId: turnId,
      name: 'Review implementation',
      instructions: 'Review the implementation and report concrete issues.',
      runtimeWorkerId: 'runtime-worker-1',
    })
    now = new Date('2026-07-13T08:00:01.000Z')
    const child = await writer.create({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      parentTurnId: turnId,
      parentWorkerId: root.id,
      name: 'Check migration safety',
      instructions: 'Inspect the migration and tenant isolation constraints.',
      runtimeWorkerId: 'runtime-worker-2',
    })
    expect(root).toMatchObject({ status: 'queued', depth: 1, ordinal: 1, version: 1 })
    expect(child).toMatchObject({ parentWorkerId: root.id, status: 'queued', depth: 2, ordinal: 1 })

    now = new Date('2026-07-13T08:01:00.000Z')
    const running = await writer.transition({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      workerId: root.id,
      runtimeWorkerId: 'runtime-worker-1',
      expectedVersion: 1,
      status: 'running',
    })
    now = new Date('2026-07-13T08:02:00.000Z')
    const completed = await writer.transition({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      workerId: root.id,
      runtimeWorkerId: 'runtime-worker-1',
      expectedVersion: 2,
      status: 'completed',
      resultSummary: 'Review completed without blocking findings.',
    })
    expect(running).toMatchObject({ status: 'running', version: 2, completedAt: null })
    expect(completed).toMatchObject({
      status: 'completed',
      version: 3,
      resultSummary: 'Review completed without blocking findings.',
      completedAt: '2026-07-13T08:02:00.000Z',
    })

    const first = await reader.list('worker-org', 'worker-space', sessionId, 'worker-reader', { limit: 1 })
    expect(first).toMatchObject({ items: [{ id: root.id, status: 'completed' }], hasMore: true })
    const second = await reader.list('worker-org', 'worker-space', sessionId, 'worker-reader', {
      limit: 1,
      cursor: first!.nextCursor!,
    })
    expect(second).toMatchObject({ items: [{ id: child.id, parentWorkerId: root.id }], hasMore: false })

    await expect(writer.transition({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      workerId: root.id,
      runtimeWorkerId: 'runtime-worker-1',
      expectedVersion: 2,
      status: 'failed',
    })).rejects.toBeInstanceOf(SessionWorkerVersionConflictError)
    await expect(writer.transition({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      workerId: child.id,
      runtimeWorkerId: 'runtime-worker-2',
      expectedVersion: 1,
      status: 'completed',
    })).rejects.toBeInstanceOf(SessionWorkerConflictError)
    await expect(writer.transition({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId,
      workerId: child.id,
      runtimeWorkerId: 'runtime-worker-2',
      expectedVersion: 1,
      status: 'running',
      resultSummary: 'This must not be silently discarded.',
    })).rejects.toThrow('only accepted for terminal states')
  })

  it('rejects cross-Session parents and conceals a private Session from other members', async () => {
    let privateId = 0
    const sessions = new PostgresSessionRepository(apiPool, {
      createId: () => `private-worker-session-${++privateId}`,
      now: () => new Date('2026-07-13T09:00:00.000Z'),
    })
    const privateSession = await sessions.create({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      actorId: 'worker-owner',
      actorKind: 'user',
      requestId: 'private-worker-session',
      idempotencyKey: 'private-worker-session',
      request: {
        expertId: 'expert-pr-author',
        title: 'Private Worker Session',
        visibility: 'private',
        start: true,
        message: { content: 'Keep this Worker tree private.', attachments: [] },
      },
    })
    if (!privateSession.turn) throw new Error('Private Session fixture requires a Turn.')
    await expect(writer.create({
      organizationId: 'worker-org',
      spaceId: 'worker-space',
      sessionId: privateSession.session.id,
      parentTurnId: privateSession.turn.id,
      parentWorkerId: 'session-worker-1',
      name: 'Invalid child',
      instructions: 'This cross-Session parent must be rejected.',
      runtimeWorkerId: 'runtime-worker-3',
    })).rejects.toBeInstanceOf(SessionWorkerConflictError)
    await expect(reader.list(
      'worker-org',
      'worker-space',
      privateSession.session.id,
      'worker-reader',
      { limit: 50 },
    )).resolves.toBeNull()
  })
})
