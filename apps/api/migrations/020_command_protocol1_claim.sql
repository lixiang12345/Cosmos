-- relay-migration: non-transactional
-- relay-migration: concurrent-index relay_commands_protocol1_claim_idx
CREATE INDEX CONCURRENTLY relay_commands_protocol1_claim_idx
  ON relay_commands (status, available_at, lease_expires_at, accepted_at, id)
  INCLUDE (organization_id, space_id, session_id, attempts, max_attempts)
  WHERE protocol_version = 1
    AND status IN ('accepted', 'queued', 'running');
