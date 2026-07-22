SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_attempts
  ADD CONSTRAINT cosmos_attempts_tenant_identity_unique
  UNIQUE USING INDEX cosmos_attempts_tenant_identity_unique;

ALTER TABLE cosmos_attempts
  ADD CONSTRAINT cosmos_attempts_turn_number_unique
  UNIQUE USING INDEX cosmos_attempts_turn_number_unique;

ALTER TABLE cosmos_attempts
  ADD CONSTRAINT cosmos_attempts_turn_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, turn_id)
  REFERENCES cosmos_turns(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID;

ALTER TABLE cosmos_messages
  ADD CONSTRAINT cosmos_messages_turn_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, turn_id)
  REFERENCES cosmos_turns(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT cosmos_messages_attempt_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, turn_id, attempt_id)
  REFERENCES cosmos_attempts(organization_id, space_id, session_id, turn_id, id)
  ON DELETE RESTRICT NOT VALID;

ALTER TABLE cosmos_session_events
  ADD CONSTRAINT cosmos_session_events_attempt_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, turn_id, attempt_id)
  REFERENCES cosmos_attempts(organization_id, space_id, session_id, turn_id, id)
  ON DELETE RESTRICT NOT VALID;

ALTER TABLE cosmos_commands
  ADD CONSTRAINT cosmos_commands_protocol_version_check
  CHECK (protocol_version IN (0, 1)) NOT VALID,
  ADD CONSTRAINT cosmos_commands_protocol1_tuple_check
  CHECK (
    protocol_version = 0
    OR (
      protocol_version = 1
      AND requested_by IS NOT NULL AND btrim(requested_by) <> ''
      AND request_id IS NOT NULL AND btrim(request_id) <> ''
      AND max_attempts IS NOT NULL AND max_attempts > 0
      AND attempts <= max_attempts
      AND available_at >= accepted_at
      AND (
        (
          status = 'accepted'
          AND attempts = 0
          AND queued_at IS NULL AND started_at IS NULL AND heartbeat_at IS NULL
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
          status = 'queued'
          AND attempts >= 0 AND attempts < max_attempts
          AND queued_at IS NOT NULL AND queued_at >= accepted_at
          AND started_at IS NULL AND heartbeat_at IS NULL
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
          status = 'running'
          AND attempts > 0
          AND queued_at IS NOT NULL AND queued_at >= accepted_at
          AND started_at IS NOT NULL AND started_at >= queued_at
          AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
          AND lease_owner IS NOT NULL AND btrim(lease_owner) <> ''
          AND lease_expires_at IS NOT NULL AND lease_expires_at > heartbeat_at
          AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
          status = 'succeeded'
          AND attempts > 0
          AND queued_at IS NOT NULL AND queued_at >= accepted_at
          AND started_at IS NOT NULL AND started_at >= queued_at
          AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
          AND completed_at IS NOT NULL AND completed_at >= heartbeat_at
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND failure_code IS NULL AND failure_message IS NULL
        )
        OR (
          status = 'failed'
          AND attempts > 0
          AND queued_at IS NOT NULL AND queued_at >= accepted_at
          AND started_at IS NOT NULL AND started_at >= queued_at
          AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
          AND completed_at IS NOT NULL AND completed_at >= heartbeat_at
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND failure_code IS NOT NULL AND btrim(failure_code) <> ''
        )
        OR (
          status = 'canceled'
          AND completed_at IS NOT NULL AND completed_at >= accepted_at
          AND lease_owner IS NULL AND lease_expires_at IS NULL
          AND (failure_code IS NULL OR btrim(failure_code) <> '')
          AND (failure_code IS NOT NULL OR failure_message IS NULL)
          AND (
            (
              attempts = 0 AND queued_at IS NULL
              AND started_at IS NULL AND heartbeat_at IS NULL
            )
            OR (
              attempts >= 0 AND queued_at IS NOT NULL AND queued_at >= accepted_at
              AND started_at IS NULL AND heartbeat_at IS NULL
              AND completed_at >= queued_at
            )
            OR (
              attempts > 0
              AND queued_at IS NOT NULL AND queued_at >= accepted_at
              AND started_at IS NOT NULL AND started_at >= queued_at
              AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
              AND completed_at >= heartbeat_at
            )
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE cosmos_attempts
  ADD CONSTRAINT cosmos_attempts_number_check
  CHECK (number > 0) NOT VALID,
  ADD CONSTRAINT cosmos_attempts_model_check
  CHECK (btrim(model) <> '') NOT VALID,
  ADD CONSTRAINT cosmos_attempts_runtime_tuple_check
  CHECK (
    (
      status = 'queued'
      AND runtime_id IS NULL
      AND started_at IS NULL AND heartbeat_at IS NULL AND completed_at IS NULL
      AND failure_code IS NULL AND failure_message IS NULL
    )
    OR (
      status = 'starting'
      AND runtime_id IS NOT NULL AND btrim(runtime_id) <> ''
      AND started_at IS NOT NULL AND started_at >= created_at
      AND heartbeat_at IS NULL AND completed_at IS NULL
      AND failure_code IS NULL AND failure_message IS NULL
    )
    OR (
      status IN ('running', 'waiting', 'paused')
      AND runtime_id IS NOT NULL AND btrim(runtime_id) <> ''
      AND started_at IS NOT NULL AND started_at >= created_at
      AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
      AND completed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL
    )
    OR (
      status = 'succeeded'
      AND runtime_id IS NOT NULL AND btrim(runtime_id) <> ''
      AND started_at IS NOT NULL AND started_at >= created_at
      AND heartbeat_at IS NOT NULL AND heartbeat_at >= started_at
      AND completed_at IS NOT NULL AND completed_at >= heartbeat_at
      AND failure_code IS NULL AND failure_message IS NULL
    )
    OR (
      status = 'failed'
      AND runtime_id IS NOT NULL AND btrim(runtime_id) <> ''
      AND started_at IS NOT NULL AND started_at >= created_at
      AND (heartbeat_at IS NULL OR heartbeat_at >= started_at)
      AND completed_at IS NOT NULL AND completed_at >= COALESCE(heartbeat_at, started_at)
      AND failure_code IS NOT NULL AND btrim(failure_code) <> ''
    )
    OR (
      status = 'canceled'
      AND (
        (started_at IS NULL AND runtime_id IS NULL)
        OR (started_at IS NOT NULL AND runtime_id IS NOT NULL AND btrim(runtime_id) <> '')
      )
      AND (started_at IS NULL OR started_at >= created_at)
      AND (heartbeat_at IS NULL OR (started_at IS NOT NULL AND heartbeat_at >= started_at))
      AND completed_at IS NOT NULL
      AND completed_at >= COALESCE(heartbeat_at, started_at, created_at)
      AND failure_code IS NULL AND failure_message IS NULL
    )
  ) NOT VALID;

ALTER TABLE cosmos_messages
  ADD CONSTRAINT cosmos_messages_agent_attempt_check
  CHECK (
    (turn_id IS NULL AND attempt_id IS NULL)
    OR (role = 'agent' AND turn_id IS NOT NULL AND attempt_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE cosmos_session_events
  ADD CONSTRAINT cosmos_session_events_runtime_event_type_check
  CHECK (event_type IN (
    'session.created',
    'session.updated',
    'message.created',
    'turn.queued',
    'attempt.updated'
  )) NOT VALID,
  ADD CONSTRAINT cosmos_session_events_runtime_resource_type_check
  CHECK (resource_type IN ('session', 'message', 'turn', 'attempt')) NOT VALID,
  ADD CONSTRAINT cosmos_session_events_runtime_actor_kind_check
  CHECK (actor_kind IN ('user', 'service_account', 'worker', 'system')) NOT VALID,
  ADD CONSTRAINT cosmos_session_events_runtime_typed_resource_check
  CHECK (
    (
      (
        event_type IN ('session.created', 'session.updated') AND resource_type = 'session'
        AND resource_id = session_id
        AND message_id IS NULL AND turn_id IS NULL AND attempt_id IS NULL
      )
      OR (
        event_type = 'message.created' AND resource_type = 'message'
        AND resource_id = message_id AND message_id IS NOT NULL
        AND turn_id IS NULL AND attempt_id IS NULL
      )
      OR (
        event_type = 'turn.queued' AND resource_type = 'turn'
        AND resource_id = turn_id AND turn_id IS NOT NULL
        AND command_id IS NOT NULL
        AND message_id IS NULL AND attempt_id IS NULL
      )
      OR (
        event_type = 'attempt.updated' AND resource_type = 'attempt'
        AND resource_id = attempt_id AND attempt_id IS NOT NULL
        AND message_id IS NULL AND turn_id IS NOT NULL
      )
    )
  ) NOT VALID;

ALTER TABLE cosmos_session_events
  DROP CONSTRAINT cosmos_session_events_event_type_check,
  DROP CONSTRAINT cosmos_session_events_resource_type_check,
  DROP CONSTRAINT cosmos_session_events_actor_kind_check,
  DROP CONSTRAINT cosmos_session_events_typed_resource_check;

CREATE FUNCTION cosmos_protect_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Cosmos Attempt rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.space_id IS DISTINCT FROM OLD.space_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.turn_id IS DISTINCT FROM OLD.turn_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cosmos Attempt identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Cosmos Attempt rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('starting', 'canceled'))
    OR (OLD.status = 'starting' AND NEW.status IN ('running', 'failed', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN ('waiting', 'paused', 'succeeded', 'failed', 'canceled'))
    OR (OLD.status = 'waiting' AND NEW.status IN ('running', 'paused', 'failed', 'canceled'))
    OR (OLD.status = 'paused' AND NEW.status IN ('running', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'Invalid Cosmos Attempt transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Cosmos Attempt started_at is immutable once set'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.runtime_id IS NOT NULL AND NEW.runtime_id IS DISTINCT FROM OLD.runtime_id THEN
    RAISE EXCEPTION 'Cosmos Attempt runtime_id is immutable once set'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.heartbeat_at IS NOT NULL
     AND (NEW.heartbeat_at IS NULL OR NEW.heartbeat_at < OLD.heartbeat_at) THEN
    RAISE EXCEPTION 'Cosmos Attempt heartbeat_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_attempts_protect_history
  BEFORE UPDATE OR DELETE ON cosmos_attempts
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_attempt_history();

CREATE TRIGGER cosmos_attempts_reject_truncate
  BEFORE TRUNCATE ON cosmos_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_protect_attempt_history();

REVOKE DELETE, TRUNCATE ON cosmos_attempts FROM PUBLIC;

CREATE FUNCTION cosmos_protect_command_runtime()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.protocol_version IS DISTINCT FROM OLD.protocol_version THEN
    RAISE EXCEPTION 'Cosmos Command protocol_version is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.protocol_version = 0 THEN
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.organization_id, NEW.space_id, NEW.session_id, NEW.id, NEW.type,
    NEW.resource_type, NEW.resource_id, NEW.payload, NEW.requested_by,
    NEW.request_id, NEW.max_attempts, NEW.accepted_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.space_id, OLD.session_id, OLD.id, OLD.type,
    OLD.resource_type, OLD.resource_id, OLD.payload, OLD.requested_by,
    OLD.request_id, OLD.max_attempts, OLD.accepted_at
  ) THEN
    RAISE EXCEPTION 'Cosmos Command request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Cosmos Command rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'accepted' AND NEW.status IN ('queued', 'running', 'canceled'))
    OR (OLD.status = 'queued' AND NEW.status IN ('running', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN ('queued', 'succeeded', 'failed', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'Invalid Cosmos Command transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN
    RAISE EXCEPTION 'Cosmos Command attempts fence must advance monotonically by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'running' AND OLD.status IN ('accepted', 'queued')
     AND NEW.attempts <> OLD.attempts + 1 THEN
    RAISE EXCEPTION 'Claiming a Cosmos Command must advance its attempts fence'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'running' AND NEW.status = 'running'
     AND NEW.attempts = OLD.attempts
     AND NEW.lease_owner IS DISTINCT FROM OLD.lease_owner THEN
    RAISE EXCEPTION 'Cosmos Command lease ownership changes require a new attempts fence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status <> 'running' AND NEW.attempts <> OLD.attempts THEN
    RAISE EXCEPTION 'Cosmos Command attempts may advance only while claiming a lease'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.heartbeat_at IS NOT NULL AND NEW.status <> 'queued'
     AND (NEW.heartbeat_at IS NULL OR NEW.heartbeat_at < OLD.heartbeat_at) THEN
    RAISE EXCEPTION 'Cosmos Command heartbeat_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_commands_protect_runtime
  BEFORE UPDATE ON cosmos_commands
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_command_runtime();
