-- Restore configuration row locking for members while guarding actual Expert writes.

DROP POLICY IF EXISTS cosmos_api_expert_lock ON cosmos_experts;
CREATE POLICY cosmos_api_expert_lock ON cosmos_experts
  FOR UPDATE TO cosmos_api_runtime
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
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
  );

DROP POLICY IF EXISTS cosmos_api_expert_revision_lock ON cosmos_expert_revisions;
CREATE POLICY cosmos_api_expert_revision_lock ON cosmos_expert_revisions
  FOR UPDATE TO cosmos_api_runtime
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
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
  );

CREATE OR REPLACE FUNCTION cosmos_guard_expert_runtime_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'cosmos_api_runtime' AND NOT (
    EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
    OR EXISTS (
      SELECT 1 FROM cosmos_space_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.space_id = NEW.space_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
        AND membership.role = 'space_manager'
    )
  ) THEN
    RAISE EXCEPTION 'Only Expert managers may update control-plane rows'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cosmos_experts_guard_runtime_update ON cosmos_experts;
CREATE TRIGGER cosmos_experts_guard_runtime_update
  BEFORE UPDATE ON cosmos_experts
  FOR EACH ROW EXECUTE FUNCTION cosmos_guard_expert_runtime_update();

DROP TRIGGER IF EXISTS cosmos_expert_revisions_guard_runtime_update ON cosmos_expert_revisions;
CREATE TRIGGER cosmos_expert_revisions_guard_runtime_update
  BEFORE UPDATE ON cosmos_expert_revisions
  FOR EACH ROW EXECUTE FUNCTION cosmos_guard_expert_runtime_update();
