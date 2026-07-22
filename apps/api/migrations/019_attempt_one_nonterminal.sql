-- cosmos-migration: non-transactional
-- cosmos-migration: concurrent-index cosmos_attempts_one_nonterminal_idx
CREATE UNIQUE INDEX CONCURRENTLY cosmos_attempts_one_nonterminal_idx
  ON cosmos_attempts (organization_id, space_id, session_id, turn_id)
  WHERE status IN ('queued', 'starting', 'running', 'waiting', 'paused');
