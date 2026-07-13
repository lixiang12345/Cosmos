SET LOCAL lock_timeout = '5s';

GRANT SELECT ON relay_schema_migrations TO relay_api_runtime, relay_worker_runtime;
GRANT SELECT ON relay_worker_heartbeats TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_worker_heartbeats TO relay_worker_runtime;
GRANT UPDATE (role) ON relay_organization_memberships, relay_space_memberships
TO relay_api_runtime, relay_worker_runtime;
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
GRANT UPDATE (actor_id) ON relay_messages TO relay_worker_runtime;
GRANT DELETE ON relay_idempotency_records, relay_idempotency_responses
TO relay_api_runtime;

CREATE OR REPLACE FUNCTION relay_reject_runtime_control_plane_update() RETURNS trigger
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
      'DROP TRIGGER IF EXISTS relay_reject_runtime_control_plane_update ON %I',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER relay_reject_runtime_control_plane_update
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION relay_reject_runtime_control_plane_update()',
      table_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS relay_api_organization_membership_lock ON relay_organization_memberships;
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

DROP POLICY IF EXISTS relay_api_space_membership_lock ON relay_space_memberships;
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
  read_only_organization_tables constant text[] := ARRAY[
    'relay_service_accounts'
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
  FOREACH table_name IN ARRAY read_only_organization_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant_select ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant_lock ON %I', table_name);
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

  FOREACH table_name IN ARRAY read_only_space_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant_select ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS relay_api_tenant_lock ON %I', table_name);
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
    EXECUTE format('DROP POLICY IF EXISTS relay_worker_execution ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS relay_worker_select ON %I', table_name);
    EXECUTE format('CREATE POLICY relay_worker_select ON %I FOR SELECT TO relay_worker_runtime USING (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_insert_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS relay_worker_insert ON %I', table_name);
    EXECUTE format('CREATE POLICY relay_worker_insert ON %I FOR INSERT TO relay_worker_runtime WITH CHECK (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_update_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS relay_worker_update ON %I', table_name);
    EXECUTE format('CREATE POLICY relay_worker_update ON %I FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_lock_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS relay_worker_lock ON %I', table_name);
    EXECUTE format('CREATE POLICY relay_worker_lock ON %I FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  protected_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('relay_api_runtime', 'relay_worker_runtime')
      AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Relay runtime database roles are not restricted';
  END IF;

  SELECT count(*) INTO protected_count
  FROM pg_class
  WHERE relnamespace = current_schema()::regnamespace
    AND relname LIKE 'relay_%'
    AND relkind = 'r'
    AND relname NOT IN ('relay_schema_migrations', 'relay_worker_heartbeats')
    AND relrowsecurity
    AND relforcerowsecurity;
  IF protected_count <> 24 THEN
    RAISE EXCEPTION 'Expected 24 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
