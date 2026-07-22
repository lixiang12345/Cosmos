-- cosmos-migration: non-transactional
-- cosmos-migration: concurrent-index cosmos_attempts_turn_number_unique
CREATE UNIQUE INDEX CONCURRENTLY cosmos_attempts_turn_number_unique
  ON cosmos_attempts (organization_id, space_id, session_id, turn_id, number);
