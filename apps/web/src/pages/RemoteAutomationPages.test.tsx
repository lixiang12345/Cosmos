import type {
  AutomationDto,
  AutomationEventDto,
  AutomationRunDto,
  ExpertSummaryDto,
  SessionDto,
} from '@cosmos/contracts'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import {
  createAutomation,
  archiveAutomation,
  enableAutomation,
  listAutomationEvents,
  listAutomationRuns,
  listAutomations,
  listExperts,
  pauseAutomation,
  receiveAutomationEvent,
  testAutomation,
  updateAutomation,
  type CosmosApiAuthContext,
} from '../services/cosmosApi'
import {
  RemoteAutomationEventLogPage,
  RemoteAutomationRunHistoryPage,
  RemoteAutomationsPage,
} from './RemoteAutomationPages'

vi.mock('../services/cosmosApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/cosmosApi')>(),
  createAutomation: vi.fn(),
  archiveAutomation: vi.fn(),
  enableAutomation: vi.fn(),
  listAutomationEvents: vi.fn(),
  listAutomationRuns: vi.fn(),
  listAutomations: vi.fn(),
  listExperts: vi.fn(),
  pauseAutomation: vi.fn(),
  receiveAutomationEvent: vi.fn(),
  testAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}))

const organizationId = 'organization-a'
const spaceId = 'space-a'
const auth: CosmosApiAuthContext = { accessToken: 'test-access-token' }
const now = '2026-07-22T08:00:00.000Z'

const expert: ExpertSummaryDto = {
  id: 'expert-a',
  organizationId,
  spaceId,
  kind: 'custom',
  name: 'Platform Reviewer',
  description: 'Reviews platform changes.',
  visibility: 'space',
  status: 'published',
  publishedRevisionId: 'expert-revision-a',
  publishedRevisionSummary: {
    id: 'expert-revision-a',
    expertId: 'expert-a',
    revision: 1,
    model: 'cosmos-default',
    environmentId: 'environment-a',
    environmentRevisionId: 'environment-revision-a',
    allowRepositoryOverride: false,
    allowBaseBranchOverride: false,
    status: 'published',
    createdAt: now,
  },
  version: 1,
  createdAt: now,
  updatedAt: now,
}

const automation: AutomationDto = {
  id: 'automation-a',
  organizationId,
  spaceId,
  expertId: expert.id,
  expertRevisionId: expert.publishedRevisionId!,
  triggerId: 'automation-a',
  name: 'Pull request triage',
  source: 'github',
  eventType: 'pull_request.opened',
  filter: { '==': [{ var: 'action' }, 'opened'] },
  scheduleCron: null,
  scheduleTimezone: null,
  maxRunsPerMinute: 10,
  status: 'paused',
  autoArchive: false,
  serviceAccountId: 'service-account-automation-local',
  lastTestedAt: null,
  lastMatchedAt: null,
  archivedAt: null,
  matchCount: 0,
  version: 1,
  createdAt: now,
  updatedAt: now,
}

const dispatchedEvent: AutomationEventDto = {
  id: 'event-a',
  organizationId,
  spaceId,
  source: 'github',
  eventType: automation.eventType,
  externalId: 'provider-event-a',
  headers: {},
  payload: { action: 'opened', token: '[REDACTED]' },
  payloadHash: 'a'.repeat(64),
  status: 'dispatched',
  automationId: automation.id,
  sessionId: 'session-a',
  matchExplanation: 'Matched Pull request triage.',
  errorCode: null,
  errorMessage: null,
  receivedAt: now,
  processedAt: now,
}

const session: SessionDto = {
  id: 'session-a',
  organizationId,
  spaceId,
  title: 'Automation: Pull request triage',
  summary: 'Triggered by pull_request.opened',
  expertId: expert.id,
  expertName: expert.name,
  expertVersion: 1,
  environmentId: 'environment-a',
  repository: 'cosmos/platform',
  baseBranch: 'main',
  visibility: 'private',
  status: 'active',
  attachments: [],
  source: 'automation',
  configurationResolutionVersion: 1,
  expertRevisionId: 'expert-revision-a',
  environmentRevisionId: 'environment-revision-a',
  executionSnapshotId: 'execution-snapshot-a',
  repositoryId: 'repository-a',
  createdAt: now,
  updatedAt: now,
  lastActivityAt: now,
  archivedAt: null,
  version: 1,
}

const run: AutomationRunDto = {
  automationId: automation.id,
  automationName: automation.name,
  eventId: dispatchedEvent.id,
  source: dispatchedEvent.source,
  eventType: dispatchedEvent.eventType,
  receivedAt: now,
  autoArchive: true,
  autoArchivedAt: null,
  session,
}

const commonProps = {
  organizationId,
  spaceId,
  auth,
  credentialVersion: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function renderPage(node: React.ReactNode) {
  return render(<PreferencesProvider>{node}</PreferencesProvider>)
}

describe('Remote Automation pages', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    vi.clearAllMocks()
    vi.mocked(listAutomations).mockResolvedValue({ items: [automation], projectionUpdatedAt: now })
    vi.mocked(listExperts).mockResolvedValue({
      items: [expert],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: now },
    })
    vi.mocked(listAutomationEvents).mockResolvedValue({ items: [], projectionUpdatedAt: null })
    vi.mocked(listAutomationRuns).mockResolvedValue({ items: [], projectionUpdatedAt: null })
  })

  it('shows loading, empty, error, and read-only permission states honestly', async () => {
    const user = userEvent.setup()
    const pendingAutomations = deferred<Awaited<ReturnType<typeof listAutomations>>>()
    vi.mocked(listAutomations).mockReturnValueOnce(pendingAutomations.promise)
    vi.mocked(listExperts).mockResolvedValueOnce({
      items: [expert],
      page: { nextCursor: null, hasMore: false, projectionUpdatedAt: now },
    })
    const first = renderPage(<RemoteAutomationsPage {...commonProps} canManage={false} />)

    expect(screen.getByText('加载中…')).toBeInTheDocument()
    await act(async () => pendingAutomations.resolve({ items: [], projectionUpdatedAt: null }))
    await user.click(screen.getByRole('button', { name: '我的' }))
    expect(await screen.findByText('当前 Space 尚未配置自动化。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建自动化' })).not.toBeInTheDocument()
    first.unmount()

    vi.mocked(listAutomations).mockRejectedValueOnce(new Error('Automation service unavailable.'))
    renderPage(<RemoteAutomationsPage {...commonProps} credentialVersion={2} canManage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Automation service unavailable.')
  })

  it('returns focus to the create trigger after Escape closes the drawer', async () => {
    const user = userEvent.setup()
    renderPage(<RemoteAutomationsPage {...commonProps} canManage />)

    const trigger = await screen.findByRole('button', { name: '创建自动化' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '创建自动化' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '创建自动化' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('creates a paused Automation with a published Expert', async () => {
    const user = userEvent.setup()
    vi.mocked(listAutomations).mockResolvedValueOnce({ items: [], projectionUpdatedAt: null })
    vi.mocked(createAutomation).mockResolvedValueOnce({ ...automation, name: 'Release triage' })
    renderPage(<RemoteAutomationsPage {...commonProps} canManage />)

    await user.click(await screen.findByRole('button', { name: '创建自动化' }))
    await user.click(screen.getByRole('button', { name: '+ 添加 Trigger' }))
    await user.click(screen.getByRole('button', { name: /GitHub/ }))
    const name = screen.getByLabelText('Trigger 名称')
    await user.clear(name)
    await user.type(name, 'Release triage')
    await user.click(screen.getByRole('button', { name: '添加到自动化' }))
    await user.click(screen.getByRole('button', { name: '保存自动化' }))

    await waitFor(() => expect(createAutomation).toHaveBeenCalledOnce())
    expect(createAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      expect.objectContaining({
        expertId: expert.id,
        name: 'Release triage',
        source: 'github',
        eventType: 'pull_request',
        serviceAccountId: 'service-account-automation-local',
      }),
      expect.stringMatching(/^automation-create-/),
      auth,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Automation 已创建并保持暂停。')
  })

  it('edits, tests, enables, and pauses the same versioned Trigger', async () => {
    const user = userEvent.setup()
    const edited = { ...automation, name: 'Updated triage', version: 2 }
    const tested = { ...edited, lastTestedAt: now, version: 3 }
    const enabled = { ...tested, status: 'active' as const, version: 4 }
    const paused = { ...enabled, status: 'paused' as const, version: 5 }
    vi.mocked(updateAutomation).mockResolvedValueOnce(edited)
    vi.mocked(testAutomation).mockResolvedValueOnce({ automation: tested, matched: true, explanation: 'action equals opened' })
    vi.mocked(enableAutomation).mockResolvedValueOnce(enabled)
    vi.mocked(pauseAutomation).mockResolvedValueOnce(paused)
    renderPage(<RemoteAutomationsPage {...commonProps} canManage />)

    await user.click(await screen.findByRole('button', { name: '展开 Trigger' }))
    await user.click(screen.getByText('Pull request triage').closest('button')!)
    const editor = screen.getByText('编辑 Trigger').closest('form')!
    const name = within(editor).getByLabelText('Trigger 名称')
    await user.clear(name)
    await user.type(name, edited.name)
    await user.click(within(editor).getByRole('button', { name: '保存并暂停' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Trigger 已更新并保持暂停。')
    expect(updateAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      automation.id,
      expect.objectContaining({ name: edited.name }),
      automation.version,
      expect.stringMatching(/^automation-update-/),
      auth,
    )

    await user.click(screen.getByText('Updated triage').closest('button')!)
    await user.click(screen.getByRole('button', { name: '测试事件' }))
    expect(await screen.findByRole('status')).toHaveTextContent('测试匹配成功：action equals opened')
    expect(testAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      automation.id,
      expect.objectContaining({ eventType: automation.eventType }),
      edited.version,
      expect.stringMatching(/^automation-test-/),
      auth,
    )

    await user.click(screen.getByRole('button', { name: '关闭编辑器' }))
    await user.click(screen.getByRole('switch', { name: '启用 Updated triage' }))
    await waitFor(() => expect(screen.getByText('已启用')).toBeInTheDocument())
    expect(enableAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      automation.id,
      tested.version,
      expect.stringMatching(/^automation-enable-/),
      auth,
    )

    await user.click(screen.getByRole('switch', { name: '停用 Updated triage' }))
    await waitFor(() => expect(screen.getByText('已停用')).toBeInTheDocument())
    expect(pauseAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      automation.id,
      enabled.version,
      expect.stringMatching(/^automation-pause-/),
      auth,
    )
  })

  it('requires confirmation, archives the Trigger, and removes mutable actions', async () => {
    const user = userEvent.setup()
    const archived = { ...automation, status: 'archived' as const, archivedAt: now, version: 2, updatedAt: now }
    vi.mocked(archiveAutomation).mockResolvedValueOnce(archived)
    renderPage(<RemoteAutomationsPage {...commonProps} canManage />)

    await user.click(await screen.findByRole('button', { name: '展开 Trigger' }))
    await user.click(screen.getByRole('button', { name: '归档 Pull request triage' }))
    expect(screen.getByRole('button', { name: '确认归档' })).toBeInTheDocument()
    expect(archiveAutomation).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认归档' }))

    await waitFor(() => expect(archiveAutomation).toHaveBeenCalledWith(
      organizationId,
      spaceId,
      automation.id,
      automation.version,
      expect.stringMatching(/^automation-archive-/),
      auth,
    ))
    expect(await screen.findByRole('status')).toHaveTextContent('Trigger 已归档且不可恢复。')
    expect(screen.getAllByText('已归档').length).toBeGreaterThan(0)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '归档 Pull request triage' })).not.toBeInTheDocument()
  })

  it('receives, deduplicates, and exposes failed Events without hiding details', async () => {
    const user = userEvent.setup()
    const failedEvent: AutomationEventDto = {
      ...dispatchedEvent,
      id: 'event-failed',
      externalId: 'provider-event-failed',
      status: 'failed',
      automationId: automation.id,
      sessionId: null,
      errorCode: 'SESSION_CREATE_FAILED',
      errorMessage: 'The bound ServiceAccount cannot create Sessions.',
    }
    vi.mocked(receiveAutomationEvent)
      .mockResolvedValueOnce({ event: dispatchedEvent, duplicate: false })
      .mockResolvedValueOnce({ event: dispatchedEvent, duplicate: true })
      .mockResolvedValueOnce({ event: failedEvent, duplicate: false })
    renderPage(<RemoteAutomationEventLogPage {...commonProps} canManage />)

    expect(await screen.findByText('没有符合当前 Filter 的事件')).toBeInTheDocument()
    const openEventInput = async () => {
      await user.click(screen.getByRole('button', { name: '高级 Filter' }))
      await user.click(screen.getByRole('button', { name: '打开受认证测试入口' }))
    }
    const submitEvent = async (externalId: string) => {
      await openEventInput()
      const input = screen.getByLabelText('外部幂等 ID')
      await user.clear(input)
      await user.type(input, externalId)
      expect(input).toHaveValue(externalId)
      await user.click(screen.getByRole('button', { name: '接收并匹配' }))
    }
    await submitEvent(dispatchedEvent.externalId)
    expect(await screen.findByRole('status')).toHaveTextContent('事件已匹配并创建 Session。')
    expect(screen.getByText(dispatchedEvent.sessionId!)).toBeInTheDocument()

    await submitEvent(dispatchedEvent.externalId)
    expect(await screen.findByRole('status')).toHaveTextContent('重复事件已去重，没有创建第二个 Session。')

    await submitEvent(failedEvent.externalId)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(failedEvent.errorMessage!))
    expect(screen.getAllByText(failedEvent.errorMessage!)).toHaveLength(2)
    expect(receiveAutomationEvent).toHaveBeenCalledTimes(3)
  })

  it('keeps the Event input permission-gated and reports list failures', async () => {
    vi.mocked(listAutomationEvents).mockRejectedValueOnce(new Error('Event projection unavailable.'))
    renderPage(<RemoteAutomationEventLogPage {...commonProps} canManage={false} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Event projection unavailable.')
    expect(screen.queryByRole('heading', { name: '接收事件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接收并匹配' })).not.toBeInTheDocument()
  })

  it('renders Run History from the Event-to-Session fact chain and opens the Session', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    vi.mocked(listAutomationRuns).mockResolvedValueOnce({ items: [run], projectionUpdatedAt: now })
    renderPage(<RemoteAutomationRunHistoryPage {...commonProps} onOpenSession={onOpenSession} />)

    expect(await screen.findByText(session.title)).toBeInTheDocument()
    expect(screen.getByText(expert.name)).toBeInTheDocument()
    await user.click(screen.getByText(session.title).closest('tr')!)
    expect(onOpenSession).toHaveBeenCalledWith(session.id)
  })
})
