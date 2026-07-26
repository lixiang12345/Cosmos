SET LOCAL lock_timeout = '5s';

-- Space migration jobs: the durable record of every execute attempt. Jobs are
-- append-only from the caller's perspective (failed jobs are retried by
-- creating a new job) and never deleted.
CREATE TABLE cosmos_space_migrations (
  organization_id text NOT NULL,
  id text NOT NULL,
  source_space_id text NOT NULL,
  target_space_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('webhooks')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  resource_total integer NOT NULL DEFAULT 0 CHECK (resource_total >= 0),
  resource_migrated integer NOT NULL DEFAULT 0 CHECK (resource_migrated >= 0),
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 2000),
  requested_by text NOT NULL,
  idempotency_key_hash text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, source_space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, target_space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT cosmos_space_migrations_distinct_spaces_check
    CHECK (source_space_id <> target_space_id),
  CONSTRAINT cosmos_space_migrations_terminal_fact_check
    CHECK ((status = 'failed') = (error_message IS NOT NULL))
);

CREATE INDEX cosmos_space_migrations_source_idx
  ON cosmos_space_migrations (organization_id, source_space_id, created_at DESC);

CREATE UNIQUE INDEX cosmos_space_migrations_idempotency_idx
  ON cosmos_space_migrations (organization_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

ALTER TABLE cosmos_space_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cosmos_space_migrations FORCE ROW LEVEL SECURITY;

CREATE POLICY cosmos_api_space_migration_select ON cosmos_space_migrations
  FOR SELECT TO cosmos_api_runtime
  USING (EXISTS (
    SELECT 1 FROM cosmos_organization_memberships membership
    WHERE membership.organization_id = cosmos_space_migrations.organization_id
      AND membership.actor_id = NULLIF(current_setting('cosmos.actor_id', true), '')
  ));

CREATE POLICY cosmos_api_space_migration_write ON cosmos_space_migrations
  FOR ALL TO cosmos_api_runtime
  USING (cosmos_actor_can_manage_space(organization_id, source_space_id))
  WITH CHECK (cosmos_actor_can_manage_space(organization_id, source_space_id));

GRANT SELECT, INSERT ON cosmos_space_migrations TO cosmos_api_runtime;
GRANT UPDATE (status, resource_total, resource_migrated, error_message, version, updated_at)
  ON cosmos_space_migrations TO cosmos_api_runtime;

CREATE FUNCTION cosmos_increment_space_migration_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_space_migrations_version_increment
  BEFORE UPDATE ON cosmos_space_migrations
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_space_migration_version();

-- The webhook audit table references the webhook primary key including its
-- space segment; rewriting a webhook's space would violate the constraint
-- mid-transaction unless it can be deferred to commit.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'cosmos_webhook_audit_events'::regclass
    AND confrelid = 'cosmos_webhooks'::regclass
    AND contype = 'f';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE cosmos_webhook_audit_events ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',
      constraint_name
    );
  END IF;
END;
$$;

-- Executes the webhooks slice in the caller's transaction. Tenant isolation is
-- explicit; the target-name conflict raises and rolls the transaction back so
-- a failed migration changes nothing.
CREATE FUNCTION cosmos_execute_webhook_space_migration(
  migration_organization_id text,
  migration_source_space_id text,
  migration_target_space_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  migrated integer;
BEGIN
  IF migration_source_space_id = migration_target_space_id THEN
    RAISE EXCEPTION 'Migration target must be a different Space' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM cosmos_spaces
  WHERE organization_id = migration_organization_id AND id = migration_target_space_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration target Space does not exist' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cosmos_webhooks source_webhook
    JOIN cosmos_webhooks target_webhook
      ON target_webhook.organization_id = source_webhook.organization_id
      AND target_webhook.space_id = migration_target_space_id
      AND target_webhook.name = source_webhook.name
      AND target_webhook.status = 'active'
    WHERE source_webhook.organization_id = migration_organization_id
      AND source_webhook.space_id = migration_source_space_id
      AND source_webhook.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The target Space already has an active Webhook with the same name'
      USING ERRCODE = '23505';
  END IF;

  SET CONSTRAINTS ALL DEFERRED;

  UPDATE cosmos_webhook_audit_events
  SET space_id = migration_target_space_id
  WHERE organization_id = migration_organization_id
    AND space_id = migration_source_space_id;

  UPDATE cosmos_webhook_outbox_events
  SET space_id = migration_target_space_id
  WHERE organization_id = migration_organization_id
    AND space_id = migration_source_space_id;

  UPDATE cosmos_webhooks
  SET space_id = migration_target_space_id
  WHERE organization_id = migration_organization_id
    AND space_id = migration_source_space_id;
  GET DIAGNOSTICS migrated = ROW_COUNT;

  RETURN migrated;
END;
$$;

REVOKE EXECUTE ON FUNCTION cosmos_execute_webhook_space_migration(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cosmos_execute_webhook_space_migration(text, text, text) TO cosmos_api_runtime;
