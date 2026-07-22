SET LOCAL lock_timeout = '5s';

CREATE TABLE cosmos_files (
  organization_id text NOT NULL REFERENCES cosmos_organizations(id) ON DELETE RESTRICT,
  space_id text,
  id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('workspace', 'user', 'organization')),
  owner_user_id text,
  session_id text,
  path text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  latest_version_id text,
  last_written_by_tool_call_id text,
  last_written_by_expert_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_user_id)
    REFERENCES cosmos_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK (
    (scope = 'workspace' AND space_id IS NOT NULL AND session_id IS NOT NULL
      AND owner_user_id IS NULL)
    OR (scope = 'user' AND space_id IS NULL AND session_id IS NULL
      AND owner_user_id IS NOT NULL)
    OR (scope = 'organization' AND space_id IS NULL AND session_id IS NULL
      AND owner_user_id IS NULL)
  ),
  CHECK (
    char_length(path) BETWEEN 1 AND 1024
    AND path !~ E'\\000'
    AND path !~ '^[/~]'
    AND path !~ E'\\\\'
    AND path !~ '(^|/)\\.{1,2}(/|$)'
    AND path !~ '//'
    AND path !~ '/$'
  ),
  CHECK (btrim(mime_type) <> '' AND char_length(mime_type) <= 255
    AND mime_type !~ E'[\\r\\n]'),
  CHECK (size BETWEEN 0 AND 1048576),
  CHECK (
    (version = 0 AND latest_version_id IS NULL
      AND last_written_by_tool_call_id IS NULL AND last_written_by_expert_id IS NULL
      AND size = 0)
    OR (version > 0 AND latest_version_id IS NOT NULL
      AND last_written_by_tool_call_id IS NOT NULL
      AND last_written_by_expert_id IS NOT NULL)
  ),
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE UNIQUE INDEX cosmos_files_organization_path_idx
  ON cosmos_files (organization_id, path)
  WHERE scope = 'organization';

CREATE UNIQUE INDEX cosmos_files_user_path_idx
  ON cosmos_files (organization_id, owner_user_id, path)
  WHERE scope = 'user';

CREATE UNIQUE INDEX cosmos_files_workspace_path_idx
  ON cosmos_files (organization_id, space_id, session_id, path)
  WHERE scope = 'workspace';

CREATE INDEX cosmos_files_scope_page_idx
  ON cosmos_files (organization_id, scope, path, id)
  WHERE archived_at IS NULL AND version > 0;

CREATE TABLE cosmos_file_versions (
  organization_id text NOT NULL,
  space_id text,
  file_id text NOT NULL,
  id text NOT NULL,
  version integer NOT NULL,
  content bytea NOT NULL,
  content_hash text NOT NULL,
  size integer NOT NULL,
  created_by_tool_call_id text NOT NULL,
  source_space_id text NOT NULL,
  source_session_id text NOT NULL,
  source_turn_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, file_id, id),
  UNIQUE (organization_id, file_id, version),
  FOREIGN KEY (organization_id, file_id)
    REFERENCES cosmos_files(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_space_id, source_session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_space_id, source_session_id, source_turn_id)
    REFERENCES cosmos_turns(organization_id, space_id, session_id, id) ON DELETE RESTRICT,
  CHECK (version > 0),
  CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CHECK (size = octet_length(content) AND size BETWEEN 0 AND 1048576),
  CHECK ((space_id IS NULL) OR (space_id = source_space_id))
);

ALTER TABLE cosmos_files
  ADD CONSTRAINT cosmos_files_latest_version_fk
  FOREIGN KEY (organization_id, id, latest_version_id)
  REFERENCES cosmos_file_versions(organization_id, file_id, id)
  ON DELETE RESTRICT NOT VALID;

CREATE INDEX cosmos_file_versions_page_idx
  ON cosmos_file_versions (organization_id, file_id, version DESC, id DESC);

CREATE OR REPLACE FUNCTION cosmos_protect_file_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cosmos File rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.organization_id, NEW.space_id, NEW.id, NEW.scope,
    NEW.owner_user_id, NEW.session_id, NEW.path, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.space_id, OLD.id, OLD.scope,
    OLD.owner_user_id, OLD.session_id, OLD.path, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Cosmos File identity and scope are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived Cosmos File rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Cosmos File updates must advance version by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Cosmos File updated_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_files_protect_history
  BEFORE UPDATE OR DELETE ON cosmos_files
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_file_history();

CREATE TRIGGER cosmos_files_reject_truncate
  BEFORE TRUNCATE ON cosmos_files
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

CREATE TRIGGER cosmos_file_versions_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_file_versions
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

CREATE TRIGGER cosmos_file_versions_reject_truncate
  BEFORE TRUNCATE ON cosmos_file_versions
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

REVOKE DELETE, TRUNCATE ON cosmos_files FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON cosmos_file_versions FROM PUBLIC;

ALTER TABLE cosmos_session_events
  ADD COLUMN file_id text,
  ADD COLUMN file_version_id text,
  ADD CONSTRAINT cosmos_session_events_file_tenant_fk
  FOREIGN KEY (organization_id, file_id)
  REFERENCES cosmos_files(organization_id, id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT cosmos_session_events_file_version_tenant_fk
  FOREIGN KEY (organization_id, file_id, file_version_id)
  REFERENCES cosmos_file_versions(organization_id, file_id, id)
  ON DELETE RESTRICT NOT VALID,
  DROP CONSTRAINT cosmos_session_events_runtime_event_type_check,
  ADD CONSTRAINT cosmos_session_events_runtime_event_type_check
  CHECK (event_type IN (
    'session.created', 'session.updated', 'session.renamed',
    'session.archived', 'session.restored', 'message.created',
    'turn.queued', 'attempt.updated', 'artifact.created',
    'artifact.updated', 'artifact.removed', 'file.version.created'
  )) NOT VALID,
  DROP CONSTRAINT cosmos_session_events_runtime_resource_type_check,
  ADD CONSTRAINT cosmos_session_events_runtime_resource_type_check
  CHECK (resource_type IN ('session', 'message', 'turn', 'attempt', 'artifact', 'file')) NOT VALID,
  DROP CONSTRAINT cosmos_session_events_runtime_typed_resource_check,
  ADD CONSTRAINT cosmos_session_events_runtime_typed_resource_check
  CHECK (
    (
      event_type IN (
        'session.created', 'session.updated', 'session.renamed',
        'session.archived', 'session.restored'
      )
      AND resource_type = 'session' AND resource_id = session_id
      AND message_id IS NULL AND turn_id IS NULL AND attempt_id IS NULL
      AND artifact_id IS NULL AND file_id IS NULL AND file_version_id IS NULL
    )
    OR (
      event_type = 'message.created' AND resource_type = 'message'
      AND resource_id = message_id AND message_id IS NOT NULL
      AND turn_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL
    )
    OR (
      event_type = 'turn.queued' AND resource_type = 'turn'
      AND resource_id = turn_id AND turn_id IS NOT NULL AND command_id IS NOT NULL
      AND message_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL
    )
    OR (
      event_type = 'attempt.updated' AND resource_type = 'attempt'
      AND resource_id = attempt_id AND attempt_id IS NOT NULL AND turn_id IS NOT NULL
      AND message_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL
    )
    OR (
      event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
      AND resource_type = 'artifact'
      AND resource_id = artifact_id AND artifact_id IS NOT NULL
      AND command_id IS NULL AND message_id IS NULL AND turn_id IS NULL
      AND attempt_id IS NULL AND file_id IS NULL AND file_version_id IS NULL
    )
    OR (
      event_type = 'file.version.created' AND resource_type = 'file'
      AND resource_id = file_id AND file_id IS NOT NULL AND file_version_id IS NOT NULL
      AND command_id IS NULL AND message_id IS NULL AND turn_id IS NULL
      AND attempt_id IS NULL AND artifact_id IS NULL
    )
  ) NOT VALID;

ALTER TABLE cosmos_audit_events
  DROP CONSTRAINT cosmos_audit_events_action_check,
  ADD CONSTRAINT cosmos_audit_events_action_check
    CHECK (action IN (
      'session.create', 'session.start', 'session.send',
      'session.rename', 'session.archive', 'session.restore',
      'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
      'session.share.create', 'session.share.revoke',
      'artifact.create', 'artifact.update', 'artifact.remove',
      'file.version.create'
    )) NOT VALID,
  DROP CONSTRAINT cosmos_audit_events_before_state_check,
  ADD CONSTRAINT cosmos_audit_events_before_state_check
    CHECK (
      (action IN ('session.create', 'session.share.create', 'artifact.create')
        AND before_state IS NULL)
      OR (action = 'file.version.create'
        AND (before_state IS NULL OR jsonb_typeof(before_state) = 'object'))
      OR (
        action IN (
          'session.start', 'session.send', 'session.rename',
          'session.archive', 'session.restore', 'session.pause',
          'session.resume', 'session.cancel', 'turn.retry',
          'session.share.revoke', 'artifact.update', 'artifact.remove'
        )
        AND before_state IS NOT NULL AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID,
  DROP CONSTRAINT cosmos_audit_events_target_type_check,
  ADD CONSTRAINT cosmos_audit_events_target_type_check
    CHECK (target_type IN ('session', 'turn', 'share_grant', 'artifact', 'file')) NOT VALID,
  DROP CONSTRAINT cosmos_audit_events_target_check,
  ADD CONSTRAINT cosmos_audit_events_target_check
    CHECK (
      (action = 'turn.retry' AND target_type = 'turn')
      OR (action IN ('session.share.create', 'session.share.revoke')
        AND target_type = 'share_grant')
      OR (action IN ('artifact.create', 'artifact.update', 'artifact.remove')
        AND target_type = 'artifact')
      OR (action = 'file.version.create' AND target_type = 'file')
      OR (
        action NOT IN (
          'turn.retry', 'session.share.create', 'session.share.revoke',
          'artifact.create', 'artifact.update', 'artifact.remove',
          'file.version.create'
        )
        AND target_type = 'session' AND target_id = session_id
      )
    ) NOT VALID;

GRANT SELECT ON cosmos_files, cosmos_file_versions TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE ON cosmos_files TO cosmos_worker_runtime;
GRANT SELECT, INSERT ON cosmos_file_versions TO cosmos_worker_runtime;
GRANT INSERT ON cosmos_audit_events, cosmos_outbox_events TO cosmos_worker_runtime;

ALTER TABLE cosmos_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_files FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_file_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_migration_admin ON cosmos_files TO CURRENT_USER
  USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_file_versions TO CURRENT_USER
  USING (true) WITH CHECK (true);

CREATE POLICY cosmos_api_tenant_select ON cosmos_files
  FOR SELECT TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND (space_id IS NULL OR space_id = NULLIF(current_setting('cosmos.space_id', true), ''))
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships actor_organization
      WHERE actor_organization.organization_id = cosmos_files.organization_id
        AND actor_organization.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM cosmos_space_memberships actor_space
      WHERE actor_space.organization_id = cosmos_files.organization_id
        AND actor_space.space_id = NULLIF(current_setting('cosmos.space_id', true), '')
        AND actor_space.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
    AND (
      cosmos_files.scope = 'organization'
      OR (
        cosmos_files.scope = 'user'
        AND (
          cosmos_files.owner_user_id = NULLIF(current_setting('cosmos.actor_id', true), '')
          OR EXISTS (
            SELECT 1 FROM cosmos_organization_memberships privileged_actor
            WHERE privileged_actor.organization_id = cosmos_files.organization_id
              AND privileged_actor.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
              AND privileged_actor.role IN ('organization_admin', 'organization_owner')
          )
        )
      )
      OR (
        cosmos_files.scope = 'workspace'
        AND cosmos_files.space_id = NULLIF(current_setting('cosmos.space_id', true), '')
        AND EXISTS (
          SELECT 1 FROM cosmos_sessions file_session
          WHERE file_session.organization_id = cosmos_files.organization_id
            AND file_session.space_id = cosmos_files.space_id
            AND file_session.id = cosmos_files.session_id
            AND (
              file_session.visibility = 'space'
              OR file_session.created_by = NULLIF(current_setting('cosmos.actor_id', true), '')
              OR EXISTS (
                SELECT 1 FROM cosmos_session_share_grants file_share
                WHERE file_share.organization_id = file_session.organization_id
                  AND file_share.space_id = file_session.space_id
                  AND file_share.session_id = file_session.id
                  AND file_share.revoked_at IS NULL
                  AND (file_share.expires_at IS NULL
                    OR file_share.expires_at > transaction_timestamp())
                  AND (
                    (file_share.principal_type = 'user'
                      AND file_share.principal_id = NULLIF(current_setting('cosmos.actor_id', true), ''))
                    OR (
                      file_share.principal_type = 'group'
                      AND EXISTS (
                        SELECT 1 FROM cosmos_group_memberships file_group
                        WHERE file_group.organization_id = file_share.organization_id
                          AND file_group.group_id = file_share.principal_id
                          AND file_group.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
                      )
                    )
                  )
              )
            )
        )
      )
    )
  );

CREATE POLICY cosmos_api_tenant_select ON cosmos_file_versions
  FOR SELECT TO cosmos_api_runtime
  USING (
    EXISTS (
      SELECT 1 FROM cosmos_files visible_file
      WHERE visible_file.organization_id = cosmos_file_versions.organization_id
        AND visible_file.id = cosmos_file_versions.file_id
    )
  );

CREATE POLICY cosmos_worker_select ON cosmos_files
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_insert ON cosmos_files
  FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);
CREATE POLICY cosmos_worker_update ON cosmos_files
  FOR UPDATE TO cosmos_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY cosmos_worker_select ON cosmos_file_versions
  FOR SELECT TO cosmos_worker_runtime USING (true);
CREATE POLICY cosmos_worker_insert ON cosmos_file_versions
  FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);
CREATE POLICY cosmos_worker_insert ON cosmos_audit_events
  FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);
CREATE POLICY cosmos_worker_insert ON cosmos_outbox_events
  FOR INSERT TO cosmos_worker_runtime WITH CHECK (true);
