ALTER TABLE cosmos_sessions
  ADD CONSTRAINT cosmos_sessions_tenant_identity_unique
  UNIQUE (organization_id, space_id, id);

CREATE TABLE cosmos_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('user', 'agent', 'tool', 'system', 'event')),
  actor_id text,
  content text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, sequence),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE TABLE cosmos_turns (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  initiator_type text NOT NULL CHECK (initiator_type IN ('user', 'event', 'system')),
  initiator_id text,
  input_message_id text NOT NULL REFERENCES cosmos_messages(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting_tool', 'waiting_approval', 'completed', 'failed', 'canceled')),
  queued_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  UNIQUE (session_id, ordinal),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE TABLE cosmos_commands (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  type text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'queued', 'running', 'succeeded', 'failed', 'canceled')),
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE INDEX cosmos_commands_available_idx
  ON cosmos_commands (status, available_at, accepted_at)
  WHERE status IN ('accepted', 'queued');

CREATE TABLE cosmos_outbox_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE INDEX cosmos_outbox_unpublished_idx
  ON cosmos_outbox_events (occurred_at, id)
  WHERE published_at IS NULL;

CREATE TABLE cosmos_idempotency_responses (
  organization_id text NOT NULL,
  actor_id text NOT NULL,
  method text NOT NULL,
  canonical_path text NOT NULL,
  idempotency_key_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, actor_id, method, canonical_path, idempotency_key_hash)
);

CREATE INDEX cosmos_idempotency_responses_expiry_idx
  ON cosmos_idempotency_responses (expires_at);
