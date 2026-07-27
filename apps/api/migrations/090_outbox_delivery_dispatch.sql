-- Production delivery state for the four core Outbox streams observed by the
-- Cosmos SLO. Source Outbox rows remain append-only domain facts; mutable
-- delivery state and operational audit facts live in dedicated tables.

CREATE TABLE cosmos_outbox_deliveries (
  stream text NOT NULL CHECK (stream IN ('session', 'environment', 'automation', 'space')),
  organization_id text NOT NULL CHECK (char_length(organization_id) BETWEEN 1 AND 256),
  space_id text NOT NULL CHECK (char_length(space_id) BETWEEN 1 AND 256),
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 256),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 160),
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'retrying', 'delivered', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'receiver_rejected', 'receiver_redirect', 'receiver_server_error',
    'receiver_timeout', 'receiver_network_error', 'receiver_interrupted'
  )),
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (stream, organization_id, space_id, source_id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'delivering' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'delivering' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CHECK ((status = 'dead_letter') = (dead_lettered_at IS NOT NULL))
);

CREATE INDEX cosmos_outbox_deliveries_claim_idx
  ON cosmos_outbox_deliveries (next_attempt_at, occurred_at, stream, source_id)
  WHERE status IN ('pending', 'retrying', 'delivering');

CREATE INDEX cosmos_outbox_deliveries_dead_letter_idx
  ON cosmos_outbox_deliveries (dead_lettered_at DESC, stream, source_id)
  WHERE status = 'dead_letter';

CREATE TABLE cosmos_outbox_delivery_audit_events (
  id text PRIMARY KEY,
  stream text NOT NULL CHECK (stream IN ('session', 'environment', 'automation', 'space')),
  organization_id text NOT NULL,
  space_id text NOT NULL,
  source_id text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'delivery.claimed', 'delivery.delivered', 'delivery.retry_scheduled',
    'delivery.dead_lettered', 'delivery.replayed'
  )),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  attempt integer NOT NULL CHECK (attempt >= 0),
  delivery_version integer NOT NULL CHECK (delivery_version > 0),
  error_code text CHECK (error_code IS NULL OR error_code IN (
    'receiver_rejected', 'receiver_redirect', 'receiver_server_error',
    'receiver_timeout', 'receiver_network_error', 'receiver_interrupted'
  )),
  reason text CHECK (reason IS NULL OR reason IN (
    'receiver_policy_fixed', 'receiver_recovered', 'operator_reconciled'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (stream, organization_id, space_id, source_id)
    REFERENCES cosmos_outbox_deliveries(stream, organization_id, space_id, source_id)
    ON DELETE RESTRICT
);

CREATE INDEX cosmos_outbox_delivery_audit_timeline_idx
  ON cosmos_outbox_delivery_audit_events (
    stream, organization_id, space_id, source_id, occurred_at, id
  );

CREATE TRIGGER cosmos_outbox_delivery_audit_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_outbox_delivery_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_outbox_delivery_audit_reject_truncate
  BEFORE TRUNCATE ON cosmos_outbox_delivery_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

CREATE FUNCTION cosmos_enqueue_outbox_delivery() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cosmos_outbox_deliveries (
    stream, organization_id, space_id, source_id, event_type, occurred_at,
    next_attempt_at, created_at, updated_at
  ) VALUES (
    TG_ARGV[0], NEW.organization_id, NEW.space_id, NEW.id, NEW.event_type,
    NEW.occurred_at, NEW.occurred_at, NEW.occurred_at, NEW.occurred_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_session_outbox_enqueue_delivery
  AFTER INSERT ON cosmos_outbox_events
  FOR EACH ROW EXECUTE FUNCTION cosmos_enqueue_outbox_delivery('session');
CREATE TRIGGER cosmos_environment_outbox_enqueue_delivery
  AFTER INSERT ON cosmos_environment_outbox_events
  FOR EACH ROW EXECUTE FUNCTION cosmos_enqueue_outbox_delivery('environment');
CREATE TRIGGER cosmos_automation_outbox_enqueue_delivery
  AFTER INSERT ON cosmos_automation_outbox_events
  FOR EACH ROW EXECUTE FUNCTION cosmos_enqueue_outbox_delivery('automation');
CREATE TRIGGER cosmos_space_outbox_enqueue_delivery
  AFTER INSERT ON cosmos_space_outbox_events
  FOR EACH ROW EXECUTE FUNCTION cosmos_enqueue_outbox_delivery('space');

INSERT INTO cosmos_outbox_deliveries (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
)
SELECT 'session', organization_id, space_id, id, event_type, occurred_at,
  occurred_at, occurred_at, occurred_at
FROM cosmos_outbox_events WHERE published_at IS NULL
ON CONFLICT (stream, organization_id, space_id, source_id) DO NOTHING;

INSERT INTO cosmos_outbox_deliveries (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
)
SELECT 'environment', organization_id, space_id, id, event_type, occurred_at,
  occurred_at, occurred_at, occurred_at
FROM cosmos_environment_outbox_events WHERE published_at IS NULL
ON CONFLICT (stream, organization_id, space_id, source_id) DO NOTHING;

INSERT INTO cosmos_outbox_deliveries (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
)
SELECT 'automation', organization_id, space_id, id, event_type, occurred_at,
  occurred_at, occurred_at, occurred_at
FROM cosmos_automation_outbox_events WHERE published_at IS NULL
ON CONFLICT (stream, organization_id, space_id, source_id) DO NOTHING;

INSERT INTO cosmos_outbox_deliveries (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
)
SELECT 'space', organization_id, space_id, id, event_type, occurred_at,
  occurred_at, occurred_at, occurred_at
FROM cosmos_space_outbox_events WHERE published_at IS NULL
ON CONFLICT (stream, organization_id, space_id, source_id) DO NOTHING;

ALTER TABLE cosmos_outbox_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_outbox_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_outbox_delivery_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_outbox_delivery_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_migration_admin ON cosmos_outbox_deliveries
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_outbox_delivery_audit_events
  TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY cosmos_api_outbox_delivery_enqueue ON cosmos_outbox_deliveries
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);
CREATE POLICY cosmos_worker_outbox_delivery_access ON cosmos_outbox_deliveries
  FOR ALL TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_outbox_delivery_audit_access ON cosmos_outbox_delivery_audit_events
  FOR ALL TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_observer_outbox_delivery_select ON cosmos_outbox_deliveries
  FOR SELECT TO cosmos_observer_runtime USING (true);

CREATE POLICY cosmos_worker_session_outbox_delivery_select ON cosmos_outbox_events
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_session_outbox_delivery_update ON cosmos_outbox_events
  FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_environment_outbox_delivery_select ON cosmos_environment_outbox_events
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_environment_outbox_delivery_update ON cosmos_environment_outbox_events
  FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_automation_outbox_delivery_select ON cosmos_automation_outbox_events
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_automation_outbox_delivery_update ON cosmos_automation_outbox_events
  FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_space_outbox_delivery_select ON cosmos_space_outbox_events
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_space_outbox_delivery_update ON cosmos_space_outbox_events
  FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);

GRANT INSERT (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
) ON cosmos_outbox_deliveries TO cosmos_api_runtime, cosmos_worker_runtime;
GRANT SELECT ON cosmos_outbox_deliveries TO cosmos_worker_runtime;
GRANT UPDATE (
  status, attempts, next_attempt_at, lease_owner, lease_expires_at,
  last_error_code, delivered_at, dead_lettered_at, updated_at, version
) ON cosmos_outbox_deliveries TO cosmos_worker_runtime;
GRANT SELECT, INSERT ON cosmos_outbox_delivery_audit_events TO cosmos_worker_runtime;
GRANT SELECT (
  stream, status, occurred_at, next_attempt_at, lease_expires_at,
  dead_lettered_at, delivered_at
) ON cosmos_outbox_deliveries TO cosmos_observer_runtime;

GRANT SELECT (organization_id, space_id, id, published_at), UPDATE (published_at)
  ON cosmos_outbox_events TO cosmos_worker_runtime;
GRANT SELECT (organization_id, space_id, id, published_at), UPDATE (published_at)
  ON cosmos_environment_outbox_events TO cosmos_worker_runtime;
GRANT SELECT (organization_id, space_id, id, published_at), UPDATE (published_at)
  ON cosmos_automation_outbox_events TO cosmos_worker_runtime;
GRANT SELECT (organization_id, space_id, id, published_at), UPDATE (published_at)
  ON cosmos_space_outbox_events TO cosmos_worker_runtime;
