CREATE TABLE relay_organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE relay_spaces (
  id text NOT NULL,
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE relay_organization_memberships (
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('organization_owner', 'organization_admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id)
);

CREATE TABLE relay_space_memberships (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('space_manager', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, actor_id),
  FOREIGN KEY (organization_id, space_id) REFERENCES relay_spaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id) REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE CASCADE
);

ALTER TABLE relay_sessions ADD COLUMN created_by text;
ALTER TABLE relay_idempotency_records ADD COLUMN actor_id text;
ALTER TABLE relay_idempotency_records ADD COLUMN method text;
ALTER TABLE relay_idempotency_records ADD COLUMN canonical_path text;

INSERT INTO relay_organizations (id, name)
SELECT DISTINCT organization_id, organization_id
FROM relay_sessions
ON CONFLICT DO NOTHING;

INSERT INTO relay_spaces (organization_id, id, name)
SELECT DISTINCT organization_id, space_id, space_id
FROM relay_sessions
ON CONFLICT DO NOTHING;

UPDATE relay_sessions SET created_by = 'system:migration' WHERE created_by IS NULL;
ALTER TABLE relay_sessions ALTER COLUMN created_by SET NOT NULL;

UPDATE relay_idempotency_records
SET actor_id = 'system:migration',
    method = 'POST',
    canonical_path = '/v1/organizations/' || organization_id || '/spaces/' || space_id || '/sessions'
WHERE actor_id IS NULL;
ALTER TABLE relay_idempotency_records ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE relay_idempotency_records ALTER COLUMN method SET NOT NULL;
ALTER TABLE relay_idempotency_records ALTER COLUMN canonical_path SET NOT NULL;
ALTER TABLE relay_idempotency_records DROP CONSTRAINT relay_idempotency_records_pkey;
ALTER TABLE relay_idempotency_records
  ADD PRIMARY KEY (organization_id, actor_id, method, canonical_path, idempotency_key_hash);

ALTER TABLE relay_sessions
  ADD CONSTRAINT relay_sessions_space_fk
  FOREIGN KEY (organization_id, space_id)
  REFERENCES relay_spaces(organization_id, id)
  ON DELETE RESTRICT;

CREATE INDEX relay_sessions_actor_visibility_idx
  ON relay_sessions (organization_id, space_id, created_by, visibility, last_activity_at DESC, id DESC);
