SET LOCAL lock_timeout = '5s';

-- Canonical MCP server registry. Records which Model Context Protocol servers
-- are registered to a Space so Experts can pin them as tool sources. Exactly
-- one of endpoint (http/sse) or command (stdio) is populated for a given row.
CREATE TABLE cosmos_mcp_servers (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 256),
  transport text NOT NULL DEFAULT 'http'
    CHECK (transport IN ('stdio', 'sse', 'http')),
  endpoint text CHECK (endpoint IS NULL OR length(btrim(endpoint)) BETWEEN 1 AND 2048),
  command text CHECK (command IS NULL OR length(btrim(command)) BETWEEN 1 AND 2048),
  connection_status text NOT NULL DEFAULT 'action_required'
    CHECK (connection_status IN ('connected', 'action_required', 'archived')),
  tool_count integer NOT NULL DEFAULT 0 CHECK (tool_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_mcp_servers_archive_fact_check
    CHECK ((connection_status = 'archived') = (archived_at IS NOT NULL)),
  -- stdio transport carries a command; http/sse transports carry an endpoint.
  CONSTRAINT cosmos_mcp_servers_transport_target_check
    CHECK (
      (transport = 'stdio' AND command IS NOT NULL AND endpoint IS NULL) OR
      (transport IN ('http', 'sse') AND endpoint IS NOT NULL AND command IS NULL)
    )
);

-- List index: most-recently-updated first, stable tie-break on id.
CREATE INDEX cosmos_mcp_servers_space_updated_idx
  ON cosmos_mcp_servers (organization_id, space_id, updated_at DESC, id DESC)
  WHERE connection_status <> 'archived';

-- MCP server names are unique within an active Space.
CREATE UNIQUE INDEX cosmos_mcp_servers_active_unique_idx
  ON cosmos_mcp_servers (organization_id, space_id, name)
  WHERE connection_status <> 'archived';

-- Audit ledger — append-only.
CREATE TABLE cosmos_mcp_server_audit_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  mcp_server_id text,
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
  FOREIGN KEY (organization_id, space_id, mcp_server_id)
    REFERENCES cosmos_mcp_servers(organization_id, space_id, id) ON DELETE RESTRICT
);

-- Outbox for downstream consumers (e.g. tool discovery workers).
CREATE TABLE cosmos_mcp_server_outbox_events (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  mcp_server_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE cosmos_mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_mcp_servers FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_mcp_server_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_mcp_server_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE cosmos_mcp_server_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_mcp_server_outbox_events FORCE ROW LEVEL SECURITY;

-- API role: space members may read; managers may mutate.
CREATE POLICY cosmos_api_mcp_server_select ON cosmos_mcp_servers
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id) OR
         EXISTS (
           SELECT 1 FROM cosmos_space_memberships sm
           WHERE sm.organization_id = cosmos_mcp_servers.organization_id
             AND sm.space_id = cosmos_mcp_servers.space_id
             AND sm.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
         ));

CREATE POLICY cosmos_api_mcp_server_mutate ON cosmos_mcp_servers
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_mcp_server_audit_insert ON cosmos_mcp_server_audit_events
  FOR INSERT TO cosmos_api_runtime WITH CHECK (true);

CREATE POLICY cosmos_api_mcp_server_audit_select ON cosmos_mcp_server_audit_events
  FOR SELECT TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, space_id));

CREATE POLICY cosmos_api_mcp_server_outbox_access ON cosmos_mcp_server_outbox_events
  FOR ALL TO cosmos_api_runtime USING (true) WITH CHECK (true);

-- ── Column grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON cosmos_mcp_servers TO cosmos_api_runtime;
GRANT UPDATE (endpoint, command, connection_status, tool_count, version, updated_at, archived_at)
  ON cosmos_mcp_servers TO cosmos_api_runtime;
GRANT SELECT, INSERT ON cosmos_mcp_server_audit_events TO cosmos_api_runtime;
GRANT SELECT, INSERT, UPDATE (published_at) ON cosmos_mcp_server_outbox_events TO cosmos_api_runtime;

-- ── Immutability / archive protection ────────────────────────────────────────

CREATE FUNCTION cosmos_protect_archived_mcp_server() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MCP servers must be archived instead of deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.connection_status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Archived MCP servers are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_mcp_servers_protect_archive
  BEFORE UPDATE OR DELETE ON cosmos_mcp_servers
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_archived_mcp_server();

-- ── CAS version increment ─────────────────────────────────────────────────────

CREATE FUNCTION cosmos_increment_mcp_server_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_mcp_servers_version_increment
  BEFORE UPDATE ON cosmos_mcp_servers
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_mcp_server_version();
