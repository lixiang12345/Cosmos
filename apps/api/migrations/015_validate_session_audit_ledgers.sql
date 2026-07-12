DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conrelid = 'relay_session_events'::regclass
      AND conname IN (
        'relay_session_events_message_tenant_fk',
        'relay_session_events_turn_tenant_fk',
        'relay_session_events_command_tenant_fk',
        'relay_session_events_typed_resource_check'
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
