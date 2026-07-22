SET LOCAL lock_timeout = '5s';

CREATE FUNCTION cosmos_actor_can_manage_space(target_organization_id text, target_space_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cosmos_organization_memberships membership
    WHERE membership.organization_id = target_organization_id
      AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
      AND membership.role IN ('organization_owner', 'organization_admin')
  ) OR EXISTS (
    SELECT 1 FROM cosmos_space_memberships membership
    WHERE membership.organization_id = target_organization_id
      AND membership.space_id = target_space_id
      AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
      AND membership.role = 'space_manager'
  );
$$;
REVOKE ALL ON FUNCTION cosmos_actor_can_manage_space(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cosmos_actor_can_manage_space(text, text) TO cosmos_api_runtime;

DROP POLICY IF EXISTS cosmos_api_environment_revision_mutate ON cosmos_environment_revisions;
CREATE POLICY cosmos_api_environment_revision_mutate ON cosmos_environment_revisions
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_repository_mutate ON cosmos_environment_revision_repositories;
CREATE POLICY cosmos_api_environment_repository_mutate ON cosmos_environment_revision_repositories
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_job_access ON cosmos_environment_provisioning_jobs;
CREATE POLICY cosmos_api_environment_job_access ON cosmos_environment_provisioning_jobs
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_audit_insert ON cosmos_environment_audit_events;
CREATE POLICY cosmos_api_environment_audit_insert ON cosmos_environment_audit_events
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_outbox_access ON cosmos_environment_outbox_events;
CREATE POLICY cosmos_api_environment_outbox_access ON cosmos_environment_outbox_events
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );
