SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_commands
  ADD COLUMN protocol_version smallint NOT NULL DEFAULT 0,
  ADD COLUMN requested_by text,
  ADD COLUMN request_id text,
  ADD COLUMN max_attempts integer,
  ADD COLUMN queued_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN failure_code text,
  ADD COLUMN failure_message text;

ALTER TABLE cosmos_turns
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN failure_code text,
  ADD COLUMN failure_message text;

CREATE TABLE cosmos_attempts (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  turn_id text NOT NULL,
  id text NOT NULL,
  number integer NOT NULL,
  status text NOT NULL,
  model text NOT NULL,
  runtime_id text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_message text
);

ALTER TABLE cosmos_messages
  ADD COLUMN turn_id text,
  ADD COLUMN attempt_id text;

ALTER TABLE cosmos_session_events
  ADD COLUMN attempt_id text;
