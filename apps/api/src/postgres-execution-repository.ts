import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  ClaimNextExecutionOptions,
  CompleteExecutionInput,
  ExecutionClaim,
  ExecutionRepository,
  FailExecutionInput,
  FailExecutionResult,
  HeartbeatExecutionInput,
  ReapExpiredExecutionsOptions,
  ReapExpiredExecutionsResult,
} from './execution-repository.js'

type CandidateRow = {
  organization_id: string
  space_id: string
  session_id: string
  turn_id: string
  command_id: string
  request_id: string
  requested_by: string
  requested_by_kind: 'user' | 'service_account'
  attempts: number
  queued_attempt_id: string | null
  queued_attempt_number: number | null
  model: string
  instructions: string
  input_content: string
}

type ClaimedCommandRow = {
  attempts: number
  lease_expires_at: Date | string
  claimed_at: Date | string
}

type TransitionedCommandRow = {
  transitioned_at: Date | string
}

type LockedExecutionRow = {
  organization_id: string
  space_id: string
  session_id: string
  turn_id: string
  command_id: string
  attempt_id: string
  attempt_number: number
  lease_owner: string
  request_id: string
  max_attempts: number
}

type QueuedExecutionRow = {
  organization_id: string
  space_id: string
  session_id: string
  turn_id: string
  command_id: string
  request_id: string
  attempts: number
}

const MAX_LEASE_DURATION_MS = 300_000
const MAX_RETRY_DELAY_MS = 86_400_000
const MAX_OUTPUT_CHARACTERS = 100_000
const MAX_PROVIDER_MODEL_CHARACTERS = 256
const MAX_FAILURE_CODE_CHARACTERS = 128
const MAX_FAILURE_MESSAGE_CHARACTERS = 1_000

function requireIdentifier(value: string, name: string) {
  if (!value || value !== value.trim() || value.length > 128) {
    throw new Error(`${name} must be a non-empty identifier of at most 128 characters.`)
  }
}

function requireProviderModel(value: string) {
  if (!value || value !== value.trim() || value.length > MAX_PROVIDER_MODEL_CHARACTERS) {
    throw new Error(
      `Provider model must be a non-empty identifier of at most ${MAX_PROVIDER_MODEL_CHARACTERS} characters.`,
    )
  }
}

function requireDuration(value: number, name: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum} milliseconds.`)
  }
}

function requireLeaseDuration(value: number) {
  requireDuration(value, 'Lease duration', MAX_LEASE_DURATION_MS)
  if (value < 100) throw new Error('Lease duration must be at least 100 milliseconds.')
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function executionNow(value: Date | undefined) {
  if (value === undefined) return null
  if (!Number.isFinite(value.getTime())) throw new Error('Execution time must be a valid Date.')
  return value.toISOString()
}

function sanitizeFailureCode(value: string) {
  const normalized = typeof value === 'string'
    ? value.trim().replaceAll(/[^a-zA-Z0-9._:-]/g, '_')
    : ''
  return (normalized || 'execution_failed').slice(0, MAX_FAILURE_CODE_CHARACTERS)
}

function sanitizeFailureMessage(value: string) {
  const withoutControlCharacters = Array.from(typeof value === 'string' ? value : '', (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127 ? ' ' : character
  }).join('')
  const normalized = withoutControlCharacters
    .replaceAll(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replaceAll(
      /\b(api[_ -]?key|authorization|password|secret|token)\b\s*[:=]\s*["']?[^\s,"';]+/gi,
      '$1=[REDACTED]',
    )
    .replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replaceAll(/\s+/g, ' ')
    .trim()
  return (normalized || 'Execution failed.').slice(0, MAX_FAILURE_MESSAGE_CHARACTERS)
}

export type PostgresExecutionRepositoryOptions = Readonly<{
  createId?: () => string
}>

export class PostgresExecutionRepository implements ExecutionRepository {
  private readonly createId: () => string

  constructor(
    private readonly pool: Pool,
    options: PostgresExecutionRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
  }

  async claimNext(options: ClaimNextExecutionOptions): Promise<ExecutionClaim | null> {
    requireIdentifier(options.leaseOwner, 'Lease owner')
    requireLeaseDuration(options.leaseDurationMs)
    const now = executionNow(options.now)

    return this.transaction(async (client) => {
      await this.cancelUnauthorizedQueuedExecutions(client, now)
      const candidate = await client.query<CandidateRow>(`
        SELECT
          command_record.organization_id,
          command_record.space_id,
          command_record.session_id,
          turn_record.id AS turn_id,
          command_record.id AS command_id,
          command_record.request_id,
          command_record.requested_by,
          CASE WHEN EXISTS (
            SELECT 1 FROM relay_service_accounts service_account
            WHERE service_account.organization_id = command_record.organization_id
              AND service_account.id = command_record.requested_by
          ) THEN 'service_account' ELSE 'user' END AS requested_by_kind,
          command_record.attempts,
          queued_attempt.id AS queued_attempt_id,
          queued_attempt.number AS queued_attempt_number,
          expert_revision.model,
          expert_revision.instructions,
          input_message.content AS input_content
        FROM relay_commands command_record
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_messages input_message
          ON input_message.organization_id = turn_record.organization_id
          AND input_message.space_id = turn_record.space_id
          AND input_message.session_id = turn_record.session_id
          AND input_message.id = turn_record.input_message_id
        LEFT JOIN relay_attempts queued_attempt
          ON queued_attempt.organization_id = turn_record.organization_id
          AND queued_attempt.space_id = turn_record.space_id
          AND queued_attempt.session_id = turn_record.session_id
          AND queued_attempt.turn_id = turn_record.id
          AND queued_attempt.status = 'queued'
        JOIN relay_expert_revisions expert_revision
          ON expert_revision.organization_id = session_record.organization_id
          AND expert_revision.space_id = session_record.space_id
          AND expert_revision.expert_id = session_record.expert_id
          AND expert_revision.id = session_record.expert_revision_id
        JOIN relay_organization_memberships organization_membership
          ON organization_membership.organization_id = command_record.organization_id
          AND organization_membership.actor_id = command_record.requested_by
        JOIN relay_space_memberships space_membership
          ON space_membership.organization_id = command_record.organization_id
          AND space_membership.space_id = command_record.space_id
          AND space_membership.actor_id = command_record.requested_by
        WHERE command_record.protocol_version = 1
          AND command_record.status IN ('accepted', 'queued')
          AND command_record.available_at <= COALESCE($1::timestamptz, clock_timestamp())
          AND command_record.attempts < command_record.max_attempts
          AND command_record.lease_owner IS NULL
          AND command_record.lease_expires_at IS NULL
          AND command_record.resource_type = 'turn'
          AND session_record.configuration_resolution_version = 1
          AND session_record.status = 'queued'
          AND turn_record.status = 'queued'
          AND input_message.role = 'user'
          AND NOT EXISTS (
            SELECT 1
            FROM relay_turns earlier_turn
            WHERE earlier_turn.organization_id = turn_record.organization_id
              AND earlier_turn.space_id = turn_record.space_id
              AND earlier_turn.session_id = turn_record.session_id
              AND earlier_turn.ordinal < turn_record.ordinal
              AND earlier_turn.status IN ('queued', 'running', 'waiting_tool', 'waiting_approval')
          )
          AND expert_revision.status = 'published'
          AND organization_membership.role <> 'viewer'
          AND space_membership.role <> 'viewer'
        ORDER BY command_record.available_at, command_record.accepted_at, command_record.id
        LIMIT 1
        FOR UPDATE OF command_record, session_record, turn_record SKIP LOCKED
        FOR SHARE OF input_message
        FOR SHARE OF organization_membership, space_membership
      `, [now])
      const selected = candidate.rows[0]
      if (!selected) return null

      const attemptId = selected.queued_attempt_id ?? this.createId()
      requireIdentifier(attemptId, 'Generated Attempt id')
      const command = await client.query<ClaimedCommandRow>(`
        WITH execution_time AS (
          SELECT COALESCE($6::timestamptz, clock_timestamp()) AS claimed_at
        )
        UPDATE relay_commands
        SET status = 'running',
            queued_at = COALESCE(queued_at, execution_time.claimed_at),
            started_at = execution_time.claimed_at,
            heartbeat_at = execution_time.claimed_at,
            lease_owner = $5,
            lease_expires_at = execution_time.claimed_at
              + ($7::double precision * interval '1 millisecond'),
            attempts = attempts + 1
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND protocol_version = 1
          AND status IN ('accepted', 'queued')
          AND attempts = $8
          AND available_at <= execution_time.claimed_at
        RETURNING attempts, lease_expires_at, execution_time.claimed_at
      `, [
        selected.organization_id,
        selected.space_id,
        selected.session_id,
        selected.command_id,
        options.leaseOwner,
        now,
        options.leaseDurationMs,
        selected.attempts,
      ])
      const claimed = command.rows[0]
      if (!claimed) throw new Error('Locked execution Command could not be claimed.')
      const claimedAt = timestamp(claimed.claimed_at)

      if (selected.queued_attempt_id) {
        if (selected.queued_attempt_number !== claimed.attempts) {
          throw new Error('The queued retry Attempt does not match the Command fence.')
        }
        const startingAttempt = await client.query(`
          UPDATE relay_attempts
          SET status = 'starting', runtime_id = $7, started_at = $8
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            AND turn_id = $4 AND id = $5 AND number = $6 AND status = 'queued'
        `, [
          selected.organization_id,
          selected.space_id,
          selected.session_id,
          selected.turn_id,
          attemptId,
          claimed.attempts,
          options.leaseOwner,
          claimedAt,
        ])
        if (startingAttempt.rowCount !== 1) throw new Error('Queued retry Attempt could not be started.')
        const runningAttempt = await client.query(`
          UPDATE relay_attempts
          SET status = 'running', heartbeat_at = $7
          WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
            AND turn_id = $4 AND id = $5 AND number = $6 AND status = 'starting'
        `, [
          selected.organization_id,
          selected.space_id,
          selected.session_id,
          selected.turn_id,
          attemptId,
          claimed.attempts,
          claimedAt,
        ])
        if (runningAttempt.rowCount !== 1) throw new Error('Queued retry Attempt could not begin running.')
      } else {
        const attempt = await client.query(`
          INSERT INTO relay_attempts (
            organization_id, space_id, session_id, turn_id, id, number, status,
            model, runtime_id, created_at, started_at, heartbeat_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'running', $7, $8, $9, $9, $9)
        `, [
          selected.organization_id,
          selected.space_id,
          selected.session_id,
          selected.turn_id,
          attemptId,
          claimed.attempts,
          selected.model,
          options.leaseOwner,
          claimedAt,
        ])
        if (attempt.rowCount !== 1) throw new Error('Execution Attempt could not be created.')
      }
      const turn = await client.query(`
        UPDATE relay_turns
        SET status = 'running',
            started_at = COALESCE(started_at, $5),
            heartbeat_at = $5,
            completed_at = NULL,
            failure_code = NULL,
            failure_message = NULL,
            version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'queued'
      `, [selected.organization_id, selected.space_id, selected.session_id, selected.turn_id, claimedAt])
      if (turn.rowCount !== 1) throw new Error('Locked execution Turn could not be activated.')

      const session = await client.query<{ first_sequence: string; version: number }>(`
        UPDATE relay_sessions
        SET status = 'active',
            updated_at = $4,
            last_activity_at = $4,
            version = version + 1,
            last_event_sequence = last_event_sequence + 2
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status = 'queued'
        RETURNING last_event_sequence - 1 AS first_sequence, version
      `, [selected.organization_id, selected.space_id, selected.session_id, claimedAt])
      const activatedSession = session.rows[0]
      const firstSequence = Number(activatedSession?.first_sequence)
      if (!activatedSession || !Number.isSafeInteger(firstSequence)) {
        throw new Error('Locked execution Session could not be activated.')
      }

      await this.insertSessionUpdatedEvent(client, {
        organizationId: selected.organization_id,
        spaceId: selected.space_id,
        sessionId: selected.session_id,
        commandId: selected.command_id,
        actorId: options.leaseOwner,
        actorKind: 'worker',
        requestId: selected.request_id,
        sequence: firstSequence,
        status: 'active',
        version: activatedSession.version,
        occurredAt: claimedAt,
      })
      await this.insertAttemptEvent(client, {
        organizationId: selected.organization_id,
        spaceId: selected.space_id,
        sessionId: selected.session_id,
        turnId: selected.turn_id,
        commandId: selected.command_id,
        attemptId,
        attemptNumber: claimed.attempts,
        actorId: options.leaseOwner,
        actorKind: 'worker',
        requestId: selected.request_id,
        sequence: firstSequence + 1,
        status: 'running',
        failureCode: null,
        occurredAt: claimedAt,
      })

      return {
        organizationId: selected.organization_id,
        spaceId: selected.space_id,
        sessionId: selected.session_id,
        turnId: selected.turn_id,
        commandId: selected.command_id,
        attemptId,
        attemptNumber: claimed.attempts,
        leaseOwner: options.leaseOwner,
        leaseExpiresAt: timestamp(claimed.lease_expires_at),
        requestId: selected.request_id,
        requestedBy: selected.requested_by,
        requestedByKind: selected.requested_by_kind,
        model: selected.model,
        systemPrompt: selected.instructions,
        taskContext: selected.input_content,
      }
    })
  }

  async heartbeat(input: HeartbeatExecutionInput): Promise<boolean> {
    this.validateClaim(input.claim)
    requireLeaseDuration(input.leaseDurationMs)
    const now = executionNow(input.now)

    return this.transaction(async (client) => {
      const locked = await client.query<LockedExecutionRow>(`
        SELECT
          command_record.organization_id,
          command_record.space_id,
          command_record.session_id,
          turn_record.id AS turn_id,
          command_record.id AS command_id,
          attempt.id AS attempt_id,
          attempt.number AS attempt_number,
          command_record.lease_owner,
          command_record.request_id,
          command_record.max_attempts
        FROM relay_commands command_record
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_attempts attempt
          ON attempt.organization_id = turn_record.organization_id
          AND attempt.space_id = turn_record.space_id
          AND attempt.session_id = turn_record.session_id
          AND attempt.turn_id = turn_record.id
          AND attempt.id = $6
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
          AND command_record.resource_id = $5
          AND command_record.protocol_version = 1
          AND command_record.status = 'running'
          AND command_record.attempts = $7
          AND command_record.lease_owner = $8
          AND attempt.number = $7
          AND attempt.runtime_id = $8
          AND attempt.status = 'running'
          AND turn_record.status = 'running'
          AND session_record.status = 'active'
        FOR UPDATE OF command_record, session_record, turn_record, attempt
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.commandId,
        input.claim.turnId,
        input.claim.attemptId,
        input.claim.attemptNumber,
        input.claim.leaseOwner,
      ])
      const execution = locked.rows[0]
      if (!execution) return false
      if (!await this.hasWritePermission(client, execution)) {
        await this.cancelRunningExecution(client, execution, {
          actorId: execution.lease_owner,
          actorKind: 'worker',
          now,
          leaseState: 'unexpired',
          providerModel: null,
        })
        return false
      }

      const command = await client.query<{ heartbeat_at: Date | string }>(`
        WITH execution_time AS (
          SELECT COALESCE($8::timestamptz, clock_timestamp()) AS heartbeat_at
        )
        UPDATE relay_commands
        SET heartbeat_at = GREATEST(relay_commands.heartbeat_at, execution_time.heartbeat_at),
            lease_expires_at = GREATEST(relay_commands.heartbeat_at, execution_time.heartbeat_at)
              + ($9::double precision * interval '1 millisecond')
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND resource_id = $5
          AND protocol_version = 1
          AND status = 'running'
          AND attempts = $6
          AND lease_owner = $7
          AND lease_expires_at > execution_time.heartbeat_at
        RETURNING relay_commands.heartbeat_at
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.commandId,
        input.claim.turnId,
        input.claim.attemptNumber,
        input.claim.leaseOwner,
        now,
        input.leaseDurationMs,
      ])
      const heartbeatAt = command.rows[0]?.heartbeat_at
      if (!heartbeatAt) return false
      const heartbeatTimestamp = timestamp(heartbeatAt)

      const attempt = await client.query(`
        UPDATE relay_attempts
        SET heartbeat_at = GREATEST(heartbeat_at, $8::timestamptz)
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND turn_id = $4 AND id = $5 AND number = $6
          AND runtime_id = $7 AND status = 'running'
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.turnId,
        input.claim.attemptId,
        input.claim.attemptNumber,
        input.claim.leaseOwner,
        heartbeatTimestamp,
      ])
      if (attempt.rowCount !== 1) throw new Error('Claimed execution Attempt is missing or no longer running.')

      const turn = await client.query(`
        UPDATE relay_turns
        SET heartbeat_at = GREATEST(heartbeat_at, $5::timestamptz)
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running'
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.turnId,
        heartbeatTimestamp,
      ])
      if (turn.rowCount !== 1) throw new Error('Claimed execution Turn is missing or no longer running.')
      return true
    })
  }

  async complete(input: CompleteExecutionInput): Promise<boolean> {
    this.validateClaim(input.claim)
    requireProviderModel(input.providerModel)
    if (
      typeof input.output !== 'string'
      || !input.output.trim()
      || input.output.length > MAX_OUTPUT_CHARACTERS
    ) {
      throw new Error(`Execution output must be non-empty and contain at most ${MAX_OUTPUT_CHARACTERS} characters.`)
    }
    const now = executionNow(input.now)

    return this.transaction(async (client) => {
      const locked = await client.query<LockedExecutionRow>(`
        SELECT
          command_record.organization_id,
          command_record.space_id,
          command_record.session_id,
          turn_record.id AS turn_id,
          command_record.id AS command_id,
          attempt.id AS attempt_id,
          attempt.number AS attempt_number,
          command_record.lease_owner,
          command_record.request_id,
          command_record.max_attempts
        FROM relay_commands command_record
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_attempts attempt
          ON attempt.organization_id = turn_record.organization_id
          AND attempt.space_id = turn_record.space_id
          AND attempt.session_id = turn_record.session_id
          AND attempt.turn_id = turn_record.id
          AND attempt.id = $6
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
          AND command_record.resource_id = $5
          AND command_record.protocol_version = 1
          AND command_record.status = 'running'
          AND command_record.attempts = $7
          AND command_record.lease_owner = $8
          AND command_record.lease_expires_at
            > COALESCE($9::timestamptz, clock_timestamp())
          AND attempt.number = $7
          AND attempt.runtime_id = $8
          AND attempt.status = 'running'
          AND turn_record.status = 'running'
          AND session_record.status = 'active'
        FOR UPDATE OF command_record, session_record, turn_record, attempt
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.commandId,
        input.claim.turnId,
        input.claim.attemptId,
        input.claim.attemptNumber,
        input.claim.leaseOwner,
        now,
      ])
      const execution = locked.rows[0]
      if (!execution) return false
      if (!await this.hasWritePermission(client, execution)) {
        await this.cancelRunningExecution(client, execution, {
          actorId: execution.lease_owner,
          actorKind: 'worker',
          now,
          leaseState: 'unexpired',
          providerModel: input.providerModel,
        })
        return false
      }

      const command = await client.query<TransitionedCommandRow>(`
        WITH execution_time AS (
          SELECT COALESCE($7::timestamptz, clock_timestamp()) AS transitioned_at
        )
        UPDATE relay_commands
        SET status = 'succeeded',
            heartbeat_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
            completed_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
            lease_owner = NULL,
            lease_expires_at = NULL
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND protocol_version = 1
          AND status = 'running' AND attempts = $5 AND lease_owner = $6
          AND lease_expires_at > execution_time.transitioned_at
        RETURNING execution_time.transitioned_at
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.command_id,
        execution.attempt_number,
        execution.lease_owner,
        now,
      ])
      const transitionedAt = command.rows[0]?.transitioned_at
      if (!transitionedAt) return false
      const completedAt = timestamp(transitionedAt)

      const messageId = this.createId()
      requireIdentifier(messageId, 'Generated Message id')
      const attempt = await client.query(`
        UPDATE relay_attempts
        SET status = 'succeeded',
            heartbeat_at = GREATEST(heartbeat_at, $8::timestamptz),
            completed_at = GREATEST(heartbeat_at, $8::timestamptz),
            provider_model = $9
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
          AND turn_id = $4 AND id = $5 AND number = $6
          AND runtime_id = $7 AND status = 'running'
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.turn_id,
        execution.attempt_id,
        execution.attempt_number,
        execution.lease_owner,
        completedAt,
        input.providerModel,
      ])
      if (attempt.rowCount !== 1) throw new Error('Locked execution Attempt could not be completed.')
      const message = await client.query(`
        INSERT INTO relay_messages (
          id, organization_id, space_id, session_id, sequence, role, actor_id,
          content, attachments, created_at, turn_id, attempt_id
        ) SELECT
          $5, $1, $2, $3, COALESCE(MAX(sequence), 0) + 1, 'agent', NULL,
          $6, '[]'::jsonb, $7, $4, $8
        FROM relay_messages
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.turn_id,
        messageId,
        input.output,
        completedAt,
        execution.attempt_id,
      ])
      if (message.rowCount !== 1) throw new Error('Execution output Message could not be inserted.')
      const turn = await client.query(`
        UPDATE relay_turns
        SET status = 'completed',
            heartbeat_at = GREATEST(heartbeat_at, $5::timestamptz),
            completed_at = GREATEST(heartbeat_at, $5::timestamptz),
            failure_code = NULL,
            failure_message = NULL,
            version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running'
      `, [execution.organization_id, execution.space_id, execution.session_id, execution.turn_id, completedAt])
      if (turn.rowCount !== 1) throw new Error('Locked execution Turn could not be completed.')
      const session = await client.query<{
        first_sequence: string
        status: 'queued' | 'completed'
        version: number
      }>(`
        UPDATE relay_sessions
        SET status = CASE WHEN EXISTS (
              SELECT 1 FROM relay_turns queued_turn
              WHERE queued_turn.organization_id = relay_sessions.organization_id
                AND queued_turn.space_id = relay_sessions.space_id
                AND queued_turn.session_id = relay_sessions.id
                AND queued_turn.status = 'queued'
            ) THEN 'queued' ELSE 'completed' END,
            updated_at = $4,
            last_activity_at = $4,
            version = version + 1,
            last_event_sequence = last_event_sequence + 3
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status = 'active'
        RETURNING last_event_sequence - 2 AS first_sequence, status, version
      `, [execution.organization_id, execution.space_id, execution.session_id, completedAt])
      const firstSequence = Number(session.rows[0]?.first_sequence)
      if (!Number.isSafeInteger(firstSequence)) throw new Error('Execution event sequence could not be reserved.')

      await this.insertMessageEvent(client, {
        organizationId: execution.organization_id,
        spaceId: execution.space_id,
        sessionId: execution.session_id,
        messageId,
        commandId: execution.command_id,
        actorId: execution.lease_owner,
        requestId: execution.request_id,
        sequence: firstSequence,
        occurredAt: completedAt,
      })
      await this.insertAttemptEvent(client, {
        organizationId: execution.organization_id,
        spaceId: execution.space_id,
        sessionId: execution.session_id,
        turnId: execution.turn_id,
        commandId: execution.command_id,
        attemptId: execution.attempt_id,
        attemptNumber: execution.attempt_number,
        actorId: execution.lease_owner,
        actorKind: 'worker',
        requestId: execution.request_id,
        sequence: firstSequence + 1,
        status: 'succeeded',
        failureCode: null,
        occurredAt: completedAt,
      })
      await this.insertSessionUpdatedEvent(client, {
        organizationId: execution.organization_id,
        spaceId: execution.space_id,
        sessionId: execution.session_id,
        commandId: execution.command_id,
        actorId: execution.lease_owner,
        actorKind: 'worker',
        requestId: execution.request_id,
        sequence: firstSequence + 2,
        status: session.rows[0].status,
        version: session.rows[0].version,
        occurredAt: completedAt,
      })
      return true
    })
  }

  async fail(input: FailExecutionInput): Promise<FailExecutionResult> {
    this.validateClaim(input.claim)
    if (input.providerModel !== undefined) requireProviderModel(input.providerModel)
    if (input.classification !== 'transient' && input.classification !== 'terminal') {
      throw new Error('Failure classification must be transient or terminal.')
    }
    const retryDelayMs = input.retryDelayMs ?? 1_000
    requireDuration(retryDelayMs, 'Retry delay', MAX_RETRY_DELAY_MS)
    const now = executionNow(input.now)
    const failureCode = sanitizeFailureCode(input.code)
    const failureMessage = sanitizeFailureMessage(input.message)

    return this.transaction(async (client) => {
      const locked = await client.query<LockedExecutionRow>(`
        SELECT
          command_record.organization_id,
          command_record.space_id,
          command_record.session_id,
          turn_record.id AS turn_id,
          command_record.id AS command_id,
          attempt.id AS attempt_id,
          attempt.number AS attempt_number,
          command_record.lease_owner,
          command_record.request_id,
          command_record.max_attempts
        FROM relay_commands command_record
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        JOIN relay_attempts attempt
          ON attempt.organization_id = turn_record.organization_id
          AND attempt.space_id = turn_record.space_id
          AND attempt.session_id = turn_record.session_id
          AND attempt.turn_id = turn_record.id
          AND attempt.id = $6
        WHERE command_record.organization_id = $1
          AND command_record.space_id = $2
          AND command_record.session_id = $3
          AND command_record.id = $4
          AND command_record.resource_id = $5
          AND command_record.protocol_version = 1
          AND command_record.status = 'running'
          AND command_record.attempts = $7
          AND command_record.lease_owner = $8
          AND command_record.lease_expires_at
            > COALESCE($9::timestamptz, clock_timestamp())
          AND attempt.number = $7
          AND attempt.runtime_id = $8
          AND attempt.status = 'running'
          AND turn_record.status = 'running'
          AND session_record.status = 'active'
        FOR UPDATE OF command_record, session_record, turn_record, attempt
      `, [
        input.claim.organizationId,
        input.claim.spaceId,
        input.claim.sessionId,
        input.claim.commandId,
        input.claim.turnId,
        input.claim.attemptId,
        input.claim.attemptNumber,
        input.claim.leaseOwner,
        now,
      ])
      const execution = locked.rows[0]
      if (!execution) return 'stale'
      if (!await this.hasWritePermission(client, execution)) {
        const canceled = await this.cancelRunningExecution(client, execution, {
          actorId: execution.lease_owner,
          actorKind: 'worker',
          now,
          leaseState: 'unexpired',
          providerModel: input.providerModel ?? null,
        })
        return canceled ? 'canceled' : 'stale'
      }
      const canRetry = input.classification === 'transient'
        && execution.attempt_number < execution.max_attempts
      const outcome = await this.finishFailure(client, execution, {
        retry: canRetry,
        retryDelayMs,
        failureCode,
        failureMessage,
        providerModel: input.providerModel ?? null,
        actorId: execution.lease_owner,
        actorKind: 'worker',
        now,
        leaseState: 'unexpired',
      })
      return outcome ?? 'stale'
    })
  }

  async reapExpired(options: ReapExpiredExecutionsOptions = {}): Promise<ReapExpiredExecutionsResult> {
    const limit = options.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Reap limit must be an integer between 1 and 1000.')
    }
    const retryDelayMs = options.retryDelayMs ?? 1_000
    requireDuration(retryDelayMs, 'Retry delay', MAX_RETRY_DELAY_MS)
    const now = executionNow(options.now)

    return this.transaction(async (client) => {
      const expired = await client.query<LockedExecutionRow>(`
        SELECT
          command_record.organization_id,
          command_record.space_id,
          command_record.session_id,
          turn_record.id AS turn_id,
          command_record.id AS command_id,
          attempt.id AS attempt_id,
          attempt.number AS attempt_number,
          command_record.lease_owner,
          command_record.request_id,
          command_record.max_attempts
        FROM relay_commands command_record
        JOIN relay_turns turn_record
          ON turn_record.organization_id = command_record.organization_id
          AND turn_record.space_id = command_record.space_id
          AND turn_record.session_id = command_record.session_id
          AND turn_record.id = command_record.resource_id
        JOIN relay_sessions session_record
          ON session_record.organization_id = command_record.organization_id
          AND session_record.space_id = command_record.space_id
          AND session_record.id = command_record.session_id
        JOIN relay_attempts attempt
          ON attempt.organization_id = turn_record.organization_id
          AND attempt.space_id = turn_record.space_id
          AND attempt.session_id = turn_record.session_id
          AND attempt.turn_id = turn_record.id
          AND attempt.number = command_record.attempts
          AND attempt.runtime_id = command_record.lease_owner
        WHERE command_record.protocol_version = 1
          AND command_record.status = 'running'
          AND command_record.lease_expires_at
            <= COALESCE($1::timestamptz, clock_timestamp())
          AND attempt.status = 'running'
          AND turn_record.status = 'running'
          AND session_record.status = 'active'
        ORDER BY command_record.lease_expires_at, command_record.id
        LIMIT $2
        FOR UPDATE OF command_record, session_record, turn_record, attempt SKIP LOCKED
      `, [now, limit])
      const result = { requeued: 0, failed: 0, canceled: 0 }
      for (const execution of expired.rows) {
        if (!await this.hasWritePermission(client, execution)) {
          const canceled = await this.cancelRunningExecution(client, execution, {
            actorId: 'system:lease-reaper',
            actorKind: 'system',
            now,
            leaseState: 'expired',
            providerModel: null,
          })
          if (canceled) result.canceled += 1
          continue
        }
        const outcome = await this.finishFailure(client, execution, {
          retry: execution.attempt_number < execution.max_attempts,
          retryDelayMs,
          failureCode: 'lease_expired',
          failureMessage: 'Execution lease expired before completion.',
          providerModel: null,
          actorId: 'system:lease-reaper',
          actorKind: 'system',
          now,
          leaseState: 'expired',
        })
        if (outcome) result[outcome] += 1
      }
      return result
    })
  }

  private async cancelUnauthorizedQueuedExecutions(client: PoolClient, now: string | null) {
    const unauthorized = await client.query<QueuedExecutionRow>(`
      SELECT
        command_record.organization_id,
        command_record.space_id,
        command_record.session_id,
        turn_record.id AS turn_id,
        command_record.id AS command_id,
        command_record.request_id,
        command_record.attempts
      FROM relay_commands command_record
      JOIN relay_sessions session_record
        ON session_record.organization_id = command_record.organization_id
        AND session_record.space_id = command_record.space_id
        AND session_record.id = command_record.session_id
      JOIN relay_turns turn_record
        ON turn_record.organization_id = command_record.organization_id
        AND turn_record.space_id = command_record.space_id
        AND turn_record.session_id = command_record.session_id
        AND turn_record.id = command_record.resource_id
      WHERE command_record.protocol_version = 1
        AND command_record.status IN ('accepted', 'queued')
        AND command_record.lease_owner IS NULL
        AND command_record.lease_expires_at IS NULL
        AND session_record.status = 'queued'
        AND turn_record.status = 'queued'
        AND NOT EXISTS (
          SELECT 1
          FROM relay_organization_memberships organization_membership
          JOIN relay_space_memberships space_membership
            ON space_membership.organization_id = organization_membership.organization_id
            AND space_membership.actor_id = organization_membership.actor_id
          WHERE organization_membership.organization_id = command_record.organization_id
            AND organization_membership.actor_id = command_record.requested_by
            AND organization_membership.role <> 'viewer'
            AND space_membership.space_id = command_record.space_id
            AND space_membership.role <> 'viewer'
        )
      ORDER BY command_record.accepted_at, command_record.id
      LIMIT 100
      FOR UPDATE OF command_record, session_record, turn_record SKIP LOCKED
    `)

    for (const execution of unauthorized.rows) {
      const command = await client.query<TransitionedCommandRow>(`
        WITH execution_time AS (
          SELECT COALESCE($6::timestamptz, clock_timestamp()) AS transitioned_at
        )
        UPDATE relay_commands
        SET status = 'canceled',
            completed_at = GREATEST(
              COALESCE(heartbeat_at, started_at, queued_at, accepted_at),
              execution_time.transitioned_at
            ),
            lease_owner = NULL,
            lease_expires_at = NULL,
            failure_code = NULL,
            failure_message = NULL
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status IN ('accepted', 'queued') AND attempts = $5
        RETURNING execution_time.transitioned_at
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.command_id,
        execution.attempts,
        now,
      ])
      const transitionedAt = command.rows[0]?.transitioned_at
      if (!transitionedAt) throw new Error('Unauthorized execution Command could not be canceled.')
      const canceledAt = timestamp(transitionedAt)
      const turn = await client.query(`
        UPDATE relay_turns
        SET status = 'canceled',
            completed_at = GREATEST(
              COALESCE(heartbeat_at, started_at, queued_at),
              $5::timestamptz
            ),
            failure_code = NULL,
            failure_message = NULL,
            version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'queued'
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.turn_id,
        canceledAt,
      ])
      if (turn.rowCount !== 1) throw new Error('Unauthorized execution Turn could not be canceled.')
      const session = await client.query<{ event_sequence: string; version: number }>(`
        UPDATE relay_sessions
        SET status = 'canceled', updated_at = $4, last_activity_at = $4,
            version = version + 1,
            last_event_sequence = last_event_sequence + 1
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status = 'queued'
        RETURNING last_event_sequence AS event_sequence, version
      `, [execution.organization_id, execution.space_id, execution.session_id, canceledAt])
      if (session.rowCount !== 1) throw new Error('Unauthorized execution Session could not be canceled.')
      const sequence = Number(session.rows[0]?.event_sequence)
      if (!Number.isSafeInteger(sequence)) {
        throw new Error('Unauthorized execution Session event sequence could not be reserved.')
      }
      await this.insertSessionUpdatedEvent(client, {
        organizationId: execution.organization_id,
        spaceId: execution.space_id,
        sessionId: execution.session_id,
        commandId: execution.command_id,
        actorId: 'system:authorization-recheck',
        actorKind: 'system',
        requestId: execution.request_id,
        sequence,
        status: 'canceled',
        version: session.rows[0].version,
        occurredAt: canceledAt,
      })
    }
  }

  private async hasWritePermission(client: PoolClient, execution: LockedExecutionRow) {
    const authorization = await client.query(`
      SELECT 1
      FROM relay_commands command_record
      JOIN relay_organization_memberships organization_membership
        ON organization_membership.organization_id = command_record.organization_id
        AND organization_membership.actor_id = command_record.requested_by
      JOIN relay_space_memberships space_membership
        ON space_membership.organization_id = command_record.organization_id
        AND space_membership.space_id = command_record.space_id
        AND space_membership.actor_id = command_record.requested_by
      WHERE command_record.organization_id = $1
        AND command_record.space_id = $2
        AND command_record.session_id = $3
        AND command_record.id = $4
        AND organization_membership.role <> 'viewer'
        AND space_membership.role <> 'viewer'
      FOR SHARE OF organization_membership, space_membership
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      execution.command_id,
    ])
    return authorization.rowCount === 1
  }

  private async cancelRunningExecution(
    client: PoolClient,
    execution: LockedExecutionRow,
    cancellation: {
      actorId: string
      actorKind: 'worker' | 'system'
      now: string | null
      leaseState: 'unexpired' | 'expired'
      providerModel: string | null
    },
  ) {
    const leaseComparator = cancellation.leaseState === 'expired' ? '<=' : '>'
    const command = await client.query<TransitionedCommandRow>(`
      WITH execution_time AS (
        SELECT COALESCE($7::timestamptz, clock_timestamp()) AS transitioned_at
      )
      UPDATE relay_commands
      SET status = 'canceled',
          heartbeat_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
          completed_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
          lease_owner = NULL,
          lease_expires_at = NULL,
          failure_code = NULL,
          failure_message = NULL
      FROM execution_time
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        AND status = 'running' AND attempts = $5 AND lease_owner = $6
        AND lease_expires_at ${leaseComparator} execution_time.transitioned_at
      RETURNING execution_time.transitioned_at
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      execution.command_id,
      execution.attempt_number,
      execution.lease_owner,
      cancellation.now,
    ])
    const transitionedAt = command.rows[0]?.transitioned_at
    if (!transitionedAt) return false
    const canceledAt = timestamp(transitionedAt)
    const attempt = await client.query(`
      UPDATE relay_attempts
      SET status = 'canceled',
          heartbeat_at = GREATEST(heartbeat_at, $7::timestamptz),
          completed_at = GREATEST(heartbeat_at, $7::timestamptz),
          failure_code = NULL,
          failure_message = NULL,
          provider_model = $8
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND turn_id = $4 AND id = $5 AND number = $6 AND status = 'running'
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      execution.turn_id,
      execution.attempt_id,
      execution.attempt_number,
      canceledAt,
      cancellation.providerModel,
    ])
    if (attempt.rowCount !== 1) throw new Error('Revoked execution Attempt could not be canceled.')
    const turn = await client.query(`
      UPDATE relay_turns
      SET status = 'canceled',
          heartbeat_at = GREATEST(heartbeat_at, $5::timestamptz),
          completed_at = GREATEST(heartbeat_at, $5::timestamptz),
          failure_code = NULL,
          failure_message = NULL,
          version = version + 1
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
        AND status = 'running'
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      execution.turn_id,
      canceledAt,
    ])
    if (turn.rowCount !== 1) throw new Error('Revoked execution Turn could not be canceled.')
    const session = await client.query<{ first_sequence: string; version: number }>(`
      UPDATE relay_sessions
      SET status = 'canceled', updated_at = $4, last_activity_at = $4,
          version = version + 1, last_event_sequence = last_event_sequence + 2
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
        AND status = 'active'
      RETURNING last_event_sequence - 1 AS first_sequence, version
    `, [execution.organization_id, execution.space_id, execution.session_id, canceledAt])
    const canceledSession = session.rows[0]
    const firstSequence = Number(canceledSession?.first_sequence)
    if (!canceledSession || !Number.isSafeInteger(firstSequence)) {
      throw new Error('Execution cancellation event sequence could not be reserved.')
    }
    await this.insertAttemptEvent(client, {
      organizationId: execution.organization_id,
      spaceId: execution.space_id,
      sessionId: execution.session_id,
      turnId: execution.turn_id,
      commandId: execution.command_id,
      attemptId: execution.attempt_id,
      attemptNumber: execution.attempt_number,
      actorId: cancellation.actorId,
      actorKind: cancellation.actorKind,
      requestId: execution.request_id,
      sequence: firstSequence,
      status: 'canceled',
      failureCode: null,
      occurredAt: canceledAt,
    })
    await this.insertSessionUpdatedEvent(client, {
      organizationId: execution.organization_id,
      spaceId: execution.space_id,
      sessionId: execution.session_id,
      commandId: execution.command_id,
      actorId: cancellation.actorId,
      actorKind: cancellation.actorKind,
      requestId: execution.request_id,
      sequence: firstSequence + 1,
      status: 'canceled',
      version: canceledSession.version,
      occurredAt: canceledAt,
    })
    return true
  }

  private validateClaim(claim: ExecutionClaim) {
    requireIdentifier(claim.organizationId, 'Organization id')
    requireIdentifier(claim.spaceId, 'Space id')
    requireIdentifier(claim.sessionId, 'Session id')
    requireIdentifier(claim.turnId, 'Turn id')
    requireIdentifier(claim.commandId, 'Command id')
    requireIdentifier(claim.attemptId, 'Attempt id')
    requireIdentifier(claim.leaseOwner, 'Lease owner')
    if (!Number.isSafeInteger(claim.attemptNumber) || claim.attemptNumber < 1) {
      throw new Error('Attempt number must be a positive integer.')
    }
  }

  private async finishFailure(
    client: PoolClient,
    execution: LockedExecutionRow,
    failure: {
      retry: boolean
      retryDelayMs: number
      failureCode: string
      failureMessage: string
      providerModel: string | null
      actorId: string
      actorKind: 'worker' | 'system'
      now: string | null
      leaseState: 'unexpired' | 'expired'
    },
  ): Promise<'requeued' | 'failed' | null> {
    const leaseComparator = failure.leaseState === 'expired' ? '<=' : '>'
    let command: { rows: TransitionedCommandRow[] }
    if (failure.retry) {
      command = await client.query<TransitionedCommandRow>(`
        WITH execution_time AS (
          SELECT COALESCE($7::timestamptz, clock_timestamp()) AS transitioned_at
        )
        UPDATE relay_commands
        SET status = 'queued',
            available_at = execution_time.transitioned_at
              + ($8::double precision * interval '1 millisecond'),
            started_at = NULL,
            heartbeat_at = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = NULL,
            failure_code = NULL,
            failure_message = NULL
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running' AND attempts = $5 AND lease_owner = $6
          AND lease_expires_at ${leaseComparator} execution_time.transitioned_at
        RETURNING execution_time.transitioned_at
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.command_id,
        execution.attempt_number,
        execution.lease_owner,
        failure.now,
        failure.retryDelayMs,
      ])
    } else {
      command = await client.query<TransitionedCommandRow>(`
        WITH execution_time AS (
          SELECT COALESCE($9::timestamptz, clock_timestamp()) AS transitioned_at
        )
        UPDATE relay_commands
        SET status = 'failed',
            heartbeat_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
            completed_at = GREATEST(relay_commands.heartbeat_at, execution_time.transitioned_at),
            lease_owner = NULL,
            lease_expires_at = NULL,
            failure_code = $7,
            failure_message = $8
        FROM execution_time
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running' AND attempts = $5 AND lease_owner = $6
          AND lease_expires_at ${leaseComparator} execution_time.transitioned_at
        RETURNING execution_time.transitioned_at
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.command_id,
        execution.attempt_number,
        execution.lease_owner,
        failure.failureCode,
        failure.failureMessage,
        failure.now,
      ])
    }
    const transitionedAt = command.rows[0]?.transitioned_at
    if (!transitionedAt) return null
    const failedAt = timestamp(transitionedAt)

    const attempt = await client.query(`
      UPDATE relay_attempts
      SET status = 'failed',
          heartbeat_at = GREATEST(heartbeat_at, $9::timestamptz),
          completed_at = GREATEST(heartbeat_at, $9::timestamptz),
          failure_code = $7,
          failure_message = $8,
          provider_model = $10
      WHERE organization_id = $1 AND space_id = $2 AND session_id = $3
        AND turn_id = $4 AND id = $5 AND number = $6 AND status = 'running'
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      execution.turn_id,
      execution.attempt_id,
      execution.attempt_number,
      failure.failureCode,
      failure.failureMessage,
      failedAt,
      failure.providerModel,
    ])
    if (attempt.rowCount !== 1) throw new Error('Locked execution Attempt could not be failed.')

    if (failure.retry) {
      const turn = await client.query(`
        UPDATE relay_turns
        SET status = 'queued',
            completed_at = NULL,
            failure_code = NULL,
            failure_message = NULL,
            version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running'
      `, [execution.organization_id, execution.space_id, execution.session_id, execution.turn_id])
      if (turn.rowCount !== 1) throw new Error('Locked execution Turn could not be requeued.')
    } else {
      const turn = await client.query(`
        UPDATE relay_turns
        SET status = 'failed',
            heartbeat_at = GREATEST(heartbeat_at, $7::timestamptz),
            completed_at = GREATEST(heartbeat_at, $7::timestamptz),
            failure_code = $5,
            failure_message = $6,
            version = version + 1
        WHERE organization_id = $1 AND space_id = $2 AND session_id = $3 AND id = $4
          AND status = 'running'
      `, [
        execution.organization_id,
        execution.space_id,
        execution.session_id,
        execution.turn_id,
        failure.failureCode,
        failure.failureMessage,
        failedAt,
      ])
      if (turn.rowCount !== 1) throw new Error('Locked execution Turn could not be failed.')
    }

    const session = await client.query<{
      first_sequence: string
      status: 'queued' | 'failed'
      version: number
    }>(`
      UPDATE relay_sessions
      SET status = CASE
            WHEN $4::boolean THEN 'queued'
            WHEN EXISTS (
              SELECT 1 FROM relay_turns queued_turn
              WHERE queued_turn.organization_id = relay_sessions.organization_id
                AND queued_turn.space_id = relay_sessions.space_id
                AND queued_turn.session_id = relay_sessions.id
                AND queued_turn.status = 'queued'
            ) THEN 'queued'
            ELSE 'failed'
          END,
          updated_at = $5,
          last_activity_at = $5,
          version = version + 1,
          last_event_sequence = last_event_sequence + 2
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
        AND status = 'active'
      RETURNING last_event_sequence - 1 AS first_sequence, status, version
    `, [
      execution.organization_id,
      execution.space_id,
      execution.session_id,
      failure.retry,
      failedAt,
    ])
    const transitionedSession = session.rows[0]
    const firstSequence = Number(transitionedSession?.first_sequence)
    if (!transitionedSession || !Number.isSafeInteger(firstSequence)) {
      throw new Error('Execution failure event sequence could not be reserved.')
    }
    await this.insertAttemptEvent(client, {
      organizationId: execution.organization_id,
      spaceId: execution.space_id,
      sessionId: execution.session_id,
      turnId: execution.turn_id,
      commandId: execution.command_id,
      attemptId: execution.attempt_id,
      attemptNumber: execution.attempt_number,
      actorId: failure.actorId,
      actorKind: failure.actorKind,
      requestId: execution.request_id,
      sequence: firstSequence,
      status: 'failed',
      failureCode: failure.failureCode,
      occurredAt: failedAt,
    })
    await this.insertSessionUpdatedEvent(client, {
      organizationId: execution.organization_id,
      spaceId: execution.space_id,
      sessionId: execution.session_id,
      commandId: execution.command_id,
      actorId: failure.actorId,
      actorKind: failure.actorKind,
      requestId: execution.request_id,
      sequence: firstSequence + 1,
      status: transitionedSession.status,
      version: transitionedSession.version,
      occurredAt: failedAt,
    })
    return failure.retry ? 'requeued' : 'failed'
  }

  private async insertMessageEvent(
    client: PoolClient,
    event: {
      organizationId: string
      spaceId: string
      sessionId: string
      messageId: string
      commandId: string
      actorId: string
      requestId: string
      sequence: number
      occurredAt: string
    },
  ) {
    const inserted = await client.query(`
      INSERT INTO relay_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id, actor_kind,
        message_id, turn_id, attempt_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'message.created', 'message', $6, $7::jsonb,
        $8, 'worker', $6, NULL, NULL, $9, $10, $11
      )
    `, [
      event.organizationId,
      event.spaceId,
      event.sessionId,
      this.createId(),
      event.sequence,
      event.messageId,
      JSON.stringify({ messageId: event.messageId }),
      event.actorId,
      event.commandId,
      event.requestId,
      event.occurredAt,
    ])
    if (inserted.rowCount !== 1) throw new Error('Message event could not be inserted.')
  }

  private async insertSessionUpdatedEvent(
    client: PoolClient,
    event: {
      organizationId: string
      spaceId: string
      sessionId: string
      commandId: string
      actorId: string
      actorKind: 'worker' | 'system'
      requestId: string
      sequence: number
      status: 'queued' | 'active' | 'completed' | 'failed' | 'canceled'
      version: number
      occurredAt: string
    },
  ) {
    const inserted = await client.query(`
      INSERT INTO relay_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id, actor_kind,
        message_id, turn_id, attempt_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'session.updated', 'session', $3, $6::jsonb,
        $7, $8, NULL, NULL, NULL, $9, $10, $11
      )
    `, [
      event.organizationId,
      event.spaceId,
      event.sessionId,
      this.createId(),
      event.sequence,
      JSON.stringify({ status: event.status, version: event.version }),
      event.actorId,
      event.actorKind,
      event.commandId,
      event.requestId,
      event.occurredAt,
    ])
    if (inserted.rowCount !== 1) throw new Error('Session event could not be inserted.')
  }

  private async insertAttemptEvent(
    client: PoolClient,
    event: {
      organizationId: string
      spaceId: string
      sessionId: string
      turnId: string
      commandId: string
      attemptId: string
      attemptNumber: number
      actorId: string
      actorKind: 'worker' | 'system'
      requestId: string
      sequence: number
      status: 'running' | 'succeeded' | 'failed' | 'canceled'
      failureCode: string | null
      occurredAt: string
    },
  ) {
    const inserted = await client.query(`
      INSERT INTO relay_session_events (
        organization_id, space_id, session_id, event_id, sequence,
        event_type, resource_type, resource_id, payload, actor_id, actor_kind,
        message_id, turn_id, attempt_id, command_id, request_id, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'attempt.updated', 'attempt', $6, $7::jsonb,
        $8, $9, NULL, $10, $6, $11, $12, $13
      )
    `, [
      event.organizationId,
      event.spaceId,
      event.sessionId,
      this.createId(),
      event.sequence,
      event.attemptId,
      JSON.stringify({
        attemptId: event.attemptId,
        turnId: event.turnId,
        number: event.attemptNumber,
        status: event.status,
        failureCode: event.failureCode,
      }),
      event.actorId,
      event.actorKind,
      event.turnId,
      event.commandId,
      event.requestId,
      event.occurredAt,
    ])
    if (inserted.rowCount !== 1) throw new Error('Attempt event could not be inserted.')
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
