export type OutboxStream = 'session' | 'environment' | 'automation' | 'space'

export type OutboxDeliveryErrorCode =
  | 'receiver_rejected'
  | 'receiver_redirect'
  | 'receiver_server_error'
  | 'receiver_timeout'
  | 'receiver_network_error'
  | 'receiver_interrupted'

export type OutboxReplayReason =
  | 'receiver_policy_fixed'
  | 'receiver_recovered'
  | 'operator_reconciled'

export type OutboxDeliveryClaim = Readonly<{
  stream: OutboxStream
  organizationId: string
  spaceId: string
  sourceId: string
  eventType: string
  occurredAt: string
  attempt: number
  leaseOwner: string
  version: number
}>

export type OutboxDeadLetter = Readonly<{
  stream: OutboxStream
  organizationId: string
  spaceId: string
  sourceId: string
  eventType: string
  occurredAt: string
  attempts: number
  lastErrorCode: OutboxDeliveryErrorCode
  deadLetteredAt: string
  version: number
}>

export interface OutboxDeliveryRepository {
  claimNext(input: {
    leaseOwner: string
    leaseDurationMs: number
  }): Promise<OutboxDeliveryClaim | null>
  markDelivered(claim: OutboxDeliveryClaim): Promise<boolean>
  markFailed(input: {
    claim: OutboxDeliveryClaim
    errorCode: OutboxDeliveryErrorCode
    retryAt?: Date
  }): Promise<'retrying' | 'dead_letter' | 'fence_lost'>
  listDeadLetters(limit: number): Promise<readonly OutboxDeadLetter[]>
  replayDeadLetter(input: {
    stream: OutboxStream
    organizationId: string
    spaceId: string
    sourceId: string
    expectedVersion: number
    actorId: string
    reason: OutboxReplayReason
  }): Promise<boolean>
}
