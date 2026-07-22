SET LOCAL lock_timeout = '5s';

CREATE TABLE cosmos_security_audit_events (
  audit_event_id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE
    CHECK (length(request_id) BETWEEN 1 AND 256),
  hmac_key_id text NOT NULL
    CHECK (hmac_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  actor_fingerprint text
    CHECK (actor_fingerprint IS NULL OR actor_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_kind text CHECK (actor_kind IN ('user', 'service_account')),
  method text NOT NULL CHECK (method ~ '^[A-Z]{3,16}$'),
  route_pattern text NOT NULL
    CHECK (length(route_pattern) BETWEEN 1 AND 512),
  outcome text NOT NULL CHECK (outcome IN ('denied', 'rejected', 'failed')),
  status_code smallint NOT NULL CHECK (status_code BETWEEN 400 AND 599),
  error_code text NOT NULL CHECK (error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  organization_fingerprint text
    CHECK (organization_fingerprint IS NULL OR organization_fingerprint ~ '^[a-f0-9]{64}$'),
  space_fingerprint text
    CHECK (space_fingerprint IS NULL OR space_fingerprint ~ '^[a-f0-9]{64}$'),
  target_fingerprint text
    CHECK (target_fingerprint IS NULL OR target_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key_fingerprint text
    CHECK (idempotency_key_fingerprint IS NULL OR idempotency_key_fingerprint ~ '^[a-f0-9]{64}$'),
  client_ip_fingerprint text NOT NULL
    CHECK (client_ip_fingerprint ~ '^[a-f0-9]{64}$'),
  user_agent_fingerprint text
    CHECK (user_agent_fingerprint IS NULL OR user_agent_fingerprint ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  CHECK ((actor_fingerprint IS NULL) = (actor_kind IS NULL)),
  CHECK (
    (status_code IN (401, 403, 404) AND outcome = 'denied')
    OR (status_code BETWEEN 400 AND 499 AND status_code NOT IN (401, 403, 404)
      AND outcome = 'rejected')
    OR (status_code BETWEEN 500 AND 599 AND outcome = 'failed')
  )
);

CREATE INDEX cosmos_security_audit_events_occurred_idx
  ON cosmos_security_audit_events (occurred_at DESC, audit_event_id DESC);
CREATE INDEX cosmos_security_audit_events_actor_idx
  ON cosmos_security_audit_events (actor_fingerprint, occurred_at DESC)
  WHERE actor_fingerprint IS NOT NULL;

DROP TRIGGER IF EXISTS cosmos_security_audit_events_reject_update_delete
  ON cosmos_security_audit_events;
CREATE TRIGGER cosmos_security_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_security_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

DROP TRIGGER IF EXISTS cosmos_security_audit_events_reject_truncate
  ON cosmos_security_audit_events;
CREATE TRIGGER cosmos_security_audit_events_reject_truncate
  BEFORE TRUNCATE ON cosmos_security_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

REVOKE ALL ON cosmos_security_audit_events FROM PUBLIC;
GRANT INSERT ON cosmos_security_audit_events TO cosmos_api_runtime;

ALTER TABLE cosmos_security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_security_audit_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY cosmos_migration_admin ON cosmos_security_audit_events TO %I USING (true) WITH CHECK (true)',
    current_user
  );
END;
$$;

CREATE POLICY cosmos_api_insert ON cosmos_security_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);
