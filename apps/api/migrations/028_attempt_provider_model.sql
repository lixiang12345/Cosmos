SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_attempts
  ADD COLUMN provider_model text,
  ADD CONSTRAINT relay_attempts_provider_model_check
  CHECK (
    provider_model IS NULL
    OR (
      btrim(provider_model) <> ''
      AND provider_model = btrim(provider_model)
      AND char_length(provider_model) <= 256
    )
  ) NOT VALID;
