import { randomUUID } from 'node:crypto'
import {
  MeOrganizationSchema,
  SessionDtoSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type MeOrganization,
  type OrganizationRole,
  type SessionConfigurationResolutionVersion,
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

export type ResolvedSessionConfiguration = {
  configurationResolutionVersion: SessionConfigurationResolutionVersion
  expertId: string
  expertName: string
  expertVersion?: number
  expertRevisionId?: string
  environmentId?: string
  environmentRevisionId?: string
  repositoryId?: string
  repository: string
  baseBranch: string
}

export type InMemoryRepositoryBinding = {
  id: string
  repository: string
  baseBranch: string
  isDefault?: boolean
}

export type InMemoryExpertCatalogEntry = {
  organizationId: string
  spaceId: string
  id: string
  name: string
  status: 'draft' | 'published' | 'disabled' | 'archived'
  visibility?: 'private' | 'space'
  createdBy?: string
  publishedRevision?: {
    id: string
    version: number
    status: 'draft' | 'published'
    allowRepositoryOverride?: boolean
    allowBaseBranchOverride?: boolean
    environment: {
      id: string
      status: 'draft' | 'provisioning' | 'ready' | 'updating' | 'failed' | 'disabled'
      activeRevisionId: string
      revision: {
        id: string
        status: 'draft' | 'ready'
        repositories: readonly InMemoryRepositoryBinding[]
      }
    }
  }
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

export class SessionConfigurationNotFoundError extends Error {
  constructor() {
    super('The selected Session configuration was not found.')
    this.name = 'SessionConfigurationNotFoundError'
  }
}

export class ExpertNotPublishedError extends Error {
  constructor() {
    super('The selected Expert does not have an available published revision.')
    this.name = 'ExpertNotPublishedError'
  }
}

export class EnvironmentNotReadyError extends Error {
  constructor() {
    super('The selected Expert environment is not ready.')
    this.name = 'EnvironmentNotReadyError'
  }
}

export class SessionConfigurationValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'SessionConfigurationValidationError'
  }
}

export interface SessionRepository {
  listActorOrganizations(actorId: string): Promise<MeOrganization[]>
  getSpaceAccess(organizationId: string, spaceId: string, actorId: string): Promise<SpaceAccess | null>
  listBySpace(organizationId: string, spaceId: string, actorId: string): Promise<SessionDto[]>
  getById(organizationId: string, spaceId: string, sessionId: string, actorId: string): Promise<SessionDto | null>
  create(record: CreateSessionRecord): Promise<CreateSessionResult>
}

export type InMemorySessionRepositoryOptions = {
  seed?: SessionDto[]
  actorOrganizations?: Readonly<Record<string, readonly MeOrganization[]>>
  authoritativeCatalog?: readonly InMemoryExpertCatalogEntry[]
  allowLegacyDevelopmentConfigurationFallback?: boolean
  seedCreatedBy?: Readonly<Record<string, string>>
  createId?: () => string
  now?: () => Date
}

export function createSessionDto(
  record: CreateSessionRecord,
  options: {
    configuration: ResolvedSessionConfiguration
    id?: string
    timestamp?: string
  },
): SessionDto {
  const timestamp = options.timestamp ?? new Date().toISOString()
  const configuration = options.configuration
  return SessionDtoSchema.parse({
    id: options.id ?? randomUUID(),
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    title: record.request.title,
    summary: record.request.message.content,
    expertId: configuration.expertId,
    expertName: configuration.expertName,
    expertVersion: configuration.expertVersion,
    environmentId: configuration.environmentId,
    configurationResolutionVersion: configuration.configurationResolutionVersion,
    expertRevisionId: configuration.expertRevisionId,
    environmentRevisionId: configuration.environmentRevisionId,
    repositoryId: configuration.repositoryId,
    repository: configuration.repository,
    baseBranch: configuration.baseBranch,
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

export function createSessionRecords(
  record: CreateSessionRecord,
  session: SessionDto,
  options: {
    createId?: () => string
  } = {},
): Pick<CreateSessionResponse, 'message' | 'turn' | 'command'> {
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
  if (!record.request.start) return { message }
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

function configurationValidation(field: string, message: string): never {
  throw new SessionConfigurationValidationError('The Session configuration overrides are invalid.', {
    [field]: [message],
  })
}

export function resolveRepositoryBinding(
  request: CreateSessionRequest,
  repositories: readonly InMemoryRepositoryBinding[],
  policy: { allowRepositoryOverride: boolean; allowBaseBranchOverride: boolean },
): InMemoryRepositoryBinding {
  const advancedRepositoryId = request.advancedOverrides?.repositoryId
  const legacyRepository = request.repository
  let selected: InMemoryRepositoryBinding | undefined

  if (advancedRepositoryId) {
    selected = repositories.find((repository) => repository.id === advancedRepositoryId)
    if (!selected) throw new SessionConfigurationNotFoundError()
  } else if (legacyRepository) {
    selected = repositories.find((repository) => repository.repository === legacyRepository)
  } else {
    selected = repositories.find((repository) => repository.isDefault)
  }

  if (!selected) throw new SessionConfigurationNotFoundError()
  if (!policy.allowRepositoryOverride && !selected.isDefault) {
    configurationValidation(
      advancedRepositoryId ? 'advancedOverrides.repositoryId' : 'repository',
      'This Expert revision only allows its default repository binding.',
    )
  }

  const advancedBaseBranch = request.advancedOverrides?.baseBranch
  if (advancedBaseBranch && request.baseBranch && advancedBaseBranch !== request.baseBranch) {
    configurationValidation('advancedOverrides.baseBranch', 'The advanced and legacy base branch selections conflict.')
  }
  const selectedBaseBranch = advancedBaseBranch ?? request.baseBranch
  if (!policy.allowBaseBranchOverride && selectedBaseBranch && selectedBaseBranch !== selected.baseBranch) {
    configurationValidation(
      advancedBaseBranch ? 'advancedOverrides.baseBranch' : 'baseBranch',
      'This Expert revision does not allow a base branch override.',
    )
  }

  return { ...selected, baseBranch: selectedBaseBranch ?? selected.baseBranch }
}

export function resolveInMemorySessionConfiguration(
  record: CreateSessionRecord,
  catalog: readonly InMemoryExpertCatalogEntry[],
): ResolvedSessionConfiguration {
  const expert = catalog.find((candidate) =>
    candidate.organizationId === record.organizationId
    && candidate.spaceId === record.spaceId
    && candidate.id === record.request.expertId)
  if (!expert) throw new SessionConfigurationNotFoundError()
  if ((expert.visibility ?? 'space') === 'private' && expert.createdBy !== record.actorId) {
    throw new SessionConfigurationNotFoundError()
  }

  const revision = expert.publishedRevision
  if (expert.status !== 'published' || !revision || revision.status !== 'published') {
    throw new ExpertNotPublishedError()
  }

  const environment = revision.environment
  if (
    environment.status !== 'ready'
    || environment.activeRevisionId !== environment.revision.id
    || environment.revision.status !== 'ready'
  ) {
    throw new EnvironmentNotReadyError()
  }

  const repository = resolveRepositoryBinding(record.request, environment.revision.repositories, {
    allowRepositoryOverride: revision.allowRepositoryOverride ?? true,
    allowBaseBranchOverride: revision.allowBaseBranchOverride ?? true,
  })
  return {
    configurationResolutionVersion: 1,
    expertId: expert.id,
    expertName: expert.name,
    expertVersion: revision.version,
    expertRevisionId: revision.id,
    environmentId: environment.id,
    environmentRevisionId: environment.revision.id,
    repositoryId: repository.id,
    repository: repository.repository,
    baseBranch: repository.baseBranch,
  }
}

function resolveLegacyDevelopmentConfiguration(record: CreateSessionRecord): ResolvedSessionConfiguration {
  if (!record.request.repository || !record.request.baseBranch) {
    configurationValidation('repository', 'Legacy development Sessions require repository and baseBranch hints.')
  }
  return {
    configurationResolutionVersion: 0,
    expertId: record.request.expertId,
    expertName: record.request.expertName ?? record.request.expertId,
    expertVersion: record.request.expertVersion,
    environmentId: record.request.environmentId,
    repository: record.request.repository,
    baseBranch: record.request.baseBranch,
  }
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
  private readonly sessionCreators = new Map<string, string>()
  private readonly organizationsByActor = new Map<string, MeOrganization[]>()
  private readonly sessionsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: CreateSessionResult
  }>()
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly authoritativeCatalog: readonly InMemoryExpertCatalogEntry[]
  private readonly allowLegacyDevelopmentConfigurationFallback: boolean

  constructor(options: InMemorySessionRepositoryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.authoritativeCatalog = options.authoritativeCatalog ?? []
    this.allowLegacyDevelopmentConfigurationFallback = options.allowLegacyDevelopmentConfigurationFallback ?? false

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
      const createdBy = options.seedCreatedBy?.[session.id]
      if (createdBy) this.sessionCreators.set(session.id, createdBy)
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
    return (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? [])
      .filter((session) => session.visibility === 'space' || this.sessionCreators.get(session.id) === actorId)
      .map(cloneSession)
  }

  async getById(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
  ): Promise<SessionDto | null> {
    if (!await this.getSpaceAccess(organizationId, spaceId, actorId)) return null
    const session = (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? [])
      .find((candidate) => candidate.id === sessionId)
    if (!session || (session.visibility === 'private' && this.sessionCreators.get(session.id) !== actorId)) return null
    return cloneSession(session)
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

    let configuration: ResolvedSessionConfiguration
    if (this.authoritativeCatalog.length > 0) {
      configuration = resolveInMemorySessionConfiguration(record, this.authoritativeCatalog)
    } else if (this.allowLegacyDevelopmentConfigurationFallback) {
      configuration = resolveLegacyDevelopmentConfiguration(record)
    } else {
      throw new SessionConfigurationNotFoundError()
    }
    const session = createSessionDto(record, {
      configuration,
      id: this.createId(),
      timestamp: this.now().toISOString(),
    })
    const startRecords = createSessionRecords(record, session, { createId: this.createId })

    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    sessions.unshift(session)
    this.sessionsBySpace.set(key, sessions)
    this.sessionCreators.set(session.id, record.actorId)
    const result = { session: cloneSession(session), ...startRecords, replayed: false }
    this.sessionsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })

    return result
  }
}
