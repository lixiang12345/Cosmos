SET LOCAL lock_timeout = '5s';

DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE conname IN (
      'relay_attempts_turn_tenant_fk',
      'relay_messages_turn_tenant_fk',
      'relay_messages_attempt_tenant_fk',
      'relay_session_events_attempt_tenant_fk'
    )
      AND conrelid IN (
        'relay_attempts'::regclass,
        'relay_messages'::regclass,
        'relay_session_events'::regclass
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
