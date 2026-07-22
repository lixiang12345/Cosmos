import type { AdvisorPlanDto, AdvisorPlanStepDto, UpdateSpaceRequest } from '@relay/contracts'
import type { AdvisorPlanRepository, AdvisorPlanScope } from './advisor-plan-repository.js'
import {
  SpacePermissionError,
  SpaceValidationError,
  SpaceVersionConflictError,
  type SpaceRepository,
} from './space-repository.js'

export class AdvisorPlanExecutor {
  constructor(
    private readonly plans: AdvisorPlanRepository,
    private readonly spaces: SpaceRepository,
  ) {}

  async execute(scope: AdvisorPlanScope & { planId: string }): Promise<AdvisorPlanDto | null> {
    let plan = await this.plans.getPlan(
      scope.organizationId,
      scope.spaceId,
      scope.sessionId,
      scope.planId,
      scope.actorId,
    )
    if (!plan || plan.status !== 'executing') return plan

    for (const candidate of plan.steps) {
      if (candidate.status === 'succeeded' || candidate.status === 'action_required') continue
      if (candidate.kind === 'manual_action') {
        const updated = await this.plans.finishStep({
          ...scope,
          planId: plan.id,
          stepId: candidate.id,
          expectedVersion: candidate.version,
          status: 'action_required',
        })
        if (!updated) throw new Error('The Advisor manual step changed concurrently.')
        continue
      }
      if (candidate.status !== 'proposed' && candidate.status !== 'failed') continue
      const started = await this.plans.startStep({
        ...scope,
        planId: plan.id,
        stepId: candidate.id,
        expectedVersion: candidate.version,
      })
      if (!started || started.kind !== 'control_plane') {
        throw new Error('The Advisor controlled step changed concurrently.')
      }
      try {
        await this.executeControlStep(scope, plan.id, started)
        const finished = await this.plans.finishStep({
          ...scope,
          planId: plan.id,
          stepId: started.id,
          expectedVersion: started.version,
          status: 'succeeded',
        })
        if (!finished) throw new Error('The Advisor controlled step could not be completed.')
      } catch (cause) {
        const failure = safeFailure(cause)
        const failed = await this.plans.finishStep({
          ...scope,
          planId: plan.id,
          stepId: started.id,
          expectedVersion: started.version,
          status: 'failed',
          failureCode: failure.code,
          failureMessage: failure.message,
        })
        if (!failed) throw cause
      }
    }

    plan = await this.plans.getPlan(
      scope.organizationId,
      scope.spaceId,
      scope.sessionId,
      scope.planId,
      scope.actorId,
    )
    if (!plan || plan.status !== 'executing') return plan
    const status = plan.steps.some((step) => step.status === 'failed')
      ? 'failed'
      : plan.steps.some((step) => step.status === 'action_required')
        ? 'action_required'
        : 'succeeded'
    return this.plans.finishPlan({
      ...scope,
      planId: plan.id,
      expectedVersion: plan.version,
      status,
    })
  }

  private async executeControlStep(
    scope: AdvisorPlanScope,
    planId: string,
    step: Extract<AdvisorPlanStepDto, { kind: 'control_plane' }>,
  ) {
    const idempotencyKey = `advisor:${planId}:${step.id}`
    const requestId = `${scope.requestId}:advisor:${step.ordinal}`
    if (step.operation === 'organization.set_default_space') {
      const result = await this.spaces.setDefaultSpace({
        organizationId: scope.organizationId,
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        requestId,
        expectedVersion: step.before.version,
        idempotencyKey,
      })
      if (!result) throw new SpaceValidationError('The target Space is no longer available.')
      return
    }
    const request: UpdateSpaceRequest = {
      ...(step.after.description !== step.before.description
        ? { description: step.after.description }
        : {}),
      ...(step.after.defaultExpertId !== step.before.defaultExpertId
        ? { defaultExpertId: step.after.defaultExpertId }
        : {}),
      ...(step.after.defaultEnvironmentId !== step.before.defaultEnvironmentId
        ? { defaultEnvironmentId: step.after.defaultEnvironmentId }
        : {}),
    }
    const result = await this.spaces.updateSpace({
      organizationId: scope.organizationId,
      spaceId: scope.spaceId,
      actorId: scope.actorId,
      requestId,
      expectedVersion: step.before.version,
      idempotencyKey,
      request,
    })
    if (!result) throw new SpaceValidationError('The target Space is no longer available.')
  }
}

function safeFailure(cause: unknown) {
  if (cause instanceof SpaceVersionConflictError) return {
    code: 'version_conflict',
    message: 'The Space changed after this plan was proposed. Generate a new plan from current state.',
  }
  if (cause instanceof SpacePermissionError) return {
    code: 'permission_denied',
    message: 'The confirming actor no longer has permission to apply this Space change.',
  }
  if (cause instanceof SpaceValidationError) return {
    code: 'validation_failed',
    message: 'The planned Space change no longer satisfies current control-plane constraints.',
  }
  return {
    code: 'execution_unavailable',
    message: 'The controlled Space operation is temporarily unavailable and can be retried safely.',
  }
}
