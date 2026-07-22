SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_sessions
  ADD COLUMN automation_auto_archive boolean,
  ADD COLUMN automation_auto_archived_at timestamptz;

UPDATE cosmos_sessions
SET automation_auto_archive = false
WHERE source = 'automation';

ALTER TABLE cosmos_sessions
  ADD CONSTRAINT cosmos_sessions_automation_snapshot_check CHECK (
    (source = 'automation') = (automation_auto_archive IS NOT NULL)
  ),
  ADD CONSTRAINT cosmos_sessions_automation_auto_archived_check CHECK (
    automation_auto_archived_at IS NULL
    OR (
      source = 'automation'
      AND automation_auto_archive
      AND status = 'completed'
      AND archived_at = automation_auto_archived_at
    )
  );

CREATE FUNCTION cosmos_protect_session_automation_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.automation_auto_archive IS DISTINCT FROM OLD.automation_auto_archive THEN
    RAISE EXCEPTION 'Session Automation snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.automation_auto_archived_at IS DISTINCT FROM OLD.automation_auto_archived_at
    AND NOT (
      current_user = 'cosmos_worker_runtime'
      AND OLD.automation_auto_archived_at IS NULL
      AND OLD.archived_at IS NULL
      AND NEW.automation_auto_archived_at IS NOT NULL
      AND NEW.archived_at = NEW.automation_auto_archived_at
      AND NEW.source = 'automation'
      AND NEW.automation_auto_archive
      AND NEW.status = 'completed'
    ) THEN
    RAISE EXCEPTION 'Session automatic archive fact may only be written by Worker completion'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_sessions_protect_automation_snapshot
  BEFORE INSERT OR UPDATE ON cosmos_sessions
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_session_automation_snapshot();
