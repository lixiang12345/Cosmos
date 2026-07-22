DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cosmos_sessions'::regclass
      AND conname = 'cosmos_sessions_tenant_identity_unique'
  ) THEN
    ALTER TABLE cosmos_sessions
      ADD CONSTRAINT cosmos_sessions_tenant_identity_unique
      UNIQUE USING INDEX cosmos_sessions_tenant_identity_unique;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cosmos_messages'::regclass
      AND conname = 'cosmos_messages_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE cosmos_messages
      ADD CONSTRAINT cosmos_messages_tenant_session_identity_unique
      UNIQUE USING INDEX cosmos_messages_tenant_session_identity_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cosmos_turns'::regclass
      AND conname = 'cosmos_turns_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE cosmos_turns
      ADD CONSTRAINT cosmos_turns_tenant_session_identity_unique
      UNIQUE USING INDEX cosmos_turns_tenant_session_identity_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cosmos_commands'::regclass
      AND conname = 'cosmos_commands_tenant_session_identity_unique'
  ) THEN
    ALTER TABLE cosmos_commands
      ADD CONSTRAINT cosmos_commands_tenant_session_identity_unique
      UNIQUE USING INDEX cosmos_commands_tenant_session_identity_unique;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_messages'::regclass
      AND constraint_record.confrelid = 'cosmos_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES cosmos_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE cosmos_messages
      ADD CONSTRAINT cosmos_messages_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES cosmos_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_turns'::regclass
      AND constraint_record.confrelid = 'cosmos_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES cosmos_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE cosmos_turns
      ADD CONSTRAINT cosmos_turns_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES cosmos_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_turns'::regclass
      AND constraint_record.confrelid = 'cosmos_messages'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id, input_message_id) REFERENCES cosmos_messages(organization_id, space_id, session_id, id)%'
  ) THEN
    ALTER TABLE cosmos_turns
      ADD CONSTRAINT cosmos_turns_input_message_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id, input_message_id)
      REFERENCES cosmos_messages(organization_id, space_id, session_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_commands'::regclass
      AND constraint_record.confrelid = 'cosmos_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES cosmos_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE cosmos_commands
      ADD CONSTRAINT cosmos_commands_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES cosmos_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_outbox_events'::regclass
      AND constraint_record.confrelid = 'cosmos_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES cosmos_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE cosmos_outbox_events
      ADD CONSTRAINT cosmos_outbox_events_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES cosmos_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'cosmos_idempotency_records'::regclass
      AND constraint_record.confrelid = 'cosmos_sessions'::regclass
      AND constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE
        'FOREIGN KEY (organization_id, space_id, session_id) REFERENCES cosmos_sessions(organization_id, space_id, id)%'
  ) THEN
    ALTER TABLE cosmos_idempotency_records
      ADD CONSTRAINT cosmos_idempotency_records_session_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id)
      REFERENCES cosmos_sessions(organization_id, space_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;
