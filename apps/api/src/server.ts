import { Pool } from 'pg'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator, createJwtAuthenticator } from './auth.js'
import { loadConfig } from './config.js'
import { assertMigrationsCurrent, runMigrations } from './migrations.js'
import { PostgresArtifactRepository } from './postgres-artifact-repository.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'
import { PostgresFileRepository } from './postgres-file-repository.js'
import { assertRuntimeDatabaseRole, createRuntimePool } from './postgres-runtime-database.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { PostgresSessionWorkerRepository } from './postgres-session-worker-repository.js'
import { PostgresToolApprovalRepository } from './postgres-tool-approval-repository.js'
import { PostgresServiceAccountPolicyRepository } from './service-account-policy-repository.js'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'
import { InMemorySessionRepository } from './session-repository.js'

const config = loadConfig()
const poolConfig = config.databaseUrl ? {
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  query_timeout: config.databaseQueryTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
} : undefined
if (poolConfig && config.migrateOnStart) {
  const migrationPool = new Pool(poolConfig)
  try {
    await runMigrations(migrationPool)
  } finally {
    await migrationPool.end()
  }
}
const pool = poolConfig ? createRuntimePool('relay_api_runtime', poolConfig) : undefined
if (pool) await assertRuntimeDatabaseRole(pool, 'relay_api_runtime')
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
const workerReadinessRepository = pool ? new PostgresWorkerReadinessRepository(pool) : undefined
const app = createApp({
  logger: true,
  corsOrigin: config.corsOrigin,
  sessionRepository: pool
    ? new PostgresSessionRepository(pool, {
      executionMaxAttempts: config.executionMaxAttempts,
    })
    : new InMemorySessionRepository({
      actorOrganizations: developmentOrganizations,
      allowLegacyDevelopmentConfigurationFallback: config.authentication.mode === 'development',
    }),
  sessionTimelineRepository: pool ? new PostgresSessionTimelineRepository(pool) : undefined,
  sessionWorkerRepository: pool ? new PostgresSessionWorkerRepository(pool) : undefined,
  artifactRepository: pool ? new PostgresArtifactRepository(pool) : undefined,
  fileRepository: pool ? new PostgresFileRepository(pool) : undefined,
  toolApprovalRepository: pool ? new PostgresToolApprovalRepository(pool) : undefined,
  serviceAccountPolicyRepository: pool ? new PostgresServiceAccountPolicyRepository(pool) : undefined,
  configurationCatalogRepository: pool
    ? new PostgresConfigurationCatalogRepository(pool)
    : undefined,
  readinessCheck: pool ? async () => {
    await pool.query('SELECT 1')
    await assertMigrationsCurrent(pool)
  } : undefined,
  authenticate,
  executionEnabled: config.executionEnabled,
  executionReadinessCheck: workerReadinessRepository ? () => (
    workerReadinessRepository.hasRecentHeartbeat({ maxAgeMs: config.workerReadinessMaxAgeMs })
  ) : undefined,
  sessionEventStream: config.sessionEventStream,
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
