import type { SessionEventPage, SessionMessagePage } from '@relay/contracts'

export type SessionTimelineListOptions = Readonly<{
  afterSequence?: number
  limit?: number
}>

export interface SessionTimelineRepository {
  listMessages(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options?: SessionTimelineListOptions,
  ): Promise<SessionMessagePage | null>
  listEvents(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options?: SessionTimelineListOptions,
  ): Promise<SessionEventPage | null>
}

export class SessionTimelineProjectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SessionTimelineProjectionError'
  }
}

export class SessionTimelineCursorAheadError extends Error {
  constructor() {
    super('The Session event cursor is ahead of the current event sequence.')
    this.name = 'SessionTimelineCursorAheadError'
  }
}
