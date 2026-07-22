SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS cosmos_api_environment_mutate ON cosmos_environments;
CREATE POLICY cosmos_api_environment_mutate ON cosmos_environments
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_environments.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_environments.organization_id
          AND membership.space_id = cosmos_environments.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager')
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_environments.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_environments.organization_id
          AND membership.space_id = cosmos_environments.space_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager')
    )
  );

DROP POLICY IF EXISTS cosmos_api_environment_revision_mutate ON cosmos_environment_revisions;
CREATE POLICY cosmos_api_environment_revision_mutate ON cosmos_environment_revisions
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_revisions.organization_id
        AND environment.space_id = cosmos_environment_revisions.space_id
        AND environment.id = cosmos_environment_revisions.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_revisions.organization_id
        AND environment.space_id = cosmos_environment_revisions.space_id
        AND environment.id = cosmos_environment_revisions.environment_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_repository_mutate ON cosmos_environment_revision_repositories;
CREATE POLICY cosmos_api_environment_repository_mutate ON cosmos_environment_revision_repositories
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_revision_repositories.organization_id
        AND environment.space_id = cosmos_environment_revision_repositories.space_id
        AND environment.id = cosmos_environment_revision_repositories.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_revision_repositories.organization_id
        AND environment.space_id = cosmos_environment_revision_repositories.space_id
        AND environment.id = cosmos_environment_revision_repositories.environment_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_job_access ON cosmos_environment_provisioning_jobs;
CREATE POLICY cosmos_api_environment_job_access ON cosmos_environment_provisioning_jobs
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_provisioning_jobs.organization_id
        AND environment.space_id = cosmos_environment_provisioning_jobs.space_id
        AND environment.id = cosmos_environment_provisioning_jobs.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_provisioning_jobs.organization_id
        AND environment.space_id = cosmos_environment_provisioning_jobs.space_id
        AND environment.id = cosmos_environment_provisioning_jobs.environment_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_audit_insert ON cosmos_environment_audit_events;
CREATE POLICY cosmos_api_environment_audit_insert ON cosmos_environment_audit_events
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_audit_events.organization_id
        AND environment.space_id = cosmos_environment_audit_events.space_id
        AND environment.id = cosmos_environment_audit_events.environment_id)
  );

DROP POLICY IF EXISTS cosmos_api_environment_outbox_access ON cosmos_environment_outbox_events;
CREATE POLICY cosmos_api_environment_outbox_access ON cosmos_environment_outbox_events
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_outbox_events.organization_id
        AND environment.space_id = cosmos_environment_outbox_events.space_id
        AND environment.id = cosmos_environment_outbox_events.environment_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (SELECT 1 FROM cosmos_environments environment
      WHERE environment.organization_id = cosmos_environment_outbox_events.organization_id
        AND environment.space_id = cosmos_environment_outbox_events.space_id
        AND environment.id = cosmos_environment_outbox_events.environment_id)
  );
