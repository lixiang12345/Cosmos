import { hostname } from 'node:os'
import {
  AGENT_MODEL_FAMILY_BY_MODEL,
  SUPPORTED_AGENT_MODELS,
  type SupportedAgentModel,
} from '@cosmos/contracts'
import { loadObjectStorageConfig, type ObjectStorageConfig } from './object-storage-config.js'

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
  objectStorage?: ObjectStorageConfig
  approvedWebhook?: {
    url: string
    bearerToken: string
    approverIds: readonly string[]
    approvalTtlMs: number
    requestTimeoutMs: number
  }
  outboxDispatcher?: {
    url: string
    bearerToken: string
    leaseDurationMs: number
    pollIntervalMs: number
    maxAttempts: number
    retryBaseDelayMs: number
    retryMaxDelayMs: number
    requestTimeoutMs: number
  }
  provider: {
    baseUrl: string
    apiKey?: string
    apiKeysByModel: Readonly<Record<string, string>>
    allowedModels: readonly SupportedAgentModel[]
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

function optional(env: NodeJS.ProcessEnv, name: string) {
  return env[name]?.trim() || undefined
}

function providerCredentials(env: NodeJS.ProcessEnv) {
  const fallback = optional(env, 'AGENT_PROVIDER_API_KEY')
  const byFamily = {
    gpt: optional(env, 'AGENT_PROVIDER_GPT_API_KEY'),
    claude: optional(env, 'AGENT_PROVIDER_CLAUDE_API_KEY'),
    grok: optional(env, 'AGENT_PROVIDER_GROK_API_KEY'),
  }
  const missingFamilies = Object.entries(byFamily)
    .filter(([, apiKey]) => !apiKey && !fallback)
    .map(([family]) => family)
  if (missingFamilies.length > 0) {
    throw new Error('AGENT_PROVIDER_API_KEY or all model-family Provider API keys are required to run the execution worker.')
  }
  const apiKeysByModel: Record<string, string> = {}
  for (const model of SUPPORTED_AGENT_MODELS) {
    const apiKey = byFamily[AGENT_MODEL_FAMILY_BY_MODEL[model]]
    if (apiKey) apiKeysByModel[model] = apiKey
  }
  return { fallback, apiKeysByModel }
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

function approvedWebhookConfig(env: NodeJS.ProcessEnv) {
  const urlValue = optional(env, 'APPROVED_WEBHOOK_URL')
  const bearerToken = optional(env, 'APPROVED_WEBHOOK_BEARER_TOKEN')
  const approverIdsValue = optional(env, 'APPROVED_WEBHOOK_APPROVER_IDS')
  const configured = [urlValue, bearerToken, approverIdsValue].filter(Boolean).length
  if (configured === 0) return undefined
  if (configured !== 3) {
    throw new Error('APPROVED_WEBHOOK_URL, APPROVED_WEBHOOK_BEARER_TOKEN, and APPROVED_WEBHOOK_APPROVER_IDS must be configured together.')
  }

  let url: URL
  try {
    url = new URL(urlValue!)
  } catch {
    throw new Error('APPROVED_WEBHOOK_URL must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('APPROVED_WEBHOOK_URL must be HTTPS and cannot contain credentials, query parameters, or a fragment.')
  }
  if (bearerToken!.length < 16 || bearerToken!.length > 4_096 || /\s/.test(bearerToken!)) {
    throw new Error('APPROVED_WEBHOOK_BEARER_TOKEN must contain 16 to 4096 non-whitespace characters.')
  }
  const approverIds = approverIdsValue!.split(',').map((value) => value.trim())
  if (approverIds.length < 1 || approverIds.length > 20
    || approverIds.some((value) => value.startsWith('system:')
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    || new Set(approverIds).size !== approverIds.length) {
    throw new Error('APPROVED_WEBHOOK_APPROVER_IDS must contain 1 to 20 distinct safe actor identifiers.')
  }
  return {
    url: url.toString(),
    bearerToken: bearerToken!,
    approverIds,
    approvalTtlMs: boundedInteger(
      env, 'APPROVED_WEBHOOK_APPROVAL_TTL_MS', 10 * 60_000, 60_000, 60 * 60_000,
    ),
    requestTimeoutMs: boundedInteger(
      env, 'APPROVED_WEBHOOK_REQUEST_TIMEOUT_MS', 10_000, 100, 60_000,
    ),
  }
}

function outboxDispatcherConfig(env: NodeJS.ProcessEnv) {
  const urlValue = optional(env, 'OUTBOX_RECEIVER_URL')
  const bearerToken = optional(env, 'OUTBOX_RECEIVER_BEARER_TOKEN')
  const configured = [urlValue, bearerToken].filter(Boolean).length
  if (configured === 0) return undefined
  if (configured !== 2) {
    throw new Error('OUTBOX_RECEIVER_URL and OUTBOX_RECEIVER_BEARER_TOKEN must be configured together.')
  }

  let url: URL
  try {
    url = new URL(urlValue!)
  } catch {
    throw new Error('OUTBOX_RECEIVER_URL must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('OUTBOX_RECEIVER_URL must be HTTPS and cannot contain credentials, query parameters, or a fragment.')
  }
  if (bearerToken!.length < 16 || bearerToken!.length > 4_096 || /\s/.test(bearerToken!)) {
    throw new Error('OUTBOX_RECEIVER_BEARER_TOKEN must contain 16 to 4096 non-whitespace characters.')
  }
  const leaseDurationMs = boundedInteger(
    env, 'OUTBOX_DELIVERY_LEASE_DURATION_MS', 30_000, 1_000, 300_000,
  )
  const requestTimeoutMs = boundedInteger(
    env, 'OUTBOX_RECEIVER_REQUEST_TIMEOUT_MS', 10_000, 100, 60_000,
  )
  if (requestTimeoutMs >= leaseDurationMs) {
    throw new Error('OUTBOX_RECEIVER_REQUEST_TIMEOUT_MS must be shorter than OUTBOX_DELIVERY_LEASE_DURATION_MS.')
  }
  const retryBaseDelayMs = boundedInteger(
    env, 'OUTBOX_RETRY_BASE_DELAY_MS', 1_000, 100, 60_000,
  )
  const retryMaxDelayMs = boundedInteger(
    env, 'OUTBOX_RETRY_MAX_DELAY_MS', 60_000, retryBaseDelayMs, 3_600_000,
  )
  return {
    url: url.toString(),
    bearerToken: bearerToken!,
    leaseDurationMs,
    pollIntervalMs: boundedInteger(env, 'OUTBOX_POLL_INTERVAL_MS', 500, 50, 60_000),
    maxAttempts: boundedInteger(env, 'OUTBOX_MAX_ATTEMPTS', 5, 1, 20),
    retryBaseDelayMs,
    retryMaxDelayMs,
    requestTimeoutMs,
  }
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
  const credentials = providerCredentials(env)
  const approvedWebhook = approvedWebhookConfig(env)
  const outboxDispatcher = outboxDispatcherConfig(env)

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
    objectStorage: loadObjectStorageConfig(env, env.NODE_ENV?.trim() || 'development'),
    ...(approvedWebhook ? { approvedWebhook } : {}),
    ...(outboxDispatcher ? { outboxDispatcher } : {}),
    provider: {
      baseUrl: required(env, 'AGENT_PROVIDER_BASE_URL'),
      apiKey: credentials.fallback,
      apiKeysByModel: credentials.apiKeysByModel,
      allowedModels: SUPPORTED_AGENT_MODELS,
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
