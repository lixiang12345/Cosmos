import type {
  AdvisorPlanDecisionRequest,
  AdvisorPlanDto,
  AdvisorPlanProposal,
  AdvisorPlanStepDto,
  AdvisorPlanStatus,
} from '@cosmos/contracts'

export type AdvisorPlanScope = {
  organizationId: string
  spaceId: string
  sessionId: string
  actorId: string
  requestId: string
}

export type ProposeAdvisorPlanRecord = AdvisorPlanScope & {
  providerToolCallId: string
  proposal: AdvisorPlanProposal
}

export type DecideAdvisorPlanRecord = AdvisorPlanScope & {
  planId: string
  expectedVersion: number
  idempotencyKey: string
  request: AdvisorPlanDecisionRequest
}

export type RetryAdvisorPlanRecord = AdvisorPlanScope & {
  planId: string
  expectedVersion: number
  idempotencyKey: string
}

export type AdvisorPlanMutationResult = {
  plan: AdvisorPlanDto
  replayed: boolean
}

export interface AdvisorPlanRepository {
  proposePlan(record: ProposeAdvisorPlanRecord): Promise<AdvisorPlanDto>
  listPlans(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    actorId: string,
  ): Promise<AdvisorPlanDto[] | null>
  getPlan(
    organizationId: string,
    spaceId: string,
    sessionId: string,
    planId: string,
    actorId: string,
  ): Promise<AdvisorPlanDto | null>
  decidePlan(record: DecideAdvisorPlanRecord): Promise<AdvisorPlanMutationResult | null>
  prepareRetry(record: RetryAdvisorPlanRecord): Promise<AdvisorPlanMutationResult | null>
  startStep(record: AdvisorPlanScope & {
    planId: string
    stepId: string
    expectedVersion: number
  }): Promise<AdvisorPlanStepDto | null>
  finishStep(record: AdvisorPlanScope & {
    planId: string
    stepId: string
    expectedVersion: number
    status: 'succeeded' | 'failed' | 'action_required'
    failureCode?: string
    failureMessage?: string
  }): Promise<AdvisorPlanStepDto | null>
  finishPlan(record: AdvisorPlanScope & {
    planId: string
    expectedVersion: number
    status: Extract<AdvisorPlanStatus, 'succeeded' | 'failed' | 'action_required'>
  }): Promise<AdvisorPlanDto | null>
}

export class AdvisorPlanValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message)
    this.name = 'AdvisorPlanValidationError'
  }
}

export class AdvisorPlanPermissionError extends Error {
  constructor(message = 'The actor cannot manage this Advisor plan.') {
    super(message)
    this.name = 'AdvisorPlanPermissionError'
  }
}

export class AdvisorPlanVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Advisor plan version ${expectedVersion} does not match current version ${actualVersion}.`)
    this.name = 'AdvisorPlanVersionConflictError'
  }
}

export class AdvisorPlanStateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdvisorPlanStateConflictError'
  }
}

export class AdvisorPlanIdempotencyConflictError extends Error {
  constructor() {
    super('The Idempotency-Key was already used with a different Advisor plan request.')
    this.name = 'AdvisorPlanIdempotencyConflictError'
  }
}

export class EmptyAdvisorPlanRepository implements AdvisorPlanRepository {
  proposePlan(): Promise<AdvisorPlanDto> {
    return Promise.reject(new Error('Advisor planning requires a database-backed repository.'))
  }
  listPlans(): Promise<AdvisorPlanDto[]> { return Promise.resolve([]) }
  getPlan(): Promise<null> { return Promise.resolve(null) }
  decidePlan(): Promise<null> { return Promise.resolve(null) }
  prepareRetry(): Promise<null> { return Promise.resolve(null) }
  startStep(): Promise<null> { return Promise.resolve(null) }
  finishStep(): Promise<null> { return Promise.resolve(null) }
  finishPlan(): Promise<null> { return Promise.resolve(null) }
}
