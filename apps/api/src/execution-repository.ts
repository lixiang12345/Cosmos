export type ExecutionLeaseFence = Readonly<{
  organizationId: string
  spaceId: string
  sessionId: string
  turnId: string
  commandId: string
  attemptId: string
  attemptNumber: number
  leaseOwner: string
}>

export type ExecutionClaim = ExecutionLeaseFence & Readonly<{
  requestId: string
  requestedBy: string
  requestedByKind: 'user' | 'service_account'
  model: string
  systemPrompt: string
  taskContext: string
  leaseExpiresAt: string
}>

export type ClaimNextExecutionOptions = Readonly<{
  leaseOwner: string
  leaseDurationMs: number
  now?: Date
}>

export type HeartbeatExecutionInput = Readonly<{
  claim: ExecutionClaim
  leaseDurationMs: number
  now?: Date
}>

export type CompleteExecutionInput = Readonly<{
  claim: ExecutionClaim
  output: string
  providerModel: string
  now?: Date
}>

export type FailExecutionInput = Readonly<{
  claim: ExecutionClaim
  classification: 'transient' | 'terminal'
  code: string
  message: string
  providerModel?: string
  retryDelayMs?: number
  now?: Date
}>

export type FailExecutionResult = 'requeued' | 'failed' | 'canceled' | 'stale'

export type ReapExpiredExecutionsOptions = Readonly<{
  limit?: number
  retryDelayMs?: number
  now?: Date
}>

export type ReapExpiredExecutionsResult = Readonly<{
  requeued: number
  failed: number
  canceled: number
}>

export interface ExecutionRepository {
  claimNext(options: ClaimNextExecutionOptions): Promise<ExecutionClaim | null>
  heartbeat(input: HeartbeatExecutionInput): Promise<boolean>
  complete(input: CompleteExecutionInput): Promise<boolean>
  fail(input: FailExecutionInput): Promise<FailExecutionResult>
  reapExpired(options?: ReapExpiredExecutionsOptions): Promise<ReapExpiredExecutionsResult>
}
