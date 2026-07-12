-- relay-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS relay_turns_tenant_session_identity_unique
  ON relay_turns (organization_id, space_id, session_id, id);
