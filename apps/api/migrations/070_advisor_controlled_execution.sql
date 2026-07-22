SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_experts
  ADD COLUMN kind text NOT NULL DEFAULT 'custom'
    CHECK (kind IN ('managed_template', 'custom', 'built_in'));

CREATE OR REPLACE FUNCTION relay_guard_expert_runtime_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'relay_experts'
    AND current_user = 'relay_api_runtime'
    AND to_jsonb(OLD) ->> 'kind' = 'built_in' THEN
    RAISE EXCEPTION 'Built-in Experts are immutable' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'relay_api_runtime' AND NOT (
    EXISTS (
      SELECT 1 FROM relay_organization_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role IN ('organization_owner', 'organization_admin')
    )
    OR EXISTS (
      SELECT 1 FROM relay_space_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.space_id = NEW.space_id
        AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
        AND membership.role = 'space_manager'
    )
  ) THEN
    RAISE EXCEPTION 'Only Expert managers may update control-plane rows'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE relay_advisor_plans (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  provider_tool_call_hash text NOT NULL,
  summary text NOT NULL,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN (
    'proposed', 'executing', 'succeeded', 'failed', 'rejected', 'action_required'
  )),
  requested_by text NOT NULL,
  confirmed_by text,
  confirmed_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, session_id, id),
  UNIQUE (organization_id, space_id, session_id, provider_tool_call_hash),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, confirmed_by)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE RESTRICT,
  CHECK (provider_tool_call_hash ~ '^[a-f0-9]{64}$'),
  CHECK (btrim(summary) <> '' AND char_length(summary) <= 2000),
  CHECK (jsonb_typeof(dependencies) = 'array' AND jsonb_array_length(dependencies) <= 10),
  CHECK (jsonb_typeof(risks) = 'array' AND jsonb_array_length(risks) <= 10),
  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  CHECK (updated_at >= created_at AND version > 0)
);

CREATE TABLE relay_advisor_plan_steps (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  plan_id text NOT NULL,
  id text NOT NULL,
  ordinal smallint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('control_plane', 'manual_action')),
  operation text CHECK (operation IN ('space.update', 'organization.set_default_space')),
  target_type text CHECK (target_type = 'space'),
  target_id text,
  rationale text,
  before_state jsonb,
  after_state jsonb,
  manual_action jsonb,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL CHECK (status IN (
    'proposed', 'executing', 'succeeded', 'failed', 'rejected', 'action_required'
  )),
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, space_id, session_id, plan_id, id),
  UNIQUE (organization_id, space_id, session_id, plan_id, ordinal),
  FOREIGN KEY (organization_id, space_id, session_id, plan_id)
    REFERENCES relay_advisor_plans(organization_id, space_id, session_id, id) ON DELETE RESTRICT,
  CHECK (ordinal BETWEEN 1 AND 10),
  CHECK (rationale IS NULL OR (btrim(rationale) <> '' AND char_length(rationale) <= 1000)),
  CHECK (failure_code IS NULL OR (btrim(failure_code) <> '' AND char_length(failure_code) <= 128)),
  CHECK (failure_message IS NULL OR (btrim(failure_message) <> '' AND char_length(failure_message) <= 1000)),
  CHECK (
    (kind = 'control_plane' AND operation IS NOT NULL AND target_type = 'space'
      AND target_id IS NOT NULL AND rationale IS NOT NULL
      AND jsonb_typeof(before_state) = 'object' AND jsonb_typeof(after_state) = 'object'
      AND manual_action IS NULL)
    OR
    (kind = 'manual_action' AND operation IS NULL AND target_type IS NULL
      AND target_id IS NULL AND rationale IS NULL AND before_state IS NULL
      AND after_state IS NULL AND jsonb_typeof(manual_action) = 'object')
  ),
  CHECK ((failure_code IS NULL) = (failure_message IS NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CHECK (
    (status = 'proposed' AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'executing' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded', 'failed', 'rejected', 'action_required') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX relay_advisor_plans_session_idx
  ON relay_advisor_plans (organization_id, space_id, session_id, created_at, id);
CREATE INDEX relay_advisor_plans_recovery_idx
  ON relay_advisor_plans (updated_at, id) WHERE status IN ('executing', 'failed');

CREATE OR REPLACE FUNCTION relay_protect_advisor_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advisor plans cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.organization_id, NEW.space_id, NEW.session_id, NEW.id,
      NEW.provider_tool_call_hash, NEW.summary, NEW.dependencies, NEW.risks,
      NEW.requested_by, NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.organization_id, OLD.space_id, OLD.session_id, OLD.id,
      OLD.provider_tool_call_hash, OLD.summary, OLD.dependencies, OLD.risks,
      OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Advisor plan proposal fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('executing', 'rejected'))
    OR (OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed', 'action_required'))
    OR (OLD.status = 'failed' AND NEW.status = 'executing')
  ) THEN
    RAISE EXCEPTION 'Invalid Advisor plan state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Advisor plan updates must advance version and time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION relay_protect_advisor_plan_step() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advisor plan steps cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.organization_id, NEW.space_id, NEW.session_id, NEW.plan_id, NEW.id,
      NEW.ordinal, NEW.kind, NEW.operation, NEW.target_type, NEW.target_id,
      NEW.rationale, NEW.before_state, NEW.after_state, NEW.manual_action, NEW.risk_level)
    IS DISTINCT FROM
    ROW(OLD.organization_id, OLD.space_id, OLD.session_id, OLD.plan_id, OLD.id,
      OLD.ordinal, OLD.kind, OLD.operation, OLD.target_type, OLD.target_id,
      OLD.rationale, OLD.before_state, OLD.after_state, OLD.manual_action, OLD.risk_level) THEN
    RAISE EXCEPTION 'Advisor plan step inputs are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('executing', 'rejected', 'action_required'))
    OR (OLD.status = 'executing' AND NEW.status IN ('succeeded', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'executing')
  ) OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Invalid Advisor plan step state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_advisor_plans_protect
  BEFORE UPDATE OR DELETE ON relay_advisor_plans
  FOR EACH ROW EXECUTE FUNCTION relay_protect_advisor_plan();
CREATE TRIGGER relay_advisor_plan_steps_protect
  BEFORE UPDATE OR DELETE ON relay_advisor_plan_steps
  FOR EACH ROW EXECUTE FUNCTION relay_protect_advisor_plan_step();
REVOKE DELETE, TRUNCATE ON relay_advisor_plans, relay_advisor_plan_steps FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON relay_advisor_plans, relay_advisor_plan_steps
  TO relay_api_runtime;
GRANT SELECT, INSERT ON relay_advisor_plans, relay_advisor_plan_steps
  TO relay_worker_runtime;
GRANT SELECT ON relay_experts, relay_spaces, relay_organizations, relay_environments
  TO relay_worker_runtime;

CREATE POLICY relay_worker_advisor_select ON relay_experts
  FOR SELECT TO relay_worker_runtime USING (true);
CREATE POLICY relay_worker_advisor_select ON relay_spaces
  FOR SELECT TO relay_worker_runtime USING (true);
CREATE POLICY relay_worker_advisor_select ON relay_organizations
  FOR SELECT TO relay_worker_runtime USING (true);

ALTER TABLE relay_advisor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_advisor_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE relay_advisor_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_advisor_plan_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY relay_migration_admin ON relay_advisor_plans
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY relay_migration_admin ON relay_advisor_plan_steps
  TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY relay_api_advisor_plan_select ON relay_advisor_plans
  FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_sessions visible_session
      WHERE visible_session.organization_id = relay_advisor_plans.organization_id
        AND visible_session.space_id = relay_advisor_plans.space_id
        AND visible_session.id = relay_advisor_plans.session_id
    )
  );
CREATE POLICY relay_api_advisor_plan_update ON relay_advisor_plans
  FOR UPDATE TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND (
      EXISTS (SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_advisor_plans.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin'))
      OR EXISTS (SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_advisor_plans.organization_id
          AND membership.space_id = relay_advisor_plans.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager')
    )
  ) WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
  );
CREATE POLICY relay_api_advisor_step_select ON relay_advisor_plan_steps
  FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_advisor_plans plan
      WHERE plan.organization_id = relay_advisor_plan_steps.organization_id
        AND plan.space_id = relay_advisor_plan_steps.space_id
        AND plan.session_id = relay_advisor_plan_steps.session_id
        AND plan.id = relay_advisor_plan_steps.plan_id)
  );
CREATE POLICY relay_api_advisor_step_update ON relay_advisor_plan_steps
  FOR UPDATE TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (SELECT 1 FROM relay_advisor_plans plan
      WHERE plan.organization_id = relay_advisor_plan_steps.organization_id
        AND plan.space_id = relay_advisor_plan_steps.space_id
        AND plan.session_id = relay_advisor_plan_steps.session_id
        AND plan.id = relay_advisor_plan_steps.plan_id)
  ) WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
  );

CREATE POLICY relay_worker_advisor_plan_all ON relay_advisor_plans
  FOR ALL TO relay_worker_runtime USING (true) WITH CHECK (true);
CREATE POLICY relay_worker_advisor_step_all ON relay_advisor_plan_steps
  FOR ALL TO relay_worker_runtime USING (true) WITH CHECK (true);

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check CHECK (action IN (
    'session.create', 'session.start', 'session.send', 'session.rename', 'session.archive',
    'session.restore', 'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
    'session.share.create', 'session.share.revoke', 'artifact.create', 'artifact.update',
    'artifact.remove', 'file.version.create', 'tool_call.create', 'tool_call.update',
    'tool_side_effect.record', 'approval.request', 'approval.decision',
    'advisor.plan.propose', 'advisor.plan.decision', 'advisor.plan.execute', 'advisor.plan.retry'
  )),
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check CHECK (
    (action IN ('session.create', 'session.share.create', 'artifact.create',
      'tool_call.create', 'tool_side_effect.record', 'approval.request', 'advisor.plan.propose')
      AND before_state IS NULL)
    OR (action = 'file.version.create' AND (before_state IS NULL OR jsonb_typeof(before_state) = 'object'))
    OR (action IN ('session.start', 'session.send', 'session.rename', 'session.archive',
      'session.restore', 'session.pause', 'session.resume', 'session.cancel', 'turn.retry',
      'session.share.revoke', 'artifact.update', 'artifact.remove', 'tool_call.update',
      'approval.decision', 'advisor.plan.decision', 'advisor.plan.execute', 'advisor.plan.retry')
      AND before_state IS NOT NULL AND jsonb_typeof(before_state) = 'object')
  ),
  DROP CONSTRAINT relay_audit_events_target_type_check,
  ADD CONSTRAINT relay_audit_events_target_type_check CHECK (target_type IN (
    'session', 'turn', 'share_grant', 'artifact', 'file', 'tool_call', 'tool_side_effect',
    'approval', 'advisor_plan'
  )),
  DROP CONSTRAINT relay_audit_events_target_check,
  ADD CONSTRAINT relay_audit_events_target_check CHECK (
    (action = 'turn.retry' AND target_type = 'turn')
    OR (action IN ('session.share.create', 'session.share.revoke') AND target_type = 'share_grant')
    OR (action IN ('artifact.create', 'artifact.update', 'artifact.remove') AND target_type = 'artifact')
    OR (action = 'file.version.create' AND target_type = 'file')
    OR (action IN ('tool_call.create', 'tool_call.update') AND target_type = 'tool_call')
    OR (action = 'tool_side_effect.record' AND target_type = 'tool_side_effect')
    OR (action IN ('approval.request', 'approval.decision') AND target_type = 'approval')
    OR (action IN ('advisor.plan.propose', 'advisor.plan.decision', 'advisor.plan.execute',
      'advisor.plan.retry') AND target_type = 'advisor_plan')
    OR (action IN ('session.create', 'session.start', 'session.send', 'session.rename',
      'session.archive', 'session.restore', 'session.pause', 'session.resume', 'session.cancel')
      AND target_type = 'session' AND target_id = session_id)
  );

ALTER TABLE relay_audit_events VALIDATE CONSTRAINT relay_audit_events_action_check;
ALTER TABLE relay_audit_events VALIDATE CONSTRAINT relay_audit_events_before_state_check;
ALTER TABLE relay_audit_events VALIDATE CONSTRAINT relay_audit_events_target_type_check;
ALTER TABLE relay_audit_events VALIDATE CONSTRAINT relay_audit_events_target_check;
