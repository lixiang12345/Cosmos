import { z } from 'zod'

const IdentifierSchema = z.string().trim().min(1).max(256)
const TimestampSchema = z.string().datetime({ offset: true })

export const ToolRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
export type ToolRiskLevel = z.infer<typeof ToolRiskLevelSchema>

export const ToolCallStatusSchema = z.enum([
  'queued', 'approval_required', 'running', 'succeeded', 'failed', 'canceled',
])
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>

export const ToolCallDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  turnId: IdentifierSchema,
  attemptId: IdentifierSchema,
  workerId: IdentifierSchema.nullable(),
  toolName: z.string().trim().min(1).max(160),
  operation: z.string().trim().min(1).max(160),
  riskLevel: ToolRiskLevelSchema,
  status: ToolCallStatusSchema,
  inputSummary: z.string().trim().min(1).max(4_000),
  outputSummary: z.string().trim().min(1).max(4_000).nullable(),
  approvalId: IdentifierSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((toolCall, context) => {
  const terminal = ['succeeded', 'failed', 'canceled'].includes(toolCall.status)
  if (terminal !== (toolCall.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'completedAt must be present exactly for terminal ToolCalls' })
  }
  if (toolCall.status === 'running' && toolCall.startedAt === null) {
    context.addIssue({ code: 'custom', path: ['startedAt'], message: 'A running ToolCall must have startedAt' })
  }
  if (toolCall.status === 'approval_required' && toolCall.approvalId === null) {
    context.addIssue({ code: 'custom', path: ['approvalId'], message: 'An approval_required ToolCall must reference an Approval' })
  }
})
export type ToolCallDto = z.infer<typeof ToolCallDtoSchema>

const PageMetadataSchema = z.object({
  nextCursor: z.string().trim().min(1).max(2_048).nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== null)) {
    context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'nextCursor must be present exactly when hasMore is true' })
  }
})

export const ToolCallListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  items: z.array(ToolCallDtoSchema).max(100),
  page: PageMetadataSchema,
}).strict().superRefine((response, context) => {
  response.items.forEach((item, index) => {
    if (item.organizationId !== response.organizationId || item.spaceId !== response.spaceId || item.sessionId !== response.sessionId) {
      context.addIssue({ code: 'custom', path: ['items', index], message: 'ToolCall scope must match the page scope' })
    }
  })
})
export type ToolCallListResponse = z.infer<typeof ToolCallListResponseSchema>

export const ApprovalStatusSchema = z.enum([
  'pending', 'approved', 'changes_requested', 'rejected', 'expired', 'canceled',
])
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const ApprovalDecisionValueSchema = z.enum(['approved', 'changes_requested', 'rejected'])
export type ApprovalDecisionValue = z.infer<typeof ApprovalDecisionValueSchema>

export const ApprovalEvidenceSchema = z.object({
  type: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(240),
  value: z.string().trim().min(1).max(2_048),
}).strict()
export type ApprovalEvidence = z.infer<typeof ApprovalEvidenceSchema>

export const ApprovalDecisionRequestSchema = z.object({
  decision: ApprovalDecisionValueSchema,
  note: z.string().trim().max(5_000).optional(),
}).strict()
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>
export type ApprovalDecisionRequestInput = z.input<typeof ApprovalDecisionRequestSchema>

export const ApprovalDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  turnId: IdentifierSchema,
  toolCallId: IdentifierSchema,
  action: z.string().trim().min(1).max(240),
  riskLevel: ToolRiskLevelSchema,
  reasons: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  evidence: z.array(ApprovalEvidenceSchema).max(20),
  status: ApprovalStatusSchema,
  requestedBy: IdentifierSchema,
  assignedTo: z.array(IdentifierSchema).min(1).max(20),
  requiredApprovals: z.number().int().min(1).max(2),
  approvalCount: z.number().int().min(0).max(2),
  actorHasDecided: z.boolean().default(false),
  expiresAt: TimestampSchema,
  decidedBy: IdentifierSchema.nullable(),
  decisionNote: z.string().max(5_000).nullable(),
  decidedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().positive(),
}).strict().superRefine((approval, context) => {
  if (approval.approvalCount > approval.requiredApprovals) {
    context.addIssue({ code: 'custom', path: ['approvalCount'], message: 'approvalCount cannot exceed requiredApprovals' })
  }
  const terminal = approval.status !== 'pending'
  if (terminal !== (approval.decidedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['decidedAt'], message: 'decidedAt must be present exactly for terminal Approvals' })
  }
  if ((approval.decidedBy === null) !== (approval.decisionNote === null)) {
    context.addIssue({ code: 'custom', path: ['decisionNote'], message: 'decidedBy and decisionNote must be present together' })
  }
  if (approval.status === 'approved' && approval.approvalCount !== approval.requiredApprovals) {
    context.addIssue({ code: 'custom', path: ['approvalCount'], message: 'An approved Approval must contain every required approval' })
  }
})
export type ApprovalDto = z.infer<typeof ApprovalDtoSchema>

export const ApprovalListResponseSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  items: z.array(ApprovalDtoSchema).max(100),
  page: PageMetadataSchema,
}).strict().superRefine((response, context) => {
  response.items.forEach((item, index) => {
    if (item.organizationId !== response.organizationId || item.spaceId !== response.spaceId) {
      context.addIssue({ code: 'custom', path: ['items', index], message: 'Approval scope must match the page scope' })
    }
  })
})
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>

export const ToolCallInputHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
