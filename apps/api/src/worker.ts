import { OpenAiCompatibleChatCompletionsProvider } from './conversation-agent-provider.js'
import { GovernedConversationToolBroker } from './conversation-tool-broker.js'
import { ExecutionWorker, type ExecutionWorkerLogger } from './execution-worker.js'
import { UnavailableEnvironmentProvisioner } from './environment-provisioning-repository.js'
import { EnvironmentProvisioningWorker } from './environment-provisioning-worker.js'
import { assertMigrationsCurrent } from './migrations.js'
import { PostgresExecutionRepository } from './postgres-execution-repository.js'
import { PostgresAdvisorPlanRepository } from './postgres-advisor-plan-repository.js'
import { PostgresEnvironmentProvisioningRepository } from './postgres-environment-provisioning-repository.js'
import { PostgresFileRepository } from './postgres-file-repository.js'
import { assertRuntimeDatabaseRole, createRuntimePool } from './postgres-runtime-database.js'
import { PostgresToolCoordinatorRepository } from './postgres-tool-coordinator-repository.js'
import { PostgresWorkerReadinessRepository } from './postgres-worker-readiness-repository.js'
import { loadWorkerConfig } from './worker-config.js'
import { maintainWorkerReadiness } from './worker-readiness-heartbeat.js'

const config = loadWorkerConfig()
const pool = createRuntimePool('relay_worker_runtime', {
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  query_timeout: config.databaseQueryTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
})
const logger: ExecutionWorkerLogger = {
  info(event, fields = {}) {
    console.info(JSON.stringify({ level: 'info', event, ...fields }))
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: 'error', event, ...fields }))
  },
}
const shutdown = new AbortController()

process.once('SIGINT', () => shutdown.abort())
process.once('SIGTERM', () => shutdown.abort())

try {
  await assertRuntimeDatabaseRole(pool, 'relay_worker_runtime')
  await assertMigrationsCurrent(pool)
  const provider = new OpenAiCompatibleChatCompletionsProvider(config.provider)
  const repository = new PostgresExecutionRepository(pool)
  const environmentProvisioningWorker = new EnvironmentProvisioningWorker({
    repository: new PostgresEnvironmentProvisioningRepository(pool),
    provisioner: new UnavailableEnvironmentProvisioner(),
    workerId: config.workerId,
    leaseDurationMs: config.leaseDurationMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
    recoveryBatchSize: config.recoveryBatchSize,
    logger,
  })
  const toolBroker = new GovernedConversationToolBroker(
    new PostgresToolCoordinatorRepository(pool),
    new PostgresFileRepository(pool),
    new PostgresAdvisorPlanRepository(pool),
  )
  const readinessRepository = new PostgresWorkerReadinessRepository(pool)
  const worker = new ExecutionWorker({
    repository,
    provider,
    workerId: config.workerId,
    leaseDurationMs: config.leaseDurationMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
    recoveryBatchSize: config.recoveryBatchSize,
    toolBroker,
    logger,
  })
  const readinessHeartbeat = maintainWorkerReadiness({
    repository: readinessRepository,
    workerId: config.workerId,
    intervalMs: config.heartbeatIntervalMs,
    logger,
  }, shutdown.signal)
  logger.info('execution_worker_started', { workerId: config.workerId })
  try {
    await Promise.all([
      worker.run(shutdown.signal),
      environmentProvisioningWorker.run(shutdown.signal),
    ])
  } finally {
    shutdown.abort()
    await readinessHeartbeat
  }
  logger.info('execution_worker_stopped', { workerId: config.workerId })
} catch {
  logger.error('execution_worker_startup_failed')
  process.exitCode = 1
} finally {
  await pool.end()
}
