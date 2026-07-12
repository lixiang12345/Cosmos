import { Pool } from 'pg'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator, createJwtAuthenticator } from './auth.js'
import { loadConfig } from './config.js'
import { runMigrations } from './migrations.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { InMemorySessionRepository } from './session-repository.js'

const config = loadConfig()
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : undefined
if (pool) await runMigrations(pool)
const authenticate = config.authentication.mode === 'oidc'
  ? createJwtAuthenticator(config.authentication)
  : createDevelopmentAuthenticator(config.authentication.actorId)
const developmentOrganizations = config.authentication.mode === 'development' ? {
  [config.authentication.actorId]: [{
    id: 'relay',
    name: 'Relay',
    role: 'organization_owner' as const,
    spaces: [
      { id: 'space-commerce', name: 'Commerce Engineering', role: 'space_manager' as const },
      { id: 'space-platform', name: 'Platform Engineering', role: 'space_manager' as const },
    ],
  }],
} : undefined
const app = createApp({
  logger: true,
  corsOrigin: config.corsOrigin,
  sessionRepository: pool
    ? new PostgresSessionRepository(pool)
    : new InMemorySessionRepository({
      actorOrganizations: developmentOrganizations,
      allowLegacyDevelopmentConfigurationFallback: config.authentication.mode === 'development',
    }),
  configurationCatalogRepository: pool
    ? new PostgresConfigurationCatalogRepository(pool)
    : undefined,
  readinessCheck: pool ? async () => { await pool.query('SELECT 1') } : undefined,
  authenticate,
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
