import type { Pool } from 'pg'
import { withApiDatabaseContext } from './postgres-runtime-database.js'

export type SharedRateLimitResult = {
  allowed: boolean
  firstDenied: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

export interface OrganizationQuotaRepository {
  consumeApiRequest(input: {
    organizationId: string
    actorId: string
    now?: Date
  }): Promise<SharedRateLimitResult | null>
}

export class PostgresOrganizationQuotaRepository implements OrganizationQuotaRepository {
  constructor(private readonly pool: Pool) {}

  async consumeApiRequest(input: {
    organizationId: string
    actorId: string
    now?: Date
  }): Promise<SharedRateLimitResult | null> {
    const now = input.now ?? new Date()
    return withApiDatabaseContext(
      this.pool,
      { organizationId: input.organizationId, actorId: input.actorId },
      async (client) => {
        const quota = await client.query<{
          api_requests_limit: number
          api_window_seconds: number
        }>(`
          SELECT api_requests_limit, api_window_seconds
          FROM relay_organization_quotas
          WHERE organization_id = $1
        `, [input.organizationId])
        const row = quota.rows[0]
        if (!row) return null
        const windowMs = row.api_window_seconds * 1_000
        const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
        const consumed = await client.query<{ request_count: number }>(`
          INSERT INTO relay_organization_rate_limit_windows (
            organization_id, window_started_at, request_count, updated_at
          ) VALUES ($1, $2, 1, $3)
          ON CONFLICT (organization_id) DO UPDATE SET
            request_count = CASE
              WHEN relay_organization_rate_limit_windows.window_started_at = EXCLUDED.window_started_at
                THEN relay_organization_rate_limit_windows.request_count + 1
              ELSE 1
            END,
            window_started_at = EXCLUDED.window_started_at,
            updated_at = EXCLUDED.updated_at
          RETURNING request_count
        `, [input.organizationId, windowStartedAt.toISOString(), now.toISOString()])
        const count = consumed.rows[0]?.request_count ?? 1
        const resetAt = windowStartedAt.getTime() + windowMs
        return {
          allowed: count <= row.api_requests_limit,
          firstDenied: count === row.api_requests_limit + 1,
          limit: row.api_requests_limit,
          remaining: Math.max(0, row.api_requests_limit - count),
          retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1_000)),
        }
      },
    )
  }
}
