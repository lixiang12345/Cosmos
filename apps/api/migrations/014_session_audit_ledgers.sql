ALTER TABLE relay_sessions
  ADD COLUMN IF NOT EXISTS last_event_sequence bigint NOT NULL DEFAULT 0
  CHECK (last_event_sequence >= 0);

CREATE TABLE IF NOT EXISTS relay_session_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  event_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL
    CHECK (event_type IN ('session.created', 'message.created', 'turn.queued')),
  resource_type text NOT NULL
    CHECK (resource_type IN ('session', 'message', 'turn')),
  resource_id text NOT NULL,
  payload_schema_version smallint NOT NULL DEFAULT 1
    CHECK (payload_schema_version = 1),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service_account')),
  message_id text,
  turn_id text,
  command_id text,
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, event_id),
  UNIQUE (organization_id, space_id, session_id, sequence),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT
);

ALTER TABLE relay_session_events ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE relay_session_events ADD COLUMN IF NOT EXISTS turn_id text;

DO $$
DECLARE had_update_delete_trigger boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'relay_session_events'::regclass
      AND tgname = 'relay_session_events_reject_update_delete'
      AND NOT tgisinternal
  ) INTO had_update_delete_trigger;

  IF had_update_delete_trigger THEN
    ALTER TABLE relay_session_events
      DISABLE TRIGGER relay_session_events_reject_update_delete;
  END IF;

  UPDATE relay_session_events
  SET message_id = CASE WHEN resource_type = 'message' THEN resource_id ELSE NULL END,
      turn_id = CASE WHEN resource_type = 'turn' THEN resource_id ELSE NULL END
  WHERE (resource_type = 'message' AND message_id IS DISTINCT FROM resource_id)
     OR (resource_type = 'turn' AND turn_id IS DISTINCT FROM resource_id)
     OR (resource_type = 'session' AND (message_id IS NOT NULL OR turn_id IS NOT NULL));

  IF had_update_delete_trigger THEN
    ALTER TABLE relay_session_events
      ENABLE TRIGGER relay_session_events_reject_update_delete;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_session_events'::regclass
      AND conname = 'relay_session_events_message_tenant_fk'
  ) THEN
    ALTER TABLE relay_session_events
      ADD CONSTRAINT relay_session_events_message_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id, message_id)
      REFERENCES relay_messages(organization_id, space_id, session_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_session_events'::regclass
      AND conname = 'relay_session_events_turn_tenant_fk'
  ) THEN
    ALTER TABLE relay_session_events
      ADD CONSTRAINT relay_session_events_turn_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id, turn_id)
      REFERENCES relay_turns(organization_id, space_id, session_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_session_events'::regclass
      AND conname = 'relay_session_events_command_tenant_fk'
  ) THEN
    ALTER TABLE relay_session_events
      ADD CONSTRAINT relay_session_events_command_tenant_fk
      FOREIGN KEY (organization_id, space_id, session_id, command_id)
      REFERENCES relay_commands(organization_id, space_id, session_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'relay_session_events'::regclass
      AND conname = 'relay_session_events_typed_resource_check'
  ) THEN
    ALTER TABLE relay_session_events
      ADD CONSTRAINT relay_session_events_typed_resource_check
      CHECK (
        (
          event_type = 'session.created' AND resource_type = 'session'
          AND resource_id = session_id AND message_id IS NULL AND turn_id IS NULL
        )
        OR (
          event_type = 'message.created' AND resource_type = 'message'
          AND resource_id = message_id AND message_id IS NOT NULL AND turn_id IS NULL
        )
        OR (
          event_type = 'turn.queued' AND resource_type = 'turn'
          AND resource_id = turn_id AND message_id IS NULL AND turn_id IS NOT NULL
          AND command_id IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS relay_audit_events (
  organization_id text NOT NULL,
  audit_event_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service_account')),
  delegation_chain jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(delegation_chain) = 'array'),
  action text NOT NULL CHECK (action = 'session.create'),
  target_type text NOT NULL CHECK (target_type = 'session'),
  target_id text NOT NULL,
  result text NOT NULL CHECK (result = 'success'),
  request_id text NOT NULL,
  idempotency_key_hash text NOT NULL
    CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  policy_decision text NOT NULL CHECK (policy_decision = 'allow'),
  policy_reason text NOT NULL,
  before_state jsonb CHECK (before_state IS NULL),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, audit_event_id),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK (target_id = session_id)
);

CREATE INDEX IF NOT EXISTS relay_audit_events_target_idx
  ON relay_audit_events (organization_id, space_id, session_id, occurred_at, audit_event_id);

CREATE OR REPLACE FUNCTION relay_reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Relay ledger rows are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS relay_session_events_reject_update_delete ON relay_session_events;
CREATE TRIGGER relay_session_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON relay_session_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

DROP TRIGGER IF EXISTS relay_session_events_reject_truncate ON relay_session_events;
CREATE TRIGGER relay_session_events_reject_truncate
  BEFORE TRUNCATE ON relay_session_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

DROP TRIGGER IF EXISTS relay_audit_events_reject_update_delete ON relay_audit_events;
CREATE TRIGGER relay_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON relay_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

DROP TRIGGER IF EXISTS relay_audit_events_reject_truncate ON relay_audit_events;
CREATE TRIGGER relay_audit_events_reject_truncate
  BEFORE TRUNCATE ON relay_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON relay_session_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON relay_audit_events FROM PUBLIC;
