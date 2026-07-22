SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_environments
  ALTER COLUMN latest_revision_id DROP NOT NULL,
  ADD CONSTRAINT cosmos_environments_latest_revision_required_check CHECK (
    status = 'draft' OR latest_revision_id IS NOT NULL
  );

ALTER TABLE cosmos_environment_revisions
  ALTER COLUMN checksum SET DEFAULT repeat('0', 64),
  ALTER COLUMN configuration SET DEFAULT '{
    "image":"ghcr.io/cosmos/runtime:stable",
    "variableReferences":[],
    "hooks":[],
    "networkPolicy":{"mode":"restricted","allowedHosts":[]},
    "sharing":"space",
    "daemonPoolId":null
  }'::jsonb;

CREATE FUNCTION cosmos_default_environment_latest_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latest_revision_id IS NULL AND NEW.active_revision_id IS NOT NULL THEN
    NEW.latest_revision_id := NEW.active_revision_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_environments_default_latest_revision
  BEFORE INSERT OR UPDATE OF status, active_revision_id, latest_revision_id ON cosmos_environments
  FOR EACH ROW EXECUTE FUNCTION cosmos_default_environment_latest_revision();

-- Runtime roles have no TRUNCATE privilege. Migration administrators retain the
-- ability to clear isolated schemas while row updates/deletes remain immutable.
DROP TRIGGER IF EXISTS cosmos_environment_audit_events_reject_truncate
  ON cosmos_environment_audit_events;
DROP TRIGGER IF EXISTS cosmos_execution_snapshots_reject_truncate
  ON cosmos_execution_snapshots;
