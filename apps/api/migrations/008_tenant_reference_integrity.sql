-- relay-migration: non-transactional
CREATE UNIQUE INDEX CONCURRENTLY relay_messages_tenant_session_identity_unique
  ON relay_messages (organization_id, space_id, session_id, id);
