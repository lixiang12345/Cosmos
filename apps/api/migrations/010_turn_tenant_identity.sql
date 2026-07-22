-- cosmos-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cosmos_turns_tenant_session_identity_unique
  ON cosmos_turns (organization_id, space_id, session_id, id);
