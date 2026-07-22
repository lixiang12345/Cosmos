CREATE TABLE IF NOT EXISTS cosmos_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cosmos_sessions (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  space_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  expert_id text NOT NULL,
  expert_name text NOT NULL,
  expert_version integer,
  environment_id text,
  repository text NOT NULL,
  base_branch text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'space')),
  status text NOT NULL CHECK (status IN ('draft', 'queued', 'active', 'waiting', 'paused', 'completed', 'failed', 'canceled')),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL CHECK (source = 'manual'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  version integer NOT NULL CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS cosmos_sessions_space_activity_idx
  ON cosmos_sessions (organization_id, space_id, last_activity_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS cosmos_idempotency_records (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  session_id text NOT NULL REFERENCES cosmos_sessions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, space_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS cosmos_idempotency_expiry_idx
  ON cosmos_idempotency_records (expires_at);
