import { Pool } from 'pg'
import { loadMigrationConfig } from './config.js'
import { runMigrations } from './migrations.js'

const config = loadMigrationConfig()

const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  query_timeout: config.databaseQueryTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
})
try {
  await runMigrations(pool)
} finally {
  await pool.end()
}
