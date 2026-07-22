-- cosmos-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cosmos_sessions_tenant_identity_unique
  ON cosmos_sessions (organization_id, space_id, id);
