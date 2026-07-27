import { OpenAiCompatibleChatCompletionsProvider } from './conversation-agent-provider.js'
import { HttpApprovedWebhookClient } from './approved-webhook-client.js'
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
import { S3ObjectStore } from './object-storage.js'
import { OutboxDispatcher } from './outbox-dispatcher.js'
import { HttpOutboxReceiverClient } from './outbox-receiver-client.js'
import { PostgresOutboxDeliveryRepository } from './postgres-outbox-delivery-repository.js'
import { loadWorkerConfig } from './worker-config.js'
import { maintainWorkerReadiness } from './worker-readiness-heartbeat.js'

const logger: ExecutionWorkerLogger = {
  info(event, fields = {}) {
    console.info(JSON.stringify({ level: 'info', event, ...fields }))
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: 'error', event, ...fields }))
  },
}
const config = loadWorkerConfig()
const pool = createRuntimePool('cosmos_worker_runtime', {
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  query_timeout: config.databaseQueryTimeoutMs,
  statement_timeout: config.databaseStatementTimeoutMs,
}, () => logger.error('worker_database_client_error'))
const shutdown = new AbortController()
let workerStage = 'database_role_check'

process.once('SIGINT', () => shutdown.abort())
process.once('SIGTERM', () => shutdown.abort())

try {
  await assertRuntimeDatabaseRole(pool, 'cosmos_worker_runtime')
  workerStage = 'migration_check'
  await assertMigrationsCurrent(pool)
  workerStage = 'provider_initialization'
  const provider = new OpenAiCompatibleChatCompletionsProvider(config.provider)
  workerStage = 'object_store_initialization'
  const objectStore = config.objectStorage ? new S3ObjectStore(config.objectStorage) : undefined
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
    new PostgresFileRepository(pool, objectStore),
    new PostgresAdvisorPlanRepository(pool),
    config.approvedWebhook ? {
      client: new HttpApprovedWebhookClient({
        url: config.approvedWebhook.url,
        bearerToken: config.approvedWebhook.bearerToken,
        requestTimeoutMs: config.approvedWebhook.requestTimeoutMs,
      }),
      approverIds: config.approvedWebhook.approverIds,
      approvalTtlMs: config.approvedWebhook.approvalTtlMs,
    } : undefined,
  )
  const readinessRepository = new PostgresWorkerReadinessRepository(pool)
  const outboxDispatcher = config.outboxDispatcher ? new OutboxDispatcher({
    repository: new PostgresOutboxDeliveryRepository(pool),
    client: new HttpOutboxReceiverClient({
      url: config.outboxDispatcher.url,
      bearerToken: config.outboxDispatcher.bearerToken,
      requestTimeoutMs: config.outboxDispatcher.requestTimeoutMs,
    }),
    workerId: config.workerId,
    leaseDurationMs: config.outboxDispatcher.leaseDurationMs,
    pollIntervalMs: config.outboxDispatcher.pollIntervalMs,
    maxAttempts: config.outboxDispatcher.maxAttempts,
    retryBaseDelayMs: config.outboxDispatcher.retryBaseDelayMs,
    retryMaxDelayMs: config.outboxDispatcher.retryMaxDelayMs,
    logger,
  }) : undefined
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
  workerStage = 'runtime'
  logger.info('execution_worker_started', { workerId: config.workerId })
  try {
    await Promise.all([
      worker.run(shutdown.signal),
      environmentProvisioningWorker.run(shutdown.signal),
      ...(outboxDispatcher ? [outboxDispatcher.run(shutdown.signal)] : []),
    ])
  } finally {
    shutdown.abort()
    await readinessHeartbeat
  }
  logger.info('execution_worker_stopped', { workerId: config.workerId })
} catch (error) {
  logger.error('execution_worker_startup_failed', {
    stage: workerStage,
    errorType: error instanceof Error ? error.name : typeof error,
  })
  process.exitCode = 1
} finally {
  await pool.end()
}
