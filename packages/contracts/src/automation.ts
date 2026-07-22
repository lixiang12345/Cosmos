import { z } from 'zod'
import { SessionDtoSchema } from './session.js'

const IdentifierSchema = z.string().trim().min(1).max(128)
const TimestampSchema = z.string().datetime({ offset: true })
const EventTypeSchema = z.string().trim().min(1).max(256)

export const AutomationSourceSchema = z.enum(['github', 'slack', 'webhook', 'schedule'])
export type AutomationSource = z.infer<typeof AutomationSourceSchema>

export const AutomationStatusSchema = z.enum(['draft', 'paused', 'active', 'error'])
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>

export const AutomationEventStatusSchema = z.enum([
  'received',
  'matched',
  'ignored',
  'dispatching',
  'dispatched',
  'failed',
])
export type AutomationEventStatus = z.infer<typeof AutomationEventStatusSchema>

type FilterIssue = { path: PropertyKey[]; message: string }

function validateFilter(value: unknown): FilterIssue[] {
  const issues: FilterIssue[] = []
  let nodes = 0
  const visitOperand = (operand: unknown, path: PropertyKey[], depth: number) => {
    if (operand === null || ['string', 'number', 'boolean'].includes(typeof operand)) return
    visit(operand, path, depth)
  }
  const visit = (node: unknown, path: PropertyKey[], depth: number) => {
    nodes += 1
    if (nodes > 64) {
      issues.push({ path, message: 'Automation filters may contain at most 64 nodes.' })
      return
    }
    if (depth > 8) {
      issues.push({ path, message: 'Automation filters may be at most 8 levels deep.' })
      return
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      issues.push({ path, message: 'Automation filter rules must be objects.' })
      return
    }
    const entries = Object.entries(node)
    if (entries.length === 0 && path.length === 0) return
    if (entries.length !== 1) {
      issues.push({ path, message: 'Each Automation filter rule must contain exactly one operator.' })
      return
    }
    const [operator, argument] = entries[0]!
    if (operator === 'var') {
      const valid = typeof argument === 'string'
        || (Array.isArray(argument) && argument.length >= 1 && argument.length <= 2
          && typeof argument[0] === 'string')
      if (!valid) issues.push({ path: [...path, operator], message: 'var requires a path string and an optional default.' })
      return
    }
    if (operator === 'and' || operator === 'or') {
      if (!Array.isArray(argument) || argument.length < 1 || argument.length > 10) {
        issues.push({ path: [...path, operator], message: `${operator} requires between 1 and 10 rules.` })
        return
      }
      argument.forEach((child, index) => visit(child, [...path, operator, index], depth + 1))
      return
    }
    if (operator === '==' || operator === '!=' || operator === 'in') {
      if (!Array.isArray(argument) || argument.length !== 2) {
        issues.push({ path: [...path, operator], message: `${operator} requires exactly two operands.` })
        return
      }
      argument.forEach((operand, index) => visitOperand(operand, [...path, operator, index], depth + 1))
      return
    }
    issues.push({ path: [...path, operator], message: `Unsupported Automation filter operator: ${operator}.` })
  }
  visit(value, [], 0)
  return issues
}

export const AutomationFilterSchema = z.record(z.string(), z.unknown()).superRefine((filter, context) => {
  for (const issue of validateFilter(filter)) context.addIssue({ code: 'custom', ...issue })
})
export type AutomationFilter = z.infer<typeof AutomationFilterSchema>

export const AutomationDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  expertId: IdentifierSchema,
  expertRevisionId: IdentifierSchema,
  triggerId: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  source: AutomationSourceSchema,
  eventType: EventTypeSchema,
  filter: AutomationFilterSchema,
  status: AutomationStatusSchema,
  autoArchive: z.boolean(),
  serviceAccountId: IdentifierSchema,
  lastTestedAt: TimestampSchema.nullable(),
  lastMatchedAt: TimestampSchema.nullable(),
  matchCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((automation, context) => {
  if (automation.id !== automation.triggerId) {
    context.addIssue({ code: 'custom', path: ['triggerId'], message: 'Automation id must be the authoritative Trigger id.' })
  }
})
export type AutomationDto = z.infer<typeof AutomationDtoSchema>

export const CreateAutomationRequestSchema = z.object({
  expertId: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  source: AutomationSourceSchema,
  eventType: EventTypeSchema,
  filter: AutomationFilterSchema.default({}),
  autoArchive: z.boolean().default(false),
  serviceAccountId: IdentifierSchema,
}).strict()
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequestSchema>
export type CreateAutomationRequestInput = z.input<typeof CreateAutomationRequestSchema>

export const UpdateAutomationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  eventType: EventTypeSchema.optional(),
  filter: AutomationFilterSchema.optional(),
  autoArchive: z.boolean().optional(),
  serviceAccountId: IdentifierSchema.optional(),
}).strict().refine((request) => Object.keys(request).length > 0, {
  message: 'At least one Automation field must be provided.',
})
export type UpdateAutomationRequest = z.infer<typeof UpdateAutomationRequestSchema>
export type UpdateAutomationRequestInput = z.input<typeof UpdateAutomationRequestSchema>

export const AutomationMutationResponseSchema = z.object({
  automation: AutomationDtoSchema,
  replayed: z.boolean(),
}).strict()
export type AutomationMutationResponse = z.infer<typeof AutomationMutationResponseSchema>

export const AutomationListResponseSchema = z.object({
  items: z.array(AutomationDtoSchema).max(100),
  projectionUpdatedAt: TimestampSchema.nullable(),
}).strict()
export type AutomationListResponse = z.infer<typeof AutomationListResponseSchema>

const EventPayloadSchema = z.record(z.string(), z.unknown())

export const TestAutomationRequestSchema = z.object({
  eventType: EventTypeSchema.optional(),
  payload: EventPayloadSchema,
}).strict()
export type TestAutomationRequest = z.infer<typeof TestAutomationRequestSchema>

export const AutomationTestResultSchema = z.object({
  automation: AutomationDtoSchema,
  matched: z.boolean(),
  explanation: z.string().trim().min(1).max(2_000),
}).strict()
export type AutomationTestResult = z.infer<typeof AutomationTestResultSchema>

export const ReceiveAutomationEventRequestSchema = z.object({
  source: AutomationSourceSchema,
  eventType: EventTypeSchema,
  externalId: z.string().trim().min(1).max(512),
  headers: EventPayloadSchema.default({}),
  payload: EventPayloadSchema,
}).strict()
export type ReceiveAutomationEventRequest = z.infer<typeof ReceiveAutomationEventRequestSchema>
export type ReceiveAutomationEventRequestInput = z.input<typeof ReceiveAutomationEventRequestSchema>

export const AutomationEventDtoSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  source: AutomationSourceSchema,
  eventType: EventTypeSchema,
  externalId: z.string().trim().min(1).max(512),
  headers: EventPayloadSchema,
  payload: EventPayloadSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: AutomationEventStatusSchema,
  automationId: IdentifierSchema.nullable(),
  sessionId: IdentifierSchema.nullable(),
  matchExplanation: z.string().max(2_000),
  errorCode: z.string().trim().min(1).max(128).nullable(),
  errorMessage: z.string().trim().min(1).max(2_000).nullable(),
  receivedAt: TimestampSchema,
  processedAt: TimestampSchema.nullable(),
}).strict().superRefine((event, context) => {
  if ((event.errorCode === null) !== (event.errorMessage === null)) {
    context.addIssue({ code: 'custom', path: ['errorMessage'], message: 'Event error code and message must be present together.' })
  }
  if (event.status === 'dispatched' && (event.automationId === null || event.sessionId === null)) {
    context.addIssue({ code: 'custom', path: ['sessionId'], message: 'A dispatched Event requires Automation and Session references.' })
  }
})
export type AutomationEventDto = z.infer<typeof AutomationEventDtoSchema>

export const AutomationEventReceiptSchema = z.object({
  event: AutomationEventDtoSchema,
  duplicate: z.boolean(),
}).strict()
export type AutomationEventReceipt = z.infer<typeof AutomationEventReceiptSchema>

export const AutomationEventListResponseSchema = z.object({
  items: z.array(AutomationEventDtoSchema).max(100),
  projectionUpdatedAt: TimestampSchema.nullable(),
}).strict()
export type AutomationEventListResponse = z.infer<typeof AutomationEventListResponseSchema>

export const AutomationRunDtoSchema = z.object({
  automationId: IdentifierSchema,
  automationName: z.string().trim().min(1).max(160),
  eventId: IdentifierSchema,
  source: AutomationSourceSchema,
  eventType: EventTypeSchema,
  receivedAt: TimestampSchema,
  session: SessionDtoSchema,
}).strict()
export type AutomationRunDto = z.infer<typeof AutomationRunDtoSchema>

export const AutomationRunListResponseSchema = z.object({
  items: z.array(AutomationRunDtoSchema).max(100),
  projectionUpdatedAt: TimestampSchema.nullable(),
}).strict()
export type AutomationRunListResponse = z.infer<typeof AutomationRunListResponseSchema>
