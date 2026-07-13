SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check
    CHECK (action IN (
      'session.create',
      'session.start',
      'session.send',
      'session.rename',
      'session.archive',
      'session.restore',
      'session.pause',
      'session.resume',
      'session.cancel',
      'turn.retry'
    )) NOT VALID,
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check
    CHECK (
      (action = 'session.create' AND before_state IS NULL)
      OR (
        action IN (
          'session.start',
          'session.send',
          'session.rename',
          'session.archive',
          'session.restore',
          'session.pause',
          'session.resume',
          'session.cancel',
          'turn.retry'
        )
        AND before_state IS NOT NULL
        AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_type_check,
  ADD CONSTRAINT relay_audit_events_target_type_check
    CHECK (target_type IN ('session', 'turn')) NOT VALID,
  DROP CONSTRAINT relay_audit_events_check,
  ADD CONSTRAINT relay_audit_events_target_check
    CHECK (
      (action = 'turn.retry' AND target_type = 'turn')
      OR (
        action <> 'turn.retry'
        AND target_type = 'session'
        AND target_id = session_id
      )
    ) NOT VALID;

CREATE OR REPLACE FUNCTION relay_protect_turn_history()
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
    RAISE EXCEPTION 'Relay Turn identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Relay Turn rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN (
      'queued', 'waiting_tool', 'waiting_approval', 'completed', 'failed', 'canceled'
    ))
    OR (OLD.status IN ('waiting_tool', 'waiting_approval')
      AND NEW.status IN ('queued', 'running', 'completed', 'failed', 'canceled'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
  ) THEN
    RAISE EXCEPTION 'Invalid Relay Turn transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status <> OLD.status AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Relay Turn status transitions must advance version by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = OLD.status AND NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Relay Turn version may change only with status'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.heartbeat_at IS NOT NULL AND NEW.status <> 'queued'
     AND (NEW.heartbeat_at IS NULL OR NEW.heartbeat_at < OLD.heartbeat_at) THEN
    RAISE EXCEPTION 'Relay Turn heartbeat_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
