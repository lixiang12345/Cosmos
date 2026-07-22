import { createHmac, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { SecurityAuditRecord, SecurityAuditRepository } from './security-audit-repository.js'

export type PostgresSecurityAuditRepositoryOptions = {
  createId?: () => string
  hmacKeyId?: string
  now?: () => Date
}

function outcome(statusCode: number) {
  if (statusCode === 401 || statusCode === 403 || statusCode === 404) return 'denied'
  return statusCode >= 500 ? 'failed' : 'rejected'
}

export class PostgresSecurityAuditRepository implements SecurityAuditRepository {
  private readonly key: Buffer
  private readonly createId: () => string
  private readonly hmacKeyId: string
  private readonly now: () => Date

  constructor(
    private readonly pool: Pool,
    hmacKey: string,
    options: PostgresSecurityAuditRepositoryOptions = {},
  ) {
    if (!/^[a-f0-9]{64}$/i.test(hmacKey)) {
      throw new Error('Security audit HMAC key must contain exactly 64 hexadecimal characters.')
    }
    const hmacKeyId = options.hmacKeyId ?? 'local'
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(hmacKeyId)) {
      throw new Error('Security audit HMAC key id is invalid.')
    }
    this.key = Buffer.from(hmacKey, 'hex')
    this.createId = options.createId ?? randomUUID
    this.hmacKeyId = hmacKeyId
    this.now = options.now ?? (() => new Date())
  }

  private fingerprint(domain: string, value: string | undefined) {
    if (value === undefined) return null
    return createHmac('sha256', this.key).update(domain).update('\0').update(value).digest('hex')
  }

  async append(record: SecurityAuditRecord): Promise<void> {
    const target = record.target && Object.keys(record.target).length > 0
      ? JSON.stringify(Object.fromEntries(Object.entries(record.target).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))))
      : undefined
    await this.pool.query(`
      INSERT INTO cosmos_security_audit_events (
        audit_event_id, request_id, hmac_key_id, actor_fingerprint, actor_kind,
        method, route_pattern, outcome, status_code, error_code,
        organization_fingerprint, space_fingerprint, target_fingerprint,
        idempotency_key_fingerprint, client_ip_fingerprint,
        user_agent_fingerprint, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17
      )
    `, [
      this.createId(),
      record.requestId,
      this.hmacKeyId,
      this.fingerprint('actor', record.actor?.id),
      record.actor?.kind ?? null,
      record.method,
      record.routePattern,
      outcome(record.statusCode),
      record.statusCode,
      record.errorCode,
      this.fingerprint('organization', record.organizationId),
      this.fingerprint('space', record.spaceId),
      this.fingerprint('target', target),
      this.fingerprint('idempotency-key', record.idempotencyKey),
      this.fingerprint('client-ip', record.clientIp),
      this.fingerprint('user-agent', record.userAgent),
      this.now().toISOString(),
    ])
  }
}
