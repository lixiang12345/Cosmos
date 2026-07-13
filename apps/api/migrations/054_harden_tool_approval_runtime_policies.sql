SET LOCAL lock_timeout = '5s';

GRANT SELECT ON relay_service_accounts TO relay_worker_runtime;
DROP POLICY IF EXISTS relay_worker_select ON relay_service_accounts;
CREATE POLICY relay_worker_select ON relay_service_accounts
  FOR SELECT TO relay_worker_runtime USING (true);

DROP POLICY IF EXISTS relay_api_tenant_select ON relay_approvals;
CREATE POLICY relay_api_tenant_select ON relay_approvals FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships actor_organization
      WHERE actor_organization.organization_id = relay_approvals.organization_id
        AND actor_organization.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships actor_space
      WHERE actor_space.organization_id = relay_approvals.organization_id
        AND actor_space.space_id = relay_approvals.space_id
        AND actor_space.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND (
      EXISTS (
        SELECT 1 FROM relay_approval_assignments assignment
        WHERE assignment.organization_id = relay_approvals.organization_id
          AND assignment.space_id = relay_approvals.space_id
          AND assignment.approval_id = relay_approvals.id
          AND assignment.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
      )
      OR EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.space_id = relay_approvals.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  );

DROP POLICY IF EXISTS relay_api_tenant_update ON relay_approvals;
CREATE POLICY relay_api_tenant_update ON relay_approvals FOR UPDATE TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND requested_by <> NULLIF(current_setting('relay.actor_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_organization_memberships actor_organization
      WHERE actor_organization.organization_id = relay_approvals.organization_id
        AND actor_organization.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM relay_space_memberships actor_space
      WHERE actor_space.organization_id = relay_approvals.organization_id
        AND actor_space.space_id = relay_approvals.space_id
        AND actor_space.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    )
    AND (
      EXISTS (
        SELECT 1 FROM relay_approval_assignments assignment
        WHERE assignment.organization_id = relay_approvals.organization_id
          AND assignment.space_id = relay_approvals.space_id
          AND assignment.approval_id = relay_approvals.id
          AND assignment.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
      )
      OR EXISTS (
        SELECT 1 FROM relay_organization_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role IN ('organization_owner', 'organization_admin')
      )
      OR EXISTS (
        SELECT 1 FROM relay_space_memberships membership
        WHERE membership.organization_id = relay_approvals.organization_id
          AND membership.space_id = relay_approvals.space_id
          AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          AND membership.role = 'space_manager'
      )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND requested_by <> NULLIF(current_setting('relay.actor_id', true), '')
  );

DROP POLICY IF EXISTS relay_api_tenant_update ON relay_tool_calls;
CREATE POLICY relay_api_tenant_update ON relay_tool_calls FOR UPDATE TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND status = 'approval_required'
    AND approval_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM relay_approvals gated_approval
      WHERE gated_approval.organization_id = relay_tool_calls.organization_id
        AND gated_approval.space_id = relay_tool_calls.space_id
        AND gated_approval.id = relay_tool_calls.approval_id
        AND gated_approval.tool_call_id = relay_tool_calls.id
        AND gated_approval.input_hash = relay_tool_calls.input_hash
        AND gated_approval.requested_by <> NULLIF(current_setting('relay.actor_id', true), '')
        AND (
          EXISTS (
            SELECT 1 FROM relay_approval_assignments assignment
            WHERE assignment.organization_id = gated_approval.organization_id
              AND assignment.space_id = gated_approval.space_id
              AND assignment.approval_id = gated_approval.id
              AND assignment.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
          )
          OR EXISTS (
            SELECT 1 FROM relay_organization_memberships membership
            WHERE membership.organization_id = gated_approval.organization_id
              AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
              AND membership.role IN ('organization_owner', 'organization_admin')
          )
          OR EXISTS (
            SELECT 1 FROM relay_space_memberships membership
            WHERE membership.organization_id = gated_approval.organization_id
              AND membership.space_id = gated_approval.space_id
              AND membership.actor_id = NULLIF(current_setting('relay.actor_id', true), '')
              AND membership.role = 'space_manager'
          )
        )
    )
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
  );

DROP POLICY IF EXISTS relay_api_tenant_insert ON relay_approval_decisions;
CREATE POLICY relay_api_tenant_insert ON relay_approval_decisions FOR INSERT TO relay_api_runtime
  WITH CHECK (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND actor_id = NULLIF(current_setting('relay.actor_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_approvals visible_approval
      WHERE visible_approval.organization_id = relay_approval_decisions.organization_id
        AND visible_approval.space_id = relay_approval_decisions.space_id
        AND visible_approval.id = relay_approval_decisions.approval_id
        AND visible_approval.requested_by <> relay_approval_decisions.actor_id
    )
  );

DROP POLICY IF EXISTS relay_api_tenant_select ON relay_approval_decisions;
CREATE POLICY relay_api_tenant_select ON relay_approval_decisions FOR SELECT TO relay_api_runtime
  USING (
    organization_id = NULLIF(current_setting('relay.organization_id', true), '')
    AND space_id = NULLIF(current_setting('relay.space_id', true), '')
    AND EXISTS (
      SELECT 1 FROM relay_approvals visible_approval
      WHERE visible_approval.organization_id = relay_approval_decisions.organization_id
        AND visible_approval.space_id = relay_approval_decisions.space_id
        AND visible_approval.id = relay_approval_decisions.approval_id
    )
  );

