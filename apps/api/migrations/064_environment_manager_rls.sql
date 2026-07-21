SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS relay_api_environment_mutate ON relay_environments;
CREATE POLICY relay_api_environment_mutate ON relay_environments
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_environments.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_environments.organization_id
          AND membership.space_id = relay_environments.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager')
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_environments.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_environments.organization_id
          AND membership.space_id = relay_environments.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager')
    )
  );

DROP POLICY IF EXISTS relay_api_environment_revision_mutate ON relay_environment_revisions;
CREATE POLICY relay_api_environment_revision_mutate ON relay_environment_revisions
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_revisions.organization_id
        AND environment.space_id = relay_environment_revisions.space_id
        AND environment.id = relay_environment_revisions.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_revisions.organization_id
        AND environment.space_id = relay_environment_revisions.space_id
        AND environment.id = relay_environment_revisions.environment_id)
  );

DROP POLICY IF EXISTS relay_api_environment_repository_mutate ON relay_environment_revision_repositories;
CREATE POLICY relay_api_environment_repository_mutate ON relay_environment_revision_repositories
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_revision_repositories.organization_id
        AND environment.space_id = relay_environment_revision_repositories.space_id
        AND environment.id = relay_environment_revision_repositories.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_revision_repositories.organization_id
        AND environment.space_id = relay_environment_revision_repositories.space_id
        AND environment.id = relay_environment_revision_repositories.environment_id)
  );

DROP POLICY IF EXISTS relay_api_environment_job_access ON relay_environment_provisioning_jobs;
CREATE POLICY relay_api_environment_job_access ON relay_environment_provisioning_jobs
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_provisioning_jobs.organization_id
        AND environment.space_id = relay_environment_provisioning_jobs.space_id
        AND environment.id = relay_environment_provisioning_jobs.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_provisioning_jobs.organization_id
        AND environment.space_id = relay_environment_provisioning_jobs.space_id
        AND environment.id = relay_environment_provisioning_jobs.environment_id)
  );

DROP POLICY IF EXISTS relay_api_environment_audit_insert ON relay_environment_audit_events;
CREATE POLICY relay_api_environment_audit_insert ON relay_environment_audit_events
  FOR INSERT TO relay_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_audit_events.organization_id
        AND environment.space_id = relay_environment_audit_events.space_id
        AND environment.id = relay_environment_audit_events.environment_id)
  );

DROP POLICY IF EXISTS relay_api_environment_outbox_access ON relay_environment_outbox_events;
CREATE POLICY relay_api_environment_outbox_access ON relay_environment_outbox_events
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_outbox_events.organization_id
        AND environment.space_id = relay_environment_outbox_events.space_id
        AND environment.id = relay_environment_outbox_events.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_environments environment
      WHERE environment.organization_id = relay_environment_outbox_events.organization_id
        AND environment.space_id = relay_environment_outbox_events.space_id
        AND environment.id = relay_environment_outbox_events.environment_id)
  );
