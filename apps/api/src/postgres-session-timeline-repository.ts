import {
  SessionEventDtoSchema,
  SessionEventPageSchema,
  SessionMessageDtoSchema,
  SessionMessagePageSchema,
  type SessionEventDto,
  type SessionEventPage,
  type SessionMessageDto,
  type SessionMessagePage,
} from '@relay/contracts'
import type { Pool } from 'pg'
import { queryWithApiDatabaseContext } from './postgres-runtime-database.js'
import {
  SessionTimelineCursorAheadError,
  SessionTimelineProjectionError,
  type SessionTimelineListOptions,
  type SessionTimelineRepository,
} from './session-timeline-repository.js'

type TimestampValue = Date | string

type MessageRow = {
  id: string | null
  organization_id: string | null
  space_id: string | null
  session_id: string | null
  sequence: string | null
  role: string | null
  actor_id: string | null
  content: string | null
  attachments: unknown
  created_at: TimestampValue | null
}

type EventRow = {
  current_sequence: string
  organization_id: string | null
  space_id: string | null
  session_id: string | null
  event_id: string | null
  sequence: string | null
  event_type: string | null
  resource_type: string | null
  resource_id: string | null
  actor_id: string | null
  command_id: string | null
  request_id: string | null
  occurred_at: TimestampValue | null
  message_id: string | null
  turn_id: string | null
  attempt_id: string | null
  artifact_id: string | null
  session_status: string | null
  session_visibility: string | null
  session_version: string | null
  session_title: string | null
  session_archived_at: string | null
  attempt_number: string | null
  attempt_status: string | null
  attempt_failure_code: string | null
  artifact_type: string | null
  artifact_label: string | null
  artifact_status: string | null
  artifact_version: string | null
  artifact_removed_at: string | null
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function timestamp(value: TimestampValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function safeInteger(value: unknown, field: string, minimum: number) {
  let parsed: bigint
  try {
    if (typeof value === 'bigint') parsed = value
    else if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value)
    else if (typeof value === 'string' && /^\d+$/.test(value)) parsed = BigInt(value)
    else throw new Error('invalid integer')
  } catch (error) {
    throw new SessionTimelineProjectionError(`${field} is not a safe integer.`, { cause: error })
  }
  if (parsed < BigInt(minimum) || parsed > MAX_SAFE_BIGINT) {
    throw new SessionTimelineProjectionError(`${field} is outside the safe integer range.`)
  }
  return Number(parsed)
}

function queryOptions(options: SessionTimelineListOptions, maximumLimit: number) {
  const afterSequence = options.afterSequence ?? 0
  const limit = options.limit ?? Math.min(100, maximumLimit)
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new RangeError('afterSequence must be a nonnegative safe integer.')
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new RangeError(`limit must be an integer between 1 and ${maximumLimit}.`)
  }
  return { afterSequence, limit }
}

function mapMessage(row: MessageRow): SessionMessageDto {
  return SessionMessageDtoSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    sequence: safeInteger(row.sequence, 'Message sequence', 1),
    role: row.role,
    actorId: row.actor_id,
    content: row.content,
    attachments: row.attachments,
    createdAt: row.created_at === null ? null : timestamp(row.created_at),
  })
}

function eventBase(row: EventRow) {
  return {
    organizationId: row.organization_id,
    spaceId: row.space_id,
    sessionId: row.session_id,
    eventId: row.event_id,
    sequence: safeInteger(row.sequence, 'Event sequence', 1),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actorId: row.actor_id,
    commandId: row.command_id,
    requestId: row.request_id,
    occurredAt: row.occurred_at === null ? null : timestamp(row.occurred_at),
  }
}

function mapEvent(row: EventRow): SessionEventDto {
  const base = eventBase(row)
  let projected: unknown
  switch (row.event_type) {
    case 'session.created':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          status: row.session_status,
          visibility: row.session_visibility,
          version: safeInteger(row.session_version, 'Session event version', 1),
        },
      }
      break
    case 'session.updated':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          status: row.session_status,
          version: safeInteger(row.session_version, 'Session event version', 1),
        },
      }
      break
    case 'session.renamed':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          title: row.session_title,
          version: safeInteger(row.session_version, 'Session event version', 1),
        },
      }
      break
    case 'session.archived':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          archivedAt: row.session_archived_at,
          version: safeInteger(row.session_version, 'Session event version', 1),
        },
      }
      break
    case 'session.restored':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          archivedAt: null,
          version: safeInteger(row.session_version, 'Session event version', 1),
        },
      }
      break
    case 'message.created':
      projected = {
        ...base,
        type: row.event_type,
        payload: { messageId: row.message_id },
      }
      break
    case 'turn.queued':
      projected = {
        ...base,
        type: row.event_type,
        payload: { turnId: row.turn_id, status: 'queued' },
      }
      break
    case 'attempt.updated':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          attemptId: row.attempt_id,
          turnId: row.turn_id,
          number: safeInteger(row.attempt_number, 'Attempt event number', 1),
          status: row.attempt_status,
          failureCode: row.attempt_failure_code,
        },
      }
      break
    case 'artifact.created':
    case 'artifact.updated':
    case 'artifact.removed':
      projected = {
        ...base,
        type: row.event_type,
        payload: {
          artifactId: row.artifact_id,
          type: row.artifact_type,
          label: row.artifact_label,
          status: row.artifact_status,
          version: safeInteger(row.artifact_version, 'Artifact event version', 1),
          removedAt: row.artifact_removed_at,
        },
      }
      break
    default:
      throw new SessionTimelineProjectionError('The Session event type is not supported.')
  }
  return SessionEventDtoSchema.parse(projected)
}

function project<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (
      error instanceof SessionTimelineProjectionError
      || error instanceof SessionTimelineCursorAheadError
    ) throw error
    throw new SessionTimelineProjectionError('The Session timeline row is not a valid public projection.', {
      cause: error,
    })
  }
}

export class PostgresSessionTimelineRepository implements SessionTimelineRepository {
  constructor(private readonly pool: Pool) {}

  async listMessages(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: SessionTimelineListOptions = {},
  ): Promise<SessionMessagePage | null> {
    const { afterSequence, limit } = queryOptions(options, 100)
    const result = await queryWithApiDatabaseContext<MessageRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
      WITH access AS (
        SELECT session.id AS session_id
        FROM relay_sessions session
        JOIN relay_organization_memberships organization_membership
          ON organization_membership.organization_id = session.organization_id
          AND organization_membership.actor_id = $4
        JOIN relay_space_memberships space_membership
          ON space_membership.organization_id = session.organization_id
          AND space_membership.space_id = session.space_id
          AND space_membership.actor_id = $4
        WHERE session.organization_id = $1
          AND session.space_id = $2
          AND session.id = $3
          AND (
            session.visibility = 'space'
            OR session.created_by = $4
            OR EXISTS (
              SELECT 1
              FROM relay_session_share_grants share_grant
              WHERE share_grant.organization_id = session.organization_id
                AND share_grant.space_id = session.space_id
                AND share_grant.session_id = session.id
                AND share_grant.revoked_at IS NULL
                AND (share_grant.expires_at IS NULL OR share_grant.expires_at > transaction_timestamp())
                AND (
                  (share_grant.principal_type = 'user' AND share_grant.principal_id = $4)
                  OR (
                    share_grant.principal_type = 'group'
                    AND EXISTS (
                      SELECT 1 FROM relay_group_memberships group_membership
                      WHERE group_membership.organization_id = share_grant.organization_id
                        AND group_membership.group_id = share_grant.principal_id
                        AND group_membership.actor_id = $4
                    )
                  )
                )
            )
          )
      )
      SELECT item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT message.id, message.organization_id, message.space_id,
          message.session_id, message.sequence, message.role, message.actor_id,
          message.content, message.attachments, message.created_at
        FROM relay_messages message
        WHERE message.organization_id = $1
          AND message.space_id = $2
          AND message.session_id = access.session_id
          AND message.sequence > $5::bigint
        ORDER BY message.sequence ASC
        LIMIT $6
      ) item ON true
      ORDER BY item.sequence ASC NULLS LAST
      `,
      [organizationId, spaceId, sessionId, actorId, afterSequence, limit + 1],
    )

    if (result.rows.length === 0) return null

    return project(() => {
      const messageRows = result.rows.filter((row) => row.id !== null)
      const hasMore = messageRows.length > limit
      const items = messageRows.slice(0, limit).map(mapMessage)
      const last = items.at(-1)
      return SessionMessagePageSchema.parse({
        organizationId,
        spaceId,
        sessionId,
        items,
        page: {
          hasMore,
          nextCursor: hasMore && last ? String(last.sequence) : null,
        },
      })
    })
  }

  async listEvents(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: SessionTimelineListOptions = {},
  ): Promise<SessionEventPage | null> {
    const { afterSequence, limit } = queryOptions(options, 500)
    const result = await queryWithApiDatabaseContext<EventRow>(
      this.pool,
      { organizationId, spaceId, actorId },
      `
      WITH access AS (
        SELECT session.id AS session_id, session.last_event_sequence AS current_sequence
        FROM relay_sessions session
        JOIN relay_organization_memberships organization_membership
          ON organization_membership.organization_id = session.organization_id
          AND organization_membership.actor_id = $4
        JOIN relay_space_memberships space_membership
          ON space_membership.organization_id = session.organization_id
          AND space_membership.space_id = session.space_id
          AND space_membership.actor_id = $4
        WHERE session.organization_id = $1
          AND session.space_id = $2
          AND session.id = $3
          AND (
            session.visibility = 'space'
            OR session.created_by = $4
            OR EXISTS (
              SELECT 1
              FROM relay_session_share_grants share_grant
              WHERE share_grant.organization_id = session.organization_id
                AND share_grant.space_id = session.space_id
                AND share_grant.session_id = session.id
                AND share_grant.revoked_at IS NULL
                AND (share_grant.expires_at IS NULL OR share_grant.expires_at > transaction_timestamp())
                AND (
                  (share_grant.principal_type = 'user' AND share_grant.principal_id = $4)
                  OR (
                    share_grant.principal_type = 'group'
                    AND EXISTS (
                      SELECT 1 FROM relay_group_memberships group_membership
                      WHERE group_membership.organization_id = share_grant.organization_id
                        AND group_membership.group_id = share_grant.principal_id
                        AND group_membership.actor_id = $4
                    )
                  )
                )
            )
          )
      )
      SELECT access.current_sequence, item.*
      FROM access
      LEFT JOIN LATERAL (
        SELECT event.organization_id, event.space_id, event.session_id,
          event.event_id, event.sequence, event.event_type, event.resource_type,
          event.resource_id, event.actor_id, event.command_id, event.request_id,
          event.occurred_at, event.message_id, event.turn_id, event.attempt_id,
          event.artifact_id,
          CASE WHEN event.event_type IN (
            'session.created', 'session.updated', 'session.renamed',
            'session.archived', 'session.restored'
          )
            THEN event.payload->>'status' END AS session_status,
          CASE WHEN event.event_type = 'session.created' THEN event.payload->>'visibility' END AS session_visibility,
          CASE WHEN event.event_type IN (
            'session.created', 'session.updated', 'session.renamed',
            'session.archived', 'session.restored'
          )
            THEN event.payload->>'version' END AS session_version,
          CASE WHEN event.event_type = 'session.renamed'
            THEN event.payload->>'title' END AS session_title,
          CASE WHEN event.event_type = 'session.archived'
            THEN event.payload->>'archivedAt' END AS session_archived_at,
          CASE WHEN event.event_type = 'attempt.updated' THEN event.payload->>'number' END AS attempt_number,
          CASE WHEN event.event_type = 'attempt.updated' THEN event.payload->>'status' END AS attempt_status,
          CASE WHEN event.event_type = 'attempt.updated' THEN event.payload->>'failureCode' END AS attempt_failure_code,
          CASE WHEN event.event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
            THEN event.payload->>'type' END AS artifact_type,
          CASE WHEN event.event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
            THEN event.payload->>'label' END AS artifact_label,
          CASE WHEN event.event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
            THEN event.payload->>'status' END AS artifact_status,
          CASE WHEN event.event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
            THEN event.payload->>'version' END AS artifact_version,
          CASE WHEN event.event_type = 'artifact.removed'
            THEN event.payload->>'removedAt' END AS artifact_removed_at
        FROM relay_session_events event
        WHERE event.organization_id = $1
          AND event.space_id = $2
          AND event.session_id = access.session_id
          AND event.sequence > $5::bigint
        ORDER BY event.sequence ASC
        LIMIT $6
      ) item ON true
      ORDER BY item.sequence ASC NULLS LAST
      `,
      [organizationId, spaceId, sessionId, actorId, afterSequence, limit + 1],
    )

    if (result.rows.length === 0) return null

    return project(() => {
      const currentSequence = safeInteger(
        result.rows[0].current_sequence,
        'Current Session event sequence',
        0,
      )
      if (afterSequence > currentSequence) throw new SessionTimelineCursorAheadError()
      const eventRows = result.rows.filter((row) => row.event_id !== null)
      const hasMore = eventRows.length > limit
      const items = eventRows.slice(0, limit).map(mapEvent)
      const last = items.at(-1)
      return SessionEventPageSchema.parse({
        organizationId,
        spaceId,
        sessionId,
        items,
        page: {
          hasMore,
          nextCursor: hasMore && last
            ? { organizationId, spaceId, sessionId, sequence: last.sequence }
            : null,
        },
      })
    })
  }
}
