ALTER TABLE relay_file_versions
  ADD COLUMN storage_backend text NOT NULL DEFAULT 'inline',
  ADD COLUMN object_key text;

ALTER TABLE relay_file_versions
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE relay_file_versions
  ADD CONSTRAINT relay_file_versions_storage_backend_check
  CHECK (storage_backend IN ('inline', 'object')),
  ADD CONSTRAINT relay_file_versions_storage_location_check
  CHECK (
    (storage_backend = 'inline' AND content IS NOT NULL AND object_key IS NULL)
    OR (storage_backend = 'object' AND content IS NULL AND object_key IS NOT NULL)
  );

COMMENT ON COLUMN relay_file_versions.storage_backend IS
  'Content location: inline is legacy/development compatibility; object is production object storage.';
COMMENT ON COLUMN relay_file_versions.object_key IS
  'Opaque object-storage key. It never contains the customer file path.';
