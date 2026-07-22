CREATE TABLE cosmos_organization_quotas (
  organization_id text PRIMARY KEY REFERENCES cosmos_organizations(id) ON DELETE CASCADE,
  file_storage_bytes_limit bigint NOT NULL DEFAULT 104857600
    CHECK (file_storage_bytes_limit BETWEEN 1048576 AND 1099511627776),
  api_requests_limit integer NOT NULL DEFAULT 6000
    CHECK (api_requests_limit BETWEEN 1 AND 1000000),
  api_window_seconds integer NOT NULL DEFAULT 60
    CHECK (api_window_seconds BETWEEN 1 AND 3600),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cosmos_organization_quotas (organization_id)
SELECT id FROM cosmos_organizations
ON CONFLICT DO NOTHING;

CREATE FUNCTION cosmos_create_default_organization_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cosmos_organization_quotas (organization_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_organizations_create_default_quota
  AFTER INSERT ON cosmos_organizations
  FOR EACH ROW EXECUTE FUNCTION cosmos_create_default_organization_quota();

CREATE TABLE cosmos_organization_rate_limit_windows (
  organization_id text PRIMARY KEY REFERENCES cosmos_organizations(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cosmos_organization_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_organization_quotas FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_organization_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_organization_rate_limit_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_migration_admin ON cosmos_organization_quotas
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_organization_rate_limit_windows
  TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY cosmos_api_organization_quota_read ON cosmos_organization_quotas
  FOR SELECT TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_organization_quotas.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    ));

CREATE POLICY cosmos_worker_organization_quota_read ON cosmos_organization_quotas
  FOR SELECT TO cosmos_worker_runtime USING (true);

CREATE POLICY cosmos_api_rate_limit_window_all ON cosmos_organization_rate_limit_windows
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_organization_rate_limit_windows.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    ))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_organization_rate_limit_windows.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    ));

REVOKE ALL ON cosmos_organization_quotas, cosmos_organization_rate_limit_windows FROM PUBLIC;
GRANT SELECT ON cosmos_organization_quotas TO cosmos_api_runtime, cosmos_worker_runtime;
GRANT SELECT, INSERT, UPDATE ON cosmos_organization_rate_limit_windows TO cosmos_api_runtime;
