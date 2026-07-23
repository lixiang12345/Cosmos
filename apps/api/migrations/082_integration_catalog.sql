SET LOCAL lock_timeout = '5s';

-- Canonical integration catalog. Records which external development and
-- collaboration systems (GitHub, Slack, Jira, PagerDuty, Linear, custom) are
-- connected to a Space. Connection health and last-event facts are advanced
-- out-of-band by the integration workers, not on the write path.
CREATE TABLE cosmos_integrations (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  type text NOT NULL
    CHECK (type IN ('github', 'slack', 'jira', 'pagerduty', 'linear', 'custom')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 256),
  connection_status text NOT NULL DEFAULT 'action_required'
    CHECK (connection_status IN ('connected', 'action_required', 'disconnected', 'archived')),
  health text NOT NULL DEFAULT 'unknown'
    CHECK (health IN ('healthy', 'degraded', 'unknown')),
  scopes text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(scopes) <= 64),
  external_account text CHECK (external_account IS NULL OR length(external_account) <= 256),
  diagnostic text CHECK (diagnostic IS NULL OR length(diagnostic) <= 2048),
  connected_at timestamptz,
  last_event_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_integrations_archive_fact_check
    CHECK ((connection_status = 'archived') = (archived_at IS NOT NULL))
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_integrations_space_updated_idx
  ON cosmos_integrations (organization_id, space_id, updated_at DESC, id DESC)
  WHERE connection_status <> 'archived';

-- Integration names are unique per type within an active Space.
CREATE UNIQUE INDEX cosmos_integrations_active_unique_idx
  ON cosmos_integrations (organization_id, space_id, type, name)
  WHERE connection_status <> 'archived';

-- Audit ledger — append-only.
CREATE TABLE cosmos_integration_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  integration_id text,
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
  FOREIGN KEY (organization_id, space_id, integration_id)
    REFERENCES cosmos_integrations(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox for downstream consumers (e.g. integration connection workers).
CREATE TABLE cosmos_integration_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  integration_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_integrations FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_integration_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_integration_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_integration_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_integration_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: space members may read; managers may mutate.
CREATE POLICY cosmos_api_integration_select ON cosmos_integrations
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_integrations.organization_id
             AND sm.space_id = cosmos_integrations.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_integration_mutate ON cosmos_integrations
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_integration_audit_insert ON cosmos_integration_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_integration_audit_select ON cosmos_integration_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_integration_outbox_access ON cosmos_integration_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON cosmos_integrations TO cosmos_api_runtime;
GRANT UPDATE (connection_status, health, scopes, external_account, diagnostic, connected_at, last_event_at, version, updated_at, archived_at)
  ON cosmos_integrations TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_integration_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_integration_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_integration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Integrations must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.connection_status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived integrations are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_integrations_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_integrations
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_integration();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_integration_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_integrations_version_increment
  BEFORE UPDATE ON cosmos_integrations
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_integration_version();
