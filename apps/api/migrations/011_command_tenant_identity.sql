-- relay-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS relay_commands_tenant_session_identity_unique
  ON relay_commands (organization_id, space_id, session_id, id);
