SET LOCAL lock_timeout = '5s';

GRANT SELECT ON cosmos_group_memberships, cosmos_session_share_grants
TO cosmos_worker_runtime;

DROP POLICY IF EXISTS cosmos_worker_select ON cosmos_group_memberships;
CREATE POLICY cosmos_worker_select ON cosmos_group_memberships
  FOR SELECT TO cosmos_worker_runtime USING (true);

DROP POLICY IF EXISTS cosmos_worker_select ON cosmos_session_share_grants;
CREATE POLICY cosmos_worker_select ON cosmos_session_share_grants
  FOR SELECT TO cosmos_worker_runtime USING (true);
