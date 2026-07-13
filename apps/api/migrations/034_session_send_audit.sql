SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check
    CHECK (action IN ('session.create', 'session.start', 'session.send')) NOT VALID,
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check
    CHECK (
      (action = 'session.create' AND before_state IS NULL)
      OR (
        action IN ('session.start', 'session.send')
        AND before_state IS NOT NULL
        AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID;
