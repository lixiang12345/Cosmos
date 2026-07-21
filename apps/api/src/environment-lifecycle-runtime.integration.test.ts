import type { CreateEnvironmentRequest } from '@relay/contracts'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EnvironmentIdempotencyConflictError } from './configuration-catalog-repository.js'
import { UnavailableEnvironmentProvisioner } from './environment-provisioning-repository.js'
import { EnvironmentProvisioningWorker } from './environment-provisioning-worker.js'
import { runMigrations } from './migrations.js'
import { PostgresConfigurationCatalogRepository } from './postgres-configuration-catalog-repository.js'
import { PostgresEnvironmentProvisioningRepository } from './postgres-environment-provisioning-repository.js'
import { withApiDatabaseContext } from './postgres-runtime-database.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

const createRequest: CreateEnvironmentRequest = {
  type: 'cloud',
  name: 'Release runtime',
  description: 'Isolated release engineering runtime.',
  visibility: 'space',
  image: 'ghcr.io/relay/release-runtime:2026.07',
  repositoryBindings: [{
    repositoryId: 'repository-release',
    repository: 'relay/release',
    baseBranch: 'main',
    isDefault: true,
  }],
  variableReferences: [{ name: 'RELEASE_TOKEN', secretId: 'secret-release-token' }],
  hooks: [{ phase: 'setup', command: 'pnpm install --frozen-lockfile', timeoutSeconds: 600 }],
  networkPolicy: { mode: 'allowlist', allowedHosts: ['registry.npmjs.org'] },
  sharing: 'space',
  daemonPoolId: null,
}

describeWithDatabase('Environment lifecycle under restricted runtime roles', () => {
  const schema = `relay_environment_lifecycle_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_worker_runtime -c search_path=${schema}`,
  })
  const repository = new PostgresConfigurationCatalogRepository(apiPool)
  const provisioningRepository = new PostgresEnvironmentProvisioningRepository(workerPool)
  let environmentId = ''
  let version = 1

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('environment-org-a', 'Environment Organization A'),
        ('environment-org-b', 'Environment Organization B');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('environment-org-a', 'environment-space', 'Environment Space'),
        ('environment-org-b', 'environment-space', 'Other Environment Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('environment-org-a', 'environment-owner', 'organization_owner'),
        ('environment-org-a', 'environment-member', 'member'),
        ('environment-org-b', 'environment-b-owner', 'organization_owner');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('environment-org-a', 'environment-space', 'environment-owner', 'space_manager'),
        ('environment-org-a', 'environment-space', 'environment-member', 'member'),
        ('environment-org-b', 'environment-space', 'environment-b-owner', 'space_manager');
    `)
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('creates one idempotent revision/job and rejects manager bypass or key reuse', async () => {
    const created = await repository.createEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      actorId: 'environment-owner',
      idempotencyKey: 'create-release-runtime',
      request: createRequest,
    })
    environmentId = created.environment.id
    version = created.environment.version
    expect(created).toMatchObject({
      replayed: false,
      environment: {
        type: 'cloud',
        status: 'provisioning',
        activeRevision: null,
        latestRevision: { revision: 1, status: 'provisioning' },
        provisioning: { phase: 'queued', progress: 0 },
      },
    })

    await expect(repository.createEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      actorId: 'environment-owner',
      idempotencyKey: 'create-release-runtime',
      request: createRequest,
    })).resolves.toMatchObject({ replayed: true, environment: { id: environmentId } })

    await expect(repository.createEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      actorId: 'environment-owner',
      idempotencyKey: 'create-release-runtime',
      request: { ...createRequest, name: 'Different request' },
    })).rejects.toBeInstanceOf(EnvironmentIdempotencyConflictError)

    await expect(repository.createEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      actorId: 'environment-member',
      idempotencyKey: 'member-create-runtime',
      request: { ...createRequest, name: 'Forbidden runtime' },
    })).rejects.toMatchObject({ code: '42501' })

    await expect(withApiDatabaseContext(
      apiPool,
      { organizationId: 'environment-org-a', spaceId: 'environment-space', actorId: 'environment-member' },
      (client) => client.query(`
        INSERT INTO relay_environment_revisions (
          organization_id, space_id, environment_id, id, revision, status,
          configuration, checksum, created_by
        ) VALUES (
          'environment-org-a', 'environment-space', $1, 'forbidden-child-revision', 99,
          'provisioning', '{}'::jsonb, $2, 'environment-member'
        )
      `, [environmentId, '0'.repeat(64)]),
    )).rejects.toMatchObject({ code: '42501' })
  })

  it('records unavailable safely, retries, and promotes only a successful fenced job', async () => {
    const unavailableWorker = new EnvironmentProvisioningWorker({
      repository: provisioningRepository,
      provisioner: new UnavailableEnvironmentProvisioner(),
      workerId: 'environment-worker-1',
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 5_000,
      pollIntervalMs: 10,
      recoveryBatchSize: 10,
    })
    await unavailableWorker.runOnce()
    const failed = await repository.getEnvironment(
      'environment-org-a', 'environment-space', environmentId, 'environment-owner',
    )
    expect(failed).toMatchObject({
      status: 'failed',
      activeRevision: null,
      latestRevision: { status: 'failed' },
      provisioning: {
        phase: 'failed',
        error: { code: 'cloud_provisioner_unavailable', retryable: false },
      },
    })
    version = failed!.version

    const retried = await repository.retryEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      environmentId,
      actorId: 'environment-owner',
      expectedVersion: version,
      idempotencyKey: 'retry-release-runtime',
    })
    expect(retried).toMatchObject({ environment: { status: 'provisioning' } })

    const readyWorker = new EnvironmentProvisioningWorker({
      repository: provisioningRepository,
      provisioner: { provision: async () => undefined },
      workerId: 'environment-worker-2',
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 5_000,
      pollIntervalMs: 10,
      recoveryBatchSize: 10,
    })
    await readyWorker.runOnce()
    const ready = await repository.getEnvironment(
      'environment-org-a', 'environment-space', environmentId, 'environment-owner',
    )
    expect(ready).toMatchObject({
      status: 'ready',
      activeRevisionId: ready?.latestRevision.id,
      activeRevision: { status: 'ready' },
      latestRevision: { status: 'ready' },
    })
    version = ready!.version
  })

  it('creates and promotes a second immutable revision without cross-tenant visibility', async () => {
    const updated = await repository.updateEnvironment({
      organizationId: 'environment-org-a',
      spaceId: 'environment-space',
      environmentId,
      actorId: 'environment-owner',
      expectedVersion: version,
      idempotencyKey: 'update-release-runtime',
      request: { image: 'ghcr.io/relay/release-runtime:2026.08' },
    })
    expect(updated).toMatchObject({
      environment: {
        status: 'updating',
        activeRevision: { revision: 1, status: 'ready' },
        latestRevision: { revision: 2, status: 'provisioning' },
      },
    })

    const worker = new EnvironmentProvisioningWorker({
      repository: provisioningRepository,
      provisioner: { provision: async () => undefined },
      workerId: 'environment-worker-3',
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 5_000,
      pollIntervalMs: 10,
      recoveryBatchSize: 10,
    })
    await worker.runOnce()
    const ready = await repository.getEnvironment(
      'environment-org-a', 'environment-space', environmentId, 'environment-owner',
    )
    expect(ready).toMatchObject({
      status: 'ready',
      activeRevision: { revision: 2, image: 'ghcr.io/relay/release-runtime:2026.08' },
    })

    const revisions = await repository.listEnvironmentRevisions(
      'environment-org-a', 'environment-space', environmentId, 'environment-owner',
    )
    expect(revisions?.map((revision) => [revision.revision, revision.status])).toEqual([
      [2, 'ready'], [1, 'ready'],
    ])
    await expect(withApiDatabaseContext(
      apiPool,
      { organizationId: 'environment-org-a', spaceId: 'environment-space', actorId: 'environment-owner' },
      (client) => client.query(`
        UPDATE relay_environment_revisions SET status = 'failed'
        WHERE environment_id = $1 AND revision = 1
      `, [environmentId]),
    )).rejects.toMatchObject({ code: '55000' })
    await expect(repository.getEnvironment(
      'environment-org-b', 'environment-space', environmentId, 'environment-b-owner',
    )).resolves.toBeNull()

    const evidence = await migrationPool.query<{ audits: number; jobs: number; plaintext_secrets: number }>(`
      SELECT
        (SELECT count(*)::integer FROM relay_environment_audit_events WHERE environment_id = $1) AS audits,
        (SELECT count(*)::integer FROM relay_environment_provisioning_jobs WHERE environment_id = $1) AS jobs,
        (SELECT count(*)::integer FROM relay_environment_revisions
          WHERE environment_id = $1 AND configuration::text LIKE '%plaintext%') AS plaintext_secrets
    `, [environmentId])
    expect(evidence.rows[0]).toMatchObject({ audits: 6, jobs: 3, plaintext_secrets: 0 })
  })
})
