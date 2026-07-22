import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutomationStateConflictError } from './automation-repository.js'
import { runMigrations } from './migrations.js'
import { PostgresAutomationRepository } from './postgres-automation-repository.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Automation authority under the restricted API runtime role', () => {
  const schema = `relay_automation_${randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c role=relay_api_runtime -c search_path=${schema}`,
  })
  const repository = new PostgresAutomationRepository(apiPool)

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO relay_organizations (id, name) VALUES
        ('automation-org', 'Automation Organization'),
        ('automation-other', 'Other Organization');
      INSERT INTO relay_spaces (organization_id, id, name) VALUES
        ('automation-org', 'automation-space', 'Automation Space'),
        ('automation-other', 'automation-space', 'Other Space');
      INSERT INTO relay_organization_memberships (organization_id, actor_id, role) VALUES
        ('automation-org', 'automation-owner', 'organization_owner'),
        ('automation-org', 'automation-member', 'member'),
        ('automation-org', 'automation-service', 'member'),
        ('automation-other', 'other-owner', 'organization_owner');
      INSERT INTO relay_space_memberships (organization_id, space_id, actor_id, role) VALUES
        ('automation-org', 'automation-space', 'automation-owner', 'space_manager'),
        ('automation-org', 'automation-space', 'automation-member', 'member'),
        ('automation-org', 'automation-space', 'automation-service', 'member'),
        ('automation-other', 'automation-space', 'other-owner', 'space_manager');
      INSERT INTO relay_service_accounts (organization_id, id, audience, status)
      VALUES ('automation-org', 'automation-service', 'automation-test-audience', 'active');
      INSERT INTO relay_environments (
        organization_id, space_id, id, type, name, status, active_revision_id,
        latest_revision_id, created_by
      ) VALUES (
        'automation-org', 'automation-space', 'environment-ready', 'cloud',
        'Ready Environment', 'draft', NULL, NULL, 'automation-owner'
      );
      INSERT INTO relay_environment_revisions (
        organization_id, space_id, environment_id, id, revision, status,
        configuration, checksum, created_by
      ) VALUES (
        'automation-org', 'automation-space', 'environment-ready',
        'environment-revision-ready', 1, 'draft',
        '{"image":"ghcr.io/relay/runtime:test","variableReferences":[],"hooks":[],"networkPolicy":{"mode":"restricted","allowedHosts":[]},"sharing":"space","daemonPoolId":null}',
        repeat('a', 64), 'automation-owner'
      );
      INSERT INTO relay_environment_revision_repositories (
        organization_id, space_id, environment_id, environment_revision_id,
        repository_id, repository, base_branch, is_default
      ) VALUES (
        'automation-org', 'automation-space', 'environment-ready',
        'environment-revision-ready', 'repository-default', 'relay/platform', 'main', true
      );
      UPDATE relay_environment_revisions SET status = 'ready'
      WHERE organization_id = 'automation-org' AND id = 'environment-revision-ready';
      UPDATE relay_environments SET status = 'ready',
        active_revision_id = 'environment-revision-ready',
        latest_revision_id = 'environment-revision-ready'
      WHERE organization_id = 'automation-org' AND id = 'environment-ready';
      INSERT INTO relay_experts (
        organization_id, space_id, id, name, visibility, status, created_by
      ) VALUES (
        'automation-org', 'automation-space', 'expert-published',
        'Published Expert', 'space', 'draft', 'automation-owner'
      );
      INSERT INTO relay_expert_revisions (
        organization_id, space_id, expert_id, id, revision, status,
        environment_id, environment_revision_id, allow_repository_override,
        allow_base_branch_override, instructions, model, configuration, created_by
      ) VALUES (
        'automation-org', 'automation-space', 'expert-published',
        'expert-revision-published', 1, 'draft', 'environment-ready',
        'environment-revision-ready', false, false, 'Handle the event.',
        'gpt-5.6-sol', '{"capabilities":[],"launchGuidance":""}', 'automation-owner'
      );
      UPDATE relay_expert_revisions SET status = 'published'
      WHERE organization_id = 'automation-org' AND id = 'expert-revision-published';
      UPDATE relay_experts SET status = 'published', published_revision_id = 'expert-revision-published'
      WHERE organization_id = 'automation-org' AND id = 'expert-published';
      INSERT INTO relay_service_account_bindings (
        organization_id, space_id, service_account_id, id,
        scope, resource_type, resource_id
      ) VALUES (
        'automation-org', 'automation-space', 'automation-service', 'binding-create',
        'session.create', 'expert', 'expert-published'
      );
    `)
  })

  afterAll(async () => {
    await apiPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('creates an idempotent paused Trigger and rejects member mutation', async () => {
    const request = {
      expertId: 'expert-published',
      name: 'Pull request triage',
      source: 'github' as const,
      eventType: 'pull_request.opened',
      filter: { '==': [{ var: 'action' }, 'opened'] },
      autoArchive: false,
      serviceAccountId: 'automation-service',
    }
    const created = await repository.createAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-create', idempotencyKey: 'automation-create', request,
    })
    expect(created).toMatchObject({ replayed: false, automation: { status: 'paused', version: 1 } })
    await expect(repository.createAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-create-replay', idempotencyKey: 'automation-create', request,
    })).resolves.toMatchObject({ replayed: true, automation: { id: created.automation.id } })
    await expect(repository.createAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-member',
      requestId: 'request-member', idempotencyKey: 'automation-member-create',
      request: { ...request, name: 'Forbidden Trigger' },
    })).rejects.toMatchObject({ code: '42501' })
  })

  it('requires a successful test before enable and deduplicates matched Events', async () => {
    const [automation] = await repository.listAutomations('automation-org', 'automation-space', 'automation-owner')
    expect(automation).toBeDefined()
    await expect(repository.setAutomationStatus({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-early-enable', automationId: automation!.id,
      expectedVersion: automation!.version, idempotencyKey: 'early-enable', status: 'active',
    })).rejects.toBeInstanceOf(AutomationStateConflictError)
    const tested = await repository.testAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-test', automationId: automation!.id,
      expectedVersion: automation!.version, idempotencyKey: 'test-trigger',
      request: { eventType: 'pull_request.opened', payload: { action: 'opened' } },
    })
    expect(tested).toMatchObject({ matched: true, automation: { version: automation!.version + 1 } })
    const enabled = await repository.setAutomationStatus({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-enable', automationId: automation!.id,
      expectedVersion: tested!.automation.version, idempotencyKey: 'enable-trigger', status: 'active',
    })
    expect(enabled).toMatchObject({ automation: { status: 'active' } })
    const eventRecord = {
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-event',
      request: {
        source: 'github' as const,
        eventType: 'pull_request.opened',
        externalId: 'provider-event-1',
        headers: { authorization: 'Bearer hidden' },
        payload: { action: 'opened', nested: { token: 'hidden' } },
      },
    }
    const received = await repository.receiveEvent(eventRecord)
    expect(received).toMatchObject({
      duplicate: false,
      event: {
        status: 'matched',
        headers: { authorization: '[REDACTED]' },
        payload: { action: 'opened', nested: { token: '[REDACTED]' } },
      },
      match: { automation: { id: automation!.id }, serviceAccountAudience: 'automation-test-audience' },
    })
    await expect(repository.receiveEvent({ ...eventRecord, requestId: 'request-event-replay' }))
      .resolves.toMatchObject({ duplicate: true, event: { id: received.event.id }, match: null })
    const [current] = await repository.listAutomations('automation-org', 'automation-space', 'automation-owner')
    expect(current?.matchCount).toBe(1)
    await expect(repository.listEvents('automation-org', 'automation-space', 'automation-member'))
      .resolves.toEqual([])
  })
})
