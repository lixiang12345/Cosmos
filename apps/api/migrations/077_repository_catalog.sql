SET LOCAL lock_timeout = '5s';

-- Canonical repository authority table. Environment revision repository
-- bindings already exist as snapshots; this table is the authoritative source
-- of truth for which repositories are connected to a Space.
CREATE TABLE cosmos_repositories (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  provider text NOT NULL DEFAULT 'unknown'
    CHECK (provider IN ('github', 'gitlab', 'unknown')),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 512),
  default_branch text NOT NULL DEFAULT 'main'
    CHECK (length(btrim(default_branch)) BETWEEN 1 AND 256),
  installation_id text CHECK (installation_id IS NULL OR length(btrim(installation_id)) BETWEEN 1 AND 256),
  connection_status text NOT NULL DEFAULT 'action_required'
    CHECK (connection_status IN ('connected', 'action_required', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_repositories_archive_fact_check
    CHECK ((connection_status = 'archived') = (archived_at IS NOT NULL))
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_repositories_space_updated_idx
  ON cosmos_repositories (organization_id, space_id, updated_at DESC, id DESC)
  WHERE connection_status <> 'archived';

-- Unique active (provider, full_name) per Space — prevents duplicate connections.
CREATE UNIQUE INDEX cosmos_repositories_active_unique_idx
  ON cosmos_repositories (organization_id, space_id, provider, full_name)
  WHERE connection_status <> 'archived';

-- Audit ledger — append-only, no RLS needed (written by api role directly).
CREATE TABLE cosmos_repository_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  repository_id text,
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
  FOREIGN KEY (organization_id, space_id, repository_id)
    REFERENCES cosmos_repositories(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox for downstream consumers (e.g. Context Engine workspace sync).
CREATE TABLE cosmos_repository_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  repository_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_repositories FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_repository_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_repository_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_repository_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_repository_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: space members may read; managers may mutate.
CREATE POLICY cosmos_api_repository_select ON cosmos_repositories
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_repositories.organization_id
             AND sm.space_id = cosmos_repositories.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_repository_mutate ON cosmos_repositories
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_repository_audit_insert ON cosmos_repository_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_repository_audit_select ON cosmos_repository_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_repository_outbox_access ON cosmos_repository_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON cosmos_repositories TO cosmos_api_runtime;
GRANT UPDATE (default_branch, connection_status, installation_id, version, updated_at, archived_at)
  ON cosmos_repositories TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_repository_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_repository_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_repository() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Repositories must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.connection_status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived Repositories are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_repositories_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_repositories
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_repository();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_repository_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_repositories_version_increment
  BEFORE UPDATE ON cosmos_repositories
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_repository_version();

-- ── Backfill from existing environment revision repository bindings ───────────
-- Rows are backfilled as provider='unknown', connection_status='action_required'
-- because the existing schema does not record provider provenance. Do not infer
-- that these are connected GitHub repositories.

INSERT INTO cosmos_repositories (
  organization_id, space_id, id, provider, full_name, default_branch,
  connection_status, created_by, created_at, updated_at
)
SELECT DISTINCT ON (errr.organization_id, errr.space_id, errr.repository_id)
  errr.organization_id,
  errr.space_id,
  errr.repository_id,
  'unknown',
  errr.repository,
  COALESCE(errr.base_branch, 'main'),
  'action_required',
  'system:migration',
  now(),
  now()
FROM cosmos_environment_revision_repositories errr
ON CONFLICT DO NOTHING;
