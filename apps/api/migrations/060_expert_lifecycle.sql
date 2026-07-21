-- Permit the API runtime to manage Experts while preserving immutable published revisions.

DROP TRIGGER IF EXISTS relay_reject_runtime_control_plane_update ON relay_experts;
DROP TRIGGER IF EXISTS relay_reject_runtime_control_plane_update ON relay_expert_revisions;

GRANT INSERT ON relay_experts, relay_expert_revisions TO relay_api_runtime;
GRANT UPDATE (
  name, description, visibility, status, published_revision_id, version, updated_at
) ON relay_experts TO relay_api_runtime;
GRANT UPDATE (
  status, environment_id, environment_revision_id, allow_repository_override,
  allow_base_branch_override, instructions, model, configuration
) ON relay_expert_revisions TO relay_api_runtime;

DROP POLICY IF EXISTS relay_api_tenant_select ON relay_experts;
DROP POLICY IF EXISTS relay_api_tenant_lock ON relay_experts;
DROP POLICY IF EXISTS relay_api_tenant_select ON relay_expert_revisions;
DROP POLICY IF EXISTS relay_api_tenant_lock ON relay_expert_revisions;

CREATE POLICY relay_api_expert_select ON relay_experts
  FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_experts.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships membership
      WHERE membership.organization_id = relay_experts.organization_id
        AND membership.space_id = relay_experts.space_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
  );

CREATE POLICY relay_api_expert_mutate ON relay_experts
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_experts.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_experts.organization_id
          AND membership.space_id = relay_experts.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_experts.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_experts.organization_id
          AND membership.space_id = relay_experts.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  );

CREATE POLICY relay_api_expert_revision_select ON relay_expert_revisions
  FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_expert_revisions.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships membership
      WHERE membership.organization_id = relay_expert_revisions.organization_id
        AND membership.space_id = relay_expert_revisions.space_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
  );

CREATE POLICY relay_api_expert_revision_mutate ON relay_expert_revisions
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_expert_revisions.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_expert_revisions.organization_id
          AND membership.space_id = relay_expert_revisions.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_expert_revisions.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_expert_revisions.organization_id
          AND membership.space_id = relay_expert_revisions.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  );

CREATE TABLE relay_control_plane_idempotency (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  actor_id text NOT NULL,
  method text NOT NULL,
  canonical_path text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (
    organization_id, actor_id, method, canonical_path, idempotency_key_hash
  ),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES relay_spaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX relay_control_plane_idempotency_expiry_idx
  ON relay_control_plane_idempotency (expires_at);

ALTER TABLE relay_control_plane_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_control_plane_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY relay_migration_admin ON relay_control_plane_idempotency
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY relay_api_control_plane_idempotency ON relay_control_plane_idempotency
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  );

GRANT SELECT, INSERT, DELETE ON relay_control_plane_idempotency TO relay_api_runtime;
