import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  EnvironmentProvisioningClaim,
  EnvironmentProvisioningFailure,
  EnvironmentProvisioningRepository,
} from './environment-provisioning-repository.js'

function now() { return new Date() }

export class PostgresEnvironmentProvisioningRepository implements EnvironmentProvisioningRepository {
  constructor(private readonly pool: Pool, private readonly createId: () => string = randomUUID) {}

  async reapExpired(input: { limit: number; retryDelayMs: number }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const expired = await client.query<{
        organization_id: string
        space_id: string
        id: string
        environment_id: string
        environment_revision_id: string
        attempt: number
        max_attempts: number
      }>(`
        SELECT organization_id, space_id, id, environment_id, environment_revision_id,
          attempt, max_attempts
        FROM relay_environment_provisioning_jobs
        WHERE status = 'running' AND lease_expires_at < now()
        ORDER BY lease_expires_at, id
        FOR UPDATE SKIP LOCKED LIMIT $1
      `, [input.limit])
      let requeued = 0
      let failed = 0
      for (const job of expired.rows) {
        if (job.attempt < job.max_attempts) {
          requeued += 1
          await client.query(`
            UPDATE relay_environment_provisioning_jobs SET status = 'queued', phase = 'queued',
              progress = 0, lease_owner = NULL, lease_expires_at = NULL,
              error_code = 'provisioning_lease_expired',
              error_message = 'The provisioning worker lease expired; the job was requeued.',
              error_retryable = true, available_at = now() + ($7 * interval '1 millisecond'), updated_at = now()
            WHERE organization_id = $1 AND space_id = $2 AND id = $3
          `, [
            job.organization_id, job.space_id, job.id, job.environment_id,
            job.environment_revision_id, job.attempt, input.retryDelayMs,
          ])
        } else {
          failed += 1
          await this.failAfterFence(client, {
            organizationId: job.organization_id,
            spaceId: job.space_id,
            jobId: job.id,
            environmentId: job.environment_id,
            environmentRevisionId: job.environment_revision_id,
          }, {
            code: 'provisioning_lease_expired',
            message: 'The provisioning worker lease expired after the retry limit.',
            retryable: false,
          })
        }
      }
      await client.query('COMMIT')
      return { requeued, failed }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async claimNext(input: { leaseOwner: string; leaseDurationMs: number }): Promise<EnvironmentProvisioningClaim | null> {
    const result = await this.pool.query<{
      organization_id: string
      space_id: string
      id: string
      environment_id: string
      environment_revision_id: string
      type: 'cloud' | 'daemon'
      configuration: Record<string, unknown>
      attempt: number
      max_attempts: number
      lease_token: number
    }>(`
      WITH candidate AS (
        SELECT job.organization_id, job.space_id, job.id, job.environment_id,
          job.environment_revision_id, environment.type, revision.configuration,
          job.attempt, job.max_attempts, job.lease_token
        FROM relay_environment_provisioning_jobs job
        JOIN relay_environments environment
          ON environment.organization_id = job.organization_id
          AND environment.space_id = job.space_id
          AND environment.id = job.environment_id
        JOIN relay_environment_revisions revision
          ON revision.organization_id = job.organization_id
          AND revision.space_id = job.space_id
          AND revision.environment_id = job.environment_id
          AND revision.id = job.environment_revision_id
        WHERE job.status = 'queued' AND job.available_at <= now()
        ORDER BY job.available_at, job.created_at, job.id
        FOR UPDATE OF job SKIP LOCKED LIMIT 1
      )
      UPDATE relay_environment_provisioning_jobs job
      SET status = 'running', phase = CASE WHEN candidate.type = 'daemon' THEN 'connecting_daemon' ELSE 'pulling_image' END,
        progress = 20, attempt = candidate.attempt + 1, lease_owner = $1,
        lease_token = candidate.lease_token + 1,
        lease_expires_at = now() + ($2 * interval '1 millisecond'), updated_at = now(),
        error_code = NULL, error_message = NULL, error_retryable = NULL
      FROM candidate
      WHERE job.organization_id = candidate.organization_id
        AND job.space_id = candidate.space_id AND job.id = candidate.id
      RETURNING candidate.organization_id, candidate.space_id, candidate.id,
        candidate.environment_id, candidate.environment_revision_id, candidate.type,
        candidate.configuration, candidate.attempt + 1 AS attempt, candidate.max_attempts,
        candidate.lease_token + 1 AS lease_token
    `, [input.leaseOwner, input.leaseDurationMs])
    const row = result.rows[0]
    if (!row) return null
    return {
      organizationId: row.organization_id,
      spaceId: row.space_id,
      jobId: row.id,
      environmentId: row.environment_id,
      environmentRevisionId: row.environment_revision_id,
      environmentType: row.type,
      image: typeof row.configuration.image === 'string' ? row.configuration.image : '',
      daemonPoolId: typeof row.configuration.daemonPoolId === 'string' ? row.configuration.daemonPoolId : null,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      leaseOwner: input.leaseOwner,
      leaseToken: row.lease_token,
    }
  }

  async heartbeat(input: { claim: EnvironmentProvisioningClaim; leaseDurationMs: number }) {
    const result = await this.pool.query(`
      UPDATE relay_environment_provisioning_jobs SET
        lease_expires_at = now() + ($6 * interval '1 millisecond'), updated_at = now()
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
        AND status = 'running' AND lease_owner = $4 AND lease_token = $5
        AND lease_expires_at > now()
    `, [
      input.claim.organizationId, input.claim.spaceId, input.claim.jobId,
      input.claim.leaseOwner, input.claim.leaseToken, input.leaseDurationMs,
    ])
    return result.rowCount === 1
  }

  async complete(claim: EnvironmentProvisioningClaim) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query(`
        UPDATE relay_environment_provisioning_jobs SET status = 'succeeded', phase = 'ready',
          progress = 100, completed_at = now(), updated_at = now(),
          lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status = 'running' AND lease_owner = $4 AND lease_token = $5
      `, [claim.organizationId, claim.spaceId, claim.jobId, claim.leaseOwner, claim.leaseToken])
      if (updated.rowCount !== 1) {
        await client.query('ROLLBACK')
        return false
      }
      await client.query(`
        UPDATE relay_environment_revisions SET status = 'ready'
        WHERE organization_id = $1 AND space_id = $2 AND environment_id = $3 AND id = $4
      `, [claim.organizationId, claim.spaceId, claim.environmentId, claim.environmentRevisionId])
      await client.query(`
        UPDATE relay_environments SET status = 'ready', active_revision_id = $4, latest_revision_id = $4
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status IN ('provisioning', 'updating', 'failed')
      `, [claim.organizationId, claim.spaceId, claim.environmentId, claim.environmentRevisionId])
      await this.appendOutcome(client, claim, 'succeeded')
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async fail(input: {
    claim: EnvironmentProvisioningClaim
    failure: EnvironmentProvisioningFailure
    retryDelayMs: number
  }): Promise<'requeued' | 'failed' | 'fence_lost'> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<{ attempt: number; max_attempts: number }>(`
        SELECT attempt, max_attempts FROM relay_environment_provisioning_jobs
        WHERE organization_id = $1 AND space_id = $2 AND id = $3
          AND status = 'running' AND lease_owner = $4 AND lease_token = $5 FOR UPDATE
      `, [input.claim.organizationId, input.claim.spaceId, input.claim.jobId, input.claim.leaseOwner, input.claim.leaseToken])
      const row = current.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return 'fence_lost'
      }
      if (input.failure.retryable && row.attempt < row.max_attempts) {
        await client.query(`
          UPDATE relay_environment_provisioning_jobs SET status = 'queued', phase = 'queued', progress = 0,
            available_at = now() + ($6 * interval '1 millisecond'), updated_at = now(),
            lease_owner = NULL, lease_expires_at = NULL, error_code = $4,
            error_message = $5, error_retryable = true
          WHERE organization_id = $1 AND space_id = $2 AND id = $3
        `, [input.claim.organizationId, input.claim.spaceId, input.claim.jobId,
          input.failure.code, input.failure.message, input.retryDelayMs])
        await client.query('COMMIT')
        return 'requeued'
      }
      await this.failAfterFence(client, input.claim, input.failure)
      await client.query('COMMIT')
      return 'failed'
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async failAfterFence(
    client: PoolClient,
    claim: Pick<EnvironmentProvisioningClaim, 'organizationId' | 'spaceId' | 'jobId' | 'environmentId' | 'environmentRevisionId'>,
    failure: EnvironmentProvisioningFailure,
  ) {
    await client.query(`
      UPDATE relay_environment_provisioning_jobs SET status = 'failed', phase = 'failed', progress = 100,
        completed_at = now(), updated_at = now(), lease_owner = NULL, lease_expires_at = NULL,
        error_code = $4, error_message = $5, error_retryable = $6
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
    `, [claim.organizationId, claim.spaceId, claim.jobId, failure.code, failure.message, failure.retryable])
    await client.query(`
      UPDATE relay_environment_revisions SET status = 'failed'
      WHERE organization_id = $1 AND space_id = $2 AND environment_id = $3 AND id = $4
        AND status = 'provisioning'
    `, [claim.organizationId, claim.spaceId, claim.environmentId, claim.environmentRevisionId])
    await client.query(`
      UPDATE relay_environments SET status = 'failed'
      WHERE organization_id = $1 AND space_id = $2 AND id = $3
        AND status IN ('provisioning', 'updating')
    `, [claim.organizationId, claim.spaceId, claim.environmentId])
    await this.appendOutcome(client, claim, 'failed', failure)
  }

  private async appendOutcome(
    client: PoolClient,
    claim: Pick<EnvironmentProvisioningClaim, 'organizationId' | 'spaceId' | 'jobId' | 'environmentId' | 'environmentRevisionId'>,
    result: 'succeeded' | 'failed',
    failure?: EnvironmentProvisioningFailure,
  ) {
    const nowValue = now().toISOString()
    await client.query(`
      INSERT INTO relay_environment_audit_events (
        organization_id, space_id, id, environment_id, environment_revision_id,
        actor_id, action, result, resource_version, metadata, occurred_at
      )
      SELECT $1, $2, $3, $4, $5, 'environment-worker', 'environment.provision', $6,
        environment.version, $7::jsonb, $8
      FROM relay_environments environment
      WHERE environment.organization_id = $1 AND environment.space_id = $2 AND environment.id = $4
    `, [
      claim.organizationId, claim.spaceId, this.createId(), claim.environmentId,
      claim.environmentRevisionId, result,
      JSON.stringify({ jobId: claim.jobId, ...(failure ? {
        code: failure.code, message: failure.message, retryable: failure.retryable,
      } : {}) }), nowValue,
    ])
    await client.query(`
      INSERT INTO relay_environment_outbox_events (
        organization_id, space_id, id, environment_id, environment_revision_id,
        event_type, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `, [
      claim.organizationId, claim.spaceId, this.createId(), claim.environmentId,
      claim.environmentRevisionId,
      result === 'succeeded' ? 'environment.provisioning.succeeded' : 'environment.provisioning.failed',
      JSON.stringify({ jobId: claim.jobId, ...(failure ? { code: failure.code } : {}) }), nowValue,
    ])
  }
}
