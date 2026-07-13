SET LOCAL lock_timeout = '5s';

CREATE TABLE relay_groups (
  organization_id text NOT NULL REFERENCES relay_organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE relay_group_memberships (
  organization_id text NOT NULL,
  group_id text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, group_id, actor_id),
  FOREIGN KEY (organization_id, group_id)
    REFERENCES relay_groups(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES relay_organization_memberships(organization_id, actor_id) ON DELETE CASCADE
);

CREATE INDEX relay_group_memberships_actor_idx
  ON relay_group_memberships (organization_id, actor_id, group_id);

CREATE TABLE relay_session_share_grants (
  organization_id text NOT NULL,
  space_id text NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'collaborator')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (organization_id, space_id, session_id, id),
  FOREIGN KEY (organization_id, space_id, session_id)
    REFERENCES relay_sessions(organization_id, space_id, id) ON DELETE RESTRICT,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX relay_session_share_grants_unrevoked_principal_idx
  ON relay_session_share_grants (
    organization_id, space_id, session_id, principal_type, principal_id
  )
  WHERE revoked_at IS NULL;

CREATE INDEX relay_session_share_grants_principal_access_idx
  ON relay_session_share_grants (
    organization_id, space_id, principal_type, principal_id, session_id
  )
  WHERE revoked_at IS NULL;

CREATE INDEX relay_session_share_grants_session_page_idx
  ON relay_session_share_grants (
    organization_id, space_id, session_id, created_at DESC, id DESC
  );

ALTER TABLE relay_audit_events
  DROP CONSTRAINT relay_audit_events_action_check,
  ADD CONSTRAINT relay_audit_events_action_check
    CHECK (action IN (
      'session.create',
      'session.start',
      'session.send',
      'session.rename',
      'session.archive',
      'session.restore',
      'session.pause',
      'session.resume',
      'session.cancel',
      'turn.retry',
      'session.share.create',
      'session.share.revoke'
    )) NOT VALID,
  DROP CONSTRAINT relay_audit_events_before_state_check,
  ADD CONSTRAINT relay_audit_events_before_state_check
    CHECK (
      (action IN ('session.create', 'session.share.create') AND before_state IS NULL)
      OR (
        action IN (
          'session.start',
          'session.send',
          'session.rename',
          'session.archive',
          'session.restore',
          'session.pause',
          'session.resume',
          'session.cancel',
          'turn.retry',
          'session.share.revoke'
        )
        AND before_state IS NOT NULL
        AND jsonb_typeof(before_state) = 'object'
      )
    ) NOT VALID,
  DROP CONSTRAINT relay_audit_events_target_type_check,
  ADD CONSTRAINT relay_audit_events_target_type_check
    CHECK (target_type IN ('session', 'turn', 'share_grant')) NOT VALID;

DO $$
BEGIN
  ALTER TABLE relay_audit_events DROP CONSTRAINT IF EXISTS relay_audit_events_target_check;
  ALTER TABLE relay_audit_events DROP CONSTRAINT IF EXISTS relay_audit_events_check;
END;
$$;

ALTER TABLE relay_audit_events
  ADD CONSTRAINT relay_audit_events_target_check
    CHECK (
      (action = 'turn.retry' AND target_type = 'turn')
      OR (
        action IN ('session.share.create', 'session.share.revoke')
        AND target_type = 'share_grant'
      )
      OR (
        action NOT IN ('turn.retry', 'session.share.create', 'session.share.revoke')
        AND target_type = 'session'
        AND target_id = session_id
      )
    ) NOT VALID;
