import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'
import { InMemoryObjectStore } from './object-storage.js'
import { runObjectStorageGc } from './object-storage-gc.js'
import { PostgresFileWriterRepository } from './postgres-file-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Object Storage orphan GC', () => {
  const schema = `cosmos_object_gc_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_worker_runtime -c search_path=${schema}`,
  })
  const storedAt = new Date('2026-07-01T00:00:00.000Z')
  const objectStore = new InMemoryObjectStore(() => storedAt)
  let sessionId = ''
  let turnId = ''
  let referencedKey = ''
  const orphanKey = `organizations/${'f'.repeat(64)}/file-versions/orphan-version`

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(pool)
    await pool.query(`
      INSERT INTO cosmos_organizations (id, name) VALUES ('gc-org', 'GC Organization');
      INSERT INTO cosmos_spaces (organization_id, id, name) VALUES ('gc-org', 'gc-space', 'GC Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
        VALUES ('gc-org', 'gc-owner', 'organization_owner');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
        VALUES ('gc-org', 'gc-space', 'gc-owner', 'space_manager');
    `)
    await seedSessionConfiguration(pool, 'gc-org', 'gc-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: (() => { let next = 0; return () => `gc-session-${++next}` })(),
      now: () => storedAt,
    }).create({
      organizationId: 'gc-org', spaceId: 'gc-space', actorId: 'gc-owner', actorKind: 'user',
      requestId: 'gc-session-create', idempotencyKey: 'gc-session-create-key',
      request: {
        expertId: 'expert-pr-author', title: 'Object GC', visibility: 'space', start: true,
        message: { content: 'Create an object-backed File.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('GC fixture requires a Turn.')
    sessionId = created.session.id
    turnId = created.turn.id
    const appended = await new PostgresFileWriterRepository(workerPool, {
      objectStore,
      createId: (() => { let next = 0; return () => `gc-file-${++next}` })(),
      now: () => storedAt,
    }).append({
      organizationId: 'gc-org', spaceId: 'gc-space', sessionId, turnId,
      actorId: 'gc-owner', actorKind: 'user', requestId: 'gc-file-write',
      scope: 'workspace', path: 'gc/referenced.txt', mimeType: 'text/plain',
      content: Buffer.from('referenced'), expertId: 'expert-pr-author', toolCallId: 'gc-tool-call',
    })
    const metadata = await pool.query<{ object_key: string }>(
      'SELECT object_key FROM cosmos_file_versions WHERE id = $1',
      [appended.fileVersion.id],
    )
    referencedKey = metadata.rows[0]?.object_key ?? ''
    await objectStore.put(orphanKey, Buffer.from('orphan'), 'text/plain')
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await pool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('dry-runs before deleting only aged unreferenced objects', async () => {
    const now = () => new Date('2026-07-03T00:00:00.000Z')
    const dryRun = await runObjectStorageGc({
      pool, objectStore, mode: 'dry_run', minAgeSeconds: 86_400,
      createId: () => 'gc-run-dry', now,
    })
    expect(dryRun).toMatchObject({
      status: 'succeeded', scannedObjects: 2, referencedObjects: 1,
      eligibleObjects: 1, deletedObjects: 0, failedDeletions: 0,
    })
    await expect(objectStore.get(orphanKey)).resolves.toEqual(Buffer.from('orphan'))

    const applied = await runObjectStorageGc({
      pool, objectStore, mode: 'apply', minAgeSeconds: 86_400,
      createId: () => 'gc-run-apply', now,
    })
    expect(applied).toMatchObject({
      status: 'succeeded', scannedObjects: 2, referencedObjects: 1,
      eligibleObjects: 1, deletedObjects: 1, failedDeletions: 0,
    })
    await expect(objectStore.get(orphanKey)).resolves.toBeNull()
    await expect(objectStore.get(referencedKey)).resolves.toEqual(Buffer.from('referenced'))
  })

  it('persists immutable count-only run evidence', async () => {
    const rows = await pool.query<{
      id: string
      mode: string
      scanned_objects: number
      deleted_objects: number
    }>('SELECT id, mode, scanned_objects, deleted_objects FROM cosmos_object_storage_gc_runs ORDER BY id')
    expect(rows.rows).toEqual([
      { id: 'gc-run-apply', mode: 'apply', scanned_objects: 2, deleted_objects: 1 },
      { id: 'gc-run-dry', mode: 'dry_run', scanned_objects: 2, deleted_objects: 0 },
    ])
    await expect(pool.query('UPDATE cosmos_object_storage_gc_runs SET deleted_objects = 0'))
      .rejects.toMatchObject({ code: '55000' })
  })
})
