import { randomUUID } from 'node:crypto'
import {
  MeOrganizationSchema,
  SessionDtoSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type MeOrganization,
  type OrganizationRole,
  type SessionCommand,
  type SessionDto,
  type SessionMessage,
  type SessionTurn,
  type SpaceRole,
} from '@relay/contracts'

export type { OrganizationRole, SpaceRole } from '@relay/contracts'

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

export type SpaceAccess = {
  organizationRole: OrganizationRole
  spaceRole: SpaceRole
}

export function canWriteSpace(access: SpaceAccess): boolean {
  return access.organizationRole !== 'viewer' && access.spaceRole !== 'viewer'
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
  listActorOrganizations(actorId: string): Promise<MeOrganization[]>
  getSpaceAccess(organizationId: string, spaceId: string, actorId: string): Promise<SpaceAccess | null>
  listBySpace(organizationId: string, spaceId: string, actorId: string): Promise<SessionDto[]>
  create(record: CreateSessionRecord): Promise<CreateSessionResult>
}

export type InMemorySessionRepositoryOptions = {
  seed?: SessionDto[]
  actorOrganizations?: Readonly<Record<string, readonly MeOrganization[]>>
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

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNames(left: { id: string; name: string }, right: { id: string; name: string }) {
  return compareText(left.name, right.name) || compareText(left.id, right.id)
}

function cloneOrganization(organization: MeOrganization): MeOrganization {
  return {
    ...organization,
    spaces: organization.spaces.map((space) => ({ ...space })).sort(compareNames),
  }
}

export function orderActorOrganizations(organizations: readonly MeOrganization[]): MeOrganization[] {
  return organizations.map(cloneOrganization).sort(compareNames)
}

function spaceKey(organizationId: string, spaceId: string) {
  return `${organizationId}\u0000${spaceId}`
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessionsBySpace = new Map<string, SessionDto[]>()
  private readonly organizationsByActor = new Map<string, MeOrganization[]>()
  private readonly sessionsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: CreateSessionResult
  }>()
  private readonly createId: () => string
  private readonly now: () => Date

  constructor(options: InMemorySessionRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())

    for (const [actorId, organizations] of Object.entries(options.actorOrganizations ?? {})) {
      this.organizationsByActor.set(actorId, orderActorOrganizations(
        organizations.map((organization) => MeOrganizationSchema.parse(organization)),
      ))
    }

    for (const candidate of options.seed ?? []) {
      const session = SessionDtoSchema.parse(candidate)
      const key = spaceKey(session.organizationId, session.spaceId)
      const sessions = this.sessionsBySpace.get(key) ?? []
      sessions.push(cloneSession(session))
      this.sessionsBySpace.set(key, sessions)
    }
  }

  async listActorOrganizations(actorId: string): Promise<MeOrganization[]> {
    return orderActorOrganizations(this.organizationsByActor.get(actorId) ?? [])
  }

  async getSpaceAccess(organizationId: string, spaceId: string, actorId: string): Promise<SpaceAccess | null> {
    const organization = this.organizationsByActor.get(actorId)?.find((item) => item.id === organizationId)
    const space = organization?.spaces.find((item) => item.id === spaceId)
    return organization && space
      ? { organizationRole: organization.role, spaceRole: space.role }
      : null
  }

  async listBySpace(organizationId: string, spaceId: string, actorId: string): Promise<SessionDto[]> {
    if (!await this.getSpaceAccess(organizationId, spaceId, actorId)) return []
    return (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? []).map(cloneSession)
  }

  async create(record: CreateSessionRecord): Promise<CreateSessionResult> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
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
