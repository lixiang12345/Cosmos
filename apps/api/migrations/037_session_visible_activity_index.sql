-- cosmos-migration: non-transactional
-- cosmos-migration: concurrent-index cosmos_sessions_visible_activity_idx
CREATE INDEX CONCURRENTLY cosmos_sessions_visible_activity_idx
  ON cosmos_sessions (organization_id, space_id, last_activity_at DESC, id DESC)
  WHERE archived_at IS NULL;
