-- cosmos-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cosmos_commands_tenant_session_identity_unique
  ON cosmos_commands (organization_id, space_id, session_id, id);
