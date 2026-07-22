SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_sessions DROP CONSTRAINT cosmos_sessions_source_check;
ALTER TABLE cosmos_sessions ADD CONSTRAINT cosmos_sessions_source_check
  CHECK (source IN ('manual', 'automation'));

CREATE TABLE cosmos_expert_triggers (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  expert_id text NOT NULL,
  expert_revision_id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  source text NOT NULL CHECK (source IN ('github', 'slack', 'webhook', 'schedule')),
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 256),
  filter jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filter) = 'object'),
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('draft', 'paused', 'active', 'error')),
  auto_archive boolean NOT NULL DEFAULT false,
  service_account_id text NOT NULL,
  last_tested_at timestamptz,
  last_matched_at timestamptz,
  match_count bigint NOT NULL DEFAULT 0 CHECK (match_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id, expert_id)
    REFERENCES cosmos_experts(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, expert_id, expert_revision_id)
    REFERENCES cosmos_expert_revisions(organization_id, space_id, expert_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, service_account_id)
    REFERENCES cosmos_service_accounts(organization_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'active' OR last_tested_at IS NOT NULL)
);

CREATE INDEX cosmos_expert_triggers_space_updated_idx
  ON cosmos_expert_triggers (organization_id, space_id, updated_at DESC, id DESC);
CREATE INDEX cosmos_expert_triggers_match_idx
  ON cosmos_expert_triggers (organization_id, space_id, source, event_type, status, created_at, id)
  WHERE status = 'active';
CREATE INDEX cosmos_expert_triggers_expert_idx
  ON cosmos_expert_triggers (organization_id, space_id, expert_id, expert_revision_id);

CREATE TABLE cosmos_automation_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  source text NOT NULL CHECK (source IN ('github', 'slack', 'webhook', 'schedule')),
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 256),
  external_id text NOT NULL CHECK (length(btrim(external_id)) BETWEEN 1 AND 512),
  headers_redacted jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers_redacted) = 'object'),
  payload_redacted jsonb NOT NULL CHECK (jsonb_typeof(payload_redacted) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN (
    'received', 'matched', 'ignored', 'dispatching', 'dispatched', 'failed'
  )),
  automation_id text,
  session_id text,
  match_explanation text NOT NULL DEFAULT '' CHECK (char_length(match_explanation) <= 2000),
  error_code text CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
  error_message text CHECK (error_message IS NULL OR length(error_message) BETWEEN 1 AND 2000),
  received_by text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  UNIQUE (organization_id, space_id, source, external_id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, automation_id)
    REFERENCES cosmos_expert_triggers(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES cosmos_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK ((error_code IS NULL) = (error_message IS NULL)),
  CHECK (status NOT IN ('matched', 'dispatching', 'dispatched') OR automation_id IS NOT NULL),
  CHECK (status <> 'dispatched' OR session_id IS NOT NULL),
  CHECK (status <> 'failed' OR error_code IS NOT NULL)
);

CREATE INDEX cosmos_automation_events_space_received_idx
  ON cosmos_automation_events (organization_id, space_id, received_at DESC, id DESC);
CREATE INDEX cosmos_automation_events_automation_idx
  ON cosmos_automation_events (organization_id, space_id, automation_id, received_at DESC)
  WHERE automation_id IS NOT NULL;
CREATE INDEX cosmos_automation_events_session_idx
  ON cosmos_automation_events (organization_id, space_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE TABLE cosmos_automation_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  automation_id text,
  event_id text,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_version integer,
  request_id text NOT NULL,
  idempotency_key_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, automation_id)
    REFERENCES cosmos_expert_triggers(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, event_id)
    REFERENCES cosmos_automation_events(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE TABLE cosmos_automation_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  automation_id text,
  event_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, automation_id)
    REFERENCES cosmos_expert_triggers(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, event_id)
    REFERENCES cosmos_automation_events(organization_id, space_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER cosmos_automation_audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON cosmos_automation_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();
CREATE TRIGGER cosmos_automation_audit_events_reject_truncate
  BEFORE TRUNCATE ON cosmos_automation_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION cosmos_reject_ledger_mutation();

ALTER TABLE cosmos_expert_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_expert_triggers FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_automation_outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_migration_admin ON cosmos_expert_triggers
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_automation_events
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_automation_audit_events
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY cosmos_migration_admin ON cosmos_automation_outbox_events
  TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE POLICY cosmos_api_trigger_select ON cosmos_expert_triggers
  FOR SELECT TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM cosmos_organization_memberships membership
      WHERE membership.organization_id = cosmos_expert_triggers.organization_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM cosmos_space_memberships membership
      WHERE membership.organization_id = cosmos_expert_triggers.organization_id
        AND membership.space_id = cosmos_expert_triggers.space_id
        AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
    )
  );
CREATE POLICY cosmos_api_trigger_mutate ON cosmos_expert_triggers
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

CREATE POLICY cosmos_api_automation_event_access ON cosmos_automation_events
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );
CREATE POLICY cosmos_api_automation_audit_insert ON cosmos_automation_audit_events
  FOR INSERT TO cosmos_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );
CREATE POLICY cosmos_api_automation_outbox_access ON cosmos_automation_outbox_events
  FOR ALL TO cosmos_api_runtime
  USING (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('cosmos.organization_id', true), '')
    AND space_id = NULLIF(current_setting('cosmos.space_id', true), '')
    AND cosmos_actor_can_manage_space(organization_id, space_id)
  );

GRANT SELECT, INSERT ON cosmos_expert_triggers, cosmos_automation_events,
  cosmos_automation_audit_events, cosmos_automation_outbox_events TO cosmos_api_runtime;
GRANT UPDATE (
  name, event_type, filter, status, auto_archive, service_account_id,
  last_tested_at, last_matched_at, match_count, version, updated_at
) ON cosmos_expert_triggers TO cosmos_api_runtime;
GRANT UPDATE (
  status, automation_id, session_id, match_explanation,
  error_code, error_message, processed_at
) ON cosmos_automation_events TO cosmos_api_runtime;

GRANT EXECUTE ON FUNCTION cosmos_actor_can_manage_space(text, text) TO cosmos_api_runtime;
