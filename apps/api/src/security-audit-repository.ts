export type SecurityAuditRecord = {
  requestId: string
  actor?: {
    id: string
    kind: 'user' | 'service_account'
  }
  method: string
  routePattern: string
  statusCode: number
  errorCode: string
  organizationId?: string
  spaceId?: string
  target?: Readonly<Record<string, string>>
  idempotencyKey?: string
  clientIp: string
  userAgent?: string
}

export interface SecurityAuditRepository {
  append(record: SecurityAuditRecord): Promise<void>
}
