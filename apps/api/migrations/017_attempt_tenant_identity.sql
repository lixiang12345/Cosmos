-- relay-migration: non-transactional
-- relay-migration: concurrent-index relay_attempts_tenant_identity_unique
CREATE UNIQUE INDEX CONCURRENTLY relay_attempts_tenant_identity_unique
  ON relay_attempts (organization_id, space_id, session_id, turn_id, id);
