ALTER TABLE relay_experts
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE relay_environments
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE FUNCTION relay_increment_control_plane_resource_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_experts_increment_version
  BEFORE UPDATE ON relay_experts
  FOR EACH ROW EXECUTE FUNCTION relay_increment_control_plane_resource_version();

CREATE TRIGGER relay_environments_increment_version
  BEFORE UPDATE ON relay_environments
  FOR EACH ROW EXECUTE FUNCTION relay_increment_control_plane_resource_version();
