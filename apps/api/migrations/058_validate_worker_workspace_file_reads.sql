SET LOCAL lock_timeout = '5s';

DO $$
DECLARE protected_count integer;
BEGIN
  IF NOT has_table_privilege('cosmos_worker_runtime', 'cosmos_group_memberships', 'SELECT')
    OR NOT has_table_privilege('cosmos_worker_runtime', 'cosmos_session_share_grants', 'SELECT') THEN
    RAISE EXCEPTION 'Worker runtime is missing workspace visibility read privileges';
  END IF;

  IF has_table_privilege('cosmos_worker_runtime', 'cosmos_group_memberships', 'INSERT')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_group_memberships', 'UPDATE')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_group_memberships', 'DELETE')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_group_memberships', 'TRUNCATE')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_session_share_grants', 'INSERT')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_session_share_grants', 'UPDATE')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_session_share_grants', 'DELETE')
    OR has_table_privilege('cosmos_worker_runtime', 'cosmos_session_share_grants', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Worker runtime must not mutate workspace visibility grants';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'cosmos_group_memberships'
      AND policyname = 'cosmos_worker_select'
      AND 'cosmos_worker_runtime' = ANY(roles)
      AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'cosmos_session_share_grants'
      AND policyname = 'cosmos_worker_select'
      AND 'cosmos_worker_runtime' = ANY(roles)
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Worker workspace visibility RLS policies are missing';
  END IF;

  SELECT count(*) INTO protected_count
  FROM pg_class
  WHERE relnamespace = current_schema()::regnamespace
    AND relname LIKE 'cosmos_%'
    AND relkind = 'r'
    AND relname NOT IN ('cosmos_schema_migrations', 'cosmos_worker_heartbeats')
    AND relrowsecurity
    AND relforcerowsecurity;
  IF protected_count <> 33 THEN
    RAISE EXCEPTION 'Expected 33 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
