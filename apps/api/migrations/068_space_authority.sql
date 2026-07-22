SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_organizations
  ADD COLUMN default_space_id text;

WITH defaults AS (
  SELECT organization_id, min(id) AS space_id
  FROM relay_spaces
  GROUP BY organization_id
)
UPDATE relay_organizations organization
SET default_space_id = defaults.space_id
FROM defaults
WHERE defaults.organization_id = organization.id;

ALTER TABLE relay_organizations
  ADD CONSTRAINT relay_organizations_default_space_fk
  FOREIGN KEY (id, default_space_id)
  REFERENCES relay_spaces(organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE relay_spaces
  ADD COLUMN slug text,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN default_expert_id text,
  ADD COLUMN default_environment_id text,
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz;

UPDATE relay_spaces
SET slug = CASE
    WHEN btrim(lower(regexp_replace(id, '[^a-z0-9]+', '-', 'g')), '-') <> ''
      THEN btrim(lower(regexp_replace(id, '[^a-z0-9]+', '-', 'g')), '-')
    ELSE 'space-' || substr(md5(id), 1, 8)
  END,
  updated_at = created_at;

ALTER TABLE relay_spaces
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ADD CONSTRAINT relay_spaces_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT relay_spaces_slug_length CHECK (length(slug) BETWEEN 1 AND 120),
  ADD CONSTRAINT relay_spaces_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT relay_spaces_description_length CHECK (length(description) <= 2000),
  ADD CONSTRAINT relay_spaces_status_check CHECK (status IN ('active', 'migrating', 'archived')),
  ADD CONSTRAINT relay_spaces_settings_object CHECK (jsonb_typeof(settings) = 'object'),
  ADD CONSTRAINT relay_spaces_settings_size CHECK (pg_column_size(settings) <= 16384),
  ADD CONSTRAINT relay_spaces_version_positive CHECK (version > 0),
  ADD CONSTRAINT relay_spaces_default_expert_fk
    FOREIGN KEY (organization_id, id, default_expert_id)
    REFERENCES relay_experts(organization_id, space_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT relay_spaces_default_environment_fk
    FOREIGN KEY (organization_id, id, default_environment_id)
    REFERENCES relay_environments(organization_id, space_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX relay_spaces_organization_slug_unique
  ON relay_spaces (organization_id, slug);
CREATE INDEX relay_spaces_organization_updated_idx
  ON relay_spaces (organization_id, updated_at DESC, id DESC);

CREATE FUNCTION relay_apply_space_insert_defaults() RETURNS trigger
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

CREATE TRIGGER relay_spaces_apply_insert_defaults
  BEFORE INSERT ON relay_spaces
  FOR EACH ROW EXECUTE FUNCTION relay_apply_space_insert_defaults();

CREATE TABLE relay_space_idempotency (
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE CASCADE,
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

CREATE TABLE relay_space_audit_events (
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE RESTRICT,
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

CREATE TABLE relay_space_outbox_events (
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE RESTRICT,
  id text NOT NULL,
  space_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id)
);

CREATE TRIGGER relay_space_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON relay_space_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();
CREATE TRIGGER relay_space_audit_events_reject_truncate
  BEFORE TRUNCATE ON relay_space_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

DROP TRIGGER IF EXISTS relay_reject_runtime_control_plane_update ON relay_spaces;
DROP TRIGGER IF EXISTS relay_reject_runtime_control_plane_update ON relay_organizations;

ALTER TABLE relay_space_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_space_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE relay_space_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_space_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE relay_space_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_space_outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY relay_migration_admin ON relay_space_idempotency TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY relay_migration_admin ON relay_space_audit_events TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY relay_migration_admin ON relay_space_outbox_events TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY relay_api_space_insert ON relay_spaces
  FOR INSERT TO relay_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_spaces.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  );

CREATE POLICY relay_api_space_update ON relay_spaces
  FOR UPDATE TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND (
      EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_spaces.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_spaces.organization_id
          AND membership.space_id = relay_spaces.id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), ''));

CREATE POLICY relay_api_organization_default_space_update ON relay_organizations
  FOR UPDATE TO relay_api_runtime
  USING (
    id = NULLIF(current_setting('relay.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_organizations.id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  )
  WITH CHECK (id = NULLIF(current_setting('relay.organization_id', true), ''));

CREATE POLICY relay_api_space_membership_insert ON relay_space_memberships
  FOR INSERT TO relay_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    AND role = 'space_manager'
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_space_memberships.organization_id
        AND membership.actor_id = relay_space_memberships.actor_id
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
  );

CREATE POLICY relay_api_space_idempotency ON relay_space_idempotency
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  );
CREATE POLICY relay_api_space_audit_insert ON relay_space_audit_events
  FOR INSERT TO relay_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
  );
CREATE POLICY relay_api_space_outbox_access ON relay_space_outbox_events
  FOR ALL TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), ''));

GRANT INSERT, UPDATE ON relay_spaces TO relay_api_runtime;
GRANT UPDATE (default_space_id) ON relay_organizations TO relay_api_runtime;
GRANT INSERT ON relay_space_memberships TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_space_idempotency TO relay_api_runtime;
GRANT INSERT ON relay_space_audit_events TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_space_outbox_events TO relay_api_runtime;
