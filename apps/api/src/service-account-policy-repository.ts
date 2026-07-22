import type { Pool } from 'pg'
import { queryWithApiDatabaseContext } from './postgres-runtime-database.js'

export type ServiceAccountSessionScope =
  | 'session.create'
  | 'session.send'
  | 'session.archive'

export type ServiceAccountSessionResourceType = 'expert' | 'session'

export type ServiceAccountAuthorization = {
  organizationId: string
  spaceId: string
  serviceAccountId: string
  audience: string
  scope: ServiceAccountSessionScope
  resourceType: ServiceAccountSessionResourceType
  resourceId: string
}

export interface ServiceAccountPolicyRepository {
  authorizeSessionOperation(input: ServiceAccountAuthorization): Promise<boolean>
}

export class DenyServiceAccountPolicyRepository implements ServiceAccountPolicyRepository {
  async authorizeSessionOperation(): Promise<boolean> {
    return false
  }
}

export class PostgresServiceAccountPolicyRepository implements ServiceAccountPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async authorizeSessionOperation(input: ServiceAccountAuthorization): Promise<boolean> {
    const result = await queryWithApiDatabaseContext(
      this.pool,
      {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        actorId: input.serviceAccountId,
      },
      `
      SELECT 1
      FROM cosmos_service_accounts service_account
      JOIN cosmos_organization_memberships organization_membership
        ON organization_membership.organization_id = service_account.organization_id
        AND organization_membership.actor_id = service_account.id
      JOIN cosmos_space_memberships space_membership
        ON space_membership.organization_id = service_account.organization_id
        AND space_membership.actor_id = service_account.id
        AND space_membership.space_id = $2
      JOIN cosmos_service_account_bindings binding
        ON binding.organization_id = service_account.organization_id
        AND binding.space_id = space_membership.space_id
        AND binding.service_account_id = service_account.id
      WHERE service_account.organization_id = $1
        AND service_account.id = $3
        AND service_account.audience = $4
        AND service_account.status = 'active'
        AND service_account.revoked_at IS NULL
        AND organization_membership.role <> 'viewer'
        AND space_membership.role <> 'viewer'
        AND binding.scope = $5
        AND binding.resource_type = $6
        AND binding.resource_id = $7
        AND binding.revoked_at IS NULL
        AND (binding.expires_at IS NULL OR binding.expires_at > transaction_timestamp())
      LIMIT 1
      `,
      [
      input.organizationId,
      input.spaceId,
      input.serviceAccountId,
      input.audience,
      input.scope,
      input.resourceType,
      input.resourceId,
      ],
    )
    return Boolean(result.rowCount)
  }
}
