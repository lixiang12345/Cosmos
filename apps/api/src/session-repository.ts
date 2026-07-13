import { randomUUID } from 'node:crypto'
import {
  MeOrganizationSchema,
  SessionDtoSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type MeOrganization,
  type OrganizationRole,
  type RenameSessionRequest,
  type SessionConfigurationResolutionVersion,
  type SessionCommand,
  type SessionDto,
  type SessionMessage,
  type SessionStatus,
  type SendSessionMessageResponse,
  type StartSessionResponse,
  type SessionTurn,
  type SpaceRole,
} from '@relay/contracts'

export type { OrganizationRole, SpaceRole } from '@relay/contracts'

export type CreateSessionRecord = {
  organizationId: string
  spaceId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  idempotencyKey: string
  request: CreateSessionRequest
  executionAvailability?: 'available' | 'disabled' | 'worker_unavailable'
}

export type CreateSessionResult = {
  session: SessionDto
  message?: SessionMessage
  turn?: SessionTurn
  command?: SessionCommand
  replayed: boolean
}

export type StartSessionRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  idempotencyKey: string
  expectedVersion: number
  executionAvailability?: 'available' | 'disabled' | 'worker_unavailable'
}

export type StartSessionResult = StartSessionResponse & {
  replayed: boolean
}

export type SendSessionMessageRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  idempotencyKey: string
  request: CreateSessionRequest['message']
  executionAvailability?: 'available' | 'disabled' | 'worker_unavailable'
}

export type SendSessionMessageResult = SendSessionMessageResponse & {
  replayed: boolean
}

type SessionMutationRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  expectedVersion: number
}

export type RenameSessionRecord = SessionMutationRecord & {
  request: RenameSessionRequest
}

export type SetSessionArchivedRecord = SessionMutationRecord & {
  action: 'archive' | 'restore'
  idempotencyKey: string
}

export type SessionLifecycleResult = {
  session: SessionDto
  replayed: boolean
}

export type SessionListCursor = {
  lastActivityAt: string
  id: string
}

export type SessionListOptions = {
  limit?: number
  cursor?: SessionListCursor
  status?: SessionStatus
  archived?: boolean | 'all'
  search?: string
}

export type SessionListPage = {
  items: SessionDto[]
  hasMore: boolean
  nextCursor: SessionListCursor | null
  projectionUpdatedAt: string | null
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
    super('The actor no longer has permission to mutate Sessions in this Space.')
    this.name = 'AuthorizationChangedError'
  }
}

export class SessionVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super('The Session changed after it was loaded. Refresh it and retry the operation.')
    this.name = 'SessionVersionConflictError'
  }
}

export class SessionStateConflictError extends Error {
  constructor(
    readonly status: SessionDto['status'],
    readonly operation: 'start' | 'send' = 'start',
  ) {
    super(operation === 'start'
      ? `A Session in the ${status} state cannot be started.`
      : `A message cannot be sent to a Session in the ${status} state.`)
    this.name = 'SessionStateConflictError'
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

export class ExecutionUnavailableError extends Error {
  readonly retryable: boolean

  constructor(reason: 'disabled' | 'worker_unavailable') {
    super(reason === 'disabled'
      ? 'Session execution is not enabled for this deployment.'
      : 'No execution Worker has reported a recent heartbeat.')
    this.name = 'ExecutionUnavailableError'
    this.retryable = reason === 'worker_unavailable'
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
  listBySpace(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options?: SessionListOptions,
  ): Promise<SessionListPage>
  getById(organizationId: string, spaceId: string, sessionId: string, actorId: string): Promise<SessionDto | null>
  rename(record: RenameSessionRecord): Promise<SessionDto | null>
  setArchived(record: SetSessionArchivedRecord): Promise<SessionLifecycleResult | null>
  create(record: CreateSessionRecord): Promise<CreateSessionResult>
  start(record: StartSessionRecord): Promise<StartSessionResult | null>
  send(record: SendSessionMessageRecord): Promise<SendSessionMessageResult | null>
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
    archivedAt: null,
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

export function createSessionStartRecords(
  session: SessionDto,
  message: Pick<SessionMessage, 'id'>,
  actorId: string,
  options: {
    createId?: () => string
    timestamp?: string
  } = {},
): Pick<StartSessionResponse, 'turn' | 'command'> {
  const createId = options.createId ?? randomUUID
  const timestamp = options.timestamp ?? new Date().toISOString()
  const turn: SessionTurn = {
    id: createId(),
    sessionId: session.id,
    ordinal: 1,
    initiatorType: 'user',
    initiatorId: actorId,
    inputMessageId: message.id,
    status: 'queued',
    queuedAt: timestamp,
    version: 1,
  }
  const command: SessionCommand = {
    id: createId(),
    type: 'session.start',
    status: 'accepted',
    resourceType: 'turn',
    resourceId: turn.id,
    acceptedAt: timestamp,
  }
  return { turn, command }
}

export function createSessionFollowUpRecords(
  record: SendSessionMessageRecord,
  session: SessionDto,
  options: {
    messageSequence: number
    turnOrdinal: number
    createId?: () => string
    timestamp?: string
  },
): Pick<SendSessionMessageResponse, 'message' | 'turn' | 'command'> {
  const createId = options.createId ?? randomUUID
  const timestamp = options.timestamp ?? new Date().toISOString()
  const message: SessionMessage = {
    id: createId(),
    sessionId: session.id,
    sequence: options.messageSequence,
    role: 'user',
    actorId: record.actorId,
    content: record.request.content,
    attachments: [...record.request.attachments],
    createdAt: timestamp,
  }
  const turn: SessionTurn = {
    id: createId(),
    sessionId: session.id,
    ordinal: options.turnOrdinal,
    initiatorType: 'user',
    initiatorId: record.actorId,
    inputMessageId: message.id,
    status: 'queued',
    queuedAt: timestamp,
    version: 1,
  }
  const command: SessionCommand = {
    id: createId(),
    type: 'session.send',
    status: 'accepted',
    resourceType: 'turn',
    resourceId: turn.id,
    acceptedAt: timestamp,
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
  private readonly startsByIdempotencyKey = new Map<string, {
    expectedVersion: number
    result: StartSessionResult
  }>()
  private readonly sendsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: SendSessionMessageResult
  }>()
  private readonly lifecycleByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: SessionLifecycleResult
  }>()
  private readonly messagesBySessionId = new Map<string, SessionMessage[]>()
  private readonly turnsBySessionId = new Map<string, SessionTurn[]>()
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

  async listBySpace(
    organizationId: string,
    spaceId: string,
    actorId: string,
    options: SessionListOptions = {},
  ): Promise<SessionListPage> {
    const limit = options.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Session page limit must be an integer between 1 and 100.')
    }
    if (!await this.getSpaceAccess(organizationId, spaceId, actorId)) {
      return { items: [], hasMore: false, nextCursor: null, projectionUpdatedAt: null }
    }
    const search = options.search?.toLocaleLowerCase()
    const visible = (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? [])
      .filter((session) => session.visibility === 'space' || this.sessionCreators.get(session.id) === actorId)
      .filter((session) => options.archived === 'all'
        || (options.archived === true ? session.archivedAt !== null : session.archivedAt === null))
      .filter((session) => !options.status || session.status === options.status)
      .filter((session) => !search || [session.title, session.summary, session.expertName, session.repository]
        .some((value) => value.toLocaleLowerCase().includes(search)))
      .filter((session) => {
        if (!options.cursor) return true
        const activityTime = new Date(session.lastActivityAt).getTime()
        const cursorTime = new Date(options.cursor.lastActivityAt).getTime()
        return activityTime < cursorTime || (activityTime === cursorTime && session.id < options.cursor.id)
      })
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt) || right.id.localeCompare(left.id))
    const hasMore = visible.length > limit
    const items = visible.slice(0, limit).map(cloneSession)
    const last = items.at(-1)
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { lastActivityAt: last.lastActivityAt, id: last.id } : null,
      projectionUpdatedAt: items[0]?.updatedAt ?? null,
    }
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

  async rename(record: RenameSessionRecord): Promise<SessionDto | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const sessions = this.sessionsBySpace.get(spaceKey(record.organizationId, record.spaceId)) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || (current.visibility === 'private' && this.sessionCreators.get(current.id) !== record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    if (!isCreator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
      throw new AuthorizationChangedError()
    }
    if (current.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, current.version)
    }
    if (current.title === record.request.title) return cloneSession(current)
    const session = SessionDtoSchema.parse({
      ...current,
      title: record.request.title,
      updatedAt: this.now().toISOString(),
      version: current.version + 1,
    })
    sessions[sessionIndex] = session
    return cloneSession(session)
  }

  async setArchived(record: SetSessionArchivedRecord): Promise<SessionLifecycleResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const idempotencyScope = `${spaceKey(record.organizationId, record.spaceId)}\u0000${record.actorId}\u0000${record.sessionId}\u0000${record.action}\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify({ expectedVersion: record.expectedVersion })
    const existing = this.lifecycleByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return { session: cloneSession(existing.result.session), replayed: true }
    }

    const sessions = this.sessionsBySpace.get(spaceKey(record.organizationId, record.spaceId)) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || (current.visibility === 'private' && this.sessionCreators.get(current.id) !== record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    if (!isCreator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
      throw new AuthorizationChangedError()
    }
    if (current.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, current.version)
    }

    const alreadyInTargetState = record.action === 'archive'
      ? current.archivedAt !== null
      : current.archivedAt === null
    let session = current
    if (!alreadyInTargetState) {
      const timestamp = this.now().toISOString()
      session = SessionDtoSchema.parse({
        ...current,
        archivedAt: record.action === 'archive' ? timestamp : null,
        updatedAt: timestamp,
        version: current.version + 1,
      })
      sessions[sessionIndex] = session
    }
    const result = { session: cloneSession(session), replayed: false }
    this.lifecycleByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
    return result
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

    if (record.request.start && record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
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
    if (startRecords.message) {
      this.messagesBySessionId.set(session.id, [{
        ...startRecords.message,
        attachments: [...startRecords.message.attachments],
      }])
    }
    if (startRecords.turn) {
      this.turnsBySessionId.set(session.id, [{ ...startRecords.turn }])
    }
    this.sessionsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })

    return result
  }

  async start(record: StartSessionRecord): Promise<StartSessionResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || (current.visibility === 'private' && this.sessionCreators.get(current.id) !== record.actorId)) {
      return null
    }

    const idempotencyScope = `${key}\u0000${record.actorId}\u0000${record.sessionId}\u0000${record.idempotencyKey}`
    const existing = this.startsByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.expectedVersion !== record.expectedVersion) throw new IdempotencyConflictError()
      return {
        ...existing.result,
        session: cloneSession(existing.result.session),
        turn: { ...existing.result.turn },
        command: { ...existing.result.command },
        replayed: true,
      }
    }

    if (current.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, current.version)
    }
    if (current.status !== 'draft') throw new SessionStateConflictError(current.status)
    if (record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
    }
    const message = this.messagesBySessionId.get(current.id)?.[0]
    if (!message) throw new Error('The draft Session does not have an initial Message.')

    const timestamp = this.now().toISOString()
    const session = SessionDtoSchema.parse({
      ...current,
      status: 'queued',
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      version: current.version + 1,
    })
    const records = createSessionStartRecords(session, message, record.actorId, {
      createId: this.createId,
      timestamp,
    })
    sessions[sessionIndex] = session
    this.turnsBySessionId.set(session.id, [{ ...records.turn }])
    const result: StartSessionResult = {
      session: cloneSession(session),
      turn: records.turn,
      command: records.command,
      replayed: false,
    }
    this.startsByIdempotencyKey.set(idempotencyScope, { expectedVersion: record.expectedVersion, result })
    return result
  }

  async send(record: SendSessionMessageRecord): Promise<SendSessionMessageResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || (current.visibility === 'private' && this.sessionCreators.get(current.id) !== record.actorId)) {
      return null
    }

    const idempotencyScope = `${key}\u0000${record.actorId}\u0000${record.sessionId}\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify(record.request)
    const existing = this.sendsByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return {
        ...existing.result,
        session: cloneSession(existing.result.session),
        message: { ...existing.result.message, attachments: [...existing.result.message.attachments] },
        turn: { ...existing.result.turn },
        command: { ...existing.result.command },
        replayed: true,
      }
    }
    if (current.status === 'draft' || current.status === 'canceled') {
      throw new SessionStateConflictError(current.status, 'send')
    }
    if (record.executionAvailability && record.executionAvailability !== 'available') {
      throw new ExecutionUnavailableError(record.executionAvailability)
    }

    const timestamp = this.now().toISOString()
    const session = SessionDtoSchema.parse({
      ...current,
      status: current.status === 'completed' || current.status === 'failed' ? 'queued' : current.status,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      version: current.version + 1,
    })
    const messages = this.messagesBySessionId.get(session.id) ?? []
    const turns = this.turnsBySessionId.get(session.id) ?? []
    const records = createSessionFollowUpRecords(record, session, {
      messageSequence: (messages.at(-1)?.sequence ?? 0) + 1,
      turnOrdinal: (turns.at(-1)?.ordinal ?? 0) + 1,
      createId: this.createId,
      timestamp,
    })
    sessions[sessionIndex] = session
    messages.push(records.message)
    turns.push(records.turn)
    this.messagesBySessionId.set(session.id, messages)
    this.turnsBySessionId.set(session.id, turns)
    const result: SendSessionMessageResult = {
      session: cloneSession(session),
      message: { ...records.message, attachments: [...records.message.attachments] },
      turn: records.turn,
      command: records.command,
      replayed: false,
    }
    this.sendsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
    return result
  }
}
