import { describe, expect, it } from 'vitest'
import { loadWorkerConfig, loadWorkerHealthConfig } from './worker-config.js'

const required = {
  DATABASE_URL: 'postgres://cosmos',
  WORKER_ID: 'worker-a:1',
  AGENT_PROVIDER_BASE_URL: 'https://provider.example/v1/',
  AGENT_PROVIDER_API_KEY: 'provider-secret',
}

describe('execution worker configuration', () => {
  it('loads bounded defaults without exposing an implicit provider', () => {
    expect(loadWorkerConfig(required)).toEqual({
      databaseUrl: 'postgres://cosmos',
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 20_000,
      databaseStatementTimeoutMs: 15_000,
      workerId: 'worker-a:1',
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 8_000,
      readinessMaxAgeMs: 30_000,
      pollIntervalMs: 500,
      recoveryBatchSize: 20,
      provider: {
        baseUrl: 'https://provider.example/v1/',
        apiKey: 'provider-secret',
        apiKeysByModel: {},
        allowedModels: [
          'gpt-5.6-sol',
          'claude-fable-5',
          'claude-opus-4-8',
          'claude-sonnet-5',
          'grok-4.5',
        ],
        connectionTimeoutMs: 10_000,
        totalTimeoutMs: 120_000,
        maxOutputTokens: 4_096,
        maxOutputCharacters: 100_000,
        maxResponseBytes: 1_048_576,
      },
    })
  })

  it('maps family credentials onto the fixed model catalog', () => {
    const config = loadWorkerConfig({
      DATABASE_URL: required.DATABASE_URL,
      WORKER_ID: required.WORKER_ID,
      AGENT_PROVIDER_BASE_URL: required.AGENT_PROVIDER_BASE_URL,
      AGENT_PROVIDER_GPT_API_KEY: 'gpt-secret',
      AGENT_PROVIDER_CLAUDE_API_KEY: 'claude-secret',
      AGENT_PROVIDER_GROK_API_KEY: 'grok-secret',
    })
    expect(config.provider).toMatchObject({
      apiKey: undefined,
      apiKeysByModel: {
        'gpt-5.6-sol': 'gpt-secret',
        'claude-fable-5': 'claude-secret',
        'claude-opus-4-8': 'claude-secret',
        'claude-sonnet-5': 'claude-secret',
        'grok-4.5': 'grok-secret',
      },
    })
  })

  it('requires database and provider authority explicitly', () => {
    expect(() => loadWorkerConfig({ ...required, DATABASE_URL: '' })).toThrow('DATABASE_URL')
    expect(() => loadWorkerConfig({ ...required, AGENT_PROVIDER_BASE_URL: '' }))
      .toThrow('AGENT_PROVIDER_BASE_URL')
    expect(() => loadWorkerConfig({ ...required, AGENT_PROVIDER_API_KEY: '' }))
      .toThrow('AGENT_PROVIDER_API_KEY')
  })

  it('rejects unsafe identifiers and heartbeat windows', () => {
    expect(() => loadWorkerConfig({ ...required, WORKER_ID: 'worker with spaces' }))
      .toThrow('WORKER_ID')
    expect(() => loadWorkerConfig({
      ...required,
      WORKER_LEASE_DURATION_MS: '3000',
      WORKER_HEARTBEAT_INTERVAL_MS: '1500',
    })).toThrow('one third')
    expect(() => loadWorkerConfig({
      ...required,
      WORKER_HEARTBEAT_INTERVAL_MS: '1000',
      WORKER_READINESS_MAX_AGE_MS: '2999',
    })).toThrow('three heartbeat intervals')
  })

  it('loads an instance-specific database health check without provider secrets', () => {
    expect(loadWorkerHealthConfig({
      DATABASE_URL: required.DATABASE_URL,
      WORKER_ID: required.WORKER_ID,
      WORKER_READINESS_MAX_AGE_MS: '45000',
    })).toEqual({
      databaseUrl: required.DATABASE_URL,
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 20_000,
      databaseStatementTimeoutMs: 15_000,
      workerId: required.WORKER_ID,
      readinessMaxAgeMs: 45_000,
    })
    expect(() => loadWorkerHealthConfig({ DATABASE_URL: required.DATABASE_URL }))
      .toThrow('WORKER_ID')
  })

  it('validates numeric worker and provider limits', () => {
    expect(() => loadWorkerConfig({ ...required, WORKER_RECOVERY_BATCH_SIZE: '101' }))
      .toThrow('WORKER_RECOVERY_BATCH_SIZE')
    expect(() => loadWorkerConfig({ ...required, AGENT_PROVIDER_MAX_OUTPUT_TOKENS: '0' }))
      .toThrow('AGENT_PROVIDER_MAX_OUTPUT_TOKENS')
    expect(() => loadWorkerConfig({ ...required, AGENT_PROVIDER_MAX_OUTPUT_CHARACTERS: '100001' }))
      .toThrow('AGENT_PROVIDER_MAX_OUTPUT_CHARACTERS')
    expect(() => loadWorkerConfig({ ...required, AGENT_PROVIDER_TOTAL_TIMEOUT_MS: 'forever' }))
      .toThrow('AGENT_PROVIDER_TOTAL_TIMEOUT_MS')
    expect(() => loadWorkerConfig({
      ...required,
      AGENT_PROVIDER_CONNECTION_TIMEOUT_MS: '2000',
      AGENT_PROVIDER_TOTAL_TIMEOUT_MS: '1000',
    })).toThrow('must not exceed')
  })
})
