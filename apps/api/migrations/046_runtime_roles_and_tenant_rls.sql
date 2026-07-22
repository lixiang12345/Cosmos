SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cosmos_api_runtime') THEN
    CREATE ROLE cosmos_api_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE cosmos_api_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cosmos_worker_runtime') THEN
    CREATE ROLE cosmos_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE cosmos_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END;
$$;

GRANT cosmos_api_runtime, cosmos_worker_runtime TO CURRENT_USER;

DO $$
BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO cosmos_api_runtime, cosmos_worker_runtime',
    current_schema()
  );
END;
$$;

GRANT SELECT ON cosmos_schema_migrations TO cosmos_api_runtime, cosmos_worker_runtime;
GRANT SELECT ON cosmos_worker_heartbeats TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON cosmos_worker_heartbeats TO cosmos_worker_runtime;

GRANT SELECT ON
  cosmos_organizations,
  cosmos_spaces,
  cosmos_organization_memberships,
  cosmos_space_memberships,
  cosmos_groups,
  cosmos_group_memberships,
  cosmos_environments,
  cosmos_environment_revisions,
  cosmos_environment_revision_repositories,
  cosmos_experts,
  cosmos_expert_revisions,
  cosmos_service_accounts,
  cosmos_service_account_bindings
TO cosmos_api_runtime;

-- PostgreSQL row-locking SELECT requires UPDATE privilege on at least one column.
-- Runtime-only triggers below allow row locks while rejecting actual updates.
GRANT UPDATE (role) ON cosmos_organization_memberships, cosmos_space_memberships
TO cosmos_api_runtime;
GRANT UPDATE (version) ON
  cosmos_environments,
  cosmos_experts,
  cosmos_service_accounts,
  cosmos_service_account_bindings
TO cosmos_api_runtime;
GRANT UPDATE (status) ON cosmos_environment_revisions, cosmos_expert_revisions
TO cosmos_api_runtime;
GRANT UPDATE (is_default) ON cosmos_environment_revision_repositories
TO cosmos_api_runtime;

GRANT SELECT, INSERT, UPDATE ON cosmos_sessions, cosmos_turns, cosmos_commands, cosmos_attempts
TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_messages, cosmos_session_events
TO cosmos_api_runtime;
GRANT INSERT ON cosmos_audit_events, cosmos_outbox_events
TO cosmos_api_runtime;
GRANT SELECT, INSERT, DELETE ON cosmos_idempotency_records, cosmos_idempotency_responses
TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE ON cosmos_session_share_grants
TO cosmos_api_runtime;

GRANT SELECT ON
  cosmos_organization_memberships,
  cosmos_space_memberships,
  cosmos_expert_revisions
TO cosmos_worker_runtime;
GRANT UPDATE (role) ON cosmos_organization_memberships, cosmos_space_memberships
TO cosmos_worker_runtime;
GRANT UPDATE (actor_id) ON cosmos_messages TO cosmos_worker_runtime;
GRANT SELECT, UPDATE ON cosmos_sessions, cosmos_turns, cosmos_commands
TO cosmos_worker_runtime;
GRANT SELECT, INSERT ON cosmos_messages
TO cosmos_worker_runtime;
GRANT SELECT, INSERT, UPDATE ON cosmos_attempts
TO cosmos_worker_runtime;
GRANT INSERT ON cosmos_session_events
TO cosmos_worker_runtime;

DO $$
DECLARE
  table_name text;
  tenant_tables constant text[] := ARRAY[
    'cosmos_attempts',
    'cosmos_audit_events',
    'cosmos_commands',
    'cosmos_environment_revision_repositories',
    'cosmos_environment_revisions',
    'cosmos_environments',
    'cosmos_expert_revisions',
    'cosmos_experts',
    'cosmos_group_memberships',
    'cosmos_groups',
    'cosmos_idempotency_records',
    'cosmos_idempotency_responses',
    'cosmos_messages',
    'cosmos_organization_memberships',
    'cosmos_organizations',
    'cosmos_outbox_events',
    'cosmos_service_account_bindings',
    'cosmos_service_accounts',
    'cosmos_session_events',
    'cosmos_session_share_grants',
    'cosmos_sessions',
    'cosmos_space_memberships',
    'cosmos_spaces',
    'cosmos_turns'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY cosmos_migration_admin ON %I TO %I USING (true) WITH CHECK (true)',
      table_name,
      current_user
    );
  END LOOP;
END;
$$;

CREATE FUNCTION cosmos_reject_runtime_control_plane_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('cosmos_api_runtime', 'cosmos_worker_runtime') THEN
    RAISE EXCEPTION 'Runtime database roles cannot mutate control-plane rows'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
  locked_read_tables constant text[] := ARRAY[
    'cosmos_environment_revision_repositories',
    'cosmos_environment_revisions',
    'cosmos_environments',
    'cosmos_expert_revisions',
    'cosmos_experts',
    'cosmos_messages',
    'cosmos_organization_memberships',
    'cosmos_service_account_bindings',
    'cosmos_service_accounts',
    'cosmos_space_memberships'
  ];
BEGIN
  FOREACH table_name IN ARRAY locked_read_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER cosmos_reject_runtime_control_plane_update
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION cosmos_reject_runtime_control_plane_update()',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY cosmos_api_actor_organizations ON cosmos_organizations
  FOR SELECT TO cosmos_api_runtime
  USING (EXISTS (
    SELECT 1
    FROM cosmos_organization_memberships actor_membership
    WHERE actor_membership.organization_id = cosmos_organizations.id
      AND actor_membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  ));

CREATE POLICY cosmos_api_actor_spaces ON cosmos_spaces
  FOR SELECT TO cosmos_api_runtime
  USING (EXISTS (
    SELECT 1
    FROM cosmos_space_memberships actor_membership
    WHERE actor_membership.organization_id = cosmos_spaces.organization_id
      AND actor_membership.space_id = cosmos_spaces.id
      AND actor_membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  ));

CREATE POLICY cosmos_api_organization_memberships ON cosmos_organization_memberships
  FOR SELECT TO cosmos_api_runtime
  USING (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
  );

CREATE POLICY cosmos_api_organization_membership_lock ON cosmos_organization_memberships
  FOR UPDATE TO cosmos_api_runtime
  USING (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
  )
  WITH CHECK (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
  );

CREATE POLICY cosmos_api_space_memberships ON cosmos_space_memberships
  FOR SELECT TO cosmos_api_runtime
  USING (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
      AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
      AND EXISTS (
        SELECT 1
        FROM cosmos_organization_memberships actor_organization
        WHERE actor_organization.organization_id = cosmos_space_memberships.organization_id
          AND actor_organization.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
      )
    )
  );

CREATE POLICY cosmos_api_space_membership_lock ON cosmos_space_memberships
  FOR UPDATE TO cosmos_api_runtime
  USING (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
      AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    )
  )
  WITH CHECK (
    actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
      AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    )
  );

DO $$
DECLARE
  table_name text;
  policy_expression text;
  organization_tables constant text[] := ARRAY[
    'cosmos_groups',
    'cosmos_group_memberships',
    'cosmos_idempotency_responses'
  ];
  read_only_organization_tables constant text[] := ARRAY[
    'cosmos_service_accounts'
  ];
  space_tables constant text[] := ARRAY[
    'cosmos_attempts',
    'cosmos_audit_events',
    'cosmos_commands',
    'cosmos_idempotency_records',
    'cosmos_messages',
    'cosmos_outbox_events',
    'cosmos_session_events',
    'cosmos_session_share_grants',
    'cosmos_sessions',
    'cosmos_turns'
  ];
  read_only_space_tables constant text[] := ARRAY[
    'cosmos_environment_revision_repositories',
    'cosmos_environment_revisions',
    'cosmos_environments',
    'cosmos_expert_revisions',
    'cosmos_experts',
    'cosmos_service_account_bindings'
  ];
BEGIN
  FOREACH table_name IN ARRAY organization_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''cosmos.organization_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM cosmos_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant ON %I FOR ALL TO cosmos_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY read_only_organization_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''cosmos.organization_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM cosmos_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant_select ON %I FOR SELECT TO cosmos_api_runtime USING (%s)',
      table_name,
      policy_expression
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant_lock ON %I FOR UPDATE TO cosmos_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY space_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''cosmos.organization_id'', true), '''')
       AND %1$I.space_id = NULLIF(current_setting(''cosmos.space_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM cosmos_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )
       AND EXISTS (
         SELECT 1 FROM cosmos_space_memberships actor_space
         WHERE actor_space.organization_id = %1$I.organization_id
           AND actor_space.space_id = %1$I.space_id
           AND actor_space.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant ON %I FOR ALL TO cosmos_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY read_only_space_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''cosmos.organization_id'', true), '''')
       AND %1$I.space_id = NULLIF(current_setting(''cosmos.space_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM cosmos_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )
       AND EXISTS (
         SELECT 1 FROM cosmos_space_memberships actor_space
         WHERE actor_space.organization_id = %1$I.organization_id
           AND actor_space.space_id = %1$I.space_id
           AND actor_space.actor_id = NULLIF(current_setting(''cosmos.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant_select ON %I FOR SELECT TO cosmos_api_runtime USING (%s)',
      table_name,
      policy_expression
    );
    EXECUTE format(
      'CREATE POLICY cosmos_api_tenant_lock ON %I FOR UPDATE TO cosmos_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
  worker_select_tables constant text[] := ARRAY[
    'cosmos_attempts',
    'cosmos_commands',
    'cosmos_expert_revisions',
    'cosmos_messages',
    'cosmos_organization_memberships',
    'cosmos_session_events',
    'cosmos_sessions',
    'cosmos_space_memberships',
    'cosmos_turns'
  ];
  worker_insert_tables constant text[] := ARRAY[
    'cosmos_attempts',
    'cosmos_messages',
    'cosmos_session_events'
  ];
  worker_update_tables constant text[] := ARRAY[
    'cosmos_attempts',
    'cosmos_commands',
    'cosmos_sessions',
    'cosmos_turns'
  ];
  worker_lock_tables constant text[] := ARRAY[
    'cosmos_messages',
    'cosmos_organization_memberships',
    'cosmos_space_memberships'
  ];
BEGIN
  FOREACH table_name IN ARRAY worker_select_tables LOOP
    EXECUTE format(
      'CREATE POLICY cosmos_worker_select ON %I FOR SELECT TO cosmos_worker_runtime USING (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_insert_tables LOOP
    EXECUTE format(
      'CREATE POLICY cosmos_worker_insert ON %I FOR INSERT TO cosmos_worker_runtime WITH CHECK (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_update_tables LOOP
    EXECUTE format(
      'CREATE POLICY cosmos_worker_update ON %I FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_lock_tables LOOP
    EXECUTE format(
      'CREATE POLICY cosmos_worker_lock ON %I FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END;
$$;
