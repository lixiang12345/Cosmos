SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_organizations
  ADD COLUMN default_space_id text;

WITH defaults AS (
  SELECT organization_id, min(id) AS space_id
  FROM cosmos_spaces
  GROUP BY organization_id
)
UPDATE cosmos_organizations organization
SET default_space_id = defaults.space_id
FROM defaults
WHERE defaults.organization_id = organization.id;

ALTER TABLE cosmos_organizations
  ADD CONSTRAINT cosmos_organizations_default_space_fk
  FOREIGN KEY (id, default_space_id)
  REFERENCES cosmos_spaces(organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE cosmos_spaces
  ADD COLUMN slug text,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN default_expert_id text,
  ADD COLUMN default_environment_id text,
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz;

UPDATE cosmos_spaces
SET slug = CASE
    WHEN btrim(lower(regexp_replace(id, '[^a-z0-9]+', '-', 'g')), '-') <> ''
      THEN btrim(lower(regexp_replace(id, '[^a-z0-9]+', '-', 'g')), '-')
    ELSE 'space-' || substr(md5(id), 1, 8)
  END,
  updated_at = created_at;

ALTER TABLE cosmos_spaces
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ADD CONSTRAINT cosmos_spaces_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT cosmos_spaces_slug_length CHECK (length(slug) BETWEEN 1 AND 120),
  ADD CONSTRAINT cosmos_spaces_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT cosmos_spaces_description_length CHECK (length(description) <= 2000),
  ADD CONSTRAINT cosmos_spaces_status_check CHECK (status IN ('active', 'migrating', 'archived')),
  ADD CONSTRAINT cosmos_spaces_settings_object CHECK (jsonb_typeof(settings) = 'object'),
  ADD CONSTRAINT cosmos_spaces_settings_size CHECK (pg_column_size(settings) <= 16384),
  ADD CONSTRAINT cosmos_spaces_version_positive CHECK (version > 0),
  ADD CONSTRAINT cosmos_spaces_default_expert_fk
    FOREIGN KEY (organization_id, id, default_expert_id)
    REFERENCES cosmos_experts(organization_id, space_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT cosmos_spaces_default_environment_fk
    FOREIGN KEY (organization_id, id, default_environment_id)
    REFERENCES cosmos_environments(organization_id, space_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX cosmos_spaces_organization_slug_unique
  ON cosmos_spaces (organization_id, slug);
CREATE INDEX cosmos_spaces_organization_updated_idx
  ON cosmos_spaces (organization_id, updated_at DESC, id DESC);

CREATE FUNCTION cosmos_apply_space_insert_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := CASE
      WHEN btrim(lower(regexp_replace(NEW.id, '[^a-z0-9]+', '-', 'g')), '-') <> ''
        THEN btrim(lower(regexp_replace(NEW.id, '[^a-z0-9]+', '-', 'g')), '-')
      ELSE 'space-' || substr(md5(NEW.id), 1, 8)
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_spaces_apply_insert_defaults
  BEFORE INSERT ON cosmos_spaces
  FOR EACH ROW EXECUTE FUNCTION cosmos_apply_space_insert_defaults();

CREATE TABLE cosmos_space_idempotency (
  organization_id text NOT NULL REFERENCES cosmos_organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  method text NOT NULL,
  canonical_path text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, actor_id, method, canonical_path, idempotency_key_hash)
);

CREATE TABLE cosmos_space_audit_events (
  organization_id text NOT NULL REFERENCES cosmos_organizations(id) ON DELETE RESTRICT,
  id text NOT NULL,
  space_id text,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_version integer,
  request_id text NOT NULL,
  idempotency_key_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE cosmos_space_outbox_events (
  organization_id text NOT NULL REFERENCES cosmos_organizations(id) ON DELETE RESTRICT,
  id text NOT NULL,
  space_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id)
);

CREATE TRIGGER cosmos_space_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_space_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_space_audit_events_reject_truncate
  BEFORE TRUNCATE ON cosmos_space_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_spaces;
DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_organizations;

ALTER TABLE cosmos_space_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_migration_admin ON cosmos_space_idempotency TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_space_audit_events TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_space_outbox_events TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY cosmos_api_space_insert ON cosmos_spaces
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_spaces.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  );

CREATE POLICY cosmos_api_space_update ON cosmos_spaces
  FOR UPDATE TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM cosmos_organization_memberships membership
        WHERE membership.organization_id = cosmos_spaces.organization_id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM cosmos_space_memberships membership
        WHERE membership.organization_id = cosmos_spaces.organization_id
          AND membership.space_id = cosmos_spaces.id
          AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), ''));

CREATE POLICY cosmos_api_organization_default_space_update ON cosmos_organizations
  FOR UPDATE TO cosmos_api_runtime
  USING (
    id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_organizations.id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  )
  WITH CHECK (id = NULLIF(current_setting('cosmos.organization_id', true), ''));

CREATE POLICY cosmos_api_space_membership_insert ON cosmos_space_memberships
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    AND role = 'space_manager'
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_space_memberships.organization_id
        AND membership.actor_id = cosmos_space_memberships.actor_id
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  );

CREATE POLICY cosmos_api_space_idempotency ON cosmos_space_idempotency
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  );
CREATE POLICY cosmos_api_space_audit_insert ON cosmos_space_audit_events
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  );
CREATE POLICY cosmos_api_space_outbox_access ON cosmos_space_outbox_events
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), ''));

GRANT INSERT, UPDATE ON cosmos_spaces TO cosmos_api_runtime;
GRANT UPDATE (default_space_id) ON cosmos_organizations TO cosmos_api_runtime;
GRANT INSERT ON cosmos_space_memberships TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON cosmos_space_idempotency TO cosmos_api_runtime;
GRANT INSERT ON cosmos_space_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE ON cosmos_space_outbox_events TO cosmos_api_runtime;
