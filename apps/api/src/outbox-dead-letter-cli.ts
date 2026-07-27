import { assertMigrationsCurrent } from './migrations.js'
import type { OutboxReplayReason, OutboxStream } from './outbox-delivery-repository.js'
import { createRuntimePool, assertRuntimeDatabaseRole } from './postgres-runtime-database.js'
import { PostgresOutboxDeliveryRepository } from './postgres-outbox-delivery-repository.js'

const streams = new Set<OutboxStream>(['session', 'environment', 'automation', 'space'])
const replayReasons = new Set<OutboxReplayReason>([
  'receiver_policy_fixed', 'receiver_recovered', 'operator_reconciled',
])

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function stream(value: string | undefined): OutboxStream {
  if (!value || !streams.has(value as OutboxStream)) {
    throw new Error('stream must be one of session, environment, automation, or space.')
  }
  return value as OutboxStream
}

function replayReason(value: string | undefined): OutboxReplayReason {
  if (!value || !replayReasons.has(value as OutboxReplayReason)) {
    throw new Error('reason must be receiver_policy_fixed, receiver_recovered, or operator_reconciled.')
  }
  return value as OutboxReplayReason
}

function usage() {
  return [
    'Usage:',
    '  pnpm outbox:dead-letter list [limit]',
    '  pnpm outbox:dead-letter replay <stream> <organization-id> <space-id> <source-id> <version> <reason-code>',
    '',
    'Required environment: DATABASE_URL, OUTBOX_OPERATOR_ID',
  ].join('\n')
}

const command = process.argv[2]
let pool: ReturnType<typeof createRuntimePool> | undefined
let stage = 'database_role_check'
try {
  pool = createRuntimePool('cosmos_worker_runtime', {
    connectionString: required('DATABASE_URL'),
    connectionTimeoutMillis: 5_000,
    query_timeout: 20_000,
    statement_timeout: 15_000,
  }, () => {})
  await assertRuntimeDatabaseRole(pool, 'cosmos_worker_runtime')
  stage = 'migration_check'
  await assertMigrationsCurrent(pool)
  stage = 'command'
  const repository = new PostgresOutboxDeliveryRepository(pool)
  if (command === 'list') {
    const limit = process.argv[3] === undefined
      ? 20
      : integer(process.argv[3], 'limit', 1, 100)
    console.log(JSON.stringify({ items: await repository.listDeadLetters(limit) }, null, 2))
  } else if (command === 'replay') {
    const [, , , streamValue, organizationId, spaceId, sourceId, versionValue, reasonValue] = process.argv
    const reason = replayReason(reasonValue)
    if (!organizationId || !spaceId || !sourceId || !reason) throw new Error(usage())
    const replayed = await repository.replayDeadLetter({
      stream: stream(streamValue),
      organizationId,
      spaceId,
      sourceId,
      expectedVersion: integer(versionValue, 'version', 1, Number.MAX_SAFE_INTEGER),
      actorId: required('OUTBOX_OPERATOR_ID'),
      reason,
    })
    console.log(JSON.stringify({ replayed }))
    if (!replayed) process.exitCode = 2
  } else {
    throw new Error(usage())
  }
} catch (error) {
  console.error(JSON.stringify({
    level: 'error',
    event: 'outbox_dead_letter_command_failed',
    stage,
    errorType: error instanceof Error ? error.name : typeof error,
  }))
  if (error instanceof Error && error.message === usage()) console.error(usage())
  process.exitCode = 1
} finally {
  await pool?.end()
}
