SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_audit_events
  VALIDATE CONSTRAINT cosmos_audit_events_action_check,
  VALIDATE CONSTRAINT cosmos_audit_events_before_state_check;
