import { createRequire } from 'node:module'
import { renderDatabaseMetrics } from './database-metrics-lib.mjs'

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url))
const { Pool } = require('pg')

const databaseUrl = process.env.OBSERVABILITY_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('OBSERVABILITY_DATABASE_URL or DATABASE_URL is required.\n')
  process.exit(1)
}

const workerFreshnessSeconds = Number(process.env.OBSERVABILITY_WORKER_FRESHNESS_SECONDS ?? 30)
if (!Number.isSafeInteger(workerFreshnessSeconds) || workerFreshnessSeconds < 5 || workerFreshnessSeconds > 300) {
  process.stderr.write('OBSERVABILITY_WORKER_FRESHNESS_SECONDS must be an integer between 5 and 300.\n')
  process.exit(1)
}

const pool = new Pool({
  connectionString: databaseUrl,
  options: '-c role=relay_observer_runtime',
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
  max: 1,
})
pool.on('error', () => {})

try {
  process.stdout.write(await renderDatabaseMetrics(pool, { workerFreshnessSeconds }))
} catch {
  process.stderr.write('Observer metrics query failed.\n')
  process.exitCode = 1
} finally {
  await pool.end()
}
