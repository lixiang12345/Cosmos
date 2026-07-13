SET LOCAL lock_timeout = '5s';

CREATE TABLE relay_artifacts (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  turn_id text,
  type text NOT NULL CHECK (type IN (
    'pull_request', 'branch', 'commit', 'issue', 'link',
    'test_report', 'deployment', 'document'
  )),
  provider text,
  external_id text,
  label text NOT NULL,
  url text NOT NULL,
  status text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_tool_call_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_by text,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, session_id, id),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK (btrim(label) <> '' AND char_length(label) <= 240),
  CHECK (char_length(url) <= 2048 AND url ~ '^https://'),
  CHECK (provider IS NULL OR (btrim(provider) <> '' AND char_length(provider) <= 128)),
  CHECK (external_id IS NULL OR (btrim(external_id) <> '' AND char_length(external_id) <= 512)),
  CHECK ((provider IS NULL) = (external_id IS NULL)),
  CHECK (status IS NULL OR (btrim(status) <> '' AND char_length(status) <= 128)),
  CHECK (jsonb_typeof(attributes) = 'object' AND octet_length(attributes::text) <= 65536),
  CHECK (version > 0),
  CHECK (updated_at >= created_at),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (removed_at IS NULL OR removed_at >= created_at)
);

ALTER TABLE relay_artifacts
  ADD CONSTRAINT relay_artifacts_turn_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, turn_id)
  REFERENCES relay_turns(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID;

CREATE UNIQUE INDEX relay_artifacts_external_identity_idx
  ON relay_artifacts (organization_id, type, provider, external_id)
  WHERE provider IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX relay_artifacts_session_page_idx
  ON relay_artifacts (
    organization_id, space_id, session_id, created_at DESC, id DESC
  )
  WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION relay_protect_artifact_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relay Artifact rows cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.organization_id, NEW.space_id, NEW.session_id, NEW.id,
    NEW.turn_id, NEW.type, NEW.provider, NEW.external_id,
    NEW.created_by_tool_call_id, NEW.created_by, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.space_id, OLD.session_id, OLD.id,
    OLD.turn_id, OLD.type, OLD.provider, OLD.external_id,
    OLD.created_by_tool_call_id, OLD.created_by, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Relay Artifact identity and provenance are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Removed Relay Artifact rows are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Relay Artifact updates must advance version by one'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Relay Artifact updated_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_artifacts_protect_history
  BEFORE UPDATE OR DELETE ON relay_artifacts
  FOR EACH ROW EXECUTE FUNCTION relay_protect_artifact_history();

CREATE TRIGGER relay_artifacts_reject_truncate
  BEFORE TRUNCATE ON relay_artifacts
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

REVOKE DELETE, TRUNCATE ON relay_artifacts FROM PUBLIC;

ALTER TABLE relay_session_events
  ADD COLUMN artifact_id text,
  ADD CONSTRAINT relay_session_events_artifact_tenant_fk
  FOREIGN KEY (organization_id, space_id, session_id, artifact_id)
  REFERENCES relay_artifacts(organization_id, space_id, session_id, id)
  ON DELETE RESTRICT NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_event_type_check,
  ADD CONSTRAINT relay_session_events_runtime_event_type_check
  CHECK (event_type IN (
    'session.created',
    'session.updated',
    'session.renamed',
    'session.archived',
    'session.restored',
    'message.created',
    'turn.queued',
    'attempt.updated',
    'artifact.created',
    'artifact.updated',
    'artifact.removed'
  )) NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_resource_type_check,
  ADD CONSTRAINT relay_session_events_runtime_resource_type_check
  CHECK (resource_type IN ('session', 'message', 'turn', 'attempt', 'artifact')) NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_typed_resource_check,
  ADD CONSTRAINT relay_session_events_runtime_typed_resource_check
  CHECK (
    (
      event_type IN (
        'session.created', 'session.updated', 'session.renamed',
        'session.archived', 'session.restored'
      )
      AND resource_type = 'session' AND resource_id = session_id
      AND message_id IS NULL AND turn_id IS NULL
      AND attempt_id IS NULL AND artifact_id IS NULL
    )
    OR (
      event_type = 'message.created' AND resource_type = 'message'
      AND resource_id = message_id AND message_id IS NOT NULL
      AND turn_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
    )
    OR (
      event_type = 'turn.queued' AND resource_type = 'turn'
      AND resource_id = turn_id AND turn_id IS NOT NULL AND command_id IS NOT NULL
      AND message_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
    )
    OR (
      event_type = 'attempt.updated' AND resource_type = 'attempt'
      AND resource_id = attempt_id AND attempt_id IS NOT NULL AND turn_id IS NOT NULL
      AND message_id IS NULL AND artifact_id IS NULL
    )
    OR (
      event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
      AND resource_type = 'artifact'
      AND resource_id = artifact_id AND artifact_id IS NOT NULL
      AND command_id IS NULL AND message_id IS NULL
      AND turn_id IS NULL AND attempt_id IS NULL
    )
  ) NOT VALID;

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check
    CHECK (action IN (
      'session.create', 'session.start', 'session.send',
      'session.rename', 'session.archive', 'session.restore',
      'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
      'session.share.create', 'session.share.revoke',
      'artifact.create', 'artifact.update', 'artifact.remove'
    )) NOT VALID,
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check
    CHECK (
      (action IN ('session.create', 'session.share.create', 'artifact.create')
        AND before_state IS NULL)
      OR (
        action IN (
          'session.start', 'session.send', 'session.rename',
          'session.archive', 'session.restore', 'session.pause',
          'session.resume', 'session.cancel', 'turn.retry',
          'session.share.revoke', 'artifact.update', 'artifact.remove'
        )
        AND before_state IS NOT NULL
        AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_type_check,
  ADD CONSTRAINT relay_audit_events_target_type_check
    CHECK (target_type IN ('session', 'turn', 'share_grant', 'artifact')) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_check,
  ADD CONSTRAINT relay_audit_events_target_check
    CHECK (
      (action = 'turn.retry' AND target_type = 'turn')
      OR (
        action IN ('session.share.create', 'session.share.revoke')
        AND target_type = 'share_grant'
      )
      OR (
        action IN ('artifact.create', 'artifact.update', 'artifact.remove')
        AND target_type = 'artifact'
      )
      OR (
        action NOT IN (
          'turn.retry', 'session.share.create', 'session.share.revoke',
          'artifact.create', 'artifact.update', 'artifact.remove'
        )
        AND target_type = 'session'
        AND target_id = session_id
      )
    ) NOT VALID;

GRANT SELECT, INSERT, UPDATE ON relay_artifacts TO relay_api_runtime;

ALTER TABLE relay_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY relay_migration_admin ON relay_artifacts TO CURRENT_USER
  USING (true) WITH CHECK (true);

CREATE POLICY relay_api_tenant ON relay_artifacts
  FOR ALL TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships actor_organization
      WHERE actor_organization.organization_id = relay_artifacts.organization_id
        AND actor_organization.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships actor_space
      WHERE actor_space.organization_id = relay_artifacts.organization_id
        AND actor_space.space_id = relay_artifacts.space_id
        AND actor_space.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships actor_organization
      WHERE actor_organization.organization_id = relay_artifacts.organization_id
        AND actor_organization.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships actor_space
      WHERE actor_space.organization_id = relay_artifacts.organization_id
        AND actor_space.space_id = relay_artifacts.space_id
        AND actor_space.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
  );
