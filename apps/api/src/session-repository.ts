import { randomUUID } from 'node:crypto'
import {
  SessionDtoSchema,
  type CreateSessionRequest,
  type SessionDto,
} from '@relay/contracts'

export type CreateSessionRecord = {
  organizationId: string
  spaceId: string
  idempotencyKey: string
  request: CreateSessionRequest
}

export type CreateSessionResult = {
  session: SessionDto
  replayed: boolean
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different request.')
    this.name = 'IdempotencyConflictError'
  }
}

export interface SessionRepository {
  listBySpace(organizationId: string, spaceId: string): Promise<SessionDto[]>
  create(record: CreateSessionRecord): Promise<CreateSessionResult>
}

export type InMemorySessionRepositoryOptions = {
  seed?: SessionDto[]
  createId?: () => string
  now?: () => Date
}

export function createSessionDto(
  record: CreateSessionRecord,
  options: { id?: string; timestamp?: string } = {},
): SessionDto {
  const timestamp = options.timestamp ?? new Date().toISOString()
  return SessionDtoSchema.parse({
    id: options.id ?? randomUUID(),
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    title: record.request.title,
    summary: record.request.message.content,
    expertId: record.request.expertId,
    expertName: record.request.expertName,
    expertVersion: record.request.expertVersion,
    environmentId: record.request.environmentId,
    repository: record.request.repository,
    baseBranch: record.request.baseBranch,
    visibility: record.request.visibility,
    status: record.request.start ? 'active' : 'draft',
    attachments: record.request.message.attachments,
    source: 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    version: 1,
  })
}

function cloneSession(session: SessionDto): SessionDto {
  return { ...session, attachments: [...session.attachments] }
}

function spaceKey(organizationId: string, spaceId: string) {
  return `${organizationId}\u0000${spaceId}`
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessionsBySpace = new Map<string, SessionDto[]>()
  private readonly sessionsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    session: SessionDto
  }>()
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(options: InMemorySessionRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())

    for (const candidate of options.seed ?? []) {
      const session = SessionDtoSchema.parse(candidate)
      const key = spaceKey(session.organizationId, session.spaceId)
      const sessions = this.sessionsBySpace.get(key) ?? []
      sessions.push(cloneSession(session))
      this.sessionsBySpace.set(key, sessions)
    }
  }

  async listBySpace(organizationId: string, spaceId: string): Promise<SessionDto[]> {
    return (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? []).map(cloneSession)
  }

  async create(record: CreateSessionRecord): Promise<CreateSessionResult> {
    const idempotencyScope = `${spaceKey(record.organizationId, record.spaceId)}\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify(record.request)
    const existing = this.sessionsByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return { session: cloneSession(existing.session), replayed: true }
    }

    const session = createSessionDto(record, {
      id: this.createId(),
      timestamp: this.now().toISOString(),
    })

    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    sessions.unshift(session)
    this.sessionsBySpace.set(key, sessions)
    this.sessionsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, session })

    return { session: cloneSession(session), replayed: false }
  }
}
