SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_session_events
  DROP CONSTRAINT relay_session_events_runtime_event_type_check,
  ADD CONSTRAINT relay_session_events_runtime_event_type_check
  CHECK (event_type IN (
    'session.created',
    'session.updated',
    'session.renamed',
    'session.archived',
    'session.restored',
    'message.created',
    'turn.queued',
    'attempt.updated'
  )) NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_typed_resource_check,
  ADD CONSTRAINT relay_session_events_runtime_typed_resource_check
  CHECK (
    (
      event_type IN (
        'session.created',
        'session.updated',
        'session.renamed',
        'session.archived',
        'session.restored'
      )
      AND resource_type = 'session'
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
  ) NOT VALID;

ALTER TABLE relay_audit_events
  ALTER COLUMN idempotency_key_hash DROP NOT NULL,
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check
    CHECK (action IN (
      'session.create',
      'session.start',
      'session.send',
      'session.rename',
      'session.archive',
      'session.restore'
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
          'session.restore'
        )
        AND before_state IS NOT NULL
        AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID;
