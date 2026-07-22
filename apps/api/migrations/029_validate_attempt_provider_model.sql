SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_attempts
  VALIDATE CONSTRAINT cosmos_attempts_provider_model_check;
