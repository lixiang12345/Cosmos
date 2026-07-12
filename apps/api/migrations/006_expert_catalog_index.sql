-- relay-migration: non-transactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS relay_experts_space_updated_idx
  ON relay_experts (organization_id, space_id, updated_at DESC, id DESC);
