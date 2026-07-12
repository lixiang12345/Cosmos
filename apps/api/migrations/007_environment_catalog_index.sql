-- relay-migration: non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS relay_environments_space_updated_idx
  ON relay_environments (organization_id, space_id, updated_at DESC, id DESC);
