-- relay-migration: non-transactional
-- relay-migration: concurrent-index relay_attempts_one_nonterminal_idx
CREATE UNIQUE INDEX CONCURRENTLY relay_attempts_one_nonterminal_idx
  ON relay_attempts (organization_id, space_id, session_id, turn_id)
  WHERE status IN ('queued', 'starting', 'running', 'waiting', 'paused');
