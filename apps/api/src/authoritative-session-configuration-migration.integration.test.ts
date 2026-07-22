import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

async function expectSqlState(query: Promise<unknown>, code: string) {
  await expect(query).rejects.toMatchObject({ code })
}

describeWithDatabase('004 authoritative Session configuration migration', () => {
  const schema = `cosmos_authoritative_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
  })

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)

    const migration001 = await readFile(resolve(migrationsDirectory, '001_sessions.sql'), 'utf8')
    await migrationPool.query(migration001)
    await migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, attachments, source,
        created_at, updated_at, last_activity_at, version
      ) VALUES (
        'legacy-session', 'legacy-org', 'legacy-space', 'Legacy Session', '',
        'legacy-expert', 'Legacy Expert', NULL, 'legacy/repository', 'main',
        'private', 'active', '[]'::jsonb, 'manual', now(), now(), now(), 1
      )
    `)

    for (const migration of [
      '002_identity_and_membership.sql',
      '003_session_execution_queue.sql',
      '004_authoritative_session_configuration.sql',
    ]) {
      await migrationPool.query(await readFile(resolve(migrationsDirectory, migration), 'utf8'))
    }

    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name)
      VALUES ('organization-a', 'Organization A'), ('organization-b', 'Organization B');

      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES
        ('organization-a', 'space-a', 'Space A'),
        ('organization-a', 'space-b', 'Space B'),
        ('organization-b', 'space-a', 'Space A');

      INSERT INTO cosmos_environments (
        organization_id, space_id, id, name, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'Environment A', 'test-actor'
      );

      INSERT INTO cosmos_environment_revisions (
        organization_id, space_id, environment_id, id, revision, status,
        configuration, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'environment-revision-a', 1,
        'draft', '{"image":"cosmos/test:1"}'::jsonb, 'test-actor'
      );

      INSERT INTO cosmos_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES
        (
          'organization-a', 'space-a', 'environment-a', 'environment-revision-a',
          'repository-a', 'cosmos/repository-a', 'main', true
        ),
        (
          'organization-a', 'space-a', 'environment-a', 'environment-revision-a',
          'repository-b', 'cosmos/repository-b', 'main', false
        );

      UPDATE cosmos_environment_revisions
      SET status = 'ready'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-a'
        AND id = 'environment-revision-a';

      UPDATE cosmos_environments
      SET status = 'ready', active_revision_id = 'environment-revision-a'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = 'environment-a';

      INSERT INTO cosmos_experts (
        organization_id, space_id, id, name, created_by
      ) VALUES (
        'organization-a', 'space-a', 'expert-a', 'Expert A', 'test-actor'
      );

      INSERT INTO cosmos_expert_revisions (
        organization_id, space_id, expert_id, id, revision, status,
        environment_id, environment_revision_id, allow_repository_override,
        allow_base_branch_override, instructions, model, created_by
      ) VALUES (
        'organization-a', 'space-a', 'expert-a', 'expert-revision-a', 1, 'draft',
        'environment-a', 'environment-revision-a', false, false,
        'Review the change.', 'cosmos-model', 'test-actor'
      );

      UPDATE cosmos_expert_revisions
      SET status = 'published'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND expert_id = 'expert-a'
        AND id = 'expert-revision-a';

      UPDATE cosmos_experts
      SET status = 'published', published_revision_id = 'expert-revision-a'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND id = 'expert-a';
    `)
  })

  afterAll(async () => {
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('upgrades 001 Sessions without inventing authoritative configuration', async () => {
    const result = await migrationPool.query<{
      id: string
      title: string
      expert_revision_id: string | null
      environment_revision_id: string | null
      repository_id: string | null
      configuration_resolution_version: number
    }>(`
      SELECT id, title, expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      FROM cosmos_sessions
      WHERE id = 'legacy-session'
    `)

    expect(result.rows).toEqual([{
      id: 'legacy-session',
      title: 'Legacy Session',
      expert_revision_id: null,
      environment_revision_id: null,
      repository_id: null,
      configuration_resolution_version: 0,
    }])

    const column = await migrationPool.query<{ column_default: string | null }>(`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'cosmos_sessions'
        AND column_name = 'configuration_resolution_version'
    `, [schema])
    expect(column.rows).toEqual([{ column_default: null }])

    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_sessions
      SET repository = 'changed/legacy-repository'
      WHERE id = 'legacy-session'
    `), '55000')
  })

  it('rejects cross-Space Environment and Expert revision references', async () => {
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_environment_revisions (
        organization_id, space_id, environment_id, id, revision, created_by
      ) VALUES (
        'organization-a', 'space-b', 'environment-a', 'cross-space-environment-revision',
        1, 'test-actor'
      )
    `), '23503')

    await migrationPool.query(`
      INSERT INTO cosmos_experts (organization_id, space_id, id, name, created_by)
      VALUES ('organization-a', 'space-b', 'expert-b', 'Expert B', 'test-actor')
    `)
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_expert_revisions (
        organization_id, space_id, expert_id, id, revision, environment_id,
        environment_revision_id, created_by
      ) VALUES (
        'organization-a', 'space-b', 'expert-b', 'cross-space-expert-revision', 1,
        'environment-a', 'environment-revision-a', 'test-actor'
      )
    `), '23503')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version, expert_revision_id,
        environment_revision_id, repository_id, configuration_resolution_version
      ) VALUES (
        'cross-space-session', 'organization-a', 'space-b', 'Cross Space', '',
        'expert-a', 'Expert A', 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `), '23514')
  })

  it('allows finalization once and makes final revisions and bindings immutable', async () => {
    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_environment_revisions
      SET configuration = '{"changed":true}'::jsonb
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-a'
        AND id = 'environment-revision-a'
    `), '55000')
    await expectSqlState(migrationPool.query(`
      DELETE FROM cosmos_environment_revisions
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-a'
        AND id = 'environment-revision-a'
    `), '55000')
    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_environment_revision_repositories
      SET base_branch = 'release'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-a'
        AND environment_revision_id = 'environment-revision-a'
        AND repository_id = 'repository-a'
    `), '55000')
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'environment-revision-a',
        'late-repository', 'cosmos/late-repository', 'main'
      )
    `), '55000')
    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_expert_revisions
      SET instructions = 'Changed instructions'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND expert_id = 'expert-a'
        AND id = 'expert-revision-a'
    `), '55000')
    await expectSqlState(migrationPool.query(`
      DELETE FROM cosmos_expert_revisions
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND expert_id = 'expert-a'
        AND id = 'expert-revision-a'
    `), '55000')

    await migrationPool.query(`
      INSERT INTO cosmos_environment_revisions (
        organization_id, space_id, environment_id, id, revision, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'environment-revision-inactive',
        2, 'test-actor'
      );
      INSERT INTO cosmos_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'environment-revision-inactive',
        'repository-inactive', 'cosmos/inactive', 'main', true
      );
      UPDATE cosmos_environment_revisions
      SET status = 'ready'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-a'
        AND id = 'environment-revision-inactive';
      INSERT INTO cosmos_expert_revisions (
        organization_id, space_id, expert_id, id, revision, environment_id,
        environment_revision_id, created_by
      ) VALUES (
        'organization-a', 'space-a', 'expert-a', 'expert-revision-inactive', 2,
        'environment-a', 'environment-revision-inactive', 'test-actor'
      )
    `)
    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_expert_revisions
      SET status = 'published'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND expert_id = 'expert-a'
        AND id = 'expert-revision-inactive'
    `), '23514')
  })

  it('rejects duplicate revision numbers and a second default repository', async () => {
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_environment_revisions (
        organization_id, space_id, environment_id, id, revision, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-a', 'duplicate-revision-number',
        1, 'test-actor'
      )
    `), '23505')
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_expert_revisions (
        organization_id, space_id, expert_id, id, revision, environment_id,
        environment_revision_id, created_by
      ) VALUES (
        'organization-a', 'space-a', 'expert-a', 'duplicate-expert-revision-number', 1,
        'environment-a', 'environment-revision-a', 'test-actor'
      )
    `), '23505')

    await migrationPool.query(`
      INSERT INTO cosmos_environments (
        organization_id, space_id, id, name, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-default-test',
        'Environment default test', 'test-actor'
      );
      INSERT INTO cosmos_environment_revisions (
        organization_id, space_id, environment_id, id, revision, created_by
      ) VALUES (
        'organization-a', 'space-a', 'environment-default-test',
        'environment-default-test-revision', 1, 'test-actor'
      )
    `)
    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_environment_revisions
      SET status = 'ready'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-default-test'
        AND id = 'environment-default-test-revision'
    `), '23514')
    await migrationPool.query(`
      INSERT INTO cosmos_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES (
        'organization-a', 'space-a', 'environment-default-test',
        'environment-default-test-revision', 'repository-default-one',
        'cosmos/default-one', 'main', true
      )
    `)
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES (
        'organization-a', 'space-a', 'environment-default-test',
        'environment-default-test-revision', 'repository-default-two',
        'cosmos/default-two', 'main', true
      )
    `), '23505')
    await expect(migrationPool.query(`
      UPDATE cosmos_environment_revisions
      SET status = 'ready'
      WHERE organization_id = 'organization-a'
        AND space_id = 'space-a'
        AND environment_id = 'environment-default-test'
        AND id = 'environment-default-test-revision'
    `)).resolves.toBeDefined()
  })

  it('requires complete and internally consistent authoritative Session references', async () => {
    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version,
        configuration_resolution_version
      ) VALUES (
        'explicit-unresolved-session', 'organization-a', 'space-a', 'Unresolved', '',
        'expert-a', 'Expert A', 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1, 0
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version
      ) VALUES (
        'new-unresolved-session', 'organization-a', 'space-a', 'Unresolved', '',
        'expert-a', 'Expert A', 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1
      )
    `), '23514')

    await expect(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status,
        attachments, source, created_by, created_at, updated_at, last_activity_at, version,
        expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      ) VALUES (
        'authoritative-session', 'organization-a', 'space-a', 'Authoritative Session', '',
        'expert-a', 'Expert A', 1, 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', '[]'::jsonb, 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `)).resolves.toBeDefined()

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status,
        source, created_by, created_at, updated_at, last_activity_at, version,
        expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      ) VALUES (
        'mismatched-snapshot-session', 'organization-a', 'space-a', 'Mismatch', '',
        'expert-a', 'Wrong Expert Name', 1, 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status,
        source, created_by, created_at, updated_at, last_activity_at, version,
        expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      ) VALUES (
        'mismatched-version-session', 'organization-a', 'space-a', 'Mismatch', '',
        'expert-a', 'Expert A', 2, 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status,
        source, created_by, created_at, updated_at, last_activity_at, version,
        expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      ) VALUES (
        'repository-override-session', 'organization-a', 'space-a', 'Override', '',
        'expert-a', 'Expert A', 1, 'environment-a', 'cosmos/repository-b', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-b', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status,
        source, created_by, created_at, updated_at, last_activity_at, version,
        expert_revision_id, environment_revision_id, repository_id,
        configuration_resolution_version
      ) VALUES (
        'branch-override-session', 'organization-a', 'space-a', 'Override', '',
        'expert-a', 'Expert A', 1, 'environment-a', 'cosmos/repository-a', 'feature',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version, expert_revision_id,
        environment_revision_id, configuration_resolution_version
      ) VALUES (
        'partial-authoritative-session', 'organization-a', 'space-a', 'Partial', '',
        'expert-a', 'Expert A', 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        expert_version, environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version, expert_revision_id,
        environment_revision_id, repository_id, configuration_resolution_version
      ) VALUES (
        'wrong-repository-session', 'organization-a', 'space-a', 'Wrong repository', '',
        'expert-a', 'Expert A', 1, 'environment-a', 'cosmos/other', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 'environment-revision-a', 'repository-a', 1
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      INSERT INTO cosmos_sessions (
        id, organization_id, space_id, title, summary, expert_id, expert_name,
        environment_id, repository, base_branch, visibility, status, source, created_by,
        created_at, updated_at, last_activity_at, version, expert_revision_id,
        configuration_resolution_version
      ) VALUES (
        'resolved-id-on-legacy-session', 'organization-a', 'space-a', 'Invalid legacy', '',
        'expert-a', 'Expert A', 'environment-a', 'cosmos/repository-a', 'main',
        'private', 'queued', 'manual', 'test-actor', now(), now(), now(), 1,
        'expert-revision-a', 0
      )
    `), '23514')

    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_sessions
      SET repository_id = 'repository-b', repository = 'cosmos/repository-b'
      WHERE id = 'authoritative-session'
    `), '55000')

    await expectSqlState(migrationPool.query(`
      UPDATE cosmos_sessions
      SET configuration_resolution_version = 0,
        expert_revision_id = NULL,
        environment_revision_id = NULL,
        repository_id = NULL
      WHERE id = 'authoritative-session'
    `), '55000')
  })
})
