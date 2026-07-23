SET LOCAL lock_timeout = '5s';

-- Canonical daemon (self-hosted execution machine) registry. Records which
-- daemons are registered to a Space and which Environment pool they belong to,
-- so the scheduler knows the available execution capacity. Heartbeats and live
-- status are advanced out-of-band by the daemon fleet, not on the write path.
CREATE TABLE cosmos_daemons (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  environment_id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 256),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2048),
  capabilities text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(capabilities) <= 64),
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'degraded', 'archived')),
  concurrency_slots integer NOT NULL DEFAULT 4 CHECK (concurrency_slots BETWEEN 1 AND 64),
  last_heartbeat_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, environment_id)
    REFERENCES cosmos_environments(organization_id, space_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_daemons_archive_fact_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_daemons_space_updated_idx
  ON cosmos_daemons (organization_id, space_id, updated_at DESC, id DESC)
  WHERE status <> 'archived';

-- Pool lookups: daemons grouped by their Environment.
CREATE INDEX cosmos_daemons_environment_idx
  ON cosmos_daemons (organization_id, space_id, environment_id)
  WHERE status <> 'archived';

-- Daemon names are unique within an active Space.
CREATE UNIQUE INDEX cosmos_daemons_active_unique_idx
  ON cosmos_daemons (organization_id, space_id, name)
  WHERE status <> 'archived';

-- Audit ledger — append-only.
CREATE TABLE cosmos_daemon_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  daemon_id text,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_version integer,
  request_id text NOT NULL,
  idempotency_key_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, daemon_id)
    REFERENCES cosmos_daemons(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox for downstream consumers (e.g. scheduler capacity sync).
CREATE TABLE cosmos_daemon_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  daemon_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_daemons ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_daemons FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_daemon_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_daemon_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_daemon_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_daemon_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: space members may read; managers may mutate.
CREATE POLICY cosmos_api_daemon_select ON cosmos_daemons
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_daemons.organization_id
             AND sm.space_id = cosmos_daemons.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_daemon_mutate ON cosmos_daemons
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_daemon_audit_insert ON cosmos_daemon_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_daemon_audit_select ON cosmos_daemon_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_daemon_outbox_access ON cosmos_daemon_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON cosmos_daemons TO cosmos_api_runtime;
GRANT UPDATE (description, capabilities, enabled, status, concurrency_slots, last_heartbeat_at, version, updated_at, archived_at)
  ON cosmos_daemons TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_daemon_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_daemon_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_daemon() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Daemons must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived daemons are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_daemons_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_daemons
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_daemon();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_daemon_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_daemons_version_increment
  BEFORE UPDATE ON cosmos_daemons
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_daemon_version();
