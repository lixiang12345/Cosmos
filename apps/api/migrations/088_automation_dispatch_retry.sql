SET LOCAL lock_timeout = '5s';

-- Asynchronous dispatch retry with a dead-letter terminal state. A failed
-- dispatch no longer finalizes the event: transient failures reschedule with
-- backoff until the attempt budget is exhausted, then the event parks in
-- 'dead_letter' where operators can see it in the Event Log.
ALTER TABLE cosmos_automation_events DROP CONSTRAINT cosmos_automation_events_status_check;
ALTER TABLE cosmos_automation_events ADD CONSTRAINT cosmos_automation_events_status_check
  CHECK (status IN (
    'received', 'matched', 'ignored', 'dispatching', 'dispatched', 'failed', 'dead_letter'
  ));

ALTER TABLE cosmos_automation_events
  ADD COLUMN dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  ADD COLUMN next_dispatch_at timestamptz;

CREATE INDEX cosmos_automation_events_retry_idx
  ON cosmos_automation_events (next_dispatch_at)
  WHERE status = 'matched' AND next_dispatch_at IS NOT NULL;

GRANT UPDATE (dispatch_attempts, next_dispatch_at)
  ON cosmos_automation_events TO cosmos_api_runtime;

-- The retry sweeper scans across tenants, which row-level security forbids
-- for the API role; claiming therefore happens in a definer function that
-- flips due events to 'dispatching' with SKIP LOCKED so concurrent API
-- instances never double-claim.
CREATE FUNCTION cosmos_claim_automation_dispatch_retries(batch_limit integer)
RETURNS TABLE (organization_id text, space_id text, event_id text, received_by text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE cosmos_automation_events events
  SET status = 'dispatching', next_dispatch_at = NULL
  FROM (
    SELECT due.organization_id, due.space_id, due.id
    FROM cosmos_automation_events due
    WHERE due.status = 'matched'
      AND due.next_dispatch_at IS NOT NULL
      AND due.next_dispatch_at <= now()
    ORDER BY due.next_dispatch_at
    LIMIT LEAST(GREATEST(batch_limit, 1), 100)
    FOR UPDATE SKIP LOCKED
  ) claimed
  WHERE events.organization_id = claimed.organization_id
    AND events.space_id = claimed.space_id
    AND events.id = claimed.id
  RETURNING events.organization_id, events.space_id, events.id, events.received_by;
$$;

REVOKE EXECUTE ON FUNCTION cosmos_claim_automation_dispatch_retries(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cosmos_claim_automation_dispatch_retries(integer) TO cosmos_api_runtime;
