SET LOCAL lock_timeout = '5s';

CREATE TABLE cosmos_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  CONSTRAINT cosmos_worker_heartbeats_worker_id_check
    CHECK (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);

CREATE INDEX cosmos_worker_heartbeats_last_seen_at_idx
  ON cosmos_worker_heartbeats (last_seen_at DESC);
