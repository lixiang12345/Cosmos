import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AutomationStateConflictError } from './automation-repository.js'
import { runMigrations } from './migrations.js'
import { PostgresAutomationRepository } from './postgres-automation-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'

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
      autoArchive: true,
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
    const session = await new PostgresSessionRepository(apiPool).create({
      organizationId: 'automation-org', spaceId: 'automation-space',
      actorId: 'automation-service', actorKind: 'service_account',
      actorAudience: 'automation-test-audience', requestId: 'request-dispatch-session',
      idempotencyKey: `automation-event:${received.event.id}`,
      source: 'automation', automationAutoArchive: received.match!.automation.autoArchive,
      request: {
        expertId: 'expert-published', title: 'Automation Session', visibility: 'space', start: true,
        message: { content: 'Handle the matched Automation Event.', attachments: [] },
      },
    })
    await expect(repository.completeDispatch({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-dispatch-complete', eventId: received.event.id, sessionId: session.session.id,
    })).resolves.toMatchObject({ status: 'dispatched', sessionId: session.session.id })
    await expect(repository.listRuns('automation-org', 'automation-space', 'automation-owner'))
      .resolves.toEqual([expect.objectContaining({
        automationId: automation!.id,
        eventId: received.event.id,
        autoArchive: true,
        autoArchivedAt: null,
        session: expect.objectContaining({ id: session.session.id, source: 'automation' }),
      })])
    const [current] = await repository.listAutomations('automation-org', 'automation-space', 'automation-owner')
    expect(current?.matchCount).toBe(1)
    await expect(repository.listEvents('automation-org', 'automation-space', 'automation-member'))
      .resolves.toEqual([])
  })

  it('archives a Trigger idempotently, stops matching, and protects the terminal row', async () => {
    const created = await repository.createAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-create-archive', idempotencyKey: 'automation-create-archive',
      request: {
        expertId: 'expert-published', name: 'Slack archive lifecycle', source: 'slack',
        eventType: 'message.posted', filter: { '==': [{ var: 'channel' }, 'platform'] },
        autoArchive: false, serviceAccountId: 'automation-service',
      },
    })
    const tested = await repository.testAutomation({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-test-archive', automationId: created.automation.id,
      expectedVersion: created.automation.version, idempotencyKey: 'automation-test-archive',
      request: { payload: { channel: 'platform' } },
    })
    const enabled = await repository.setAutomationStatus({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-enable-archive', automationId: created.automation.id,
      expectedVersion: tested!.automation.version, idempotencyKey: 'automation-enable-archive',
      status: 'active',
    })
    const archiveRecord = {
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-archive', automationId: created.automation.id,
      expectedVersion: enabled!.automation.version, idempotencyKey: 'automation-archive',
    }
    const archived = await repository.archiveAutomation(archiveRecord)
    expect(archived).toMatchObject({
      replayed: false,
      automation: { status: 'archived', version: enabled!.automation.version + 1 },
    })
    expect(archived!.automation.archivedAt).toBe(archived!.automation.updatedAt)
    await expect(repository.archiveAutomation({ ...archiveRecord, requestId: 'request-archive-replay' }))
      .resolves.toMatchObject({ replayed: true, automation: { id: created.automation.id, status: 'archived' } })

    const ignored = await repository.receiveEvent({
      organizationId: 'automation-org', spaceId: 'automation-space', actorId: 'automation-owner',
      requestId: 'request-event-after-archive',
      request: {
        source: 'slack', eventType: 'message.posted', externalId: 'provider-event-after-archive',
        headers: {}, payload: { channel: 'platform' },
      },
    })
    expect(ignored).toMatchObject({ duplicate: false, event: { status: 'ignored', automationId: null }, match: null })

    const facts = await migrationPool.query<{ audits: string; outbox: string }>(`
      SELECT
        (SELECT count(*) FROM relay_automation_audit_events
          WHERE automation_id = $1 AND action = 'automation.archive')::text AS audits,
        (SELECT count(*) FROM relay_automation_outbox_events
          WHERE automation_id = $1 AND event_type = 'automation.archived')::text AS outbox
    `, [created.automation.id])
    expect(facts.rows[0]).toEqual({ audits: '1', outbox: '1' })

    await expect(repository.updateAutomation({
      ...archiveRecord, requestId: 'request-update-archived',
      expectedVersion: archived!.automation.version, idempotencyKey: 'automation-update-archived',
      request: { name: 'Forbidden rename' },
    })).rejects.toBeInstanceOf(AutomationStateConflictError)
    await expect(migrationPool.query(
      'UPDATE relay_expert_triggers SET name = name || \' changed\' WHERE id = $1',
      [created.automation.id],
    )).rejects.toMatchObject({ code: '55000' })
    await expect(migrationPool.query(
      'DELETE FROM relay_expert_triggers WHERE id = $1',
      [created.automation.id],
    )).rejects.toMatchObject({ code: '55000' })
  })
})
