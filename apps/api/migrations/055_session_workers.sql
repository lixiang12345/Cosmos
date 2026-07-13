SET LOCAL lock_timeout = '5s';

CREATE TABLE relay_session_workers (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  parent_turn_id text NOT NULL,
  parent_worker_id text,
  expert_revision_id text,
  name text NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'canceled')),
  depth integer NOT NULL CHECK (depth BETWEEN 1 AND 16),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 10000),
  result_summary text,
  created_by_worker_id text NOT NULL,
  updated_by_worker_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (organization_id, space_id, session_id, id),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK (btrim(name) <> '' AND char_length(name) <= 240),
  CHECK (btrim(instructions) <> '' AND char_length(instructions) <= 20000),
  CHECK (result_summary IS NULL
    OR (btrim(result_summary) <> '' AND char_length(result_summary) <= 10000)),
  CHECK (btrim(created_by_worker_id) <> '' AND char_length(created_by_worker_id) <= 128),
  CHECK (btrim(updated_by_worker_id) <> '' AND char_length(updated_by_worker_id) <= 128),
  CHECK ((parent_worker_id IS NULL) = (depth = 1)),
  CHECK ((status IN ('completed', 'failed', 'canceled')) = (completed_at IS NOT NULL)),
  CHECK (status IN ('completed', 'failed', 'canceled') OR result_summary IS NULL),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

ALTER TABLE relay_session_workers
  ADD CONSTRAINT relay_session_workers_turn_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, parent_turn_id)
  REFERENCES relay_turns(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT relay_session_workers_parent_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, parent_worker_id)
  REFERENCES relay_session_workers(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID;

ALTER TABLE relay_session_workers
  ADD CONSTRAINT relay_session_workers_sibling_ordinal_unique
  UNIQUE NULLS NOT DISTINCT (
    organization_id, space_id, session_id, parent_worker_id, ordinal
  );

CREATE INDEX relay_session_workers_page_idx
  ON relay_session_workers (
    organization_id, space_id, session_id, created_at, id
  );

CREATE OR REPLACE FUNCTION relay_validate_session_worker()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE parent_depth integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relay Session Worker rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_worker_id IS NULL THEN
      IF NEW.depth <> 1 THEN
        RAISE EXCEPTION 'Root Session Workers must have depth 1'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT worker.depth INTO parent_depth
      FROM relay_session_workers worker
      WHERE worker.organization_id = NEW.organization_id
        AND worker.space_id = NEW.space_id
        AND worker.session_id = NEW.session_id
        AND worker.id = NEW.parent_worker_id;
      IF parent_depth IS NULL THEN
        RAISE EXCEPTION 'Session Worker parent does not exist in this Session'
          USING ERRCODE = '23503';
      END IF;
      IF NEW.depth <> parent_depth + 1 THEN
        RAISE EXCEPTION 'Session Worker depth must be one greater than its parent'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.expert_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM relay_sessions session
      JOIN relay_expert_revisions revision
        ON revision.organization_id = session.organization_id
        AND revision.space_id = session.space_id
        AND revision.expert_id = session.expert_id
        AND revision.id = NEW.expert_revision_id
      WHERE session.organization_id = NEW.organization_id
        AND session.space_id = NEW.space_id
        AND session.id = NEW.session_id
    ) THEN
      RAISE EXCEPTION 'Session Worker Expert revision does not belong to this Session Expert'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.organization_id, NEW.space_id, NEW.session_id, NEW.id,
    NEW.parent_turn_id, NEW.parent_worker_id, NEW.expert_revision_id,
    NEW.name, NEW.instructions, NEW.depth, NEW.ordinal,
    NEW.created_by_worker_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.space_id, OLD.session_id, OLD.id,
    OLD.parent_turn_id, OLD.parent_worker_id, OLD.expert_revision_id,
    OLD.name, OLD.instructions, OLD.depth, OLD.ordinal,
    OLD.created_by_worker_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Relay Session Worker identity and instructions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Relay Session Workers are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN ('waiting', 'completed', 'failed', 'canceled'))
    OR (OLD.status = 'waiting' AND NEW.status IN ('running', 'completed', 'failed', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'Invalid Relay Session Worker status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Relay Session Worker updates must advance version by one'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Relay Session Worker updated_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_session_workers_validate
  BEFORE INSERT OR UPDATE OR DELETE ON relay_session_workers
  FOR EACH ROW EXECUTE FUNCTION relay_validate_session_worker();

CREATE TRIGGER relay_session_workers_reject_truncate
  BEFORE TRUNCATE ON relay_session_workers
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

REVOKE DELETE, TRUNCATE ON relay_session_workers FROM PUBLIC;
GRANT SELECT ON relay_session_workers TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_session_workers TO relay_worker_runtime;

ALTER TABLE relay_session_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_session_workers FORCE ROW LEVEL SECURITY;

CREATE POLICY relay_migration_admin ON relay_session_workers TO CURRENT_USER
  USING (true) WITH CHECK (true);

CREATE POLICY relay_api_tenant_select ON relay_session_workers
  FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_sessions visible_session
      WHERE visible_session.organization_id = relay_session_workers.organization_id
        AND visible_session.space_id = relay_session_workers.space_id
        AND visible_session.id = relay_session_workers.session_id
    )
  );

CREATE POLICY relay_worker_select ON relay_session_workers
  FOR SELECT TO relay_worker_runtime USING (true);
CREATE POLICY relay_worker_insert ON relay_session_workers
  FOR INSERT TO relay_worker_runtime WITH CHECK (true);
CREATE POLICY relay_worker_update ON relay_session_workers
  FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true);
