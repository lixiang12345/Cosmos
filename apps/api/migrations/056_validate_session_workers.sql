SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_session_workers
  VALIDATE CONSTRAINT relay_session_workers_turn_tenant_fk;
ALTER TABLE relay_session_workers
  VALIDATE CONSTRAINT relay_session_workers_parent_tenant_fk;

DO $$
DECLARE protected_count integer;
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
  IF protected_count <> 33 THEN
    RAISE EXCEPTION 'Expected 33 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
