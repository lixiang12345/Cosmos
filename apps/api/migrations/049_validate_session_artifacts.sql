SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_artifacts
  VALIDATE CONSTRAINT relay_artifacts_turn_tenant_fk;

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_artifact_tenant_fk;

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_runtime_event_type_check;

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_runtime_resource_type_check;

ALTER TABLE relay_session_events
  VALIDATE CONSTRAINT relay_session_events_runtime_typed_resource_check;

ALTER TABLE relay_audit_events
  VALIDATE CONSTRAINT relay_audit_events_action_check;

ALTER TABLE relay_audit_events
  VALIDATE CONSTRAINT relay_audit_events_before_state_check;

ALTER TABLE relay_audit_events
  VALIDATE CONSTRAINT relay_audit_events_target_type_check;

ALTER TABLE relay_audit_events
  VALIDATE CONSTRAINT relay_audit_events_target_check;
