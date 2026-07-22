CREATE TABLE relay_organization_quotas (
  organization_id text PRIMARY KEY REFERENCES relay_organizations(id) ON DELETE CASCADE,
  file_storage_bytes_limit bigint NOT NULL DEFAULT 104857600
    CHECK (file_storage_bytes_limit BETWEEN 1048576 AND 1099511627776),
  api_requests_limit integer NOT NULL DEFAULT 6000
    CHECK (api_requests_limit BETWEEN 1 AND 1000000),
  api_window_seconds integer NOT NULL DEFAULT 60
    CHECK (api_window_seconds BETWEEN 1 AND 3600),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO relay_organization_quotas (organization_id)
SELECT id FROM relay_organizations
ON CONFLICT DO NOTHING;

CREATE FUNCTION relay_create_default_organization_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO relay_organization_quotas (organization_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_organizations_create_default_quota
  AFTER INSERT ON relay_organizations
  FOR EACH ROW EXECUTE FUNCTION relay_create_default_organization_quota();

CREATE TABLE relay_organization_rate_limit_windows (
  organization_id text PRIMARY KEY REFERENCES relay_organizations(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE relay_organization_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_organization_quotas FORCE ROW LEVEL SECURITY;
ALTER TABLE relay_organization_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_organization_rate_limit_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY relay_migration_admin ON relay_organization_quotas
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY relay_migration_admin ON relay_organization_rate_limit_windows
  TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY relay_api_organization_quota_read ON relay_organization_quotas
  FOR SELECT TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_organization_quotas.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    ));

CREATE POLICY relay_worker_organization_quota_read ON relay_organization_quotas
  FOR SELECT TO relay_worker_runtime USING (true);

CREATE POLICY relay_api_rate_limit_window_all ON relay_organization_rate_limit_windows
  FOR ALL TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_organization_rate_limit_windows.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    ))
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = relay_organization_rate_limit_windows.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    ));

REVOKE ALL ON relay_organization_quotas, relay_organization_rate_limit_windows FROM PUBLIC;
GRANT SELECT ON relay_organization_quotas TO relay_api_runtime, relay_worker_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_organization_rate_limit_windows TO relay_api_runtime;
