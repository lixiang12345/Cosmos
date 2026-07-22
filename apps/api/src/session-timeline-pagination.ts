import { SessionEventCursorSchema, type SessionEventCursor } from '@cosmos/contracts'

const MAX_CURSOR_LENGTH = 2_048

export class InvalidSessionTimelinePaginationError extends Error {
  constructor(
    readonly field: 'cursor' | 'limit' | 'last-event-id',
    options?: ErrorOptions,
  ) {
    super(`The Session timeline ${field} is invalid.`, options)
    this.name = 'InvalidSessionTimelinePaginationError'
  }
}

export type SessionTimelineQuery = {
  cursor?: string
  limit?: string
}

function parseLimit(value: string | undefined, maximum: number) {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new InvalidSessionTimelinePaginationError('limit')
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new InvalidSessionTimelinePaginationError('limit')
  }
  return limit
}

export function encodeSessionTimelineCursor(cursor: SessionEventCursor) {
  return Buffer.from(JSON.stringify(SessionEventCursorSchema.parse(cursor)), 'utf8').toString('base64url')
}

export function parseSessionTimelineCursor(
  value: string | undefined,
  scope: Omit<SessionEventCursor, 'sequence'>,
  field: 'cursor' | 'last-event-id' = 'cursor',
) {
  if (value === undefined) return 0
  try {
    if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('invalid encoding')
    }
    const cursor = SessionEventCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    )
    if (
      cursor.organizationId !== scope.organizationId
      || cursor.spaceId !== scope.spaceId
      || cursor.sessionId !== scope.sessionId
    ) {
      throw new Error('cursor scope mismatch')
    }
    return cursor.sequence
  } catch (error) {
    throw new InvalidSessionTimelinePaginationError(field, { cause: error })
  }
}

export function parseSessionTimelinePagination(
  query: SessionTimelineQuery,
  scope: Omit<SessionEventCursor, 'sequence'>,
  maximumLimit: number,
) {
  return {
    afterSequence: parseSessionTimelineCursor(query.cursor, scope),
    limit: parseLimit(query.limit, maximumLimit),
  }
}
