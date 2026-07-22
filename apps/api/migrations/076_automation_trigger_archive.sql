SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_expert_triggers
  DROP CONSTRAINT cosmos_expert_triggers_status_check,
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT cosmos_expert_triggers_status_check
    CHECK (status IN ('draft', 'paused', 'active', 'error', 'archived')),
  ADD CONSTRAINT cosmos_expert_triggers_archive_fact_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL));

CREATE FUNCTION cosmos_protect_archived_automation_trigger() RETURNS trigger
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

CREATE TRIGGER cosmos_expert_triggers_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_expert_triggers
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_automation_trigger();

GRANT UPDATE (archived_at) ON cosmos_expert_triggers TO cosmos_api_runtime;
