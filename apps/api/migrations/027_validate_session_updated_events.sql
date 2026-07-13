SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_runtime_event_type_check;

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_runtime_typed_resource_check;
