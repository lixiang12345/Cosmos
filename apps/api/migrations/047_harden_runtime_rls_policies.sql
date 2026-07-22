SET LOCAL lock_timeout = '5s';

GRANT SELECT ON cosmos_schema_migrations TO cosmos_api_runtime, cosmos_worker_runtime;
GRANT SELECT ON cosmos_worker_heartbeats TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON cosmos_worker_heartbeats TO cosmos_worker_runtime;
GRANT UPDATE (role) ON cosmos_organization_memberships, cosmos_space_memberships
TO cosmos_api_runtime, cosmos_worker_runtime;
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
GRANT UPDATE (actor_id) ON cosmos_messages TO cosmos_worker_runtime;
GRANT DELETE ON cosmos_idempotency_records, cosmos_idempotency_responses
TO cosmos_api_runtime;

CREATE OR REPLACE FUNCTION cosmos_reject_runtime_control_plane_update() RETURNS trigger
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
      'DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON %I',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER cosmos_reject_runtime_control_plane_update
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION cosmos_reject_runtime_control_plane_update()',
      table_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS cosmos_api_organization_membership_lock ON cosmos_organization_memberships;
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

DROP POLICY IF EXISTS cosmos_api_space_membership_lock ON cosmos_space_memberships;
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
  read_only_organization_tables constant text[] := ARRAY[
    'cosmos_service_accounts'
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
  FOREACH table_name IN ARRAY read_only_organization_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant_select ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant_lock ON %I', table_name);
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

  FOREACH table_name IN ARRAY read_only_space_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant_select ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS cosmos_api_tenant_lock ON %I', table_name);
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
    EXECUTE format('DROP POLICY IF EXISTS cosmos_worker_execution ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS cosmos_worker_select ON %I', table_name);
    EXECUTE format('CREATE POLICY cosmos_worker_select ON %I FOR SELECT TO cosmos_worker_runtime USING (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_insert_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS cosmos_worker_insert ON %I', table_name);
    EXECUTE format('CREATE POLICY cosmos_worker_insert ON %I FOR INSERT TO cosmos_worker_runtime WITH CHECK (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_update_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS cosmos_worker_update ON %I', table_name);
    EXECUTE format('CREATE POLICY cosmos_worker_update ON %I FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY worker_lock_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS cosmos_worker_lock ON %I', table_name);
    EXECUTE format('CREATE POLICY cosmos_worker_lock ON %I FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  protected_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('cosmos_api_runtime', 'cosmos_worker_runtime')
      AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Cosmos runtime database roles are not restricted';
  END IF;

  SELECT count(*) INTO protected_count
  FROM pg_class
  WHERE relnamespace = current_schema()::regnamespace
    AND relname LIKE 'cosmos_%'
    AND relkind = 'r'
    AND relname NOT IN ('cosmos_schema_migrations', 'cosmos_worker_heartbeats')
    AND relrowsecurity
    AND relforcerowsecurity;
  IF protected_count <> 24 THEN
    RAISE EXCEPTION 'Expected 24 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
