SET LOCAL lock_timeout = '5s';

GRANT SELECT ON relay_group_memberships, relay_session_share_grants
TO relay_worker_runtime;

DROP POLICY IF EXISTS relay_worker_select ON relay_group_memberships;
CREATE POLICY relay_worker_select ON relay_group_memberships
  FOR SELECT TO relay_worker_runtime USING (true);

DROP POLICY IF EXISTS relay_worker_select ON relay_session_share_grants;
CREATE POLICY relay_worker_select ON relay_session_share_grants
  FOR SELECT TO relay_worker_runtime USING (true);
