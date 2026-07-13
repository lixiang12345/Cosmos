SET LOCAL lock_timeout = '5s';

CREATE TABLE relay_tool_calls (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  turn_id text NOT NULL,
  attempt_id text NOT NULL,
  id text NOT NULL,
  worker_id text,
  tool_name text NOT NULL,
  operation text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL CHECK (status IN (
    'queued', 'approval_required', 'running', 'succeeded', 'failed', 'canceled'
  )),
  input_summary text NOT NULL,
  input_hash text NOT NULL,
  input_ref text,
  output_summary text,
  output_hash text,
  output_ref text,
  approval_id text,
  provider_idempotency_key_hash text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, session_id, id),
  UNIQUE (organization_id, space_id, session_id, turn_id, id),
  UNIQUE (organization_id, space_id, session_id, turn_id, attempt_id, id),
  FOREIGN KEY (organization_id, space_id, session_id, turn_id, attempt_id)
    REFERENCES relay_attempts(organization_id, space_id, session_id, turn_id, id)
    ON DELETE RESTRICT,
  CHECK (btrim(tool_name) <> '' AND char_length(tool_name) <= 160),
  CHECK (btrim(operation) <> '' AND char_length(operation) <= 160),
  CHECK (btrim(input_summary) <> '' AND char_length(input_summary) <= 4000),
  CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CHECK (input_ref IS NULL OR (btrim(input_ref) <> '' AND char_length(input_ref) <= 2048)),
  CHECK (output_summary IS NULL OR (btrim(output_summary) <> '' AND char_length(output_summary) <= 4000)),
  CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  CHECK (output_ref IS NULL OR (btrim(output_ref) <> '' AND char_length(output_ref) <= 2048)),
  CHECK (provider_idempotency_key_hash IS NULL OR provider_idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  CHECK ((output_summary IS NULL) = (output_hash IS NULL)),
  CHECK (version > 0),
  CHECK (
    (status IN ('queued', 'approval_required') AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded', 'failed', 'canceled') AND completed_at IS NOT NULL)
  ),
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= COALESCE(started_at, created_at)),
  CHECK (status <> 'approval_required' OR approval_id IS NOT NULL)
);

CREATE INDEX relay_tool_calls_session_page_idx
  ON relay_tool_calls (organization_id, space_id, session_id, created_at DESC, id DESC);
CREATE INDEX relay_tool_calls_ready_idx
  ON relay_tool_calls (created_at, id)
  WHERE status = 'queued';

CREATE TABLE relay_approvals (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  session_id text NOT NULL,
  turn_id text NOT NULL,
  tool_call_id text NOT NULL,
  input_hash text NOT NULL,
  action text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  reasons jsonb NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 'approved', 'changes_requested', 'rejected', 'expired', 'canceled'
  )),
  requested_by text NOT NULL,
  required_approvals smallint NOT NULL DEFAULT 1,
  approval_count smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  decided_by text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, id),
  UNIQUE (organization_id, space_id, session_id, tool_call_id),
  FOREIGN KEY (organization_id, space_id, session_id, turn_id, tool_call_id)
    REFERENCES relay_tool_calls(organization_id, space_id, session_id, turn_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CHECK (btrim(action) <> '' AND char_length(action) <= 240),
  CHECK (jsonb_typeof(reasons) = 'array' AND jsonb_array_length(reasons) BETWEEN 1 AND 20),
  CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 20),
  CHECK (required_approvals BETWEEN 1 AND 2),
  CHECK (approval_count BETWEEN 0 AND required_approvals),
  CHECK (expires_at > created_at AND updated_at >= created_at),
  CHECK (version > 0),
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decision_note IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  ),
  CHECK (decision_note IS NULL OR char_length(decision_note) <= 5000),
  CHECK (status <> 'approved' OR approval_count = required_approvals)
);

ALTER TABLE relay_tool_calls
  ADD CONSTRAINT relay_tool_calls_approval_fk
  FOREIGN KEY (organization_id, space_id, approval_id)
  REFERENCES relay_approvals(organization_id, space_id, id)
  ON DELETE RESTRICT NOT VALID;

CREATE INDEX relay_approvals_space_page_idx
  ON relay_approvals (organization_id, space_id, created_at DESC, id DESC);
CREATE INDEX relay_approvals_pending_expiry_idx
  ON relay_approvals (expires_at, id) WHERE status = 'pending';

CREATE TABLE relay_approval_assignments (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, space_id, approval_id, actor_id),
  FOREIGN KEY (organization_id, space_id, approval_id)
    REFERENCES relay_approvals(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_by)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT
);

CREATE INDEX relay_approval_assignments_actor_idx
  ON relay_approval_assignments (organization_id, space_id, actor_id, approval_id);

CREATE TABLE relay_approval_decisions (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  approval_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  note text NOT NULL,
  input_hash text NOT NULL,
  idempotency_key_hash text NOT NULL,
  decided_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, space_id, approval_id, id),
  UNIQUE (organization_id, space_id, approval_id, actor_id),
  FOREIGN KEY (organization_id, space_id, approval_id)
    REFERENCES relay_approvals(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  CHECK (char_length(note) <= 5000),
  CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE relay_tool_side_effects (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  tool_call_id text NOT NULL,
  id text NOT NULL,
  provider text NOT NULL,
  operation text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared', 'unknown', 'succeeded', 'failed')),
  provider_operation_id text,
  result_hash text,
  result_summary text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, session_id, tool_call_id, id),
  UNIQUE (organization_id, provider, idempotency_key_hash),
  FOREIGN KEY (organization_id, space_id, session_id, tool_call_id)
    REFERENCES relay_tool_calls(organization_id, space_id, session_id, id) ON DELETE RESTRICT,
  CHECK (btrim(provider) <> '' AND char_length(provider) <= 160),
  CHECK (btrim(operation) <> '' AND char_length(operation) <= 160),
  CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CHECK (result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
  CHECK (result_summary IS NULL OR char_length(result_summary) <= 4000),
  CHECK (updated_at >= created_at AND version > 0),
  CHECK ((status IN ('succeeded', 'failed')) = (result_hash IS NOT NULL))
);

CREATE OR REPLACE FUNCTION relay_protect_tool_call_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relay ToolCall rows cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.organization_id, NEW.space_id, NEW.session_id, NEW.turn_id,
    NEW.attempt_id, NEW.id, NEW.tool_name, NEW.operation, NEW.risk_level,
    NEW.input_summary, NEW.input_hash, NEW.input_ref, NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.organization_id, OLD.space_id, OLD.session_id, OLD.turn_id,
    OLD.attempt_id, OLD.id, OLD.tool_name, OLD.operation, OLD.risk_level,
    OLD.input_summary, OLD.input_hash, OLD.input_ref, OLD.created_at) THEN
    RAISE EXCEPTION 'Relay ToolCall identity and input are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Terminal Relay ToolCall rows are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('approval_required', 'running', 'canceled'))
    OR (OLD.status = 'approval_required' AND NEW.status IN ('queued', 'canceled'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'Invalid Relay ToolCall state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Relay ToolCall updates must advance version by one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_tool_calls_protect_history
  BEFORE UPDATE OR DELETE ON relay_tool_calls
  FOR EACH ROW EXECUTE FUNCTION relay_protect_tool_call_history();
CREATE TRIGGER relay_tool_calls_reject_truncate
  BEFORE TRUNCATE ON relay_tool_calls
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION relay_protect_approval_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relay Approval rows cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.organization_id, NEW.space_id, NEW.id, NEW.session_id, NEW.turn_id,
    NEW.tool_call_id, NEW.input_hash, NEW.action, NEW.risk_level, NEW.reasons,
    NEW.evidence, NEW.requested_by, NEW.required_approvals, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.organization_id, OLD.space_id, OLD.id, OLD.session_id, OLD.turn_id,
    OLD.tool_call_id, OLD.input_hash, OLD.action, OLD.risk_level, OLD.reasons,
    OLD.evidence, OLD.requested_by, OLD.required_approvals, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'Relay Approval request fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Terminal Relay Approval rows are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('pending', 'approved', 'changes_requested', 'rejected', 'expired', 'canceled') THEN
    RAISE EXCEPTION 'Invalid Relay Approval state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Relay Approval updates must advance version and time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_approvals_protect_history
  BEFORE UPDATE OR DELETE ON relay_approvals
  FOR EACH ROW EXECUTE FUNCTION relay_protect_approval_history();
CREATE TRIGGER relay_approvals_reject_truncate
  BEFORE TRUNCATE ON relay_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION relay_protect_tool_side_effect_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relay Tool side-effect rows cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.organization_id, NEW.space_id, NEW.session_id, NEW.tool_call_id,
    NEW.id, NEW.provider, NEW.operation, NEW.idempotency_key_hash,
    NEW.request_hash, NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.organization_id, OLD.space_id, OLD.session_id, OLD.tool_call_id,
    OLD.id, OLD.provider, OLD.operation, OLD.idempotency_key_hash,
    OLD.request_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'Relay Tool side-effect identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('succeeded', 'failed')
    OR NOT (
      (OLD.status = 'prepared' AND NEW.status IN ('unknown', 'succeeded', 'failed'))
      OR (OLD.status = 'unknown' AND NEW.status IN ('succeeded', 'failed'))
    ) THEN
    RAISE EXCEPTION 'Invalid Relay Tool side-effect state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Relay Tool side-effect updates must advance version and time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_tool_side_effects_protect_history
  BEFORE UPDATE OR DELETE ON relay_tool_side_effects
  FOR EACH ROW EXECUTE FUNCTION relay_protect_tool_side_effect_history();
CREATE TRIGGER relay_tool_side_effects_reject_truncate
  BEFORE TRUNCATE ON relay_tool_side_effects
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

CREATE TRIGGER relay_approval_assignments_reject_update_delete
  BEFORE UPDATE OR DELETE ON relay_approval_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();
CREATE TRIGGER relay_approval_assignments_reject_truncate
  BEFORE TRUNCATE ON relay_approval_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();
CREATE TRIGGER relay_approval_decisions_reject_update_delete
  BEFORE UPDATE OR DELETE ON relay_approval_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();
CREATE TRIGGER relay_approval_decisions_reject_truncate
  BEFORE TRUNCATE ON relay_approval_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION relay_reject_ledger_mutation();

REVOKE DELETE, TRUNCATE ON relay_tool_calls, relay_approvals, relay_tool_side_effects FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON relay_approval_assignments, relay_approval_decisions FROM PUBLIC;

ALTER TABLE relay_session_events
  ADD COLUMN tool_call_id text,
  ADD COLUMN approval_id text,
  ADD CONSTRAINT relay_session_events_tool_call_tenant_fk
    FOREIGN KEY (organization_id, space_id, session_id, tool_call_id)
    REFERENCES relay_tool_calls(organization_id, space_id, session_id, id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT relay_session_events_approval_tenant_fk
    FOREIGN KEY (organization_id, space_id, approval_id)
    REFERENCES relay_approvals(organization_id, space_id, id)
    ON DELETE RESTRICT NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_event_type_check,
  ADD CONSTRAINT relay_session_events_runtime_event_type_check CHECK (event_type IN (
    'session.created', 'session.updated', 'session.renamed', 'session.archived',
    'session.restored', 'message.created', 'turn.queued', 'attempt.updated',
    'artifact.created', 'artifact.updated', 'artifact.removed', 'file.version.created',
    'tool_call.updated', 'approval.requested', 'approval.decided'
  )) NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_resource_type_check,
  ADD CONSTRAINT relay_session_events_runtime_resource_type_check CHECK (resource_type IN (
    'session', 'message', 'turn', 'attempt', 'artifact', 'file', 'tool_call', 'approval'
  )) NOT VALID,
  DROP CONSTRAINT relay_session_events_runtime_typed_resource_check,
  ADD CONSTRAINT relay_session_events_runtime_typed_resource_check CHECK (
    (event_type IN ('session.created', 'session.updated', 'session.renamed', 'session.archived', 'session.restored')
      AND resource_type = 'session' AND resource_id = session_id
      AND message_id IS NULL AND turn_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type = 'message.created' AND resource_type = 'message' AND resource_id = message_id
      AND message_id IS NOT NULL AND turn_id IS NULL AND attempt_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type = 'turn.queued' AND resource_type = 'turn' AND resource_id = turn_id
      AND turn_id IS NOT NULL AND command_id IS NOT NULL AND message_id IS NULL AND attempt_id IS NULL
      AND artifact_id IS NULL AND file_id IS NULL AND file_version_id IS NULL
      AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type = 'attempt.updated' AND resource_type = 'attempt' AND resource_id = attempt_id
      AND attempt_id IS NOT NULL AND turn_id IS NOT NULL AND message_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type IN ('artifact.created', 'artifact.updated', 'artifact.removed')
      AND resource_type = 'artifact' AND resource_id = artifact_id AND artifact_id IS NOT NULL
      AND command_id IS NULL AND message_id IS NULL AND turn_id IS NULL AND attempt_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type = 'file.version.created' AND resource_type = 'file'
      AND resource_id = file_id AND file_id IS NOT NULL AND file_version_id IS NOT NULL
      AND command_id IS NULL AND message_id IS NULL AND turn_id IS NULL AND attempt_id IS NULL
      AND artifact_id IS NULL AND tool_call_id IS NULL AND approval_id IS NULL)
    OR (event_type = 'tool_call.updated' AND resource_type = 'tool_call'
      AND resource_id = tool_call_id AND tool_call_id IS NOT NULL AND turn_id IS NOT NULL
      AND attempt_id IS NOT NULL AND message_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL)
    OR (event_type IN ('approval.requested', 'approval.decided') AND resource_type = 'approval'
      AND resource_id = approval_id AND approval_id IS NOT NULL AND tool_call_id IS NOT NULL
      AND turn_id IS NOT NULL AND message_id IS NULL AND artifact_id IS NULL
      AND file_id IS NULL AND file_version_id IS NULL)
  ) NOT VALID;

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check CHECK (action IN (
    'session.create', 'session.start', 'session.send', 'session.rename', 'session.archive',
    'session.restore', 'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
    'session.share.create', 'session.share.revoke', 'artifact.create', 'artifact.update',
    'artifact.remove', 'file.version.create', 'tool_call.create', 'tool_call.update',
    'tool_side_effect.record', 'approval.request', 'approval.decision'
  )) NOT VALID,
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check CHECK (
    (action IN ('session.create', 'session.share.create', 'artifact.create',
      'tool_call.create', 'tool_side_effect.record', 'approval.request') AND before_state IS NULL)
    OR (action = 'file.version.create' AND (before_state IS NULL OR jsonb_typeof(before_state) = 'object'))
    OR (action IN ('session.start', 'session.send', 'session.rename', 'session.archive',
      'session.restore', 'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
      'session.share.revoke', 'artifact.update', 'artifact.remove', 'tool_call.update',
      'approval.decision') AND before_state IS NOT NULL AND jsonb_typeof(before_state) = 'object')
  ) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_type_check,
  ADD CONSTRAINT relay_audit_events_target_type_check CHECK (target_type IN (
    'session', 'turn', 'share_grant', 'artifact', 'file', 'tool_call', 'tool_side_effect', 'approval'
  )) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_check,
  ADD CONSTRAINT relay_audit_events_target_check CHECK (
    (action = 'turn.retry' AND target_type = 'turn')
    OR (action IN ('session.share.create', 'session.share.revoke') AND target_type = 'share_grant')
    OR (action IN ('artifact.create', 'artifact.update', 'artifact.remove') AND target_type = 'artifact')
    OR (action = 'file.version.create' AND target_type = 'file')
    OR (action IN ('tool_call.create', 'tool_call.update') AND target_type = 'tool_call')
    OR (action = 'tool_side_effect.record' AND target_type = 'tool_side_effect')
    OR (action IN ('approval.request', 'approval.decision') AND target_type = 'approval')
    OR (action IN ('session.create', 'session.start', 'session.send', 'session.rename',
      'session.archive', 'session.restore', 'session.pause', 'session.resume', 'session.cancel')
      AND target_type = 'session' AND target_id = session_id)
  ) NOT VALID;

GRANT SELECT ON relay_tool_calls, relay_approvals, relay_approval_assignments, relay_approval_decisions
  TO relay_api_runtime;
GRANT UPDATE ON relay_approvals, relay_tool_calls TO relay_api_runtime;
GRANT INSERT ON relay_approval_decisions TO relay_api_runtime;
GRANT SELECT, INSERT, UPDATE ON relay_tool_calls, relay_approvals, relay_tool_side_effects
  TO relay_worker_runtime;
GRANT SELECT, INSERT ON relay_approval_assignments TO relay_worker_runtime;
GRANT SELECT ON relay_approval_decisions TO relay_worker_runtime;
GRANT SELECT ON relay_service_accounts TO relay_worker_runtime;
GRANT INSERT ON relay_audit_events, relay_outbox_events TO relay_worker_runtime;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'relay_tool_calls', 'relay_approvals', 'relay_approval_assignments',
    'relay_approval_decisions', 'relay_tool_side_effects'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY relay_migration_admin ON %I TO %I USING (true) WITH CHECK (true)', table_name, current_user);
  END LOOP;
END;
$$;

CREATE POLICY relay_api_tenant_select ON relay_tool_calls FOR SELECT TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_sessions visible_session
      WHERE visible_session.organization_id = relay_tool_calls.organization_id
        AND visible_session.space_id = relay_tool_calls.space_id
        AND visible_session.id = relay_tool_calls.session_id));

CREATE POLICY relay_api_tenant_select ON relay_approvals FOR SELECT TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM relay_approval_assignments assignment
        WHERE assignment.organization_id = relay_approvals.organization_id
          AND assignment.space_id = relay_approvals.space_id
          AND assignment.approval_id = relay_approvals.id
          AND assignment.actor_id = NULLIF(current_setting('relay.actor_id', true), ''))
      OR EXISTS (SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.space_id = relay_approvals.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager')
    ));

CREATE POLICY relay_api_tenant_update ON relay_approvals FOR UPDATE TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''));

CREATE POLICY relay_api_tenant_update ON relay_tool_calls FOR UPDATE TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''));

CREATE POLICY relay_api_tenant_select ON relay_approval_assignments FOR SELECT TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''));
CREATE POLICY relay_api_tenant_select ON relay_approval_decisions FOR SELECT TO relay_api_runtime
  USING (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), ''));
CREATE POLICY relay_api_tenant_insert ON relay_approval_decisions FOR INSERT TO relay_api_runtime
  WITH CHECK (organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), ''));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'relay_tool_calls', 'relay_approvals', 'relay_approval_assignments',
    'relay_approval_decisions', 'relay_tool_side_effects'
  ] LOOP
    EXECUTE format('CREATE POLICY relay_worker_select ON %I FOR SELECT TO relay_worker_runtime USING (true)', table_name);
  END LOOP;
END;
$$;
CREATE POLICY relay_worker_insert ON relay_tool_calls FOR INSERT TO relay_worker_runtime WITH CHECK (true);
CREATE POLICY relay_worker_update ON relay_tool_calls FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY relay_worker_insert ON relay_approvals FOR INSERT TO relay_worker_runtime WITH CHECK (true);
CREATE POLICY relay_worker_update ON relay_approvals FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY relay_worker_insert ON relay_approval_assignments FOR INSERT TO relay_worker_runtime WITH CHECK (true);
CREATE POLICY relay_worker_insert ON relay_tool_side_effects FOR INSERT TO relay_worker_runtime WITH CHECK (true);
CREATE POLICY relay_worker_update ON relay_tool_side_effects FOR UPDATE TO relay_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY relay_worker_select ON relay_service_accounts
  FOR SELECT TO relay_worker_runtime USING (true);
