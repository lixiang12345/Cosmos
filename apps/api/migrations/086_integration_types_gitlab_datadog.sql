SET LOCAL lock_timeout = '5s';

-- Widen the Integration type set with GitLab and Datadog, matching the
-- documented partner surface (gitlab-cloud / datadog docs pages).
ALTER TABLE cosmos_integrations DROP CONSTRAINT cosmos_integrations_type_check;
ALTER TABLE cosmos_integrations ADD CONSTRAINT cosmos_integrations_type_check
  CHECK (type IN ('github', 'gitlab', 'slack', 'jira', 'pagerduty', 'linear', 'datadog', 'custom'));
