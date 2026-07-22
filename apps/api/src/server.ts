import { Pool } from 'pg'
import { createApp } from './app.js'
import { createDevelopmentAuthenticator, createJwtAuthenticator } from './auth.js'
import { loadConfig } from './config.js'
import { HttpContextEngineGateway } from './context-engine-gateway.js'
import { bootstrapDevelopmentDatabase } from './development-database-bootstrap.js'
import { assertMigrationsCurrent, runMigrations } from './migrations.js'
import { PostgresArtifactRepository } from './postgres-artifact-repository.js'
import { PostgresAdvisorPlanRepository } from './postgres-advisor-plan-repository.js'
import { PostgresAutomationRepository } from './postgres-automation-repository.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'
import { PostgresFileRepository } from './postgres-file-repository.js'
import { assertRuntimeDatabaseRole, createRuntimePool } from './postgres-runtime-database.js'
import { PostgresSecurityAuditRepository } from './postgres-security-audit-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresSessionTimelineRepository } from './postgres-session-timeline-repository.js'
import { PostgresSessionWorkerRepository } from './postgres-session-worker-repository.js'
import { PostgresSpaceRepository } from './postgres-space-repository.js'
import { PostgresToolApprovalRepository } from './postgres-tool-approval-repository.js'
import { PostgresServiceAccountPolicyRepository } from './service-account-policy-repository.js'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'
import { PostgresOrganizationQuotaRepository } from './organization-quota-repository.js'
import { S3ObjectStore } from './object-storage.js'
import { InMemorySessionRepository } from './session-repository.js'

const config = loadConfig()
const poolConfig = config.databaseUrl ? {
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  query_timeout: config.databaseQueryTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
} : undefined
if (poolConfig && (config.migrateOnStart || config.authentication.mode === 'development')) {
  const migrationPool = new Pool(poolConfig)
  try {
    if (config.migrateOnStart) await runMigrations(migrationPool)
    else await assertMigrationsCurrent(migrationPool)
    if (config.authentication.mode === 'development') {
      await bootstrapDevelopmentDatabase(migrationPool, config.authentication.actorId)
    }
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
const contextEngineGateway = config.contextEngine
  ? new HttpContextEngineGateway(config.contextEngine)
  : undefined
const objectStore = config.objectStorage ? new S3ObjectStore(config.objectStorage) : undefined
const organizationQuotaRepository = pool ? new PostgresOrganizationQuotaRepository(pool) : undefined
const app = createApp({
  logger: true,
  corsOrigin: config.corsOrigin,
  bodyLimit: config.bodyLimit,
  trustProxy: config.trustProxy,
  connectionTimeoutMs: config.connectionTimeoutMs,
  requestTimeoutMs: config.requestTimeoutMs,
  keepAliveTimeoutMs: config.keepAliveTimeoutMs,
  securityHeaders: config.securityHeaders,
  rateLimit: config.rateLimit,
  contextEngineGateway,
  securityAuditRepository: pool && config.securityAuditHmacKey && config.securityAuditHmacKeyId
    ? new PostgresSecurityAuditRepository(pool, config.securityAuditHmacKey, {
      hmacKeyId: config.securityAuditHmacKeyId,
    })
    : undefined,
  organizationQuotaRepository,
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
  advisorPlanRepository: pool ? new PostgresAdvisorPlanRepository(pool) : undefined,
  automationRepository: pool ? new PostgresAutomationRepository(pool) : undefined,
  spaceRepository: pool ? new PostgresSpaceRepository(pool) : undefined,
  fileRepository: pool ? new PostgresFileRepository(pool, objectStore) : undefined,
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

let closing = false
const close = async (signal: NodeJS.Signals) => {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'API shutdown started')
  try {
    await app.close()
    await pool?.end()
  } catch (error) {
    app.log.error(error, 'API shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void close('SIGINT'))
process.once('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  await pool?.end()
  process.exit(1)
}
