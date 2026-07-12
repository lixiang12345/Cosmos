import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { assertMigrationsCurrent } from './migrations.js'

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

  it('rejects a database with pending migrations', async () => {
    await expect(assertMigrationsCurrent(poolWithVersions(migrationVersions.slice(0, -1))))
      .rejects.toThrow('1 pending migration')
  })

  it('rejects a database without migration metadata', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('relay_schema_migrations does not exist')),
    } as unknown as Pool
    await expect(assertMigrationsCurrent(pool)).rejects.toThrow('does not exist')
  })
})
