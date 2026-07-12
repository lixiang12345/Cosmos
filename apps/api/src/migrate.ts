import { Pool } from 'pg'
import { loadConfig } from './config.js'
import { runMigrations } from './migrations.js'

const config = loadConfig()
if (!config.databaseUrl) throw new Error('DATABASE_URL is required to run migrations.')

const pool = new Pool({ connectionString: config.databaseUrl })
try {
  await runMigrations(pool)
} finally {
  await pool.end()
}
