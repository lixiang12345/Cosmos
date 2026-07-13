import type { SessionWorkerDto, SessionWorkerStatus } from '@relay/contracts'

export type SessionWorkerListCursor = {
  createdAt: string
  id: string
}

export type SessionWorkerListOptions = {
  limit: number
  cursor?: SessionWorkerListCursor
}

export type SessionWorkerListPage = {
  items: SessionWorkerDto[]
  hasMore: boolean
  nextCursor: SessionWorkerListCursor | null
}

export interface SessionWorkerRepository {
  list(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: SessionWorkerListOptions,
  ): Promise<SessionWorkerListPage | null>
}

export class EmptySessionWorkerRepository implements SessionWorkerRepository {
  async list(): Promise<null> {
    return null
  }
}

export type CreateSessionWorkerRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  parentTurnId: string
  parentWorkerId?: string
  expertRevisionId?: string
  name: string
  instructions: string
  runtimeWorkerId: string
}

export type TransitionSessionWorkerRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  workerId: string
  runtimeWorkerId: string
  expectedVersion: number
  status: Exclude<SessionWorkerStatus, 'queued'>
  resultSummary?: string
}

export interface SessionWorkerWriterRepository {
  create(record: CreateSessionWorkerRecord): Promise<SessionWorkerDto>
  transition(record: TransitionSessionWorkerRecord): Promise<SessionWorkerDto | null>
}

export class SessionWorkerConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionWorkerConflictError'
  }
}

export class SessionWorkerVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`Session Worker version ${expectedVersion} does not match current version ${currentVersion}.`)
    this.name = 'SessionWorkerVersionConflictError'
  }
}
