SET LOCAL lock_timeout = '5s';

-- The validated runtime typed-resource constraint supersedes this 014-era shape check.
ALTER TABLE cosmos_session_events
  DROP CONSTRAINT IF EXISTS cosmos_session_events_check;
