import { Pool } from 'pg'
import { loadMigrationConfig } from './config.js'
import { loadObjectStorageConfig } from './object-storage-config.js'
import { S3ObjectStore } from './object-storage.js'
import { runObjectStorageGc } from './object-storage-gc.js'

const env = process.env
const mode = env.OBJECT_STORAGE_GC_MODE?.trim()
if (mode !== 'dry_run' && mode !== 'apply') throw new Error('OBJECT_STORAGE_GC_MODE must be dry_run or apply.')
const minAgeSeconds = Number(env.OBJECT_STORAGE_GC_MIN_AGE_SECONDS ?? '86400')
const maxObjects = Number(env.OBJECT_STORAGE_GC_MAX_OBJECTS ?? '100000')
const config = loadMigrationConfig(env)
const storage = loadObjectStorageConfig(env, env.NODE_ENV?.trim() || 'production')
if (!storage) throw new Error('Object Storage is required for the GC command.')
const pool = new Pool({ connectionString: config.databaseUrl })
try {
  const result = await runObjectStorageGc({
    pool,
    objectStore: new S3ObjectStore(storage),
    mode,
    minAgeSeconds,
    maxObjects,
  })
  console.log(JSON.stringify(result))
} finally {
  await pool.end()
}
