import type {
  AutomationDto,
  AutomationEventDto,
  AutomationRunDto,
  AutomationTestResult,
  CreateAutomationRequest,
  ReceiveAutomationEventRequest,
  TestAutomationRequest,
  UpdateAutomationRequest,
} from '@cosmos/contracts'

export type AutomationScope = {
  organizationId: string
  spaceId: string
  actorId: string
  requestId: string
}

export type AutomationMutationRecord = AutomationScope & {
  automationId: string
  expectedVersion: number
  idempotencyKey: string
}

export type CreateAutomationRecord = AutomationScope & {
  idempotencyKey: string
  request: CreateAutomationRequest
}

export type UpdateAutomationRecord = AutomationMutationRecord & {
  request: UpdateAutomationRequest
}

export type SetAutomationStatusRecord = AutomationMutationRecord & {
  status: 'paused' | 'active'
}

export type TestAutomationRecord = AutomationMutationRecord & {
  request: TestAutomationRequest
}

export type ReceiveAutomationEventRecord = AutomationScope & {
  request: ReceiveAutomationEventRequest
}

export type AutomationMutationResult = {
  automation: AutomationDto
  replayed: boolean
}

export type AutomationEventMatch = {
  automation: AutomationDto
  serviceAccountAudience: string
}

export type AutomationEventMatchResult = {
  event: AutomationEventDto
  duplicate: boolean
  match: AutomationEventMatch | null
}

export interface AutomationRepository {
  listAutomations(organizationId: string, spaceId: string, actorId: string): Promise<AutomationDto[]>
  createAutomation(record: CreateAutomationRecord): Promise<AutomationMutationResult>
  updateAutomation(record: UpdateAutomationRecord): Promise<AutomationMutationResult | null>
  setAutomationStatus(record: SetAutomationStatusRecord): Promise<AutomationMutationResult | null>
  archiveAutomation(record: AutomationMutationRecord): Promise<AutomationMutationResult | null>
  testAutomation(record: TestAutomationRecord): Promise<AutomationTestResult | null>
  listEvents(organizationId: string, spaceId: string, actorId: string): Promise<AutomationEventDto[]>
  receiveEvent(record: ReceiveAutomationEventRecord): Promise<AutomationEventMatchResult>
  completeDispatch(record: AutomationScope & { eventId: string; sessionId: string }): Promise<AutomationEventDto | null>
  failDispatch(record: AutomationScope & { eventId: string; code: string; message: string }): Promise<AutomationEventDto | null>
  listRuns(organizationId: string, spaceId: string, actorId: string): Promise<AutomationRunDto[]>
}

export class AutomationVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Automation version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'AutomationVersionConflictError'
  }
}

export class AutomationStateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationStateConflictError'
  }
}

export class AutomationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationValidationError'
  }
}

export class AutomationIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Automation request.')
    this.name = 'AutomationIdempotencyConflictError'
  }
}

export class EmptyAutomationRepository implements AutomationRepository {
  listAutomations(): Promise<AutomationDto[]> { return Promise.resolve([]) }
  listEvents(): Promise<AutomationEventDto[]> { return Promise.resolve([]) }
  listRuns(): Promise<AutomationRunDto[]> { return Promise.resolve([]) }
  createAutomation(): Promise<AutomationMutationResult> {
    return Promise.reject(new Error('Automation mutations require a database-backed repository.'))
  }
  updateAutomation(): Promise<null> { return Promise.resolve(null) }
  setAutomationStatus(): Promise<null> { return Promise.resolve(null) }
  archiveAutomation(): Promise<null> { return Promise.resolve(null) }
  testAutomation(): Promise<null> { return Promise.resolve(null) }
  receiveEvent(): Promise<AutomationEventMatchResult> {
    return Promise.reject(new Error('Automation Events require a database-backed repository.'))
  }
  completeDispatch(): Promise<null> { return Promise.resolve(null) }
  failDispatch(): Promise<null> { return Promise.resolve(null) }
}
