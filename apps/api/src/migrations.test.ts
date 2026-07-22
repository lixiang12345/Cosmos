import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { assertMigrationsCurrent, runMigrations } from './migrations.js'

const migrationVersions = [
  '001_sessions.sql',
  '002_identity_and_membership.sql',
  '003_session_execution_queue.sql',
  '004_authoritative_session_configuration.sql',
  '005_control_plane_resource_versions.sql',
  '006_expert_catalog_index.sql',
  '007_environment_catalog_index.sql',
  '008_tenant_reference_integrity.sql',
  '009_session_tenant_identity.sql',
  '010_turn_tenant_identity.sql',
  '011_command_tenant_identity.sql',
  '012_tenant_reference_constraints.sql',
  '013_validate_tenant_references.sql',
  '014_session_audit_ledgers.sql',
  '015_validate_session_audit_ledgers.sql',
  '016_session_execution_runtime.sql',
  '017_attempt_tenant_identity.sql',
  '018_attempt_turn_number.sql',
  '019_attempt_one_nonterminal.sql',
  '020_command_protocol1_claim.sql',
  '021_session_execution_constraints.sql',
  '022_validate_session_execution_state.sql',
  '023_validate_session_execution_references.sql',
  '024_execution_lifecycle_forward_repair.sql',
  '025_validate_execution_lifecycle_forward_repair.sql',
  '026_session_updated_events.sql',
  '027_validate_session_updated_events.sql',
  '028_attempt_provider_model.sql',
  '029_validate_attempt_provider_model.sql',
  '030_worker_heartbeats.sql',
  '031_session_start_audit.sql',
  '032_validate_session_start_audit.sql',
  '033_remove_legacy_session_event_shape.sql',
  '034_session_send_audit.sql',
  '035_validate_session_send_audit.sql',
  '036_session_archival_and_list_indexes.sql',
  '037_session_visible_activity_index.sql',
  '038_session_archived_activity_index.sql',
  '039_session_metadata_lifecycle_ledgers.sql',
  '040_validate_session_metadata_lifecycle_ledgers.sql',
  '041_session_execution_controls.sql',
  '042_validate_session_execution_controls.sql',
  '043_session_share_grants.sql',
  '044_validate_session_share_grants.sql',
  '045_service_account_session_scopes.sql',
  '046_runtime_roles_and_tenant_rls.sql',
  '047_harden_runtime_rls_policies.sql',
  '048_session_artifacts.sql',
  '049_validate_session_artifacts.sql',
  '050_scoped_files.sql',
  '051_validate_scoped_files.sql',
  '052_tool_calls_and_approvals.sql',
  '053_validate_tool_calls_and_approvals.sql',
  '054_harden_tool_approval_runtime_policies.sql',
  '055_session_workers.sql',
  '056_validate_session_workers.sql',
  '057_worker_workspace_file_reads.sql',
  '058_validate_worker_workspace_file_reads.sql',
  '059_security_failure_audit.sql',
  '060_expert_lifecycle.sql',
  '061_expert_runtime_lock_guard.sql',
  '062_environment_lifecycle.sql',
  '063_environment_lifecycle_compatibility.sql',
  '064_environment_manager_rls.sql',
  '065_environment_child_manager_rls.sql',
  '066_automation_authority.sql',
  '067_environment_seed_compatibility.sql',
  '068_space_authority.sql',
  '069_space_insert_compatibility.sql',
  '070_advisor_controlled_execution.sql',
]

function poolWithVersions(versions: string[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows: versions.map((version) => ({ version })) }),
  } as unknown as Pool
}

describe('migration readiness', () => {
  it('accepts a database with every repository migration applied', async () => {
    await expect(assertMigrationsCurrent(poolWithVersions(migrationVersions))).resolves.toBeUndefined()
  })

  it('accepts the two known pre-release migration history entries', async () => {
    await expect(assertMigrationsCurrent(poolWithVersions([
      ...migrationVersions,
      '010_tenant_reference_constraints.sql',
      '011_session_audit_ledgers.sql',
    ]))).resolves.toBeUndefined()
  })

  it('rejects a database with pending migrations', async () => {
    await expect(assertMigrationsCurrent(poolWithVersions(migrationVersions.slice(0, -1))))
      .rejects.toThrow('1 pending migration')
  })

  it('rejects migration history that diverges from the immutable repository set', async () => {
    await expect(assertMigrationsCurrent(poolWithVersions([
      ...migrationVersions,
      '059_replaced_history.sql',
    ]))).rejects.toThrow('1 unknown migration')
  })

  it('rejects a database without migration metadata', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('relay_schema_migrations does not exist')),
    } as unknown as Pool
    await expect(assertMigrationsCurrent(pool)).rejects.toThrow('does not exist')
  })

  it('bounds and resets lock waits while rebuilding an orphaned concurrent index', async () => {
    const applied = new Set(migrationVersions)
    applied.delete('017_attempt_tenant_identity.sql')
    const client = {
      query: vi.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql === 'SELECT version FROM relay_schema_migrations WHERE version = $1') {
          return { rowCount: applied.has(String(parameters?.[0])) ? 1 : 0, rows: [] }
        }
        return { rowCount: 1, rows: [] }
      }),
      release: vi.fn(),
    }
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool

    await runMigrations(pool)

    const statements = client.query.mock.calls.map(([sql]) => sql)
    const lockIndex = statements.indexOf("SET lock_timeout = '5s'")
    const dropIndex = statements.indexOf(
      'DROP INDEX CONCURRENTLY IF EXISTS "relay_attempts_tenant_identity_unique"',
    )
    const createIndex = statements.findIndex((sql) => (
      typeof sql === 'string' && sql.includes('CREATE UNIQUE INDEX CONCURRENTLY relay_attempts_tenant_identity_unique')
    ))
    const resetIndex = statements.indexOf('RESET lock_timeout')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(dropIndex).toBeGreaterThan(lockIndex)
    expect(createIndex).toBeGreaterThan(dropIndex)
    expect(resetIndex).toBeGreaterThan(createIndex)
    expect(client.release).toHaveBeenCalledOnce()
  })
})
