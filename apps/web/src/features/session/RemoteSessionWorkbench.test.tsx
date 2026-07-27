import type { AttemptStatus, SessionDto, SessionEventDto, SessionMessageDto } from '@cosmos/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../../preferences'
import { RemoteSessionWorkbench, type RemoteSessionWorkbenchProps } from './RemoteSessionWorkbench'

const session: SessionDto = {
  id: 'session-authoritative', organizationId: 'organization-a', spaceId: 'space-a',
  title: 'Harden checkout validation', summary: 'Validate the production checkout boundary.',
  expertId: 'expert-a', expertName: 'Production Engineer', expertVersion: 4,
  environmentId: 'environment-a', configurationResolutionVersion: 1,
  expertRevisionId: 'expert-revision-4', environmentRevisionId: 'environment-revision-7',
  executionSnapshotId: 'execution-snapshot-7', repositoryId: 'repository-binding-2',
  repository: 'cosmos/checkout', baseBranch: 'main', visibility: 'private', status: 'queued',
  attachments: [], source: 'manual', createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:04:00.000Z', lastActivityAt: '2026-07-13T08:04:00.000Z',
  archivedAt: null, version: 2,
}

function attemptEvent(number: number, status: AttemptStatus, failureCode: string | null = null): SessionEventDto {
  return {
    eventId: `event-attempt-${number}-${status}`, organizationId: session.organizationId,
    spaceId: session.spaceId, sessionId: session.id, sequence: number + 3,
    type: 'attempt.updated', resourceType: 'attempt', resourceId: `attempt-${number}`,
    actorId: 'worker-1', commandId: 'command-1', requestId: `request-${number}`,
    occurredAt: session.updatedAt,
    payload: { attemptId: `attempt-${number}`, turnId: 'turn-1', number, status, failureCode },
  }
}

const message: SessionMessageDto = {
  id: 'message-user-1', organizationId: session.organizationId, spaceId: session.spaceId,
  sessionId: session.id, sequence: 1, role: 'user', actorId: 'user-1',
  content: '请检查结算竞态并补充回归测试。', attachments: [], createdAt: session.createdAt,
}

function renderWorkbench(overrides: Partial<SessionDto> = {}, props: Partial<RemoteSessionWorkbenchProps> = {}) {
  const onBack = vi.fn()
  const onOpenNavigation = vi.fn()
  const view = render(
    <PreferencesProvider>
      <RemoteSessionWorkbench session={{ ...session, ...overrides }} onBack={onBack} onOpenNavigation={onOpenNavigation} {...props} />
    </PreferencesProvider>,
  )
  return { ...view, onBack, onOpenNavigation }
}

describe('RemoteSessionWorkbench', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
  })

  it('uses the prototype title, four tabs, exact SVG paths, composer, and 300px inspector contract', () => {
    renderWorkbench({}, { executionEnabled: true, onSend: vi.fn().mockResolvedValue(undefined), onOpenFiles: vi.fn() })

    expect(screen.getByRole('heading', { level: 1, name: session.title })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Agent', '终端', '文件', '订阅'])
    expect(document.querySelector('.prototype-session-tabs path[d="M8 1.75l5.4 3.1v6.3L8 14.25 2.6 11.15v-6.3L8 1.75z"]')).toBeInTheDocument()
    expect(document.querySelector('.prototype-session-composer path[d="M5.5 8.5l4.2-4.2a2 2 0 012.8 2.8L6.2 13.4a3.2 3.2 0 01-4.5-4.5l6.4-6.4"]')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '会话详情' })).toHaveClass('prototype-session-inspector')
    expect(screen.getByRole('textbox', { name: '后续消息' })).toBeEnabled()
  })

  it('keeps authoritative execution, summary, revisions, visibility, and timestamps in the prototype surface', () => {
    renderWorkbench()
    expect(screen.getByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(screen.getByText('命令已被服务端接受，正在等待 Worker 领取。')).toBeInTheDocument()
    for (const value of [session.summary, session.expertName, session.expertId, session.repository, session.baseBranch, session.expertRevisionId, session.environmentRevisionId, session.repositoryId]) {
      expect(screen.getByText(value!)).toBeInTheDocument()
    }
    expect(screen.getByText('私有')).toBeInTheDocument()
    expect(document.querySelector(`time[datetime="${session.createdAt}"]`)).toBeInTheDocument()
  })

  it('exposes legal controls in the prototype menu and confirms destructive cancellation', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onCancel = vi.fn()
    renderWorkbench({}, { executionEnabled: true, onPause, onCancel })

    await user.click(screen.getByRole('button', { name: '更多' }))
    await user.click(screen.getByRole('menuitem', { name: '暂停' }))
    expect(onPause).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '停止' }))
    const dialog = screen.getByRole('alertdialog', { name: '停止当前执行？' })
    await user.click(within(dialog).getByRole('button', { name: '取消执行' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('offers real resume, retry, and draft-start actions only in legal states', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    const paused = renderWorkbench({ status: 'paused' }, { executionEnabled: false, onResume, onCancel: vi.fn() })
    await user.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menuitem', { name: '恢复' })).toBeDisabled()
    paused.unmount()

    const onRetry = vi.fn()
    const failed = renderWorkbench({ status: 'failed' }, { executionEnabled: true, events: [attemptEvent(1, 'failed')], onRetry })
    await user.click(screen.getByRole('button', { name: '更多' }))
    await user.click(screen.getByRole('menuitem', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledOnce()
    failed.unmount()

    const onStart = vi.fn()
    renderWorkbench({ status: 'draft' }, { executionEnabled: true, onStart })
    await user.click(screen.getByRole('button', { name: '开始执行' }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('submits follow-up messages, clears accepted drafts, and retains rejected drafts', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(undefined)
    const accepted = renderWorkbench({}, { executionEnabled: true, onSend })
    const input = screen.getByRole('textbox', { name: '后续消息' })
    await user.type(input, '  请继续检查取消路径。  ')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).toHaveBeenCalledWith('请继续检查取消路径。')
    await waitFor(() => expect(input).toHaveValue(''))
    accepted.unmount()

    const rejectedSend = vi.fn().mockRejectedValue(new Error('发送失败'))
    renderWorkbench({}, { executionEnabled: true, sendStatus: 'error', sendError: '发送失败', onSend: rejectedSend })
    const rejected = screen.getByRole('textbox', { name: '后续消息' })
    await user.type(rejected, '保留这条消息')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(rejected).toHaveValue('保留这条消息')
    expect(screen.getByRole('alert')).toHaveTextContent('发送失败')
  })

  it('routes real Files and Worker actions while keeping Terminal and Subscriptions prototype tabs', async () => {
    const user = userEvent.setup()
    const onOpenFiles = vi.fn()
    const onOpenWorkers = vi.fn()
    renderWorkbench({}, { onOpenFiles, onOpenWorkers, events: [attemptEvent(1, 'running')] })
    await user.click(screen.getByRole('tab', { name: '文件' }))
    expect(onOpenFiles).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('tab', { name: '终端' }))
    await user.click(screen.getByRole('button', { name: '打开 Worker 详情' }))
    expect(onOpenWorkers).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('tab', { name: '订阅' }))
    expect(screen.getByRole('region', { name: '执行动态' })).toHaveTextContent('#4')
  })

  it('renders canonical messages and recoverable timeline errors without inventing data', () => {
    renderWorkbench({}, { messages: [message], events: [attemptEvent(1, 'running')], timelineStatus: 'error', timelineError: 'Timeline temporarily unavailable.' })
    const region = screen.getByRole('region', { name: '会话消息' })
    expect(region).toHaveTextContent(message.content)
    expect(region).toHaveTextContent('用户')
    expect(screen.getByRole('alert')).toHaveTextContent('实时更新暂时中断，正在自动重试。')
    expect(screen.getByRole('alert')).toHaveTextContent('Timeline temporarily unavailable.')
  })

  it('keeps the prototype message rail accessible and scrolls the real message surface', async () => {
    const user = userEvent.setup()
    renderWorkbench({}, { messages: [message] })
    const messageRegion = screen.getByRole('region', { name: '会话消息' })
    const scrollBy = vi.fn()
    messageRegion.scrollBy = scrollBy

    await user.click(screen.getByRole('button', { name: '向上滚动消息' }))
    await user.click(screen.getByRole('button', { name: '向下滚动消息' }))

    expect(scrollBy).toHaveBeenNthCalledWith(1, { top: -180, behavior: 'smooth' })
    expect(scrollBy).toHaveBeenNthCalledWith(2, { top: 180, behavior: 'smooth' })
  })

  it('supports panel toggling, copy feedback, collapsed navigation, theme, and trapped shortcuts', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const { onOpenNavigation } = renderWorkbench({}, { navigationCollapsed: true })
    await user.click(screen.getByRole('button', { name: '显示导航' }))
    expect(onOpenNavigation).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '隐藏面板' }))
    expect(screen.queryByRole('complementary', { name: '会话详情' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '显示面板' }))
    await user.click(screen.getByRole('button', { name: '↗ 复制链接' }))
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(screen.getByRole('status')).toHaveTextContent('会话链接已复制')
    await user.click(screen.getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByRole('button', { name: '键盘快捷键' }))
    expect(screen.getByRole('dialog', { name: '键盘快捷键' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
  })

  it('labels unresolved legacy configuration and renders authoritative attempt states', () => {
    const view = renderWorkbench({ configurationResolutionVersion: 0, expertRevisionId: undefined, environmentRevisionId: undefined, repositoryId: undefined }, { events: [attemptEvent(2, 'running')], timelineStatus: 'ready' })
    expect(screen.getAllByText('未解析（旧版会话记录）')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: '正在重试' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '执行动态' })).toHaveTextContent('#5')
    view.unmount()
  })
})
