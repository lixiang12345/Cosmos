CREATE TABLE cosmos_environments (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'provisioning', 'ready', 'updating', 'failed', 'disabled')),
  active_revision_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'ready' OR active_revision_id IS NOT NULL)
);

CREATE TABLE cosmos_environment_revisions (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  environment_id text NOT NULL,
  id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, environment_id, id),
  UNIQUE (organization_id, space_id, environment_id, revision),
  FOREIGN KEY (organization_id, space_id, environment_id)
    REFERENCES cosmos_environments(organization_id, space_id, id) ON DELETE RESTRICT
);

ALTER TABLE cosmos_environments
  ADD CONSTRAINT cosmos_environments_active_revision_fk
  FOREIGN KEY (organization_id, space_id, id, active_revision_id)
  REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
  ON DELETE RESTRICT;

CREATE TABLE cosmos_environment_revision_repositories (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  environment_id text NOT NULL,
  environment_revision_id text NOT NULL,
  repository_id text NOT NULL,
  repository text NOT NULL,
  base_branch text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    organization_id,
    space_id,
    environment_id,
    environment_revision_id,
    repository_id
  ),
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX cosmos_environment_revision_one_default_repository_idx
  ON cosmos_environment_revision_repositories (
    organization_id,
    space_id,
    environment_id,
    environment_revision_id
  )
  WHERE is_default;

CREATE TABLE cosmos_experts (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'space' CHECK (visibility IN ('private', 'space')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'disabled', 'archived')),
  published_revision_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, id),
  FOREIGN KEY (organization_id, space_id)
    REFERENCES cosmos_spaces(organization_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'published' OR published_revision_id IS NOT NULL)
);

CREATE TABLE cosmos_expert_revisions (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  expert_id text NOT NULL,
  id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  environment_id text NOT NULL,
  environment_revision_id text NOT NULL,
  allow_repository_override boolean NOT NULL DEFAULT true,
  allow_base_branch_override boolean NOT NULL DEFAULT true,
  instructions text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'default',
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, space_id, expert_id, id),
  UNIQUE (organization_id, space_id, expert_id, revision),
  UNIQUE (
    organization_id,
    space_id,
    expert_id,
    id,
    environment_id,
    environment_revision_id
  ),
  FOREIGN KEY (organization_id, space_id, expert_id)
    REFERENCES cosmos_experts(organization_id, space_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, space_id, environment_id, environment_revision_id)
    REFERENCES cosmos_environment_revisions(organization_id, space_id, environment_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE cosmos_experts
  ADD CONSTRAINT cosmos_experts_published_revision_fk
  FOREIGN KEY (organization_id, space_id, id, published_revision_id)
  REFERENCES cosmos_expert_revisions(organization_id, space_id, expert_id, id)
  ON DELETE RESTRICT;

CREATE FUNCTION cosmos_protect_final_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = TG_ARGV[0] THEN
    RAISE EXCEPTION '% % is immutable after reaching status %',
      TG_TABLE_NAME, OLD.id, TG_ARGV[0]
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_environment_revisions_protect_final
  BEFORE UPDATE OR DELETE ON cosmos_environment_revisions
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_final_revision('ready');

CREATE TRIGGER cosmos_expert_revisions_protect_final
  BEFORE UPDATE OR DELETE ON cosmos_expert_revisions
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_final_revision('published');

CREATE FUNCTION cosmos_protect_environment_repository_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO revision_status
    FROM cosmos_environment_revisions
    WHERE organization_id = OLD.organization_id
      AND space_id = OLD.space_id
      AND environment_id = OLD.environment_id
      AND id = OLD.environment_revision_id
    FOR UPDATE;

    IF revision_status = 'ready' THEN
      RAISE EXCEPTION 'repositories for ready Environment revision % are immutable',
        OLD.environment_revision_id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO revision_status
    FROM cosmos_environment_revisions
    WHERE organization_id = NEW.organization_id
      AND space_id = NEW.space_id
      AND environment_id = NEW.environment_id
      AND id = NEW.environment_revision_id
    FOR UPDATE;

    IF revision_status = 'ready' THEN
      RAISE EXCEPTION 'repositories for ready Environment revision % are immutable',
        NEW.environment_revision_id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_environment_revision_repositories_protect_ready
  BEFORE INSERT OR UPDATE OR DELETE ON cosmos_environment_revision_repositories
  FOR EACH ROW EXECUTE FUNCTION cosmos_protect_environment_repository_binding();

CREATE FUNCTION cosmos_validate_ready_environment_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  default_repository_count integer;
BEGIN
  IF NEW.status = 'ready' AND (TG_OP = 'INSERT' OR OLD.status <> 'ready') THEN
    SELECT count(*) INTO default_repository_count
    FROM cosmos_environment_revision_repositories
    WHERE organization_id = NEW.organization_id
      AND space_id = NEW.space_id
      AND environment_id = NEW.environment_id
      AND environment_revision_id = NEW.id
      AND is_default;

    IF default_repository_count <> 1 THEN
      RAISE EXCEPTION 'ready Environment revision % requires exactly one default repository', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_environment_revisions_validate_ready
  BEFORE INSERT OR UPDATE OF status ON cosmos_environment_revisions
  FOR EACH ROW EXECUTE FUNCTION cosmos_validate_ready_environment_revision();

CREATE FUNCTION cosmos_validate_environment_active_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cosmos_environment_revisions
    WHERE organization_id = NEW.organization_id
      AND space_id = NEW.space_id
      AND environment_id = NEW.id
      AND id = NEW.active_revision_id
      AND status = 'ready'
  ) THEN
    RAISE EXCEPTION 'active Environment revision % must be ready', NEW.active_revision_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_environments_validate_active_revision
  BEFORE INSERT OR UPDATE OF active_revision_id ON cosmos_environments
  FOR EACH ROW EXECUTE FUNCTION cosmos_validate_environment_active_revision();

CREATE FUNCTION cosmos_validate_expert_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND NOT EXISTS (
    SELECT 1
    FROM cosmos_environments environment
    JOIN cosmos_environment_revisions environment_revision
      ON environment_revision.organization_id = environment.organization_id
      AND environment_revision.space_id = environment.space_id
      AND environment_revision.environment_id = environment.id
      AND environment_revision.id = NEW.environment_revision_id
      AND environment_revision.status = 'ready'
    WHERE environment.organization_id = NEW.organization_id
      AND environment.space_id = NEW.space_id
      AND environment.id = NEW.environment_id
      AND environment.status = 'ready'
      AND environment.active_revision_id = environment_revision.id
  ) THEN
    RAISE EXCEPTION 'published Expert revision must reference the active ready Environment revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_expert_revisions_validate_environment
  BEFORE INSERT OR UPDATE OF status, environment_id, environment_revision_id
  ON cosmos_expert_revisions
  FOR EACH ROW EXECUTE FUNCTION cosmos_validate_expert_revision();

CREATE FUNCTION cosmos_validate_expert_published_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cosmos_expert_revisions
    WHERE organization_id = NEW.organization_id
      AND space_id = NEW.space_id
      AND expert_id = NEW.id
      AND id = NEW.published_revision_id
      AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'published Expert revision % must be published', NEW.published_revision_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_experts_validate_published_revision
  BEFORE INSERT OR UPDATE OF published_revision_id ON cosmos_experts
  FOR EACH ROW EXECUTE FUNCTION cosmos_validate_expert_published_revision();

ALTER TABLE cosmos_sessions
  ADD COLUMN expert_revision_id text,
  ADD COLUMN environment_revision_id text,
  ADD COLUMN repository_id text,
  ADD COLUMN configuration_resolution_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT cosmos_sessions_configuration_resolution_check CHECK (
    (
      configuration_resolution_version = 0
      AND expert_revision_id IS NULL
      AND environment_revision_id IS NULL
      AND repository_id IS NULL
    )
    OR
    (
      configuration_resolution_version = 1
      AND expert_revision_id IS NOT NULL
      AND environment_id IS NOT NULL
      AND environment_revision_id IS NOT NULL
      AND repository_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT cosmos_sessions_authoritative_expert_revision_fk
    FOREIGN KEY (
      organization_id,
      space_id,
      expert_id,
      expert_revision_id,
      environment_id,
      environment_revision_id
    )
    REFERENCES cosmos_expert_revisions (
      organization_id,
      space_id,
      expert_id,
      id,
      environment_id,
      environment_revision_id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT cosmos_sessions_authoritative_repository_fk
    FOREIGN KEY (
      organization_id,
      space_id,
      environment_id,
      environment_revision_id,
      repository_id
    )
    REFERENCES cosmos_environment_revision_repositories (
      organization_id,
      space_id,
      environment_id,
      environment_revision_id,
      repository_id
    )
    ON DELETE RESTRICT;

CREATE FUNCTION cosmos_validate_authoritative_session_configuration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_expert_name text;
  resolved_expert_version integer;
  resolved_repository text;
  resolved_base_branch text;
  repository_is_default boolean;
  repository_override_allowed boolean;
  base_branch_override_allowed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      NEW.organization_id,
      NEW.space_id,
      NEW.configuration_resolution_version,
      NEW.expert_id,
      NEW.expert_name,
      NEW.expert_version,
      NEW.expert_revision_id,
      NEW.environment_id,
      NEW.environment_revision_id,
      NEW.repository_id,
      NEW.repository,
      NEW.base_branch
    ) IS DISTINCT FROM ROW(
      OLD.organization_id,
      OLD.space_id,
      OLD.configuration_resolution_version,
      OLD.expert_id,
      OLD.expert_name,
      OLD.expert_version,
      OLD.expert_revision_id,
      OLD.environment_id,
      OLD.environment_revision_id,
      OLD.repository_id,
      OLD.repository,
      OLD.base_branch
    ) THEN
      RAISE EXCEPTION 'Session configuration is immutable after creation'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.configuration_resolution_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'new Sessions require authoritative configuration resolution'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    expert.name,
    expert_revision.revision,
    repository_binding.repository,
    repository_binding.base_branch,
    repository_binding.is_default,
    expert_revision.allow_repository_override,
    expert_revision.allow_base_branch_override
  INTO
    resolved_expert_name,
    resolved_expert_version,
    resolved_repository,
    resolved_base_branch,
    repository_is_default,
    repository_override_allowed,
    base_branch_override_allowed
  FROM cosmos_experts expert
  JOIN cosmos_expert_revisions expert_revision
    ON expert_revision.organization_id = expert.organization_id
    AND expert_revision.space_id = expert.space_id
    AND expert_revision.expert_id = expert.id
    AND expert_revision.id = NEW.expert_revision_id
    AND expert_revision.status = 'published'
  JOIN cosmos_environments environment
    ON environment.organization_id = expert_revision.organization_id
    AND environment.space_id = expert_revision.space_id
    AND environment.id = expert_revision.environment_id
    AND environment.status = 'ready'
    AND environment.active_revision_id = expert_revision.environment_revision_id
  JOIN cosmos_environment_revisions environment_revision
    ON environment_revision.organization_id = environment.organization_id
    AND environment_revision.space_id = environment.space_id
    AND environment_revision.environment_id = environment.id
    AND environment_revision.id = expert_revision.environment_revision_id
    AND environment_revision.status = 'ready'
  JOIN cosmos_environment_revision_repositories repository_binding
    ON repository_binding.organization_id = environment_revision.organization_id
    AND repository_binding.space_id = environment_revision.space_id
    AND repository_binding.environment_id = environment_revision.environment_id
    AND repository_binding.environment_revision_id = environment_revision.id
    AND repository_binding.repository_id = NEW.repository_id
  WHERE expert.organization_id = NEW.organization_id
    AND expert.space_id = NEW.space_id
    AND expert.id = NEW.expert_id
    AND expert.status = 'published'
    AND expert.published_revision_id = expert_revision.id
    AND expert_revision.environment_id = NEW.environment_id
    AND expert_revision.environment_revision_id = NEW.environment_revision_id
  FOR SHARE OF expert, environment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authoritative Session configuration must reference current final revisions'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.expert_name IS DISTINCT FROM resolved_expert_name
    OR NEW.expert_version IS DISTINCT FROM resolved_expert_version
    OR NEW.repository IS DISTINCT FROM resolved_repository THEN
    RAISE EXCEPTION 'authoritative Session configuration snapshot does not match its revisions'
      USING ERRCODE = '23514';
  END IF;

  IF NOT repository_override_allowed AND NOT repository_is_default THEN
    RAISE EXCEPTION 'Expert revision does not allow repository overrides'
      USING ERRCODE = '23514';
  END IF;

  IF NOT base_branch_override_allowed AND NEW.base_branch IS DISTINCT FROM resolved_base_branch THEN
    RAISE EXCEPTION 'Expert revision does not allow base branch overrides'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_sessions_validate_authoritative_configuration
  BEFORE INSERT OR UPDATE OF
    organization_id,
    space_id,
    configuration_resolution_version,
    expert_id,
    expert_name,
    expert_version,
    expert_revision_id,
    environment_id,
    environment_revision_id,
    repository_id,
    repository,
    base_branch
  ON cosmos_sessions
  FOR EACH ROW EXECUTE FUNCTION cosmos_validate_authoritative_session_configuration();

ALTER TABLE cosmos_sessions
  ALTER COLUMN configuration_resolution_version DROP DEFAULT;
