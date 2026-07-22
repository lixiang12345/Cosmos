import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { PostgresFileRepository, PostgresFileWriterRepository } from './postgres-file-repository.js'
import { InMemoryObjectStore } from './object-storage.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'
import { withApiDatabaseContext } from './postgres-runtime-database.js'
import {
  FileQuotaExceededError,
  FileValidationError,
} from './file-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Postgres File repositories', () => {
  const schema = `cosmos_file_${crypto.randomUUID().replaceAll('-', '')}`
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
  let now = new Date('2026-07-13T03:00:00.000Z')
  let id = 0
  let sessionId = ''
  let turnId = ''
  const reader = new PostgresFileRepository(apiPool)
  const writer = new PostgresFileWriterRepository(workerPool, {
    createId: () => `file-runtime-${++id}`,
    now: () => new Date(now),
  })
  const timeline = new PostgresSessionTimelineRepository(apiPool)

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await migrationPool.query(`SET search_path TO ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('file-org', 'File Organization');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('file-org', 'file-space', 'File Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES
        ('file-org', 'file-owner', 'organization_owner'),
        ('file-org', 'file-reader', 'member');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
      VALUES
        ('file-org', 'file-space', 'file-owner', 'space_manager'),
        ('file-org', 'file-space', 'file-reader', 'member');
    `)
    await seedSessionConfiguration(migrationPool, 'file-org', 'file-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: (() => {
        let next = 0
        return () => `file-session-${++next}`
      })(),
      now: () => new Date('2026-07-13T02:00:00.000Z'),
    }).create({
      organizationId: 'file-org',
      spaceId: 'file-space',
      actorId: 'file-owner',
      actorKind: 'user',
      requestId: 'file-session-create',
      idempotencyKey: 'file-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'File writer Session',
        visibility: 'space',
        start: true,
        message: { content: 'Write governed Files.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('File fixture requires a Turn.')
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

  const record = (scope: 'workspace' | 'user' | 'organization', path: string, content: string) => ({
    organizationId: 'file-org',
    spaceId: 'file-space',
    sessionId,
    turnId,
    actorId: 'file-owner',
    actorKind: 'user' as const,
    requestId: `file-write-${scope}-${path}`,
    scope,
    path,
    mimeType: 'text/markdown',
    content: Buffer.from(content),
    expertId: 'expert-pr-author',
    toolCallId: `tool-${scope}-${path}`,
  })

  it('rejects unsafe paths and bounded content before opening a write transaction', async () => {
    await expect(writer.append(record('user', '../secret', 'secret')))
      .rejects.toBeInstanceOf(FileValidationError)
    const bounded = new PostgresFileWriterRepository(workerPool, { maxVersionBytes: 4 })
    await expect(bounded.append(record('user', 'safe.txt', '12345')))
      .rejects.toBeInstanceOf(FileValidationError)
  })

  it('writes all governed scopes with immutable versions and redacted ledgers', async () => {
    const workspace = await writer.append(record('workspace', 'reports/run.md', 'workspace v1'))
    const user = await writer.append(record('user', 'knowledge/checkout.md', 'user v1'))
    const organization = await writer.append(record('organization', 'standards/review.md', 'org v1'))
    expect(workspace.file).toMatchObject({
      scope: 'workspace', spaceId: 'file-space', sessionId, ownerUserId: null, version: 1,
    })
    expect(user.file).toMatchObject({
      scope: 'user', spaceId: null, sessionId: null, ownerUserId: 'file-owner', version: 1,
    })
    expect(organization.file).toMatchObject({
      scope: 'organization', spaceId: null, sessionId: null, ownerUserId: null, version: 1,
    })

    const ledgers = await migrationPool.query<{
      events: string
      audits: string
      outbox: string
      payload: unknown
    }>(`
      SELECT
        (SELECT count(*)::text FROM cosmos_session_events
          WHERE event_type = 'file.version.created') AS events,
        (SELECT count(*)::text FROM cosmos_audit_events
          WHERE action = 'file.version.create') AS audits,
        (SELECT count(*)::text FROM cosmos_outbox_events
          WHERE event_type = 'file.version.created') AS outbox,
        (SELECT jsonb_agg(payload) FROM cosmos_session_events
          WHERE event_type = 'file.version.created') AS payload
    `)
    expect(ledgers.rows[0]).toMatchObject({ events: '3', audits: '3', outbox: '3' })
    const serialized = JSON.stringify(ledgers.rows[0]?.payload)
    expect(serialized).not.toContain('workspace v1')
    expect(serialized).not.toContain('contentHash')
  })

  it('enforces scope-specific reads and returns exact content bytes', async () => {
    await expect(reader.list('file-org', 'file-space', 'file-reader', {
      scope: 'organization',
    })).resolves.toMatchObject({ items: [{ path: 'standards/review.md' }] })
    await expect(reader.list('file-org', 'file-space', 'file-reader', {
      scope: 'workspace', sessionId,
    })).resolves.toMatchObject({ items: [{ path: 'reports/run.md' }] })
    await expect(reader.list('file-org', 'file-space', 'file-reader', {
      scope: 'user', ownerUserId: 'file-owner',
    })).rejects.toBeDefined()
    await expect(reader.list('file-org', 'file-space', 'file-owner', {
      scope: 'user', ownerUserId: 'file-owner', prefix: 'knowledge/', search: 'check',
    })).resolves.toMatchObject({ items: [{ path: 'knowledge/checkout.md' }] })

    const rawMemberVisibility = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'file-org', spaceId: 'file-space', actorId: 'file-reader' },
      (client) => client.query<{ scope: string; files: string; versions: string }>(`
        SELECT scope, count(*)::text AS files,
          (SELECT count(*)::text FROM cosmos_file_versions) AS versions
        FROM cosmos_files GROUP BY scope ORDER BY scope
      `),
    )
    expect(rawMemberVisibility.rows).toEqual([
      { scope: 'organization', files: '1', versions: '2' },
      { scope: 'workspace', files: '1', versions: '2' },
    ])
    const rawOwnerVisibility = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'file-org', spaceId: 'file-space', actorId: 'file-owner' },
      (client) => client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM cosmos_files WHERE scope = 'user'`,
      ),
    )
    expect(rawOwnerVisibility.rows[0]?.count).toBe('1')

    const organization = await reader.list('file-org', 'file-space', 'file-reader', {
      scope: 'organization',
    })
    const fileId = organization?.items[0]?.id ?? ''
    const content = await reader.getContent('file-org', 'file-space', fileId, 'file-reader')
    expect(content?.content.toString('utf8')).toBe('org v1')
    expect(content?.version.contentHash).toBe(
      createHash('sha256').update('org v1').digest('hex'),
    )
  })

  it('appends versions in order and paginates without exposing mutable content', async () => {
    now = new Date('2026-07-13T03:01:00.000Z')
    const appended = await writer.append(record('user', 'knowledge/checkout.md', 'user v2'))
    expect(appended).toMatchObject({
      file: { version: 2, size: 7 },
      fileVersion: { version: 2, size: 7 },
    })
    const first = await reader.listVersions(
      'file-org', 'file-space', appended.file.id, 'file-owner', { limit: 1 },
    )
    expect(first).toMatchObject({
      hasMore: true,
      items: [{ version: 2 }],
      nextCursor: { version: 2 },
    })
    const second = await reader.listVersions(
      'file-org', 'file-space', appended.file.id, 'file-owner', {
        limit: 1,
        cursor: first?.nextCursor ?? undefined,
      },
    )
    expect(second).toMatchObject({ hasMore: false, items: [{ version: 1 }] })
    const old = await reader.getContent(
      'file-org', 'file-space', appended.file.id, 'file-owner', 1,
    )
    expect(old?.content.toString('utf8')).toBe('user v1')

    const events = await timeline.listEvents('file-org', 'file-space', sessionId, 'file-owner')
    expect(events?.items.at(-1)).toMatchObject({
      type: 'file.version.created',
      payload: { path: 'knowledge/checkout.md', version: 2, size: 7 },
    })
  })

  it('conceals Private Workspace Files in both the repository and raw API RLS', async () => {
    let nextId = 0
    const privateSession = await new PostgresSessionRepository(apiPool, {
      createId: () => `private-file-${++nextId}`,
      now: () => new Date('2026-07-13T03:02:00.000Z'),
    }).create({
      organizationId: 'file-org',
      spaceId: 'file-space',
      actorId: 'file-owner',
      actorKind: 'user',
      requestId: 'private-file-session-create',
      idempotencyKey: 'private-file-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Private File Session',
        visibility: 'private',
        start: true,
        message: { content: 'Write a Private Workspace File.', attachments: [] },
      },
    })
    if (!privateSession.turn) throw new Error('Private File fixture requires a Turn.')
    const written = await writer.append({
      ...record('workspace', 'private/context.md', 'private'),
      sessionId: privateSession.session.id,
      turnId: privateSession.turn.id,
      requestId: 'private-file-write',
      toolCallId: 'private-file-tool',
    })

    await expect(reader.list('file-org', 'file-space', 'file-reader', {
      scope: 'workspace', sessionId: privateSession.session.id,
    })).resolves.toBeNull()
    const hidden = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'file-org', spaceId: 'file-space', actorId: 'file-reader' },
      (client) => client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM cosmos_files WHERE id = $1',
        [written.file.id],
      ),
    )
    expect(hidden.rows[0]?.count).toBe('0')
    const visible = await withApiDatabaseContext(
      apiPool,
      { organizationId: 'file-org', spaceId: 'file-space', actorId: 'file-owner' },
      (client) => client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM cosmos_file_versions WHERE file_id = $1',
        [written.file.id],
      ),
    )
    expect(visible.rows[0]?.count).toBe('1')
  })

  it('enforces Organization quota and database immutability', async () => {
    await migrationPool.query(`
      UPDATE cosmos_organization_quotas
      SET file_storage_bytes_limit = 1048576
      WHERE organization_id = 'file-org'
    `)
    await expect(writer.append({
      ...record('workspace', 'quota/authority.bin', 'ignored'),
      mimeType: 'application/octet-stream',
      content: Buffer.alloc(1_048_576),
    })).rejects.toBeInstanceOf(FileQuotaExceededError)
    await migrationPool.query(`
      UPDATE cosmos_organization_quotas
      SET file_storage_bytes_limit = 104857600
      WHERE organization_id = 'file-org'
    `)

    const limited = new PostgresFileWriterRepository(workerPool, {
      maxVersionBytes: 16,
      maxOrganizationBytes: 40,
    })
    await expect(limited.append(record('workspace', 'quota/new.md', '1234567890123456')))
      .rejects.toBeInstanceOf(FileQuotaExceededError)

    await expect(migrationPool.query(`
      UPDATE cosmos_file_versions SET content = 'changed'
    `)).rejects.toMatchObject({ code: '55000' })
    await expect(migrationPool.query(`
      DELETE FROM cosmos_file_versions
    `)).rejects.toMatchObject({ code: '55000' })
    await expect(migrationPool.query(`
      UPDATE cosmos_files SET path = 'moved.md', version = version + 1
      WHERE scope = 'organization'
    `)).rejects.toMatchObject({ code: '55000' })
  })

  it('stores object-backed versions without duplicating content in PostgreSQL', async () => {
    const objectStore = new InMemoryObjectStore()
    const objectWriter = new PostgresFileWriterRepository(workerPool, {
      objectStore,
      createId: (() => {
        let next = 0
        return () => `object-file-runtime-${++next}`
      })(),
    })
    const objectReader = new PostgresFileRepository(apiPool, objectStore)
    const appended = await objectWriter.append(record('workspace', 'reports/object.md', 'stored outside the database'))
    const metadata = await migrationPool.query<{
      content: Buffer | null
      storage_backend: string
      object_key: string | null
    }>(`
      SELECT content, storage_backend, object_key
      FROM cosmos_file_versions WHERE id = $1
    `, [appended.fileVersion.id])
    expect(metadata.rows[0]).toMatchObject({ content: null, storage_backend: 'object' })
    expect(metadata.rows[0]?.object_key).toMatch(/^organizations\/[a-f0-9]{64}\/file-versions\//)
    expect(metadata.rows[0]?.object_key).not.toContain('reports/object.md')
    await expect(objectReader.getContent('file-org', 'file-space', appended.file.id, 'file-owner'))
      .resolves.toMatchObject({ content: Buffer.from('stored outside the database') })
  })
})
