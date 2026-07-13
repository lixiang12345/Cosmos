import { z } from 'zod'
import {
  ApprovalDecisionValueSchema,
  ApprovalStatusSchema,
  ToolCallStatusSchema,
  ToolRiskLevelSchema,
} from './tool-approval.js'

export const SessionStatusSchema = z.enum([
  'draft',
  'queued',
  'active',
  'waiting',
  'paused',
  'completed',
  'failed',
  'canceled',
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionVisibilitySchema = z.enum(['private', 'space'])

export type SessionVisibility = z.infer<typeof SessionVisibilitySchema>

const IdentifierSchema = z.string().trim().min(1).max(128)
const ActorIdentifierSchema = z.string().trim().min(1).max(256)
const TimestampSchema = z.string().datetime({ offset: true })

export const MessageCreateSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10).default([]),
}).strict()

export type MessageCreate = z.infer<typeof MessageCreateSchema>
export type MessageCreateInput = z.input<typeof MessageCreateSchema>

export const CreateSessionAdvancedOverridesSchema = z.object({
  repositoryId: IdentifierSchema.optional(),
  baseBranch: z.string().trim().min(1).max(255).optional(),
}).strict()

export type CreateSessionAdvancedOverrides = z.infer<typeof CreateSessionAdvancedOverridesSchema>

export const CreateSessionRequestSchema = z.object({
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160).optional(),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
  title: z.string().trim().min(1).max(240),
  visibility: SessionVisibilitySchema.default('private'),
  start: z.boolean().default(true),
  message: MessageCreateSchema,
  repository: z.string().trim().min(1).max(512).optional(),
  baseBranch: z.string().trim().min(1).max(255).optional(),
  advancedOverrides: CreateSessionAdvancedOverridesSchema.optional(),
}).strict()

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>
export type CreateSessionRequestInput = z.input<typeof CreateSessionRequestSchema>

export const RenameSessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(240),
}).strict()

export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>
export type RenameSessionRequestInput = z.input<typeof RenameSessionRequestSchema>

export const CancelSessionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict()

export type CancelSessionRequest = z.infer<typeof CancelSessionRequestSchema>
export type CancelSessionRequestInput = z.input<typeof CancelSessionRequestSchema>

export const SharePrincipalTypeSchema = z.enum(['user', 'group'])
export type SharePrincipalType = z.infer<typeof SharePrincipalTypeSchema>

export const ShareGrantRoleSchema = z.enum(['viewer', 'collaborator'])
export type ShareGrantRole = z.infer<typeof ShareGrantRoleSchema>

export const CreateShareGrantRequestSchema = z.object({
  principalType: SharePrincipalTypeSchema,
  principalId: ActorIdentifierSchema,
  role: ShareGrantRoleSchema,
  expiresAt: TimestampSchema.nullable().optional(),
}).strict()

export type CreateShareGrantRequest = z.infer<typeof CreateShareGrantRequestSchema>
export type CreateShareGrantRequestInput = z.input<typeof CreateShareGrantRequestSchema>

export const ShareGrantDtoSchema = z.object({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
  id: IdentifierSchema,
  principalType: SharePrincipalTypeSchema,
  principalId: ActorIdentifierSchema,
  role: ShareGrantRoleSchema,
  expiresAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  createdBy: ActorIdentifierSchema,
  revokedAt: TimestampSchema.nullable(),
  revokedBy: ActorIdentifierSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((grant, context) => {
  if ((grant.revokedAt === null) !== (grant.revokedBy === null)) {
    context.addIssue({
      code: 'custom',
      path: ['revokedBy'],
      message: 'revokedAt and revokedBy must be present together',
    })
  }
  if (grant.revokedAt !== null && Date.parse(grant.revokedAt) < Date.parse(grant.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['revokedAt'],
      message: 'revokedAt cannot precede createdAt',
    })
  }
})

export type ShareGrantDto = z.infer<typeof ShareGrantDtoSchema>

export const SessionShareListResponseSchema = z.object({
  items: z.array(ShareGrantDtoSchema),
  page: z.object({
    nextCursor: z.string().trim().min(1).nullable(),
    hasMore: z.boolean(),
    projectionUpdatedAt: TimestampSchema.nullable(),
  }).strict(),
}).strict().superRefine((response, context) => {
  if (response.page.hasMore !== (response.page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['page', 'nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }
})

export type SessionShareListResponse = z.infer<typeof SessionShareListResponseSchema>

export const SessionConfigurationResolutionVersionSchema = z.union([
  z.literal(0),
  z.literal(1),
])

export type SessionConfigurationResolutionVersion = z.infer<typeof SessionConfigurationResolutionVersionSchema>

const SessionDtoBaseSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().max(100_000),
  expertId: IdentifierSchema,
  expertName: z.string().trim().min(1).max(160),
  expertVersion: z.number().int().positive().optional(),
  environmentId: IdentifierSchema.optional(),
  configurationResolutionVersion: SessionConfigurationResolutionVersionSchema.default(0),
  expertRevisionId: IdentifierSchema.optional(),
  environmentRevisionId: IdentifierSchema.optional(),
  repositoryId: IdentifierSchema.optional(),
  repository: z.string().trim().min(1).max(512),
  baseBranch: z.string().trim().min(1).max(255),
  visibility: SessionVisibilitySchema,
  status: SessionStatusSchema,
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10),
  source: z.literal('manual'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastActivityAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
}).strict()

const authoritativeConfigurationFields = [
  'expertRevisionId',
  'environmentRevisionId',
  'repositoryId',
] as const

export const SessionDtoSchema = SessionDtoBaseSchema.superRefine((session, context) => {
  for (const field of authoritativeConfigurationFields) {
    if (session.configurationResolutionVersion === 1 && session[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when configurationResolutionVersion is 1`,
      })
    }

    if (session.configurationResolutionVersion === 0 && session[field] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is not allowed when configurationResolutionVersion is 0`,
      })
    }
  }
})

export type SessionDto = z.infer<typeof SessionDtoSchema>
export type SessionDtoInput = z.input<typeof SessionDtoSchema>

export const SessionMessageSchema = z.object({
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  sequence: z.number().int().positive(),
  role: z.enum(['user', 'agent', 'tool', 'system', 'event']),
  actorId: ActorIdentifierSchema.nullable(),
  content: z.string().max(100_000),
  attachments: z.array(z.string().trim().min(1).max(2_048)).max(10),
  createdAt: TimestampSchema,
}).strict()

export type SessionMessage = z.infer<typeof SessionMessageSchema>

const SessionScopeShape = {
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
  sessionId: IdentifierSchema,
}

const PageMetadataSchema = z.object({
  nextCursor: z.string().trim().min(1).max(2_048).nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }
})

export const SessionMessageDtoSchema = SessionMessageSchema.extend({
  organizationId: IdentifierSchema,
  spaceId: IdentifierSchema,
}).strict()

export type SessionMessageDto = z.infer<typeof SessionMessageDtoSchema>

export const SessionMessagePageSchema = z.object({
  ...SessionScopeShape,
  items: z.array(SessionMessageDtoSchema).max(100),
  page: PageMetadataSchema,
}).strict().superRefine((response, context) => {
  let previousSequence = 0
  for (const [index, message] of response.items.entries()) {
    if (
      message.organizationId !== response.organizationId
      || message.spaceId !== response.spaceId
      || message.sessionId !== response.sessionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index],
        message: 'Message scope must match the page scope',
      })
    }
    if (message.sequence <= previousSequence) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'sequence'],
        message: 'Message sequence must be strictly increasing',
      })
    }
    previousSequence = message.sequence
  }
})

export type SessionMessagePage = z.infer<typeof SessionMessagePageSchema>

export const AttemptStatusSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting',
  'paused',
  'succeeded',
  'failed',
  'canceled',
])

export type AttemptStatus = z.infer<typeof AttemptStatusSchema>

const FailureCodeSchema = z.string().trim().min(1).max(128)

export const AttemptDtoSchema = z.object({
  ...SessionScopeShape,
  id: IdentifierSchema,
  turnId: IdentifierSchema,
  number: z.number().int().positive(),
  status: AttemptStatusSchema,
  model: z.string().trim().min(1).max(256),
  providerModel: z.string().trim().min(1).max(256).nullable(),
  runtimeId: IdentifierSchema.nullable(),
  failureCode: FailureCodeSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
}).strict().superRefine((attempt, context) => {
  const terminal = attempt.status === 'succeeded'
    || attempt.status === 'failed'
    || attempt.status === 'canceled'

  if (terminal !== (attempt.finishedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'finishedAt must be present exactly for terminal Attempts',
    })
  }
  if ((attempt.status === 'failed') !== (attempt.failureCode !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['failureCode'],
      message: 'failureCode must be present exactly for failed Attempts',
    })
  }
  if (attempt.status === 'queued' && attempt.startedAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['startedAt'],
      message: 'A queued Attempt cannot have startedAt',
    })
  }

  const createdAt = Date.parse(attempt.createdAt)
  const startedAt = attempt.startedAt === null ? null : Date.parse(attempt.startedAt)
  const finishedAt = attempt.finishedAt === null ? null : Date.parse(attempt.finishedAt)
  if (startedAt !== null && startedAt < createdAt) {
    context.addIssue({
      code: 'custom',
      path: ['startedAt'],
      message: 'startedAt cannot precede createdAt',
    })
  }
  if (finishedAt !== null && finishedAt < (startedAt ?? createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'finishedAt cannot precede the Attempt start',
    })
  }
})

export type AttemptDto = z.infer<typeof AttemptDtoSchema>

export const SessionEventTypeSchema = z.enum([
  'session.created',
  'session.updated',
  'session.renamed',
  'session.archived',
  'session.restored',
  'message.created',
  'turn.queued',
  'attempt.updated',
  'artifact.created',
  'artifact.updated',
  'artifact.removed',
  'file.version.created',
  'tool_call.updated',
  'approval.requested',
  'approval.decided',
])

export type SessionEventType = z.infer<typeof SessionEventTypeSchema>

const SessionEventBaseShape = {
  ...SessionScopeShape,
  eventId: IdentifierSchema,
  sequence: z.number().int().positive(),
  actorId: ActorIdentifierSchema,
  commandId: IdentifierSchema.nullable(),
  requestId: IdentifierSchema,
  occurredAt: TimestampSchema,
}

export const SessionEventDtoSchema = z.discriminatedUnion('type', [
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('session.created'),
    resourceType: z.literal('session'),
    resourceId: IdentifierSchema,
    payload: z.object({
      status: z.enum(['draft', 'queued']),
      visibility: SessionVisibilitySchema,
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('session.updated'),
    resourceType: z.literal('session'),
    resourceId: IdentifierSchema,
    payload: z.object({
      status: SessionStatusSchema,
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('session.renamed'),
    resourceType: z.literal('session'),
    resourceId: IdentifierSchema,
    payload: z.object({
      title: z.string().trim().min(1).max(240),
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('session.archived'),
    resourceType: z.literal('session'),
    resourceId: IdentifierSchema,
    payload: z.object({
      archivedAt: TimestampSchema,
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('session.restored'),
    resourceType: z.literal('session'),
    resourceId: IdentifierSchema,
    payload: z.object({
      archivedAt: z.null(),
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('message.created'),
    resourceType: z.literal('message'),
    resourceId: IdentifierSchema,
    payload: z.object({ messageId: IdentifierSchema }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('turn.queued'),
    resourceType: z.literal('turn'),
    resourceId: IdentifierSchema,
    payload: z.object({
      turnId: IdentifierSchema,
      status: z.literal('queued'),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('attempt.updated'),
    resourceType: z.literal('attempt'),
    resourceId: IdentifierSchema,
    payload: z.object({
      attemptId: IdentifierSchema,
      turnId: IdentifierSchema,
      number: z.number().int().positive(),
      status: AttemptStatusSchema,
      failureCode: FailureCodeSchema.nullable(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.enum(['artifact.created', 'artifact.updated', 'artifact.removed']),
    resourceType: z.literal('artifact'),
    resourceId: IdentifierSchema,
    payload: z.object({
      artifactId: IdentifierSchema,
      type: z.enum([
        'pull_request', 'branch', 'commit', 'issue', 'link',
        'test_report', 'deployment', 'document',
      ]),
      label: z.string().trim().min(1).max(240),
      status: z.string().trim().min(1).max(128).nullable(),
      version: z.number().int().positive(),
      removedAt: TimestampSchema.nullable(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('file.version.created'),
    resourceType: z.literal('file'),
    resourceId: IdentifierSchema,
    payload: z.object({
      fileId: IdentifierSchema,
      fileVersionId: IdentifierSchema,
      scope: z.enum(['workspace', 'user', 'organization']),
      path: z.string().min(1).max(1_024),
      version: z.number().int().positive(),
      size: z.number().int().nonnegative().max(1_048_576),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('tool_call.updated'),
    resourceType: z.literal('tool_call'),
    resourceId: IdentifierSchema,
    payload: z.object({
      toolCallId: IdentifierSchema,
      turnId: IdentifierSchema,
      attemptId: IdentifierSchema,
      toolName: z.string().trim().min(1).max(160),
      operation: z.string().trim().min(1).max(160),
      riskLevel: ToolRiskLevelSchema,
      status: ToolCallStatusSchema,
      approvalId: IdentifierSchema.nullable(),
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('approval.requested'),
    resourceType: z.literal('approval'),
    resourceId: IdentifierSchema,
    payload: z.object({
      approvalId: IdentifierSchema,
      toolCallId: IdentifierSchema,
      action: z.string().trim().min(1).max(240),
      riskLevel: ToolRiskLevelSchema,
      status: z.literal('pending'),
      requiredApprovals: z.number().int().min(1).max(2),
      expiresAt: TimestampSchema,
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    ...SessionEventBaseShape,
    type: z.literal('approval.decided'),
    resourceType: z.literal('approval'),
    resourceId: IdentifierSchema,
    payload: z.object({
      approvalId: IdentifierSchema,
      toolCallId: IdentifierSchema,
      recordedDecision: z.union([ApprovalDecisionValueSchema, z.literal('expired'), z.literal('canceled')]),
      status: ApprovalStatusSchema,
      approvalCount: z.number().int().min(0).max(2),
      requiredApprovals: z.number().int().min(1).max(2),
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
]).superRefine((event, context) => {
  if (event.resourceType === 'session'
    && event.resourceId !== event.sessionId) {
    context.addIssue({
      code: 'custom',
      path: ['resourceId'],
      message: 'A Session event resource must match sessionId',
    })
  }
  if (event.type === 'message.created' && event.resourceId !== event.payload.messageId) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'messageId'],
      message: 'messageId must match resourceId',
    })
  }
  if (event.type === 'turn.queued' && event.resourceId !== event.payload.turnId) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'turnId'],
      message: 'turnId must match resourceId',
    })
  }
  if (event.type === 'attempt.updated') {
    if (event.resourceId !== event.payload.attemptId) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'attemptId'],
        message: 'attemptId must match resourceId',
      })
    }
    if ((event.payload.status === 'failed') !== (event.payload.failureCode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'failureCode'],
        message: 'failureCode must be present exactly for failed Attempt events',
      })
    }
  }
  if ('artifactId' in event.payload) {
    if (event.resourceId !== event.payload.artifactId) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'artifactId'],
        message: 'artifactId must match resourceId',
      })
    }
    if ((event.type === 'artifact.removed') !== (event.payload.removedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['payload', 'removedAt'],
        message: 'removedAt must be present exactly for removed Artifact events',
      })
    }
  }
  if ('fileId' in event.payload && event.resourceId !== event.payload.fileId) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'fileId'],
      message: 'fileId must match resourceId',
    })
  }
  if ('toolCallId' in event.payload && event.resourceType === 'tool_call'
    && event.resourceId !== event.payload.toolCallId) {
    context.addIssue({ code: 'custom', path: ['payload', 'toolCallId'], message: 'toolCallId must match resourceId' })
  }
  if ('approvalId' in event.payload && event.resourceType === 'approval'
    && event.resourceId !== event.payload.approvalId) {
    context.addIssue({ code: 'custom', path: ['payload', 'approvalId'], message: 'approvalId must match resourceId' })
  }
})

export type SessionEventDto = z.infer<typeof SessionEventDtoSchema>

export const SessionEventCursorSchema = z.object({
  ...SessionScopeShape,
  sequence: z.number().int().nonnegative(),
}).strict()

export type SessionEventCursor = z.infer<typeof SessionEventCursorSchema>

export const SessionEventPageSchema = z.object({
  ...SessionScopeShape,
  items: z.array(SessionEventDtoSchema).max(500),
  page: z.object({
    nextCursor: SessionEventCursorSchema.nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict().superRefine((response, context) => {
  if (response.page.hasMore !== (response.page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['page', 'nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }

  let previousSequence = 0
  for (const [index, event] of response.items.entries()) {
    if (
      event.organizationId !== response.organizationId
      || event.spaceId !== response.spaceId
      || event.sessionId !== response.sessionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index],
        message: 'Event scope must match the page scope',
      })
    }
    if (event.sequence <= previousSequence) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'sequence'],
        message: 'Event sequence must be strictly increasing',
      })
    }
    previousSequence = event.sequence
  }

  const cursor = response.page.nextCursor
  if (cursor !== null) {
    if (
      cursor.organizationId !== response.organizationId
      || cursor.spaceId !== response.spaceId
      || cursor.sessionId !== response.sessionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['page', 'nextCursor'],
        message: 'Event cursor scope must match the page scope',
      })
    }
    const lastEvent = response.items.at(-1)
    if (!lastEvent || cursor.sequence !== lastEvent.sequence) {
      context.addIssue({
        code: 'custom',
        path: ['page', 'nextCursor', 'sequence'],
        message: 'Event cursor sequence must match the last event',
      })
    }
  }
})

export type SessionEventPage = z.infer<typeof SessionEventPageSchema>

export const SessionTurnSchema = z.object({
  id: IdentifierSchema,
  sessionId: IdentifierSchema,
  ordinal: z.number().int().positive(),
  initiatorType: z.enum(['user', 'event', 'system']),
  initiatorId: ActorIdentifierSchema.nullable(),
  inputMessageId: IdentifierSchema,
  status: z.enum(['queued', 'running', 'waiting_tool', 'waiting_approval', 'completed', 'failed', 'canceled']),
  queuedAt: TimestampSchema,
  version: z.number().int().positive(),
}).strict()

export type SessionTurn = z.infer<typeof SessionTurnSchema>

export const SessionCommandSchema = z.object({
  id: IdentifierSchema,
  type: z.enum([
    'session.start',
    'session.send',
    'session.pause',
    'session.resume',
    'session.cancel',
    'turn.retry',
  ]),
  status: z.enum(['accepted', 'queued', 'running', 'succeeded', 'failed', 'canceled']),
  resourceType: z.enum(['session', 'turn']),
  resourceId: IdentifierSchema,
  acceptedAt: TimestampSchema,
}).strict().superRefine((command, context) => {
  const expectedResourceType = command.type === 'session.pause'
    || command.type === 'session.resume'
    || command.type === 'session.cancel'
    ? 'session'
    : 'turn'
  if (command.resourceType !== expectedResourceType) {
    context.addIssue({
      code: 'custom',
      path: ['resourceType'],
      message: `${command.type} commands must target a ${expectedResourceType}`,
    })
  }
})

export type SessionCommand = z.infer<typeof SessionCommandSchema>

export const SessionControlResponseSchema = z.object({
  session: SessionDtoSchema,
  command: SessionCommandSchema,
}).strict().superRefine((response, context) => {
  if (response.command.resourceId !== response.session.id) {
    context.addIssue({
      code: 'custom',
      path: ['command', 'resourceId'],
      message: 'The control command must target the returned Session',
    })
  }
})

export type SessionControlResponse = z.infer<typeof SessionControlResponseSchema>

export const RetryTurnResponseSchema = z.object({
  session: SessionDtoSchema,
  attempt: AttemptDtoSchema,
  command: SessionCommandSchema,
}).strict().superRefine((response, context) => {
  if (
    response.attempt.organizationId !== response.session.organizationId
    || response.attempt.spaceId !== response.session.spaceId
    || response.attempt.sessionId !== response.session.id
  ) {
    context.addIssue({
      code: 'custom',
      path: ['attempt'],
      message: 'The retry Attempt scope must match the returned Session',
    })
  }
  if (response.command.resourceId !== response.attempt.turnId) {
    context.addIssue({
      code: 'custom',
      path: ['command', 'resourceId'],
      message: 'The retry command must target the returned Attempt Turn',
    })
  }
})

export type RetryTurnResponse = z.infer<typeof RetryTurnResponseSchema>

export const CreateSessionResponseSchema = z.object({
  session: SessionDtoSchema,
  message: SessionMessageSchema.optional(),
  turn: SessionTurnSchema.optional(),
  command: SessionCommandSchema.optional(),
}).strict()

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>

export const StartSessionResponseSchema = z.object({
  session: SessionDtoSchema,
  turn: SessionTurnSchema,
  command: SessionCommandSchema,
}).strict()

export type StartSessionResponse = z.infer<typeof StartSessionResponseSchema>

export const SendSessionMessageResponseSchema = z.object({
  session: SessionDtoSchema,
  message: SessionMessageSchema,
  turn: SessionTurnSchema,
  command: SessionCommandSchema,
}).strict()

export type SendSessionMessageResponse = z.infer<typeof SendSessionMessageResponseSchema>

export const SessionListResponseSchema = z.object({
  items: z.array(SessionDtoSchema),
  page: z.object({
    nextCursor: z.string().trim().min(1).nullable(),
    hasMore: z.boolean(),
    projectionUpdatedAt: TimestampSchema.nullable(),
  }).strict(),
}).strict().superRefine((response, context) => {
  if (response.page.hasMore !== (response.page.nextCursor !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['page', 'nextCursor'],
      message: 'nextCursor must be present exactly when hasMore is true',
    })
  }
})

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
