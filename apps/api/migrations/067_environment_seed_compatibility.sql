SET LOCAL lock_timeout = '5s';

-- Older development fixtures predate the Environment lifecycle configuration
-- shape. Repair those final revisions as a migration concern, before the
-- application resumes enforcing immutable ready revisions.
ALTER TABLE cosmos_environment_revisions DISABLE TRIGGER cosmos_environment_revisions_protect_final;
UPDATE cosmos_environment_revisions
SET configuration = jsonb_build_object(
  'image', 'ghcr.io/cosmos/runtime:stable',
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
ALTER TABLE cosmos_environment_revisions ENABLE TRIGGER cosmos_environment_revisions_protect_final;
