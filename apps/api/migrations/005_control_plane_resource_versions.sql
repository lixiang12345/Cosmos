ALTER TABLE cosmos_experts
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE cosmos_environments
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE FUNCTION cosmos_increment_control_plane_resource_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cosmos_experts_increment_version
  BEFORE UPDATE ON cosmos_experts
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_control_plane_resource_version();

CREATE TRIGGER cosmos_environments_increment_version
  BEFORE UPDATE ON cosmos_environments
  FOR EACH ROW EXECUTE FUNCTION cosmos_increment_control_plane_resource_version();
