SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_session_workers
  VALIDATE CONSTRAINT cosmos_session_workers_turn_tenant_fk;
ALTER TABLE cosmos_session_workers
  VALIDATE CONSTRAINT cosmos_session_workers_parent_tenant_fk;

DO $$
DECLARE protected_count integer;
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
  IF protected_count <> 33 THEN
    RAISE EXCEPTION 'Expected 33 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
