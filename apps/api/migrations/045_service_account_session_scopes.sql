SET LOCAL lock_timeout = '5s';

CREATE TABLE cosmos_service_accounts (
  organization_id text NOT NULL,
  id text NOT NULL,
  audience text NOT NULL CHECK (length(audience) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, id)
    REFERENCES cosmos_organization_memberships(organization_id, actor_id) ON DELETE CASCADE,
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE cosmos_service_account_bindings (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  service_account_id text NOT NULL,
  id text NOT NULL,
  scope text NOT NULL CHECK (scope IN (
    'session.create',
    'session.send',
    'session.archive'
  )),
  resource_type text NOT NULL CHECK (resource_type IN ('expert', 'session')),
  resource_id text NOT NULL CHECK (resource_id <> '*'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (organization_id, space_id, service_account_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, service_account_id)
    REFERENCES cosmos_service_accounts(organization_id, id) ON DELETE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (scope = 'session.create' AND resource_type = 'expert')
    OR (scope IN ('session.send', 'session.archive') AND resource_type = 'session')
  )
);

CREATE UNIQUE INDEX cosmos_service_account_bindings_unrevoked_scope_idx
  ON cosmos_service_account_bindings (
    organization_id, space_id, service_account_id, scope, resource_type, resource_id
  )
  WHERE revoked_at IS NULL;

CREATE INDEX cosmos_service_account_bindings_authorization_idx
  ON cosmos_service_account_bindings (
    organization_id, space_id, service_account_id, scope, resource_type, resource_id
  )
  WHERE revoked_at IS NULL;
