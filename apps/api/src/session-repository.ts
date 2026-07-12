import { randomUUID } from 'node:crypto'
import {
  SessionDtoSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type SessionCommand,
  type SessionDto,
  type SessionMessage,
  type SessionTurn,
} from '@relay/contracts'

export type CreateSessionRecord = {
  organizationId: string
  spaceId: string
  actorId: string
  idempotencyKey: string
  request: CreateSessionRequest
}

export type CreateSessionResult = {
  session: SessionDto
  message?: SessionMessage
  turn?: SessionTurn
  command?: SessionCommand
  replayed: boolean
}

export type OrganizationRole = 'organization_owner' | 'organization_admin' | 'member' | 'viewer'
export type SpaceRole = 'space_manager' | 'member' | 'viewer'
export type SpaceAccess = {
  organizationRole: OrganizationRole
  spaceRole: SpaceRole
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different request.')
    this.name = 'IdempotencyConflictError'
  }
}

export class AuthorizationChangedError extends Error {
  constructor() {
    super('The actor no longer has permission to create Sessions in this Space.')
    this.name = 'AuthorizationChangedError'
  }
}

export interface SessionRepository {
  getSpaceAccess(organizationId: string, spaceId: string, actorId: string): Promise<SpaceAccess | null>
  listBySpace(organizationId: string, spaceId: string, actorId: string): Promise<SessionDto[]>
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
    status: record.request.start ? 'queued' : 'draft',
    attachments: record.request.message.attachments,
    source: 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    version: 1,
  })
}

export function createSessionStartRecords(
  record: CreateSessionRecord,
  session: SessionDto,
  options: {
    createId?: () => string
  } = {},
): Pick<CreateSessionResponse, 'message' | 'turn' | 'command'> {
  if (!record.request.start) return {}
  const createId = options.createId ?? randomUUID
  const message: SessionMessage = {
    id: createId(),
    sessionId: session.id,
    sequence: 1,
    role: 'user',
    actorId: record.actorId,
    content: record.request.message.content,
    attachments: [...record.request.message.attachments],
    createdAt: session.createdAt,
  }
  const turn: SessionTurn = {
    id: createId(),
    sessionId: session.id,
    ordinal: 1,
    initiatorType: 'user',
    initiatorId: record.actorId,
    inputMessageId: message.id,
    status: 'queued',
    queuedAt: session.createdAt,
    version: 1,
  }
  const command: SessionCommand = {
    id: createId(),
    type: 'session.start',
    status: 'accepted',
    resourceType: 'turn',
    resourceId: turn.id,
    acceptedAt: session.createdAt,
  }
  return { message, turn, command }
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
    result: CreateSessionResult
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

  async getSpaceAccess(): Promise<SpaceAccess> {
    return { organizationRole: 'organization_owner', spaceRole: 'space_manager' }
  }

  async listBySpace(organizationId: string, spaceId: string): Promise<SessionDto[]> {
    return (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? []).map(cloneSession)
  }

  async create(record: CreateSessionRecord): Promise<CreateSessionResult> {
    const idempotencyScope = `${spaceKey(record.organizationId, record.spaceId)}\u0000${record.actorId}\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify(record.request)
    const existing = this.sessionsByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return {
        ...existing.result,
        session: cloneSession(existing.result.session),
        message: existing.result.message
          ? { ...existing.result.message, attachments: [...existing.result.message.attachments] }
          : undefined,
        replayed: true,
      }
    }

    const session = createSessionDto(record, {
      id: this.createId(),
      timestamp: this.now().toISOString(),
    })
    const startRecords = createSessionStartRecords(record, session, { createId: this.createId })

    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    sessions.unshift(session)
    this.sessionsBySpace.set(key, sessions)
    const result = { session: cloneSession(session), ...startRecords, replayed: false }
    this.sessionsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })

    return result
  }
}
