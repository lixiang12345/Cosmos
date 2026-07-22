CREATE TABLE relay_object_storage_gc_runs (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  status text NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed')),
  min_age_seconds integer NOT NULL CHECK (min_age_seconds >= 86_400),
  scanned_objects integer NOT NULL CHECK (scanned_objects >= 0),
  referenced_objects integer NOT NULL CHECK (referenced_objects >= 0),
  eligible_objects integer NOT NULL CHECK (eligible_objects >= 0),
  deleted_objects integer NOT NULL CHECK (deleted_objects >= 0),
  failed_deletions integer NOT NULL CHECK (failed_deletions >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  error_code text,
  CHECK (completed_at >= started_at),
  CHECK (deleted_objects + failed_deletions <= eligible_objects),
  CHECK ((status = 'succeeded' AND failed_deletions = 0 AND error_code IS NULL)
    OR (status = 'partial' AND failed_deletions > 0 AND error_code IS NULL)
    OR (status = 'failed' AND error_code IS NOT NULL))
);

CREATE INDEX relay_object_storage_gc_runs_completed_idx
  ON relay_object_storage_gc_runs (completed_at DESC, id DESC);

CREATE TRIGGER relay_object_storage_gc_runs_reject_mutation
  BEFORE UPDATE OR DELETE ON relay_object_storage_gc_runs
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

CREATE TRIGGER relay_object_storage_gc_runs_reject_truncate
  BEFORE TRUNCATE ON relay_object_storage_gc_runs
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

REVOKE ALL ON relay_object_storage_gc_runs FROM PUBLIC, relay_api_runtime, relay_worker_runtime;
