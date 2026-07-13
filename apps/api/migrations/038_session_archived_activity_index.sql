-- relay-migration: non-transactional
-- relay-migration: concurrent-index relay_sessions_archived_activity_idx
CREATE INDEX CONCURRENTLY relay_sessions_archived_activity_idx
  ON relay_sessions (organization_id, space_id, last_activity_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
