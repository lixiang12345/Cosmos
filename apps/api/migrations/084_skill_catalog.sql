SET LOCAL lock_timeout = '5s';

-- Canonical Skill catalog. A Skill is a reusable knowledge package (following
-- the agentskills.io shape) that Experts can pin so sessions launch with
-- domain-specific guidance. Inline skills carry their instructions in-row;
-- url skills reference an external package the runtime fetches at boot.
CREATE TABLE cosmos_skills (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 256),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2048),
  source text NOT NULL DEFAULT 'inline' CHECK (source IN ('inline', 'url')),
  content text CHECK (content IS NULL OR length(content) BETWEEN 1 AND 65536),
  url text CHECK (url IS NULL OR (length(btrim(url)) BETWEEN 1 AND 2048 AND url ~ '^https://')),
  tags text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_skills_archive_fact_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  -- Inline skills carry content; url skills carry a package URL.
  CONSTRAINT cosmos_skills_source_target_check
    CHECK (
      (source = 'inline' AND content IS NOT NULL AND url IS NULL) OR
      (source = 'url' AND url IS NOT NULL AND content IS NULL)
    )
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_skills_space_updated_idx
  ON cosmos_skills (organization_id, space_id, updated_at DESC, id DESC)
  WHERE status <> 'archived';

-- Skill names are unique within an active Space.
CREATE UNIQUE INDEX cosmos_skills_active_unique_idx
  ON cosmos_skills (organization_id, space_id, name)
  WHERE status <> 'archived';

-- Audit ledger — append-only.
CREATE TABLE cosmos_skill_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  skill_id text,
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
  FOREIGN KEY (organization_id, space_id, skill_id)
    REFERENCES cosmos_skills(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox for downstream consumers (e.g. package prefetch workers).
CREATE TABLE cosmos_skill_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  skill_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_skills FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_skill_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_skill_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_skill_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_skill_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: space members may read; managers may mutate.
CREATE POLICY cosmos_api_skill_select ON cosmos_skills
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_skills.organization_id
             AND sm.space_id = cosmos_skills.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_skill_mutate ON cosmos_skills
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_skill_audit_insert ON cosmos_skill_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_skill_audit_select ON cosmos_skill_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_skill_outbox_access ON cosmos_skill_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON cosmos_skills TO cosmos_api_runtime;
GRANT UPDATE (description, content, url, tags, status, version, updated_at, archived_at)
  ON cosmos_skills TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_skill_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_skill_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_skill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Skills must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived Skills are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_skills_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_skills
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_skill();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_skill_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_skills_version_increment
  BEFORE UPDATE ON cosmos_skills
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_skill_version();
