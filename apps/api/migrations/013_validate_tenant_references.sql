DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conname IN (
      'cosmos_messages_session_tenant_fk',
      'cosmos_turns_session_tenant_fk',
      'cosmos_turns_input_message_tenant_fk',
      'cosmos_commands_session_tenant_fk',
      'cosmos_outbox_events_session_tenant_fk',
      'cosmos_idempotency_records_session_tenant_fk'
    )
      AND conrelid IN (
        'cosmos_messages'::regclass,
        'cosmos_turns'::regclass,
        'cosmos_commands'::regclass,
        'cosmos_outbox_events'::regclass,
        'cosmos_idempotency_records'::regclass
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
