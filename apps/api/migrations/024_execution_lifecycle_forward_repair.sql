SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_commands
  DROP CONSTRAINT cosmos_commands_protocol1_tuple_check,
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

CREATE FUNCTION cosmos_protect_turn_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.organization_id, NEW.space_id, NEW.session_id, NEW.id, NEW.ordinal,
    NEW.initiator_type, NEW.initiator_id, NEW.input_message_id, NEW.queued_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.space_id, OLD.session_id, OLD.id, OLD.ordinal,
    OLD.initiator_type, OLD.initiator_id, OLD.input_message_id, OLD.queued_at
  ) THEN
    RAISE EXCEPTION 'Cosmos Turn identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Cosmos Turn rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN (
      'queued', 'waiting_tool', 'waiting_approval', 'completed', 'failed', 'canceled'
    ))
    OR (OLD.status IN ('waiting_tool', 'waiting_approval')
      AND NEW.status IN ('running', 'completed', 'failed', 'canceled'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
  ) THEN
    RAISE EXCEPTION 'Invalid Cosmos Turn transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status <> OLD.status AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Cosmos Turn status transitions must advance version by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = OLD.status AND NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Cosmos Turn version may change only with status'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.heartbeat_at IS NOT NULL AND NEW.status <> 'queued'
     AND (NEW.heartbeat_at IS NULL OR NEW.heartbeat_at < OLD.heartbeat_at) THEN
    RAISE EXCEPTION 'Cosmos Turn heartbeat_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_turns_protect_history
  BEFORE UPDATE ON cosmos_turns
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_turn_history();
