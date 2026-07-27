-- Forward hardening for environments that applied migration 090 before the
-- final least-privilege review. Reset grants, then restore only the columns
-- required by source triggers, the dispatcher, and metadata-only operations.

REVOKE ALL PRIVILEGES ON cosmos_outbox_deliveries
  FROM cosmos_api_runtime, cosmos_worker_runtime;

GRANT INSERT (
  stream, organization_id, space_id, source_id, event_type, occurred_at,
  next_attempt_at, created_at, updated_at
) ON cosmos_outbox_deliveries TO cosmos_api_runtime, cosmos_worker_runtime;
GRANT SELECT ON cosmos_outbox_deliveries TO cosmos_worker_runtime;
GRANT UPDATE (
  status, attempts, next_attempt_at, lease_owner, lease_expires_at,
  last_error_code, delivered_at, dead_lettered_at, updated_at, version
) ON cosmos_outbox_deliveries TO cosmos_worker_runtime;
