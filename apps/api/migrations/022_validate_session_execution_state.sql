SET LOCAL lock_timeout = '5s';

DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conname IN (
      'cosmos_commands_protocol_version_check',
      'cosmos_commands_protocol1_tuple_check',
      'cosmos_attempts_number_check',
      'cosmos_attempts_model_check',
      'cosmos_attempts_runtime_tuple_check',
      'cosmos_messages_agent_attempt_check',
      'cosmos_session_events_runtime_event_type_check',
      'cosmos_session_events_runtime_resource_type_check',
      'cosmos_session_events_runtime_actor_kind_check',
      'cosmos_session_events_runtime_typed_resource_check'
    )
      AND conrelid IN (
        'cosmos_commands'::regclass,
        'cosmos_attempts'::regclass,
        'cosmos_messages'::regclass,
        'cosmos_session_events'::regclass
      )
      AND NOT convalidated
  LOOP
    EXECUTE format(
      'ALTER TABLE %s VALIDATE CONSTRAINT %I',
      constraint_record.table_name,
      constraint_record.conname
    );
  END LOOP;
END;
$$;
