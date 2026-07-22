SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cosmos_observer_runtime') THEN
    CREATE ROLE cosmos_observer_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE cosmos_observer_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END;
$$;

DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO cosmos_observer_runtime', current_schema());
END;
$$;

GRANT SELECT (last_seen_at)
  ON cosmos_worker_heartbeats TO cosmos_observer_runtime;
GRANT SELECT (
  status, accepted_at, queued_at, heartbeat_at, lease_expires_at
) ON cosmos_commands TO cosmos_observer_runtime;
GRANT SELECT (status, available_at, lease_expires_at, created_at)
  ON cosmos_environment_provisioning_jobs TO cosmos_observer_runtime;
GRANT SELECT (occurred_at, published_at)
  ON cosmos_outbox_events,
     cosmos_environment_outbox_events,
     cosmos_automation_outbox_events,
     cosmos_space_outbox_events
  TO cosmos_observer_runtime;

CREATE POLICY cosmos_observer_commands_select ON cosmos_commands
  FOR SELECT TO cosmos_observer_runtime USING (true);
CREATE POLICY cosmos_observer_environment_jobs_select ON cosmos_environment_provisioning_jobs
  FOR SELECT TO cosmos_observer_runtime USING (true);
CREATE POLICY cosmos_observer_outbox_select ON cosmos_outbox_events
  FOR SELECT TO cosmos_observer_runtime USING (true);
CREATE POLICY cosmos_observer_environment_outbox_select ON cosmos_environment_outbox_events
  FOR SELECT TO cosmos_observer_runtime USING (true);
CREATE POLICY cosmos_observer_automation_outbox_select ON cosmos_automation_outbox_events
  FOR SELECT TO cosmos_observer_runtime USING (true);
CREATE POLICY cosmos_observer_space_outbox_select ON cosmos_space_outbox_events
  FOR SELECT TO cosmos_observer_runtime USING (true);

DO $$
DECLARE
  role_record record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit
    INTO role_record
    FROM pg_roles
   WHERE rolname = 'cosmos_observer_runtime';
  IF role_record.rolsuper OR role_record.rolbypassrls OR role_record.rolcanlogin OR role_record.rolinherit THEN
    RAISE EXCEPTION 'Observer runtime role must remain NOLOGIN, NOINHERIT and non-bypass';
  END IF;
END;
$$;
