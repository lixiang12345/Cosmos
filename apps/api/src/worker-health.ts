import { Pool } from 'pg'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'
import { loadWorkerHealthConfig } from './worker-config.js'

let pool: Pool | undefined
try {
  const config = loadWorkerHealthConfig()
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseStatementTimeoutMs,
    max: 1,
  })
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
