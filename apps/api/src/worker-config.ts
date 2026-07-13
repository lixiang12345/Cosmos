import { hostname } from 'node:os'

export type WorkerConfig = {
  databaseUrl: string
  databaseConnectionTimeoutMs: number
  databaseQueryTimeoutMs: number
  databaseStatementTimeoutMs: number
  workerId: string
  leaseDurationMs: number
  heartbeatIntervalMs: number
  readinessMaxAgeMs: number
  pollIntervalMs: number
  recoveryBatchSize: number
  provider: {
    baseUrl: string
    apiKey: string
    connectionTimeoutMs: number
    totalTimeoutMs: number
    maxOutputTokens: number
    maxOutputCharacters: number
    maxResponseBytes: number
  }
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required to run the execution worker.`)
  return value
}

function boundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
) {
  const value = env[name]?.trim()
  if (!value) return defaultValue
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function workerIdentifier(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('WORKER_ID must be 1 to 128 safe identifier characters.')
  }
  return value
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const leaseDurationMs = boundedInteger(env, 'WORKER_LEASE_DURATION_MS', 30_000, 3_000, 300_000)
  const heartbeatIntervalMs = boundedInteger(
    env,
    'WORKER_HEARTBEAT_INTERVAL_MS',
    8_000,
    500,
    60_000,
  )
  if (heartbeatIntervalMs * 3 > leaseDurationMs) {
    throw new Error('WORKER_HEARTBEAT_INTERVAL_MS must be at most one third of the lease duration.')
  }
  const readinessMaxAgeMs = boundedInteger(
    env,
    'WORKER_READINESS_MAX_AGE_MS',
    30_000,
    100,
    300_000,
  )
  if (heartbeatIntervalMs * 3 > readinessMaxAgeMs) {
    throw new Error('WORKER_READINESS_MAX_AGE_MS must be at least three heartbeat intervals.')
  }

  const providerConnectionTimeoutMs = boundedInteger(
    env, 'AGENT_PROVIDER_CONNECTION_TIMEOUT_MS', 10_000, 100, 300_000,
  )
  const providerTotalTimeoutMs = boundedInteger(
    env, 'AGENT_PROVIDER_TOTAL_TIMEOUT_MS', 120_000, 100, 300_000,
  )
  if (providerConnectionTimeoutMs > providerTotalTimeoutMs) {
    throw new Error('AGENT_PROVIDER_CONNECTION_TIMEOUT_MS must not exceed the total timeout.')
  }

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseConnectionTimeoutMs: boundedInteger(
      env, 'DATABASE_CONNECTION_TIMEOUT_MS', 5_000, 100, 300_000,
    ),
    databaseQueryTimeoutMs: boundedInteger(
      env, 'DATABASE_QUERY_TIMEOUT_MS', 20_000, 100, 300_000,
    ),
    databaseStatementTimeoutMs: boundedInteger(
      env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 100, 300_000,
    ),
    workerId: workerIdentifier(env.WORKER_ID?.trim() || `${hostname()}:${process.pid}`),
    leaseDurationMs,
    heartbeatIntervalMs,
    readinessMaxAgeMs,
    pollIntervalMs: boundedInteger(env, 'WORKER_POLL_INTERVAL_MS', 500, 50, 60_000),
    recoveryBatchSize: boundedInteger(env, 'WORKER_RECOVERY_BATCH_SIZE', 20, 1, 100),
    provider: {
      baseUrl: required(env, 'AGENT_PROVIDER_BASE_URL'),
      apiKey: required(env, 'AGENT_PROVIDER_API_KEY'),
      connectionTimeoutMs: providerConnectionTimeoutMs,
      totalTimeoutMs: providerTotalTimeoutMs,
      maxOutputTokens: boundedInteger(
        env, 'AGENT_PROVIDER_MAX_OUTPUT_TOKENS', 4_096, 1, 32_768,
      ),
      maxOutputCharacters: boundedInteger(
        env, 'AGENT_PROVIDER_MAX_OUTPUT_CHARACTERS', 100_000, 1, 100_000,
      ),
      maxResponseBytes: boundedInteger(
        env, 'AGENT_PROVIDER_MAX_RESPONSE_BYTES', 1_048_576, 1_024, 10_485_760,
      ),
    },
  }
}

export type WorkerHealthConfig = Pick<
  WorkerConfig,
  | 'databaseUrl'
  | 'databaseConnectionTimeoutMs'
  | 'databaseQueryTimeoutMs'
  | 'databaseStatementTimeoutMs'
  | 'workerId'
  | 'readinessMaxAgeMs'
>

export function loadWorkerHealthConfig(env: NodeJS.ProcessEnv = process.env): WorkerHealthConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseConnectionTimeoutMs: boundedInteger(
      env, 'DATABASE_CONNECTION_TIMEOUT_MS', 5_000, 100, 300_000,
    ),
    databaseQueryTimeoutMs: boundedInteger(
      env, 'DATABASE_QUERY_TIMEOUT_MS', 20_000, 100, 300_000,
    ),
    databaseStatementTimeoutMs: boundedInteger(
      env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 100, 300_000,
    ),
    workerId: workerIdentifier(required(env, 'WORKER_ID')),
    readinessMaxAgeMs: boundedInteger(
      env, 'WORKER_READINESS_MAX_AGE_MS', 30_000, 100, 300_000,
    ),
  }
}
