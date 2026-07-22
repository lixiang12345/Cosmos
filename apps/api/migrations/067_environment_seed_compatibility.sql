SET LOCAL lock_timeout = '5s';

-- Older development fixtures predate the Environment lifecycle configuration
-- shape. Repair those final revisions as a migration concern, before the
-- application resumes enforcing immutable ready revisions.
ALTER TABLE relay_environment_revisions DISABLE TRIGGER relay_environment_revisions_protect_final;
UPDATE relay_environment_revisions
SET configuration = jsonb_build_object(
  'image', 'ghcr.io/relay/runtime:stable',
  'variableReferences', '[]'::jsonb,
  'hooks', '[]'::jsonb,
  'networkPolicy', jsonb_build_object('mode', 'restricted', 'allowedHosts', '[]'::jsonb),
  'sharing', 'space',
  'daemonPoolId', NULL
) || configuration
WHERE status = 'ready'
  AND (
    NOT (configuration ? 'image')
    OR NOT (configuration ? 'variableReferences')
    OR NOT (configuration ? 'networkPolicy')
  );
ALTER TABLE relay_environment_revisions ENABLE TRIGGER relay_environment_revisions_protect_final;
