SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_expert_triggers
  DROP CONSTRAINT cosmos_expert_triggers_source_check,
  ADD COLUMN schedule_cron text,
  ADD COLUMN schedule_timezone text,
  ADD COLUMN max_runs_per_minute integer NOT NULL DEFAULT 10
    CHECK (max_runs_per_minute BETWEEN 1 AND 120),
  ADD CONSTRAINT cosmos_expert_triggers_source_check
    CHECK (source IN ('github', 'linear', 'slack', 'gitlab', 'pagerduty', 'schedule', 'webhook'));

UPDATE cosmos_expert_triggers
SET schedule_cron = '0 8 * * *', schedule_timezone = 'America/Los_Angeles'
WHERE source = 'schedule';

ALTER TABLE cosmos_expert_triggers
  ADD CONSTRAINT cosmos_expert_triggers_schedule_check CHECK (
    (source = 'schedule') = (schedule_cron IS NOT NULL AND schedule_timezone IS NOT NULL)
    AND (schedule_cron IS NULL OR schedule_cron ~ '^\S+\s+\S+\s+\S+\s+\S+\s+\S+$')
  );

ALTER TABLE cosmos_automation_events
  DROP CONSTRAINT cosmos_automation_events_source_check,
  ADD CONSTRAINT cosmos_automation_events_source_check
    CHECK (source IN ('github', 'linear', 'slack', 'gitlab', 'pagerduty', 'schedule', 'webhook'));
