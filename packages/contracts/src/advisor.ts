import { z } from 'zod'
import { ToolRiskLevelSchema } from './tool-approval.js'

const IdentifierSchema = z.string().trim().min(1).max(128)
const ActorIdentifierSchema = z.string().trim().min(1).max(256)
const TimestampSchema = z.string().datetime({ offset: true })
const SummarySchema = z.string().trim().min(1).max(2_000)
const PlanNoteSchema = z.string().trim().min(1).max(1_000)

export const AdvisorPlanStatusSchema = z.enum([
  'proposed', 'executing', 'succeeded', 'failed', 'rejected', 'action_required',
])
export type AdvisorPlanStatus = z.infer<typeof AdvisorPlanStatusSchema>

export const AdvisorPlanStepStatusSchema = z.enum([
  'proposed', 'executing', 'succeeded', 'failed', 'rejected', 'action_required',
])
export type AdvisorPlanStepStatus = z.infer<typeof AdvisorPlanStepStatusSchema>

export const AdvisorControlOperationSchema = z.enum([
  'space.update', 'organization.set_default_space',
])
export type AdvisorControlOperation = z.infer<typeof AdvisorControlOperationSchema>

export const AdvisorManualActionKindSchema = z.enum(['oauth', 'secret'])
export type AdvisorManualActionKind = z.infer<typeof AdvisorManualActionKindSchema>

export const AdvisorSpaceUpdateChangesSchema = z.object({
  description: z.string().max(2_000).optional(),
  defaultExpertId: IdentifierSchema.nullable().optional(),
  defaultEnvironmentId: IdentifierSchema.nullable().optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, {
  message: 'At least one supported Space change is required',
})
export type AdvisorSpaceUpdateChanges = z.infer<typeof AdvisorSpaceUpdateChangesSchema>

const AdvisorControlPlanStepProposalSchema = z.discriminatedUnion('operation', [
  z.object({
    kind: z.literal('control_plane'),
    operation: z.literal('space.update'),
    changes: AdvisorSpaceUpdateChangesSchema,
    rationale: PlanNoteSchema,
  }).strict(),
  z.object({
    kind: z.literal('control_plane'),
    operation: z.literal('organization.set_default_space'),
    rationale: PlanNoteSchema,
  }).strict(),
])

const AdvisorManualPlanStepProposalSchema = z.object({
  kind: z.literal('manual_action'),
  action: AdvisorManualActionKindSchema,
  label: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(1).max(2_000),
}).strict()

export const AdvisorPlanProposalSchema = z.object({
  summary: SummarySchema,
  dependencies: z.array(PlanNoteSchema).max(10).default([]),
  risks: z.array(PlanNoteSchema).max(10).default([]),
  steps: z.array(z.union([
    AdvisorControlPlanStepProposalSchema,
    AdvisorManualPlanStepProposalSchema,
  ])).min(1).max(10),
}).strict().superRefine((plan, context) => {
  if (plan.steps.filter((step) => step.kind === 'control_plane').length > 1) {
    context.addIssue({
      code: 'custom',
      path: ['steps'],
      message: 'One Advisor plan can contain at most one controlled mutation',
    })
  }
})
export type AdvisorPlanProposal = z.infer<typeof AdvisorPlanProposalSchema>

export const AdvisorSpaceStateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2_000),
  defaultExpertId: IdentifierSchema.nullable(),
  defaultEnvironmentId: IdentifierSchema.nullable(),
  isDefault: z.boolean(),
  version: z.number().int().positive(),
}).strict()
export type AdvisorSpaceState = z.infer<typeof AdvisorSpaceStateSchema>

const AdvisorStepBaseSchema = z.object({
  id: IdentifierSchema,
  ordinal: z.number().int().positive(),
  status: AdvisorPlanStepStatusSchema,
  riskLevel: ToolRiskLevelSchema,
  failureCode: z.string().trim().min(1).max(128).nullable(),
  failureMessage: z.string().trim().min(1).max(1_000).nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
})

export const AdvisorControlPlanStepDtoSchema = AdvisorStepBaseSchema.extend({
  kind: z.literal('control_plane'),
  operation: AdvisorControlOperationSchema,
  targetType: z.literal('space'),
  targetId: IdentifierSchema,
  rationale: PlanNoteSchema,
  before: AdvisorSpaceStateSchema,
  after: AdvisorSpaceStateSchema,
  manualAction: z.null(),
}).strict()

export const AdvisorManualPlanStepDtoSchema = AdvisorStepBaseSchema.extend({
  kind: z.literal('manual_action'),
  operation: z.null(),
  targetType: z.null(),
  targetId: z.null(),
  rationale: z.null(),
  before: z.null(),
  after: z.null(),
  manualAction: z.object({
    kind: AdvisorManualActionKindSchema,
    label: z.string().trim().min(1).max(240),
    instructions: z.string().trim().min(1).max(2_000),
  }).strict(),
}).strict()

export const AdvisorPlanStepDtoSchema = z.union([
  AdvisorControlPlanStepDtoSchema,
  AdvisorManualPlanStepDtoSchema,
]).superRefine((step, context) => {
  const terminal = ['succeeded', 'failed', 'rejected', 'action_required'].includes(step.status)
  if (terminal !== (step.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'completedAt is required exactly for terminal steps' })
  }
  if ((step.status === 'executing') !== (step.startedAt !== null && step.completedAt === null)) {
    context.addIssue({ code: 'custom', path: ['startedAt'], message: 'executing steps require startedAt and no completedAt' })
  }
  if ((step.status === 'failed') !== (step.failureCode !== null && step.failureMessage !== null)) {
    context.addIssue({ code: 'custom', path: ['failureCode'], message: 'failure details are required exactly for failed steps' })
  }
})
export type AdvisorPlanStepDto = z.infer<typeof AdvisorPlanStepDtoSchema>

export const AdvisorPlanDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  id: IdentifierSchema,
  summary: SummarySchema,
  dependencies: z.array(PlanNoteSchema).max(10),
  risks: z.array(PlanNoteSchema).max(10),
  status: AdvisorPlanStatusSchema,
  steps: z.array(AdvisorPlanStepDtoSchema).min(1).max(10),
  requestedBy: ActorIdentifierSchema,
  confirmedBy: ActorIdentifierSchema.nullable(),
  confirmedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().positive(),
}).strict().superRefine((plan, context) => {
  if ((plan.confirmedBy === null) !== (plan.confirmedAt === null)) {
    context.addIssue({ code: 'custom', path: ['confirmedAt'], message: 'confirmedBy and confirmedAt must be present together' })
  }
  if (plan.status === 'proposed' && plan.confirmedAt !== null) {
    context.addIssue({ code: 'custom', path: ['confirmedAt'], message: 'A proposed plan cannot already be confirmed' })
  }
})
export type AdvisorPlanDto = z.infer<typeof AdvisorPlanDtoSchema>

export const AdvisorPlanListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  items: z.array(AdvisorPlanDtoSchema).max(50),
}).strict()
export type AdvisorPlanListResponse = z.infer<typeof AdvisorPlanListResponseSchema>

export const AdvisorPlanDecisionRequestSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  note: z.string().trim().max(2_000).optional(),
}).strict()
export type AdvisorPlanDecisionRequest = z.infer<typeof AdvisorPlanDecisionRequestSchema>
export type AdvisorPlanDecisionRequestInput = z.input<typeof AdvisorPlanDecisionRequestSchema>

export const AdvisorPlanRetryRequestSchema = z.object({}).strict()
export type AdvisorPlanRetryRequest = z.infer<typeof AdvisorPlanRetryRequestSchema>
