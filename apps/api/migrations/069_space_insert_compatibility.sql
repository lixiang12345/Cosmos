SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION relay_apply_space_insert_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := CASE
      WHEN btrim(lower(regexp_replace(NEW.id, '[^a-z0-9]+', '-', 'g')), '-') <> ''
        THEN btrim(lower(regexp_replace(NEW.id, '[^a-z0-9]+', '-', 'g')), '-')
      ELSE 'space-' || substr(md5(NEW.id), 1, 8)
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relay_spaces_apply_insert_defaults ON relay_spaces;
CREATE TRIGGER relay_spaces_apply_insert_defaults
  BEFORE INSERT ON relay_spaces
  FOR EACH ROW EXECUTE FUNCTION relay_apply_space_insert_defaults();
