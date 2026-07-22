import { randomUUID } from 'node:crypto'
import {
  MeOrganizationSchema,
  SessionDtoSchema,
  type AttemptDto,
  type CancelSessionRequest,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateShareGrantRequest,
  type MeOrganization,
  type OrganizationRole,
  type RenameSessionRequest,
  type SessionConfigurationResolutionVersion,
  type SessionCommand,
  type SessionControlResponse,
  type SessionDto,
  type SessionMessage,
  type SessionStatus,
  type ShareGrantDto,
  type ShareGrantRole,
  type SendSessionMessageResponse,
  type StartSessionResponse,
  type RetryTurnResponse,
  type SessionTurn,
  type SpaceRole,
} from '@cosmos/contracts'

export type { OrganizationRole, SpaceRole } from '@cosmos/contracts'

export type CreateSessionRecord = {
  organizationId: string
  spaceId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  actorAudience?: string
  requestId: string
  idempotencyKey: string
  request: CreateSessionRequest
  source?: 'manual' | 'automation'
  automationAutoArchive?: boolean
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
  actorAudience?: string
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
  actorAudience?: string
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
  actorAudience?: string
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

export type SessionControlAction = 'pause' | 'resume' | 'cancel'

export type ControlSessionRecord = SessionMutationRecord & {
  action: SessionControlAction
  idempotencyKey: string
  request: CancelSessionRequest
}

export type SessionControlResult = SessionControlResponse & {
  replayed: boolean
}

export type RetryTurnRecord = SessionMutationRecord & {
  turnId: string
  idempotencyKey: string
}

export type RetryTurnResult = RetryTurnResponse & {
  replayed: boolean
}

export type ShareGrantListCursor = {
  createdAt: string
  id: string
}

export type ShareGrantListOptions = {
  limit?: number
  cursor?: ShareGrantListCursor
}

export type ShareGrantListPage = {
  items: ShareGrantDto[]
  hasMore: boolean
  nextCursor: ShareGrantListCursor | null
  projectionUpdatedAt: string | null
}

export type CreateShareGrantRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  idempotencyKey: string
  request: CreateShareGrantRequest
}

export type RevokeShareGrantRecord = {
  organizationId: string
  spaceId: string
  sessionId: string
  shareId: string
  actorId: string
  actorKind: 'user' | 'service_account'
  requestId: string
  idempotencyKey: string
  expectedVersion: number
}

export type ShareGrantMutationResult = {
  grant: ShareGrantDto
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
  executionSnapshotId?: string
  environmentType?: 'cloud' | 'daemon'
  environmentImage?: string
  environmentVariableReferences?: Array<{ name: string; secretId: string }>
  environmentNetworkPolicy?: { mode: string; allowedHosts: string[] }
  environmentChecksum?: string
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

export class ShareGrantVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super('The ShareGrant changed after it was loaded. Refresh it and retry the operation.')
    this.name = 'ShareGrantVersionConflictError'
  }
}

export class ShareGrantConflictError extends Error {
  constructor(message = 'An active ShareGrant already exists for this principal.') {
    super(message)
    this.name = 'ShareGrantConflictError'
  }
}

export class SharePrincipalNotFoundError extends Error {
  constructor() {
    super('The requested share principal does not have current access to this Space.')
    this.name = 'SharePrincipalNotFoundError'
  }
}

export class ShareGrantValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareGrantValidationError'
  }
}

export class SessionStateConflictError extends Error {
  constructor(
    readonly status: SessionDto['status'],
    readonly operation: 'start' | 'send' | 'pause' | 'resume' | 'cancel' | 'retry' = 'start',
  ) {
    const messages = {
      start: `A Session in the ${status} state cannot be started.`,
      send: `A message cannot be sent to a Session in the ${status} state.`,
      pause: `A Session in the ${status} state cannot be paused.`,
      resume: `A Session in the ${status} state cannot be resumed.`,
      cancel: `A Session in the ${status} state cannot be canceled.`,
      retry: `A Turn cannot be retried while its Session is in the ${status} state.`,
    }
    super(messages[operation])
    this.name = 'SessionStateConflictError'
  }
}

export class TurnStateConflictError extends Error {
  constructor(readonly status: SessionTurn['status'] | 'missing') {
    super(status === 'missing'
      ? 'The requested Turn was not found in this Session.'
      : `A Turn in the ${status} state cannot be retried.`)
    this.name = 'TurnStateConflictError'
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
  control(record: ControlSessionRecord): Promise<SessionControlResult | null>
  retryTurn(record: RetryTurnRecord): Promise<RetryTurnResult | null>
  listShares(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options?: ShareGrantListOptions,
  ): Promise<ShareGrantListPage | null>
  createShare(record: CreateShareGrantRecord): Promise<ShareGrantMutationResult | null>
  revokeShare(record: RevokeShareGrantRecord): Promise<ShareGrantMutationResult | null>
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
  seedShareGrants?: readonly ShareGrantDto[]
  groupMembers?: Readonly<Record<string, readonly string[]>>
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
  const id = options.id ?? randomUUID()
  const configuration = options.configuration
  return SessionDtoSchema.parse({
    id,
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
    executionSnapshotId: configuration.configurationResolutionVersion === 1
      ? (configuration.executionSnapshotId ?? `${id}-snapshot`)
      : undefined,
    repositoryId: configuration.repositoryId,
    repository: configuration.repository,
    baseBranch: configuration.baseBranch,
    visibility: record.request.visibility,
    status: record.request.start ? 'queued' : 'draft',
    attachments: record.request.message.attachments,
    source: record.source ?? 'manual',
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
    initiatorType: record.actorKind === 'service_account' ? 'event' : 'user',
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
    initiatorType: record.actorKind === 'service_account' ? 'event' : 'user',
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

function cloneShareGrant(grant: ShareGrantDto): ShareGrantDto {
  return { ...grant }
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
    spaces: organization.spaces.map((space) => ({ ...space })).sort((left, right) => (
      Number(right.isDefault === true) - Number(left.isDefault === true) || compareNames(left, right)
    )),
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
  private readonly controlsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: SessionControlResult
  }>()
  private readonly retriesByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: RetryTurnResult
  }>()
  private readonly sharesBySessionId = new Map<string, ShareGrantDto[]>()
  private readonly shareMutationsByIdempotencyKey = new Map<string, {
    requestFingerprint: string
    result: ShareGrantMutationResult
  }>()
  private readonly groupMembers = new Map<string, Set<string>>()
  private readonly messagesBySessionId = new Map<string, SessionMessage[]>()
  private readonly turnsBySessionId = new Map<string, SessionTurn[]>()
  private readonly attemptsByTurnId = new Map<string, AttemptDto[]>()
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
    for (const [groupId, members] of Object.entries(options.groupMembers ?? {})) {
      this.groupMembers.set(groupId, new Set(members))
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
    for (const candidate of options.seedShareGrants ?? []) {
      const grants = this.sharesBySessionId.get(candidate.sessionId) ?? []
      grants.push({ ...candidate })
      this.sharesBySessionId.set(candidate.sessionId, grants)
    }
  }

  private activeShareRole(sessionId: string, actorId: string): ShareGrantRole | null {
    const now = this.now().getTime()
    const grants = this.sharesBySessionId.get(sessionId) ?? []
    const roles = grants.filter((grant) => grant.revokedAt === null
      && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now)
      && (grant.principalType === 'user'
        ? grant.principalId === actorId
        : this.groupMembers.get(grant.principalId)?.has(actorId)))
      .map((grant) => grant.role)
    return roles.includes('collaborator') ? 'collaborator' : roles.includes('viewer') ? 'viewer' : null
  }

  private canReadSession(session: SessionDto, actorId: string) {
    return session.visibility === 'space'
      || this.sessionCreators.get(session.id) === actorId
      || this.activeShareRole(session.id, actorId) !== null
  }

  private canManageShares(session: SessionDto, actorId: string, access: SpaceAccess) {
    return this.sessionCreators.get(session.id) === actorId
      || (session.visibility === 'space' && access.spaceRole === 'space_manager')
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
      .filter((session) => this.canReadSession(session, actorId))
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
    if (!session || !this.canReadSession(session, actorId)) return null
    return cloneSession(session)
  }

  async listShares(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
    options: ShareGrantListOptions = {},
  ): Promise<ShareGrantListPage | null> {
    const limit = options.limit ?? 25
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('ShareGrant page limit must be an integer between 1 and 100.')
    }
    const access = await this.getSpaceAccess(organizationId, spaceId, actorId)
    if (!access) return null
    const session = (this.sessionsBySpace.get(spaceKey(organizationId, spaceId)) ?? [])
      .find((candidate) => candidate.id === sessionId)
    if (!session || !this.canReadSession(session, actorId)) return null
    if (!this.canManageShares(session, actorId, access)) throw new AuthorizationChangedError()

    const visible = (this.sharesBySessionId.get(sessionId) ?? [])
      .filter((grant) => {
        if (!options.cursor) return true
        return grant.createdAt < options.cursor.createdAt
          || (grant.createdAt === options.cursor.createdAt && grant.id < options.cursor.id)
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    const hasMore = visible.length > limit
    const items = visible.slice(0, limit).map(cloneShareGrant)
    const last = items.at(-1)
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
      projectionUpdatedAt: items[0]?.revokedAt ?? items[0]?.createdAt ?? null,
    }
  }

  async createShare(record: CreateShareGrantRecord): Promise<ShareGrantMutationResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const session = (this.sessionsBySpace.get(spaceKey(record.organizationId, record.spaceId)) ?? [])
      .find((candidate) => candidate.id === record.sessionId)
    if (!session || !this.canReadSession(session, record.actorId)) return null
    if (!this.canManageShares(session, record.actorId, access)) throw new AuthorizationChangedError()

    const idempotencyScope = `${spaceKey(record.organizationId, record.spaceId)}\u0000${record.actorId}\u0000${record.sessionId}\u0000share-create\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify(record.request)
    const replay = this.shareMutationsByIdempotencyKey.get(idempotencyScope)
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return { grant: cloneShareGrant(replay.result.grant), replayed: true }
    }

    const principalHasSpaceAccess = record.request.principalType === 'user'
      ? await this.getSpaceAccess(record.organizationId, record.spaceId, record.request.principalId) !== null
      : [...(this.groupMembers.get(record.request.principalId) ?? [])].some((member) =>
        this.organizationsByActor.get(member)?.some((organization) =>
          organization.id === record.organizationId
          && organization.spaces.some((space) => space.id === record.spaceId)))
    if (!principalHasSpaceAccess) throw new SharePrincipalNotFoundError()

    const now = this.now()
    if (record.request.expiresAt && Date.parse(record.request.expiresAt) <= now.getTime()) {
      throw new ShareGrantValidationError('ShareGrant expiresAt must be in the future.')
    }
    const grants = this.sharesBySessionId.get(record.sessionId) ?? []
    const existing = grants.find((grant) => grant.principalType === record.request.principalType
      && grant.principalId === record.request.principalId
      && grant.revokedAt === null)
    if (existing && (existing.expiresAt === null || Date.parse(existing.expiresAt) > now.getTime())) {
      throw new ShareGrantConflictError()
    }
    if (existing) {
      existing.revokedAt = now.toISOString()
      existing.revokedBy = record.actorId
      existing.version += 1
    }
    const grant: ShareGrantDto = {
      organizationId: record.organizationId,
      spaceId: record.spaceId,
      sessionId: record.sessionId,
      id: this.createId(),
      principalType: record.request.principalType,
      principalId: record.request.principalId,
      role: record.request.role,
      expiresAt: record.request.expiresAt ?? null,
      createdAt: now.toISOString(),
      createdBy: record.actorId,
      revokedAt: null,
      revokedBy: null,
      version: 1,
    }
    grants.push(grant)
    this.sharesBySessionId.set(record.sessionId, grants)
    const result = { grant: cloneShareGrant(grant), replayed: false }
    this.shareMutationsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
    return result
  }

  async revokeShare(record: RevokeShareGrantRecord): Promise<ShareGrantMutationResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const session = (this.sessionsBySpace.get(spaceKey(record.organizationId, record.spaceId)) ?? [])
      .find((candidate) => candidate.id === record.sessionId)
    if (!session || !this.canReadSession(session, record.actorId)) return null
    if (!this.canManageShares(session, record.actorId, access)) throw new AuthorizationChangedError()
    const grant = (this.sharesBySessionId.get(record.sessionId) ?? [])
      .find((candidate) => candidate.id === record.shareId)
    if (!grant) return null

    const idempotencyScope = `${spaceKey(record.organizationId, record.spaceId)}\u0000${record.actorId}\u0000${record.sessionId}\u0000${record.shareId}\u0000share-revoke\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify({ expectedVersion: record.expectedVersion })
    const replay = this.shareMutationsByIdempotencyKey.get(idempotencyScope)
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return { grant: cloneShareGrant(replay.result.grant), replayed: true }
    }
    if (grant.version !== record.expectedVersion) {
      throw new ShareGrantVersionConflictError(record.expectedVersion, grant.version)
    }
    if (grant.revokedAt !== null) throw new ShareGrantConflictError('The ShareGrant is already revoked.')
    grant.revokedAt = this.now().toISOString()
    grant.revokedBy = record.actorId
    grant.version += 1
    const result = { grant: cloneShareGrant(grant), replayed: false }
    this.shareMutationsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
    return result
  }

  async rename(record: RenameSessionRecord): Promise<SessionDto | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const sessions = this.sessionsBySpace.get(spaceKey(record.organizationId, record.spaceId)) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || !this.canReadSession(current, record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    const isCollaborator = this.activeShareRole(current.id, record.actorId) === 'collaborator'
    if (!isCreator && !isCollaborator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
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
    if (!current || !this.canReadSession(current, record.actorId)) {
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

  async control(record: ControlSessionRecord): Promise<SessionControlResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || !this.canReadSession(current, record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    if (!isCreator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
      throw new AuthorizationChangedError()
    }

    const idempotencyScope = `${key}\u0000${record.actorId}\u0000${record.sessionId}\u0000control\u0000${record.action}\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify({
      expectedVersion: record.expectedVersion,
      request: record.request,
    })
    const existing = this.controlsByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return {
        session: cloneSession(existing.result.session),
        command: { ...existing.result.command },
        replayed: true,
      }
    }
    if (current.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, current.version)
    }

    const allowed = record.action === 'pause'
      ? ['queued', 'active', 'waiting'].includes(current.status)
      : record.action === 'resume'
        ? current.status === 'paused'
        : ['draft', 'queued', 'active', 'waiting', 'paused'].includes(current.status)
    if (!allowed) throw new SessionStateConflictError(current.status, record.action)

    const timestamp = this.now().toISOString()
    const status: SessionDto['status'] = record.action === 'pause'
      ? 'paused'
      : record.action === 'resume'
        ? 'queued'
        : 'canceled'
    const session = SessionDtoSchema.parse({
      ...current,
      status,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      version: current.version + 1,
    })
    const turns = this.turnsBySessionId.get(session.id) ?? []
    this.turnsBySessionId.set(session.id, turns.map((turn) => {
      if (record.action === 'pause' && ['running', 'waiting_tool', 'waiting_approval'].includes(turn.status)) {
        return { ...turn, status: 'queued' as const, version: turn.version + 1 }
      }
      if (record.action === 'cancel' && !['completed', 'failed', 'canceled'].includes(turn.status)) {
        return { ...turn, status: 'canceled' as const, version: turn.version + 1 }
      }
      return turn
    }))
    sessions[sessionIndex] = session
    const command: SessionCommand = {
      id: this.createId(),
      type: `session.${record.action}`,
      status: 'succeeded',
      resourceType: 'session',
      resourceId: session.id,
      acceptedAt: timestamp,
    }
    const result = { session: cloneSession(session), command, replayed: false }
    this.controlsByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
    return result
  }

  async retryTurn(record: RetryTurnRecord): Promise<RetryTurnResult | null> {
    const access = await this.getSpaceAccess(record.organizationId, record.spaceId, record.actorId)
    if (!access || !canWriteSpace(access)) throw new AuthorizationChangedError()
    const key = spaceKey(record.organizationId, record.spaceId)
    const sessions = this.sessionsBySpace.get(key) ?? []
    const sessionIndex = sessions.findIndex((candidate) => candidate.id === record.sessionId)
    const current = sessions[sessionIndex]
    if (!current || !this.canReadSession(current, record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    if (!isCreator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
      throw new AuthorizationChangedError()
    }

    const idempotencyScope = `${key}\u0000${record.actorId}\u0000${record.sessionId}\u0000${record.turnId}\u0000retry\u0000${record.idempotencyKey}`
    const requestFingerprint = JSON.stringify({ expectedVersion: record.expectedVersion })
    const existing = this.retriesByIdempotencyKey.get(idempotencyScope)
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError()
      return {
        session: cloneSession(existing.result.session),
        attempt: { ...existing.result.attempt },
        command: { ...existing.result.command },
        replayed: true,
      }
    }
    if (current.version !== record.expectedVersion) {
      throw new SessionVersionConflictError(record.expectedVersion, current.version)
    }
    if (current.status !== 'failed') throw new SessionStateConflictError(current.status, 'retry')

    const turns = this.turnsBySessionId.get(current.id) ?? []
    const turnIndex = turns.findIndex((turn) => turn.id === record.turnId)
    const currentTurn = turns[turnIndex]
    if (!currentTurn) return null
    if (currentTurn.status !== 'failed') throw new TurnStateConflictError(currentTurn.status)

    const timestamp = this.now().toISOString()
    const session = SessionDtoSchema.parse({
      ...current,
      status: 'queued',
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      version: current.version + 1,
    })
    turns[turnIndex] = { ...currentTurn, status: 'queued', version: currentTurn.version + 1 }
    const attempts = this.attemptsByTurnId.get(currentTurn.id) ?? []
    const attempt: AttemptDto = {
      organizationId: record.organizationId,
      spaceId: record.spaceId,
      sessionId: record.sessionId,
      id: this.createId(),
      turnId: record.turnId,
      number: (attempts.at(-1)?.number ?? 0) + 1,
      status: 'queued',
      model: 'development-runtime',
      providerModel: null,
      runtimeId: null,
      failureCode: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
    }
    const command: SessionCommand = {
      id: this.createId(),
      type: 'turn.retry',
      status: 'queued',
      resourceType: 'turn',
      resourceId: record.turnId,
      acceptedAt: timestamp,
    }
    attempts.push(attempt)
    this.attemptsByTurnId.set(record.turnId, attempts)
    sessions[sessionIndex] = session
    const result = { session: cloneSession(session), attempt, command, replayed: false }
    this.retriesByIdempotencyKey.set(idempotencyScope, { requestFingerprint, result })
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
    if (!current || !this.canReadSession(current, record.actorId)) {
      return null
    }
    if (current.visibility === 'private' && this.sessionCreators.get(current.id) !== record.actorId) {
      throw new AuthorizationChangedError()
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
    if (!current || !this.canReadSession(current, record.actorId)) {
      return null
    }
    const isCreator = this.sessionCreators.get(current.id) === record.actorId
    const isCollaborator = this.activeShareRole(current.id, record.actorId) === 'collaborator'
    if (!isCreator && !isCollaborator && (current.visibility !== 'space' || access.spaceRole !== 'space_manager')) {
      throw new AuthorizationChangedError()
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
