-- relay-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS relay_sessions_tenant_identity_unique
  ON relay_sessions (organization_id, space_id, id);
