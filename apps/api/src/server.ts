import { Pool } from 'pg'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { runMigrations } from './migrations.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { InMemorySessionRepository } from './session-repository.js'

const config = loadConfig()
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : undefined
if (pool) await runMigrations(pool)
const app = createApp({
  logger: true,
  corsOrigin: config.corsOrigin,
  sessionRepository: pool ? new PostgresSessionRepository(pool) : new InMemorySessionRepository(),
  readinessCheck: pool ? async () => { await pool.query('SELECT 1') } : undefined,
})

const close = async () => {
  await app.close()
  await pool?.end()
  process.exit(0)
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  await pool?.end()
  process.exit(1)
}
