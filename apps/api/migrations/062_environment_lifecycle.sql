SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_environments
  DROP CONSTRAINT cosmos_environments_status_check,
  ADD COLUMN type text NOT NULL DEFAULT 'cloud' CHECK (type IN ('cloud', 'daemon')),
  ADD COLUMN visibility text NOT NULL DEFAULT 'space' CHECK (visibility IN ('private', 'space')),
  ADD COLUMN latest_revision_id text,
  ADD CONSTRAINT cosmos_environments_status_check CHECK (
    status IN ('draft', 'provisioning', 'ready', 'updating', 'failed', 'disabled', 'archived')
  );

ALTER TABLE cosmos_environment_revisions
  DROP CONSTRAINT cosmos_environment_revisions_status_check,
  ADD COLUMN checksum text,
  ADD CONSTRAINT cosmos_environment_revisions_status_check CHECK (
    status IN ('draft', 'provisioning', 'ready', 'failed')
  );

UPDATE cosmos_environments environment
SET latest_revision_id = candidate.id
FROM (
  SELECT DISTINCT ON (revision.organization_id, revision.space_id, revision.environment_id)
    revision.organization_id, revision.space_id, revision.environment_id, revision.id
  FROM cosmos_environment_revisions revision
  ORDER BY revision.organization_id, revision.space_id, revision.environment_id, revision.revision DESC
) candidate
WHERE candidate.organization_id = environment.organization_id
  AND candidate.space_id = environment.space_id
  AND candidate.environment_id = environment.id;

ALTER TABLE cosmos_environment_revisions DISABLE TRIGGER cosmos_environment_revisions_protect_final;

UPDATE cosmos_environment_revisions revision
SET configuration = revision.configuration || jsonb_build_object(
  'image', COALESCE(revision.configuration ->> 'image', 'ghcr.io/cosmos/runtime:stable'),
  'variableReferences', COALESCE(revision.configuration -> 'variableReferences', '[]'::jsonb),
  'hooks', COALESCE(revision.configuration -> 'hooks', '[]'::jsonb),
  'networkPolicy', COALESCE(
    revision.configuration -> 'networkPolicy',
    '{"mode":"restricted","allowedHosts":[]}'::jsonb
  ),
  'sharing', COALESCE(revision.configuration ->> 'sharing', environment.visibility),
  'daemonPoolId', revision.configuration -> 'daemonPoolId'
), checksum = md5(revision.configuration::text) || md5(revision.id || revision.configuration::text)
FROM cosmos_environments environment
WHERE environment.organization_id = revision.organization_id
  AND environment.space_id = revision.space_id
  AND environment.id = revision.environment_id;

ALTER TABLE cosmos_environment_revisions ENABLE TRIGGER cosmos_environment_revisions_protect_final;

ALTER TABLE cosmos_environment_revisions
  ALTER COLUMN checksum SET NOT NULL,
  ADD CONSTRAINT cosmos_environment_revisions_checksum_check CHECK (checksum ~ '^[a-f0-9]{64}$');

ALTER TABLE cosmos_environments
  ALTER COLUMN latest_revision_id SET NOT NULL,
  ADD CONSTRAINT cosmos_environments_latest_revision_fk
    FOREIGN KEY (organization_id, space_id, id, latest_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE cosmos_environment_provisioning_jobs (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  environment_id text NOT NULL,
  environment_revision_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  phase text NOT NULL CHECK (phase IN (
    'queued', 'validating', 'pulling_image', 'configuring', 'connecting_daemon', 'ready', 'failed'
  )),
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_owner text,
  lease_token integer NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_expires_at timestamptz,
  error_code text,
  error_message text,
  error_retryable boolean,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_by text NOT NULL,
  PRIMARY KEY (organization_id, space_id, id),
  UNIQUE (organization_id, space_id, environment_id, environment_revision_id, id),
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE RESTRICT,
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((error_code IS NULL) = (error_message IS NULL)),
  CHECK ((error_code IS NULL) = (error_retryable IS NULL)),
  CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 128)),
  CHECK (error_message IS NULL OR (length(error_message) BETWEEN 1 AND 1000)),
  CHECK ((status IN ('succeeded', 'failed', 'canceled')) = (completed_at IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX cosmos_environment_one_active_provisioning_job_idx
  ON cosmos_environment_provisioning_jobs (organization_id, space_id, environment_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX cosmos_environment_provisioning_claim_idx
  ON cosmos_environment_provisioning_jobs (available_at, created_at, id)
  WHERE status = 'queued';

CREATE TABLE cosmos_environment_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  environment_id text NOT NULL,
  environment_revision_id text,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'environment.create', 'environment.update', 'environment.retry',
    'environment.disable', 'environment.archive', 'environment.provision'
  )),
  result text NOT NULL CHECK (result IN ('accepted', 'succeeded', 'failed')),
  resource_version integer NOT NULL CHECK (resource_version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id, environment_id)
    REFERENCES cosmos_environments(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE INDEX cosmos_environment_audit_timeline_idx
  ON cosmos_environment_audit_events (organization_id, space_id, environment_id, occurred_at DESC, id DESC);

CREATE TABLE cosmos_environment_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  environment_id text NOT NULL,
  environment_revision_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'environment.provisioning.requested', 'environment.provisioning.succeeded',
    'environment.provisioning.failed', 'environment.disabled', 'environment.archived'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX cosmos_environment_outbox_unpublished_idx
  ON cosmos_environment_outbox_events (occurred_at, id) WHERE published_at IS NULL;

CREATE TABLE cosmos_execution_snapshots (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  environment_id text NOT NULL,
  environment_revision_id text NOT NULL,
  environment_type text NOT NULL CHECK (environment_type IN ('cloud', 'daemon')),
  image text NOT NULL,
  repository_id text NOT NULL,
  repository text NOT NULL,
  base_branch text NOT NULL,
  variable_references jsonb NOT NULL CHECK (jsonb_typeof(variable_references) = 'array'),
  network_policy jsonb NOT NULL CHECK (jsonb_typeof(network_policy) = 'object'),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id, repository_id)
    REFERENCES cosmos_environment_revision_repositories(
      organization_id, space_id, environment_id, environment_revision_id, repository_id
    ) ON DELETE RESTRICT
);

ALTER TABLE cosmos_sessions ADD COLUMN execution_snapshot_id text;

INSERT INTO cosmos_execution_snapshots (
  organization_id, space_id, id, environment_id, environment_revision_id,
  environment_type, image, repository_id, repository, base_branch,
  variable_references, network_policy, checksum, created_at
)
SELECT session.organization_id, session.space_id, session.id || '-snapshot',
  session.environment_id, session.environment_revision_id, environment.type,
  revision.configuration ->> 'image', session.repository_id, session.repository,
  session.base_branch, revision.configuration -> 'variableReferences',
  revision.configuration -> 'networkPolicy', revision.checksum, session.created_at
FROM cosmos_sessions session
JOIN cosmos_environments environment
  ON environment.organization_id = session.organization_id
  AND environment.space_id = session.space_id
  AND environment.id = session.environment_id
JOIN cosmos_environment_revisions revision
  ON revision.organization_id = session.organization_id
  AND revision.space_id = session.space_id
  AND revision.environment_id = session.environment_id
  AND revision.id = session.environment_revision_id
WHERE session.configuration_resolution_version = 1;

UPDATE cosmos_sessions SET execution_snapshot_id = id || '-snapshot'
WHERE configuration_resolution_version = 1;

ALTER TABLE cosmos_sessions
  ADD CONSTRAINT cosmos_sessions_execution_snapshot_resolution_check CHECK (
    (configuration_resolution_version = 0 AND execution_snapshot_id IS NULL)
    OR (configuration_resolution_version = 1 AND execution_snapshot_id IS NOT NULL)
  ),
  ADD CONSTRAINT cosmos_sessions_execution_snapshot_fk
    FOREIGN KEY (organization_id, space_id, execution_snapshot_id)
    REFERENCES cosmos_execution_snapshots(organization_id, space_id, id) ON DELETE RESTRICT;

CREATE FUNCTION cosmos_protect_session_execution_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.execution_snapshot_id IS DISTINCT FROM OLD.execution_snapshot_id THEN
    RAISE EXCEPTION 'Session execution snapshot is immutable after creation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_sessions_protect_execution_snapshot
  BEFORE UPDATE OF execution_snapshot_id ON cosmos_sessions
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_session_execution_snapshot();

CREATE TRIGGER cosmos_environment_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_environment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_environment_audit_events_reject_truncate
  BEFORE TRUNCATE ON cosmos_environment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_execution_snapshots_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_execution_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_execution_snapshots_reject_truncate
  BEFORE TRUNCATE ON cosmos_execution_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_environments;
DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_environment_revisions;
DROP TRIGGER IF EXISTS cosmos_reject_runtime_control_plane_update ON cosmos_environment_revision_repositories;

GRANT INSERT ON cosmos_environments, cosmos_environment_revisions,
  cosmos_environment_revision_repositories, cosmos_environment_provisioning_jobs,
  cosmos_environment_audit_events, cosmos_environment_outbox_events TO cosmos_api_runtime;
GRANT SELECT ON cosmos_environment_provisioning_jobs, cosmos_environment_audit_events,
  cosmos_environment_outbox_events TO cosmos_api_runtime;
GRANT UPDATE (name, description, visibility, status, active_revision_id, latest_revision_id, version, updated_at)
  ON cosmos_environments TO cosmos_api_runtime;
GRANT UPDATE (status) ON cosmos_environment_revisions TO cosmos_api_runtime;
GRANT UPDATE (status, phase, progress, attempt, lease_owner, lease_token, lease_expires_at,
  error_code, error_message, error_retryable, available_at, updated_at, completed_at)
  ON cosmos_environment_provisioning_jobs TO cosmos_api_runtime;

GRANT SELECT ON cosmos_environments, cosmos_environment_revisions,
  cosmos_environment_revision_repositories, cosmos_environment_provisioning_jobs TO cosmos_worker_runtime;
GRANT UPDATE (status, active_revision_id, latest_revision_id, version, updated_at)
  ON cosmos_environments TO cosmos_worker_runtime;
GRANT UPDATE (status) ON cosmos_environment_revisions TO cosmos_worker_runtime;
GRANT UPDATE (status, phase, progress, attempt, lease_owner, lease_token, lease_expires_at,
  error_code, error_message, error_retryable, available_at, updated_at, completed_at)
  ON cosmos_environment_provisioning_jobs TO cosmos_worker_runtime;
GRANT INSERT ON cosmos_environment_audit_events, cosmos_environment_outbox_events TO cosmos_worker_runtime;

GRANT SELECT, INSERT ON cosmos_execution_snapshots TO cosmos_api_runtime;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cosmos_environment_provisioning_jobs', 'cosmos_environment_audit_events',
    'cosmos_environment_outbox_events', 'cosmos_execution_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY cosmos_migration_admin ON %I TO %I USING (true) WITH CHECK (true)',
      table_name, current_user
    );
  END LOOP;
END;
$$;

CREATE POLICY cosmos_api_environment_job_access ON cosmos_environment_provisioning_jobs
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_environment_audit_access ON cosmos_environment_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_environment_audit_insert ON cosmos_environment_audit_events
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_environment_outbox_access ON cosmos_environment_outbox_events
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_execution_snapshot_insert ON cosmos_execution_snapshots
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_execution_snapshot_select ON cosmos_execution_snapshots
  FOR SELECT TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));

CREATE POLICY cosmos_worker_environment_select ON cosmos_environments FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_environment_update ON cosmos_environments FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_environment_revision_select ON cosmos_environment_revisions FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_environment_revision_update ON cosmos_environment_revisions FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_environment_repository_select ON cosmos_environment_revision_repositories FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_environment_job_access ON cosmos_environment_provisioning_jobs FOR ALL TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_environment_audit_insert ON cosmos_environment_audit_events FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);
CREATE POLICY cosmos_worker_environment_outbox_insert ON cosmos_environment_outbox_events FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_environment_mutate ON cosmos_environments
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_environment_revision_mutate ON cosmos_environment_revisions
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
CREATE POLICY cosmos_api_environment_repository_mutate ON cosmos_environment_revision_repositories
  FOR ALL TO cosmos_api_runtime
  USING (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), ''));
