import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DeterministicConversationAgentProvider } from './conversation-agent-provider.js'
import { GovernedConversationToolBroker } from './conversation-tool-broker.js'
import { ExecutionWorker } from './execution-worker.js'
import { runMigrations } from './migrations.js'
import { PostgresExecutionRepository } from './postgres-execution-repository.js'
import { PostgresFileRepository, PostgresFileWriterRepository } from './postgres-file-repository.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'
import { PostgresToolCoordinatorRepository } from './postgres-tool-coordinator-repository.js'
import { seedSessionConfiguration } from './session-configuration-test-fixture.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('governed conversation tool runtime', () => {
  const schema = `cosmos_conversation_tools_${crypto.randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString: databaseUrl })
  const migrationPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const apiPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_api_runtime -c search_path=${schema}`,
  })
  const workerPool = new Pool({
    connectionString: databaseUrl,
    options: `-c role=cosmos_worker_runtime -c search_path=${schema}`,
  })
  let sequence = 0
  let sessionId = ''
  let fileId = ''

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`)
    await runMigrations(migrationPool)
    await migrationPool.query(`
      INSERT INTO cosmos_organizations (id, name)
      VALUES ('conversation-tool-org', 'Conversation Tool Organization');
      INSERT INTO cosmos_spaces (organization_id, id, name)
      VALUES ('conversation-tool-org', 'conversation-tool-space', 'Conversation Tool Space');
      INSERT INTO cosmos_organization_memberships (organization_id, actor_id, role)
      VALUES ('conversation-tool-org', 'conversation-tool-user', 'member');
      INSERT INTO cosmos_space_memberships (organization_id, space_id, actor_id, role)
      VALUES ('conversation-tool-org', 'conversation-tool-space', 'conversation-tool-user', 'member');
    `)
    await seedSessionConfiguration(migrationPool, 'conversation-tool-org', 'conversation-tool-space')
    const created = await new PostgresSessionRepository(apiPool, {
      createId: () => `conversation-tool-${++sequence}`,
      now: () => new Date('2026-07-13T08:00:00.000Z'),
    }).create({
      organizationId: 'conversation-tool-org',
      spaceId: 'conversation-tool-space',
      actorId: 'conversation-tool-user',
      actorKind: 'user',
      requestId: 'conversation-tool-session-request',
      idempotencyKey: 'conversation-tool-session-key',
      request: {
        expertId: 'expert-pr-author',
        title: 'Conversation Tool Runtime',
        visibility: 'private',
        start: true,
        message: { content: 'Read the workspace plan and report its status.', attachments: [] },
      },
    })
    if (!created.turn) throw new Error('Conversation tool fixture requires a Turn.')
    sessionId = created.session.id
    const appended = await new PostgresFileWriterRepository(workerPool, {
      createId: () => `conversation-file-${++sequence}`,
      now: () => new Date('2026-07-13T08:00:01.000Z'),
    }).append({
      organizationId: 'conversation-tool-org',
      spaceId: 'conversation-tool-space',
      sessionId,
      turnId: created.turn.id,
      actorId: 'conversation-tool-user',
      actorKind: 'user',
      requestId: 'conversation-file-import',
      scope: 'workspace',
      path: 'plans/release.md',
      mimeType: 'text/markdown',
      content: Buffer.from('# Release\n\nStatus: ready for validation.\n'),
      expertId: 'expert-pr-author',
      toolCallId: 'fixture-import',
    })
    fileId = appended.file.id
  })

  afterAll(async () => {
    await apiPool.end()
    await workerPool.end()
    await migrationPool.end()
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await adminPool.end()
  })

  it('executes list and read tools under the Worker role before completing the Agent message', async () => {
    await expect(new PostgresFileRepository(workerPool).list(
      'conversation-tool-org',
      'conversation-tool-space',
      'conversation-tool-user',
      { scope: 'workspace', sessionId, limit: 25 },
    )).resolves.toMatchObject({ items: [expect.objectContaining({ id: fileId })] })
    const provider = new DeterministicConversationAgentProvider((input, invocation) => {
      if (invocation === 1) {
        return {
          text: '',
          finishReason: 'tool_calls',
          toolCall: {
            providerToolCallId: 'provider-list-files',
            name: 'workspace_files_list',
            input: { prefix: 'plans/' },
          },
        }
      }
      if (invocation === 2) {
        return {
          text: '',
          finishReason: 'tool_calls',
          toolCall: {
            providerToolCallId: 'provider-read-file',
            name: 'workspace_file_read',
            input: { fileId },
          },
        }
      }
      const readResult = JSON.parse(input.toolExchanges?.[1]?.result ?? '{}')
      return {
        text: `Workspace release status: ${readResult.content}`,
        finishReason: 'stop',
      }
    })
    const worker = new ExecutionWorker({
      repository: new PostgresExecutionRepository(workerPool),
      provider,
      toolBroker: new GovernedConversationToolBroker(
        new PostgresToolCoordinatorRepository(workerPool),
        new PostgresFileRepository(workerPool),
      ),
      workerId: 'conversation-tool-worker',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 10_000,
      pollIntervalMs: 100,
      recoveryBatchSize: 20,
    })

    await expect(worker.runOnce()).resolves.toBe(true)

    const calls = await migrationPool.query<{
      tool_name: string
      operation: string
      risk_level: string
      status: string
      input_hash: string
      output_hash: string
    }>(`
      SELECT tool_name, operation, risk_level, status, input_hash, output_hash
      FROM cosmos_tool_calls
      WHERE session_id = $1
      ORDER BY created_at, id
    `, [sessionId])
    expect(calls.rows).toEqual([
      expect.objectContaining({
        tool_name: 'workspace_files_list', operation: 'list', risk_level: 'low', status: 'succeeded',
      }),
      expect.objectContaining({
        tool_name: 'workspace_file_read', operation: 'read', risk_level: 'low', status: 'succeeded',
      }),
    ])
    for (const call of calls.rows) {
      expect(call.input_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(call.output_hash).toMatch(/^[a-f0-9]{64}$/)
    }
    const completed = await migrationPool.query<{ content: string }>(`
      SELECT content FROM cosmos_messages
      WHERE session_id = $1 AND role = 'agent'
    `, [sessionId])
    expect(completed.rows[0]?.content).toContain('Status: ready for validation.')
    const ledgers = await migrationPool.query<{
      tool_events: string
      audit_events: string
      leaked_content: boolean
    }>(`
      SELECT
        (SELECT count(*)::text FROM cosmos_session_events
          WHERE session_id = $1 AND event_type = 'tool_call.updated') AS tool_events,
        (SELECT count(*)::text FROM cosmos_audit_events
          WHERE session_id = $1 AND action IN ('tool_call.create', 'tool_call.update')) AS audit_events,
        EXISTS (
          SELECT 1 FROM cosmos_session_events
          WHERE session_id = $1 AND payload::text LIKE '%ready for validation%'
        ) AS leaked_content
    `, [sessionId])
    expect(ledgers.rows[0]).toEqual({
      tool_events: '6',
      audit_events: '4',
      leaked_content: false,
    })
  })
})
