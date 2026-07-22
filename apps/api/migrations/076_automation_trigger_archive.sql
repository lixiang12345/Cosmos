SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_expert_triggers
  DROP CONSTRAINT relay_expert_triggers_status_check,
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT relay_expert_triggers_status_check
    CHECK (status IN ('draft', 'paused', 'active', 'error', 'archived')),
  ADD CONSTRAINT relay_expert_triggers_archive_fact_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL));

CREATE FUNCTION relay_protect_archived_automation_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Automation Triggers must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived Automation Triggers are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_expert_triggers_protect_archive
  BEFORE UPDATE OR DELETE ON relay_expert_triggers
  FOR EACH ROW EXECUTE FUNCTION relay_protect_archived_automation_trigger();

GRANT UPDATE (archived_at) ON relay_expert_triggers TO relay_api_runtime;
