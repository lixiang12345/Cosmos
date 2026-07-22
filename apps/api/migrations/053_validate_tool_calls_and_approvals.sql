SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_tool_calls VALIDATE CONSTRAINT cosmos_tool_calls_approval_fk;
ALTER TABLE cosmos_session_events VALIDATE CONSTRAINT cosmos_session_events_tool_call_tenant_fk;
ALTER TABLE cosmos_session_events VALIDATE CONSTRAINT cosmos_session_events_approval_tenant_fk;
ALTER TABLE cosmos_session_events VALIDATE CONSTRAINT cosmos_session_events_runtime_event_type_check;
ALTER TABLE cosmos_session_events VALIDATE CONSTRAINT cosmos_session_events_runtime_resource_type_check;
ALTER TABLE cosmos_session_events VALIDATE CONSTRAINT cosmos_session_events_runtime_typed_resource_check;
ALTER TABLE cosmos_audit_events VALIDATE CONSTRAINT cosmos_audit_events_action_check;
ALTER TABLE cosmos_audit_events VALIDATE CONSTRAINT cosmos_audit_events_before_state_check;
ALTER TABLE cosmos_audit_events VALIDATE CONSTRAINT cosmos_audit_events_target_type_check;
ALTER TABLE cosmos_audit_events VALIDATE CONSTRAINT cosmos_audit_events_target_check;

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
  IF protected_count <> 32 THEN
    RAISE EXCEPTION 'Expected 32 FORCE RLS tenant tables, found %', protected_count;
  END IF;
END;
$$;
