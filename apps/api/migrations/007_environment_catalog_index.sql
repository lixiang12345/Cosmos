-- cosmos-migration: non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS cosmos_environments_space_updated_idx
  ON cosmos_environments (organization_id, space_id, updated_at DESC, id DESC);
