-- Permit the API runtime to manage Experts while preserving immutable published revisions.

DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_experts;
DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_expert_revisions;

GRANT INSERT ON cosmos_experts, cosmos_expert_revisions TO cosmos_api_runtime;
GRANT UPDATE (
  name, description, visibility, status, published_revision_id, version, updated_at
) ON cosmos_experts TO cosmos_api_runtime;
GRANT UPDATE (
  status, environment_id, environment_revision_id, allow_repository_override,
  allow_base_branch_override, instructions, model, configuration
) ON cosmos_expert_revisions TO cosmos_api_runtime;

DROP POLICY IF EXISTS cosmos_api_tenant_select ON cosmos_experts;
DROP POLICY IF EXISTS cosmos_api_tenant_lock ON cosmos_experts;
DROP POLICY IF EXISTS cosmos_api_tenant_select ON cosmos_expert_revisions;
DROP POLICY IF EXISTS cosmos_api_tenant_lock ON cosmos_expert_revisions;

CREATE POLICY cosmos_api_expert_select ON cosmos_experts
  FOR SELECT TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_experts.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM cosmos_space_memberships membership
      WHERE membership.organization_id = cosmos_experts.organization_id
        AND membership.space_id = cosmos_experts.space_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
  );

CREATE POLICY cosmos_api_expert_mutate ON cosmos_experts
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_experts.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_experts.organization_id
          AND membership.space_id = cosmos_experts.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_experts.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_experts.organization_id
          AND membership.space_id = cosmos_experts.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  );

CREATE POLICY cosmos_api_expert_revision_select ON cosmos_expert_revisions
  FOR SELECT TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_expert_revisions.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM cosmos_space_memberships membership
      WHERE membership.organization_id = cosmos_expert_revisions.organization_id
        AND membership.space_id = cosmos_expert_revisions.space_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
  );

CREATE POLICY cosmos_api_expert_revision_mutate ON cosmos_expert_revisions
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_expert_revisions.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_expert_revisions.organization_id
          AND membership.space_id = cosmos_expert_revisions.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_expert_revisions.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_expert_revisions.organization_id
          AND membership.space_id = cosmos_expert_revisions.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  );

CREATE TABLE cosmos_control_plane_idempotency (
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
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX cosmos_control_plane_idempotency_expiry_idx
  ON cosmos_control_plane_idempotency (expires_at);

ALTER TABLE cosmos_control_plane_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_control_plane_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY cosmos_migration_admin ON cosmos_control_plane_idempotency
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_api_control_plane_idempotency ON cosmos_control_plane_idempotency
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  );

GRANT SELECT, INSERT, DELETE ON cosmos_control_plane_idempotency TO cosmos_api_runtime;
