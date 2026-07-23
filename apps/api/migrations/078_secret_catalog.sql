SET LOCAL lock_timeout = '5s';

-- Canonical write-only Secret catalog. value_ciphertext contains only an opaque
-- ciphertext/hash reference; API read paths and the runtime role cannot select it.
CREATE TABLE cosmos_secrets (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL
    CHECK (length(name) BETWEEN 1 AND 256 AND name ~ '^[A-Z][A-Z0-9_]*$'),
  scope text NOT NULL DEFAULT 'private'
    CHECK (scope IN ('private', 'shared')),
  value_ciphertext text NOT NULL,
  last_four text CHECK (last_four IS NULL OR length(last_four) BETWEEN 1 AND 4),
  description text,
  vm_install boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_secrets_archive_fact_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_secrets_space_updated_idx
  ON cosmos_secrets (organization_id, space_id, updated_at DESC, id DESC)
  WHERE status <> 'archived';

-- Secret names are unique within an active Space scope.
CREATE UNIQUE INDEX cosmos_secrets_active_unique_idx
  ON cosmos_secrets (organization_id, space_id, scope, name)
  WHERE status <> 'archived';

-- Audit ledger. Metadata must remain non-sensitive and never contain Secret values.
CREATE TABLE cosmos_secret_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  secret_id text,
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
  FOREIGN KEY (organization_id, space_id, secret_id)
    REFERENCES cosmos_secrets(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox payloads carry identifiers and non-sensitive metadata only.
CREATE TABLE cosmos_secret_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  secret_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_secrets FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_secret_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_secret_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_secret_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_secret_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: Space members may read safe metadata; managers may mutate.
CREATE POLICY cosmos_api_secret_select ON cosmos_secrets
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_secrets.organization_id
             AND sm.space_id = cosmos_secrets.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_secret_mutate ON cosmos_secrets
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_secret_audit_insert ON cosmos_secret_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_secret_audit_select ON cosmos_secret_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_secret_outbox_access ON cosmos_secret_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

-- Deliberately omit value_ciphertext from every SELECT grant. Runtime callers
-- may write an opaque reference but cannot read it back, even with ad hoc SQL.
GRANT SELECT (
  organization_id, space_id, id, name, scope, last_four, description,
  vm_install, status, version, created_by, created_at, updated_at, archived_at
) ON cosmos_secrets TO cosmos_api_runtime;
GRANT INSERT ON cosmos_secrets TO cosmos_api_runtime;
GRANT UPDATE (status, version, updated_at, archived_at)
  ON cosmos_secrets TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_secret_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_secret_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_secret() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Secrets must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived Secrets are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_secrets_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_secrets
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_secret();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_secret_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_secrets_version_increment
  BEFORE UPDATE ON cosmos_secrets
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_secret_version();
