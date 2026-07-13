SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_attempts
  VALIDATE CONSTRAINT relay_attempts_provider_model_check;
