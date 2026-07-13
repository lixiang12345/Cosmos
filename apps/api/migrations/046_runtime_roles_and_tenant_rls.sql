SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relay_api_runtime') THEN
    CREATE ROLE relay_api_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE relay_api_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relay_worker_runtime') THEN
    CREATE ROLE relay_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE relay_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END;
$$;

GRANT relay_api_runtime, relay_worker_runtime TO CURRENT_USER;

DO $$
BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO relay_api_runtime, relay_worker_runtime',
    current_schema()
  );
END;
$$;

GRANT SELECT ON relay_schema_migrations TO relay_api_runtime, relay_worker_runtime;
GRANT SELECT ON relay_worker_heartbeats TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_worker_heartbeats TO relay_worker_runtime;

GRANT SELECT ON
  relay_organizations,
  relay_spaces,
  relay_organization_memberships,
  relay_space_memberships,
  relay_groups,
  relay_group_memberships,
  relay_environments,
  relay_environment_revisions,
  relay_environment_revision_repositories,
  relay_experts,
  relay_expert_revisions,
  relay_service_accounts,
  relay_service_account_bindings
TO relay_api_runtime;

-- PostgreSQL row-locking SELECT requires UPDATE privilege on at least one column.
-- Runtime-only triggers below allow row locks while rejecting actual updates.
GRANT UPDATE (role) ON relay_organization_memberships, relay_space_memberships
TO relay_api_runtime;
GRANT UPDATE (version) ON
  relay_environments,
  relay_experts,
  relay_service_accounts,
  relay_service_account_bindings
TO relay_api_runtime;
GRANT UPDATE (status) ON relay_environment_revisions, relay_expert_revisions
TO relay_api_runtime;
GRANT UPDATE (is_default) ON relay_environment_revision_repositories
TO relay_api_runtime;

GRANT SELECT, INSERT, UPDATE ON relay_sessions, relay_turns, relay_commands, relay_attempts
TO relay_api_runtime;
GRANT SELECT, INSERT ON relay_messages, relay_session_events
TO relay_api_runtime;
GRANT INSERT ON relay_audit_events, relay_outbox_events
TO relay_api_runtime;
GRANT SELECT, INSERT, DELETE ON relay_idempotency_records, relay_idempotency_responses
TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_session_share_grants
TO relay_api_runtime;

GRANT SELECT ON
  relay_organization_memberships,
  relay_space_memberships,
  relay_expert_revisions
TO relay_worker_runtime;
GRANT UPDATE (role) ON relay_organization_memberships, relay_space_memberships
TO relay_worker_runtime;
GRANT UPDATE (actor_id) ON relay_messages TO relay_worker_runtime;
GRANT SELECT, UPDATE ON relay_sessions, relay_turns, relay_commands
TO relay_worker_runtime;
GRANT SELECT, INSERT ON relay_messages
TO relay_worker_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_attempts
TO relay_worker_runtime;
GRANT INSERT ON relay_session_events
TO relay_worker_runtime;

DO $$
DECLARE
  table_name text;
  tenant_tables constant text[] := ARRAY[
    'relay_attempts',
    'relay_audit_events',
    'relay_commands',
    'relay_environment_revision_repositories',
    'relay_environment_revisions',
    'relay_environments',
    'relay_expert_revisions',
    'relay_experts',
    'relay_group_memberships',
    'relay_groups',
    'relay_idempotency_records',
    'relay_idempotency_responses',
    'relay_messages',
    'relay_organization_memberships',
    'relay_organizations',
    'relay_outbox_events',
    'relay_service_account_bindings',
    'relay_service_accounts',
    'relay_session_events',
    'relay_session_share_grants',
    'relay_sessions',
    'relay_space_memberships',
    'relay_spaces',
    'relay_turns'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY relay_migration_admin ON %I TO %I USING (true) WITH CHECK (true)',
      table_name,
      current_user
    );
  END LOOP;
END;
$$;

CREATE FUNCTION relay_reject_runtime_control_plane_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('relay_api_runtime', 'relay_worker_runtime') THEN
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
    'relay_environment_revision_repositories',
    'relay_environment_revisions',
    'relay_environments',
    'relay_expert_revisions',
    'relay_experts',
    'relay_messages',
    'relay_organization_memberships',
    'relay_service_account_bindings',
    'relay_service_accounts',
    'relay_space_memberships'
  ];
BEGIN
  FOREACH table_name IN ARRAY locked_read_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER relay_reject_runtime_control_plane_update
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION relay_reject_runtime_control_plane_update()',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY relay_api_actor_organizations ON relay_organizations
  FOR SELECT TO relay_api_runtime
  USING (EXISTS (
    SELECT 1
    FROM relay_organization_memberships actor_membership
    WHERE actor_membership.organization_id = relay_organizations.id
      AND actor_membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  ));

CREATE POLICY relay_api_actor_spaces ON relay_spaces
  FOR SELECT TO relay_api_runtime
  USING (EXISTS (
    SELECT 1
    FROM relay_space_memberships actor_membership
    WHERE actor_membership.organization_id = relay_spaces.organization_id
      AND actor_membership.space_id = relay_spaces.id
      AND actor_membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  ));

CREATE POLICY relay_api_organization_memberships ON relay_organization_memberships
  FOR SELECT TO relay_api_runtime
  USING (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('relay.organization_id', true), '')
  );

CREATE POLICY relay_api_organization_membership_lock ON relay_organization_memberships
  FOR UPDATE TO relay_api_runtime
  USING (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('relay.organization_id', true), '')
  )
  WITH CHECK (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR organization_id = NULLIF(current_setting('relay.organization_id', true), '')
  );

CREATE POLICY relay_api_space_memberships ON relay_space_memberships
  FOR SELECT TO relay_api_runtime
  USING (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('relay.organization_id', true), '')
      AND space_id = NULLIF(current_setting('relay.space_id', true), '')
      AND EXISTS (
        SELECT 1
        FROM relay_organization_memberships actor_organization
        WHERE actor_organization.organization_id = relay_space_memberships.organization_id
          AND actor_organization.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
      )
    )
  );

CREATE POLICY relay_api_space_membership_lock ON relay_space_memberships
  FOR UPDATE TO relay_api_runtime
  USING (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('relay.organization_id', true), '')
      AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    )
  )
  WITH CHECK (
    actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    OR (
      organization_id = NULLIF(current_setting('relay.organization_id', true), '')
      AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    )
  );

DO $$
DECLARE
  table_name text;
  policy_expression text;
  organization_tables constant text[] := ARRAY[
    'relay_groups',
    'relay_group_memberships',
    'relay_idempotency_responses'
  ];
  read_only_organization_tables constant text[] := ARRAY[
    'relay_service_accounts'
  ];
  space_tables constant text[] := ARRAY[
    'relay_attempts',
    'relay_audit_events',
    'relay_commands',
    'relay_idempotency_records',
    'relay_messages',
    'relay_outbox_events',
    'relay_session_events',
    'relay_session_share_grants',
    'relay_sessions',
    'relay_turns'
  ];
  read_only_space_tables constant text[] := ARRAY[
    'relay_environment_revision_repositories',
    'relay_environment_revisions',
    'relay_environments',
    'relay_expert_revisions',
    'relay_experts',
    'relay_service_account_bindings'
  ];
BEGIN
  FOREACH table_name IN ARRAY organization_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''relay.organization_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM relay_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant ON %I FOR ALL TO relay_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY read_only_organization_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''relay.organization_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM relay_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant_select ON %I FOR SELECT TO relay_api_runtime USING (%s)',
      table_name,
      policy_expression
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant_lock ON %I FOR UPDATE TO relay_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY space_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''relay.organization_id'', true), '''')
       AND %1$I.space_id = NULLIF(current_setting(''relay.space_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM relay_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )
       AND EXISTS (
         SELECT 1 FROM relay_space_memberships actor_space
         WHERE actor_space.organization_id = %1$I.organization_id
           AND actor_space.space_id = %1$I.space_id
           AND actor_space.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant ON %I FOR ALL TO relay_api_runtime USING (%s) WITH CHECK (%s)',
      table_name,
      policy_expression,
      policy_expression
    );
  END LOOP;

  FOREACH table_name IN ARRAY read_only_space_tables LOOP
    policy_expression := format(
      '%1$I.organization_id = NULLIF(current_setting(''relay.organization_id'', true), '''')
       AND %1$I.space_id = NULLIF(current_setting(''relay.space_id'', true), '''')
       AND EXISTS (
         SELECT 1 FROM relay_organization_memberships actor_organization
         WHERE actor_organization.organization_id = %1$I.organization_id
           AND actor_organization.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )
       AND EXISTS (
         SELECT 1 FROM relay_space_memberships actor_space
         WHERE actor_space.organization_id = %1$I.organization_id
           AND actor_space.space_id = %1$I.space_id
           AND actor_space.actor_id = NULLIF(current_setting(''relay.actor_id'', true), '''')
       )',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant_select ON %I FOR SELECT TO relay_api_runtime USING (%s)',
      table_name,
      policy_expression
    );
    EXECUTE format(
      'CREATE POLICY relay_api_tenant_lock ON %I FOR UPDATE TO relay_api_runtime USING (%s) WITH CHECK (%s)',
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
    'relay_attempts',
    'relay_commands',
    'relay_expert_revisions',
    'relay_messages',
    'relay_organization_memberships',
    'relay_session_events',
    'relay_sessions',
    'relay_space_memberships',
    'relay_turns'
  ];
  worker_insert_tables constant text[] := ARRAY[
    'relay_attempts',
    'relay_messages',
    'relay_session_events'
  ];
  worker_update_tables constant text[] := ARRAY[
    'relay_attempts',
    'relay_commands',
    'relay_sessions',
    'relay_turns'
  ];
  worker_lock_tables constant text[] := ARRAY[
    'relay_messages',
    'relay_organization_memberships',
    'relay_space_memberships'
  ];
BEGIN
  FOREACH table_name IN ARRAY worker_select_tables LOOP
    EXECUTE format(
      'CREATE POLICY relay_worker_select ON %I FOR SELECT TO relay_worker_runtime USING (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_insert_tables LOOP
    EXECUTE format(
      'CREATE POLICY relay_worker_insert ON %I FOR INSERT TO relay_worker_runtime WITH CHECK (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_update_tables LOOP
    EXECUTE format(
      'CREATE POLICY relay_worker_update ON %I FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY worker_lock_tables LOOP
    EXECUTE format(
      'CREATE POLICY relay_worker_lock ON %I FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END;
$$;
