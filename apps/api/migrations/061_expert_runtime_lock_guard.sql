-- Restore configuration row locking for members while guarding actual Expert writes.

DROP POLICY IF EXISTS relay_api_expert_lock ON relay_experts;
CREATE POLICY relay_api_expert_lock ON relay_experts
  FOR UPDATE TO relay_api_runtime
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
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
  );

DROP POLICY IF EXISTS relay_api_expert_revision_lock ON relay_expert_revisions;
CREATE POLICY relay_api_expert_revision_lock ON relay_expert_revisions
  FOR UPDATE TO relay_api_runtime
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
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
  );

CREATE OR REPLACE FUNCTION relay_guard_expert_runtime_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'relay_api_runtime' AND NOT (
    EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
    OR EXISTS (
      SELECT 1 FROM relay_space_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.space_id = NEW.space_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role = 'space_manager'
    )
  ) THEN
    RAISE EXCEPTION 'Only Expert managers may update control-plane rows'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relay_experts_guard_runtime_update ON relay_experts;
CREATE TRIGGER relay_experts_guard_runtime_update
  BEFORE UPDATE ON relay_experts
  FOR EACH ROW EXECUTE FUNCTION relay_guard_expert_runtime_update();

DROP TRIGGER IF EXISTS relay_expert_revisions_guard_runtime_update ON relay_expert_revisions;
CREATE TRIGGER relay_expert_revisions_guard_runtime_update
  BEFORE UPDATE ON relay_expert_revisions
  FOR EACH ROW EXECUTE FUNCTION relay_guard_expert_runtime_update();
