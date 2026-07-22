-- cosmos-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY cosmos_messages_tenant_session_identity_unique
  ON cosmos_messages (organization_id, space_id, session_id, id);
