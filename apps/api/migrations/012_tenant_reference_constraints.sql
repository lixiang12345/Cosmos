DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_sessions'::regclass
      AND conname = 'relay_sessions_tenant_identity_unique'
  ) THEN
    ALTER TABLE relay_sessions
      ADD CONSTRAINT relay_sessions_tenant_identity_unique
      UNIQUE USING INDEX relay_sessions_tenant_identity_unique;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_messages'::regclass
      AND conname = 'relay_messages_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE relay_messages
      ADD CONSTRAINT relay_messages_tenant_session_identity_unique
      UNIQUE USING INDEX relay_messages_tenant_session_identity_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_turns'::regclass
      AND conname = 'relay_turns_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE relay_turns
      ADD CONSTRAINT relay_turns_tenant_session_identity_unique
      UNIQUE USING INDEX relay_turns_tenant_session_identity_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_commands'::regclass
      AND conname = 'relay_commands_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE relay_commands
      ADD CONSTRAINT relay_commands_tenant_session_identity_unique
      UNIQUE USING INDEX relay_commands_tenant_session_identity_unique;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_messages'::regclass
      AND constraint_record.confrelid = 'relay_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES relay_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE relay_messages
      ADD CONSTRAINT relay_messages_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES relay_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_turns'::regclass
      AND constraint_record.confrelid = 'relay_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES relay_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE relay_turns
      ADD CONSTRAINT relay_turns_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES relay_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_turns'::regclass
      AND constraint_record.confrelid = 'relay_messages'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id, input_message_id) REFERENCES relay_messages(organization_id, space_id, session_id, id)%'
  ) THEN
    ALTER TABLE relay_turns
      ADD CONSTRAINT relay_turns_input_message_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id, input_message_id)
      REFERENCES relay_messages(organization_id, space_id, session_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_commands'::regclass
      AND constraint_record.confrelid = 'relay_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES relay_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE relay_commands
      ADD CONSTRAINT relay_commands_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES relay_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_outbox_events'::regclass
      AND constraint_record.confrelid = 'relay_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES relay_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE relay_outbox_events
      ADD CONSTRAINT relay_outbox_events_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES relay_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'relay_idempotency_records'::regclass
      AND constraint_record.confrelid = 'relay_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES relay_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE relay_idempotency_records
      ADD CONSTRAINT relay_idempotency_records_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES relay_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;
