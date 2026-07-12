DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conname IN (
      'relay_messages_session_tenant_fk',
      'relay_turns_session_tenant_fk',
      'relay_turns_input_message_tenant_fk',
      'relay_commands_session_tenant_fk',
      'relay_outbox_events_session_tenant_fk',
      'relay_idempotency_records_session_tenant_fk'
    )
      AND conrelid IN (
        'relay_messages'::regclass,
        'relay_turns'::regclass,
        'relay_commands'::regclass,
        'relay_outbox_events'::regclass,
        'relay_idempotency_records'::regclass
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
