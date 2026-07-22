import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { ObjectStore } from './object-storage.js'

export type ObjectStorageGcMode = 'dry_run' | 'apply'

export type ObjectStorageGcOptions = {
  pool: Pool
  objectStore: ObjectStore
  mode: ObjectStorageGcMode
  minAgeSeconds: number
  maxObjects?: number
  batchSize?: number
  createId?: () => string
  now?: () => Date
}

export type ObjectStorageGcResult = {
  id: string
  mode: ObjectStorageGcMode
  status: 'succeeded' | 'partial' | 'failed'
  minAgeSeconds: number
  scannedObjects: number
  referencedObjects: number
  eligibleObjects: number
  deletedObjects: number
  failedDeletions: number
  startedAt: string
  completedAt: string
  errorCode: string | null
}

const PREFIX = 'organizations/'
const DEFAULT_MAX_OBJECTS = 100_000
const DEFAULT_BATCH_SIZE = 500

function assertOptions(options: ObjectStorageGcOptions) {
  if (!Number.isSafeInteger(options.minAgeSeconds) || options.minAgeSeconds < 86_400) {
    throw new Error('Object Storage GC minAgeSeconds must be at least 86400.')
  }
  if (!Number.isSafeInteger(options.maxObjects ?? DEFAULT_MAX_OBJECTS) || (options.maxObjects ?? DEFAULT_MAX_OBJECTS) < 1) {
    throw new Error('Object Storage GC maxObjects must be a positive integer.')
  }
  if (!Number.isSafeInteger(options.batchSize ?? DEFAULT_BATCH_SIZE) || (options.batchSize ?? DEFAULT_BATCH_SIZE) < 1) {
    throw new Error('Object Storage GC batchSize must be a positive integer.')
  }
}

async function persist(client: PoolClient, result: ObjectStorageGcResult) {
  await client.query(`
    INSERT INTO relay_object_storage_gc_runs (
      id, mode, status, min_age_seconds, scanned_objects, referenced_objects,
      eligible_objects, deleted_objects, failed_deletions, started_at, completed_at, error_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    result.id, result.mode, result.status, result.minAgeSeconds, result.scannedObjects,
    result.referencedObjects, result.eligibleObjects, result.deletedObjects,
    result.failedDeletions, result.startedAt, result.completedAt, result.errorCode,
  ])
}

export async function runObjectStorageGc(options: ObjectStorageGcOptions): Promise<ObjectStorageGcResult> {
  assertOptions(options)
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const started = now()
  const id = createId()
  const cutoff = started.getTime() - options.minAgeSeconds * 1_000
  const client = await options.pool.connect()
  let lockAcquired = false
  const base = () => ({
    id,
    mode: options.mode,
    minAgeSeconds: options.minAgeSeconds,
    scannedObjects: 0,
    referencedObjects: 0,
    eligibleObjects: 0,
    deletedObjects: 0,
    failedDeletions: 0,
    startedAt: started.toISOString(),
    completedAt: now().toISOString(),
  })
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended('relay-object-storage-gc', 0)) AS acquired",
    )
    lockAcquired = Boolean(lock.rows[0]?.acquired)
    if (!lockAcquired) throw new Error('OBJECT_STORAGE_GC_ALREADY_RUNNING')

    const scanned: Array<{ key: string; size: number; lastModified: Date }> = []
    let continuation: string | undefined
    do {
      const page = await options.objectStore.list(PREFIX, continuation, batchSize)
      scanned.push(...page.objects)
      if (scanned.length > maxObjects) throw new Error('OBJECT_STORAGE_GC_LIMIT_EXCEEDED')
      continuation = page.continuationToken ?? undefined
    } while (continuation)

    const keys = scanned.map((object) => object.key)
    const referenced = new Set<string>()
    for (let offset = 0; offset < keys.length; offset += batchSize) {
      const batch = keys.slice(offset, offset + batchSize)
      if (batch.length === 0) continue
      const rows = await client.query<{ object_key: string }>(`
        SELECT object_key
        FROM relay_file_versions
        WHERE storage_backend = 'object' AND object_key = ANY($1::text[])
      `, [batch])
      rows.rows.forEach((row) => referenced.add(row.object_key))
    }
    const eligible = scanned.filter((object) => (
      object.lastModified.getTime() <= cutoff && !referenced.has(object.key)
    ))
    let deleted = 0
    let failed = 0
    if (options.mode === 'apply') {
      for (const object of eligible) {
        try {
          await options.objectStore.delete(object.key)
          deleted += 1
        } catch {
          failed += 1
        }
      }
    }
    const result: ObjectStorageGcResult = {
      ...base(),
      status: failed > 0 ? 'partial' : 'succeeded',
      scannedObjects: scanned.length,
      referencedObjects: referenced.size,
      eligibleObjects: eligible.length,
      deletedObjects: deleted,
      failedDeletions: failed,
      completedAt: now().toISOString(),
      errorCode: null,
    }
    await persist(client, result)
    return result
  } catch (error) {
    const errorCode = error instanceof Error && /^OBJECT_STORAGE_GC_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'OBJECT_STORAGE_GC_FAILED'
    const result: ObjectStorageGcResult = {
      ...base(),
      status: 'failed',
      completedAt: now().toISOString(),
      errorCode,
    }
    await persist(client, result)
    throw Object.assign(new Error(errorCode), { result })
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended('relay-object-storage-gc', 0))")
    }
    client.release()
  }
}
