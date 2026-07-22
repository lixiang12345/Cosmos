import type { Pool } from 'pg'
import { assertRuntimeDatabaseRole, createRuntimePool } from './postgres-runtime-database.js'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'
import { loadWorkerHealthConfig } from './worker-config.js'

let pool: Pool | undefined
try {
  const config = loadWorkerHealthConfig()
  pool = createRuntimePool('relay_worker_runtime', {
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseStatementTimeoutMs,
    max: 1,
  }, () => { process.exitCode = 1 })
  await assertRuntimeDatabaseRole(pool, 'relay_worker_runtime')
  const ready = await new PostgresWorkerReadinessRepository(pool).hasRecentHeartbeat({
    workerId: config.workerId,
    maxAgeMs: config.readinessMaxAgeMs,
  })
  if (!ready) process.exitCode = 1
} catch {
  process.exitCode = 1
} finally {
  await pool?.end()
}
