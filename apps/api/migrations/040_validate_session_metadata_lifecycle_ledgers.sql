SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_session_events
  VALIDATE CONSTRAINT cosmos_session_events_runtime_event_type_check;

ALTER TABLE cosmos_session_events
  VALIDATE CONSTRAINT cosmos_session_events_runtime_typed_resource_check;

ALTER TABLE cosmos_audit_events
  VALIDATE CONSTRAINT cosmos_audit_events_action_check;

ALTER TABLE cosmos_audit_events
  VALIDATE CONSTRAINT cosmos_audit_events_before_state_check;
