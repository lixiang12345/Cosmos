import type { AttemptStatus, SessionDto, SessionEventDto, SessionMessageDto } from '@relay/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../../preferences'
import { RemoteSessionWorkbench } from './RemoteSessionWorkbench'

const session: SessionDto = {
  id: 'session-authoritative',
  organizationId: 'organization-a',
  spaceId: 'space-a',
  title: 'Harden checkout validation',
  summary: 'Validate the production checkout boundary and record the requested changes.',
  expertId: 'expert-a',
  expertName: 'Production Engineer',
  expertVersion: 4,
  environmentId: 'environment-a',
  configurationResolutionVersion: 1,
  expertRevisionId: 'expert-revision-4',
  environmentRevisionId: 'environment-revision-7',
  repositoryId: 'repository-binding-2',
  repository: 'relay/checkout',
  baseBranch: 'main',
  visibility: 'private',
  status: 'queued',
  attachments: [],
  source: 'manual',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:04:00.000Z',
  lastActivityAt: '2026-07-13T08:04:00.000Z',
  archivedAt: null,
  version: 2,
}

function attemptEvent(number: number, status: AttemptStatus, failureCode: string | null = null): SessionEventDto {
  return {
    eventId: `event-attempt-${number}-${status}`,
    organizationId: session.organizationId,
    spaceId: session.spaceId,
    sessionId: session.id,
    sequence: number + 3,
    type: 'attempt.updated',
    resourceType: 'attempt',
    resourceId: `attempt-${number}`,
    actorId: 'worker-1',
    commandId: 'command-1',
    requestId: `request-${number}`,
    occurredAt: session.updatedAt,
    payload: {
      attemptId: `attempt-${number}`,
      turnId: 'turn-1',
      number,
      status,
      failureCode,
    },
  }
}

const message: SessionMessageDto = {
  id: 'message-user-1',
  organizationId: session.organizationId,
  spaceId: session.spaceId,
  sessionId: session.id,
  sequence: 1,
  role: 'user',
  actorId: 'user-1',
  content: '请检查结算竞态并补充回归测试。',
  attachments: [],
  createdAt: session.createdAt,
}

function renderWorkbench(
  overrides: Partial<SessionDto> = {},
  timeline: { messages?: SessionMessageDto[]; events?: SessionEventDto[]; timelineStatus?: 'loading' | 'ready' | 'error'; timelineError?: string } = {},
  controls: {
    executionEnabled?: boolean
    startStatus?: 'idle' | 'submitting' | 'error'
    startError?: string
    onStart?: () => void
    sendStatus?: 'idle' | 'submitting' | 'error'
    sendError?: string
    onSend?: (content: string) => Promise<void>
    controlStatus?: 'idle' | 'submitting' | 'error'
    controlAction?: 'pause' | 'resume' | 'cancel' | 'retry'
    controlError?: string
    onPause?: () => void
    onResume?: () => void
    onCancel?: () => void
    onRetry?: () => void
  } = {},
) {
  const onBack = vi.fn()
  const onOpenNavigation = vi.fn()
  const view = render(
    <PreferencesProvider>
      <RemoteSessionWorkbench
        session={{ ...session, ...overrides }}
        {...timeline}
        {...controls}
        onBack={onBack}
        onOpenNavigation={onOpenNavigation}
      />
    </PreferencesProvider>,
  )
  return { ...view, onBack, onOpenNavigation }
}

describe('RemoteSessionWorkbench', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
  })

  it('shows only authoritative session facts and an honest execution state', () => {
    renderWorkbench()

    expect(screen.getByRole('heading', { name: session.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已排队，等待执行' })).toBeInTheDocument()
    expect(screen.getByText('命令已被服务端接受，正在等待 Worker 领取。')).toBeInTheDocument()
    expect(screen.getByText(session.summary)).toBeInTheDocument()
    expect(screen.getByText(session.expertName)).toBeInTheDocument()
    expect(screen.getByText(session.expertId)).toBeInTheDocument()
    expect(screen.getByText(session.repository)).toBeInTheDocument()
    expect(screen.getByText(session.baseBranch)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: session.title }).parentElement).toHaveTextContent(
      `${session.repository} / ${session.baseBranch}`,
    )
    expect(screen.getByText(session.expertRevisionId!)).toBeInTheDocument()
    expect(screen.getByText(session.environmentRevisionId!)).toBeInTheDocument()
    expect(screen.getByText(session.repositoryId!)).toBeInTheDocument()
    expect(screen.getByText('私有')).toBeInTheDocument()
    expect(document.querySelector(`time[datetime="${session.createdAt}"]`)).toBeInTheDocument()
    expect(document.querySelector(`time[datetime="${session.updatedAt}"]`)).toBeInTheDocument()
  })

  it('exposes only legal execution controls and keeps local fencing available', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onCancel = vi.fn()
    const onRetry = vi.fn()
    const queuedView = renderWorkbench({}, {}, { executionEnabled: true, onPause, onResume, onCancel, onRetry })

    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '取消执行' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '暂停' }))
    await user.click(screen.getByRole('button', { name: '取消执行' }))
    expect(onPause).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    queuedView.unmount()

    const pausedView = renderWorkbench(
      { status: 'paused' },
      {},
      { executionEnabled: false, onPause, onResume, onCancel, onRetry },
    )
    expect(screen.getByRole('button', { name: '恢复' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消执行' })).toBeEnabled()
    pausedView.unmount()

    renderWorkbench(
      { status: 'failed' },
      { events: [attemptEvent(1, 'failed', 'PROVIDER_TIMEOUT')] },
      { executionEnabled: true, onPause, onResume, onCancel, onRetry },
    )
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '取消执行' })).not.toBeInTheDocument()
  })

  it('does not invent execution data, views, controls, or a message composer', () => {
    renderWorkbench()

    for (const label of [
      '预计成本', '上下文', '模型', '尝试', '文件', '产物', '阶段',
      'Estimated cost', 'Context', 'Model', 'Attempt', 'Files', 'Artifact', 'Stages',
    ]) {
      expect(screen.queryByText(label, { exact: false })).not.toBeInTheDocument()
    }

    for (const action of [
      '分享会话', '暂停', '停止', '重试', '批准', '发送',
      'Share session', 'Pause', 'Stop', 'Retry', 'Approve', 'Send',
    ]) {
      expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument()
    }

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('offers the real draft start action only when execution is available', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    const view = renderWorkbench({ status: 'draft', version: 1 }, {}, {
      executionEnabled: true,
      onStart,
    })

    await user.click(screen.getByRole('button', { name: '开始执行' }))
    expect(onStart).toHaveBeenCalledOnce()

    view.rerender(
      <PreferencesProvider>
        <RemoteSessionWorkbench
          session={{ ...session, status: 'draft', version: 1 }}
          executionEnabled={false}
          onStart={onStart}
          onBack={() => undefined}
        />
      </PreferencesProvider>,
    )
    expect(screen.getByRole('button', { name: '开始执行' })).toBeDisabled()
    expect(screen.getByText('当前部署未开放执行。')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('submits follow-up Messages for runnable states and clears only after acceptance', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(undefined)
    renderWorkbench({}, {}, { executionEnabled: true, onSend })

    const input = screen.getByRole('textbox', { name: '后续消息' })
    const send = screen.getByRole('button', { name: '发送' })
    expect(send).toBeDisabled()
    await user.type(input, '  请继续检查取消路径。  ')
    await user.click(send)

    expect(onSend).toHaveBeenCalledWith('请继续检查取消路径。')
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('retains a failed follow-up draft and hides the composer for canceled Sessions', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockRejectedValue(new Error('发送失败'))
    const view = renderWorkbench({}, {}, {
      executionEnabled: true,
      sendStatus: 'error',
      sendError: '发送失败',
      onSend,
    })

    const input = screen.getByRole('textbox', { name: '后续消息' })
    await user.type(input, '保留这条消息')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(input).toHaveValue('保留这条消息')
    expect(screen.getByRole('alert')).toHaveTextContent('发送失败')

    view.rerender(
      <PreferencesProvider>
        <RemoteSessionWorkbench
          session={{ ...session, status: 'canceled' }}
          executionEnabled
          onSend={onSend}
          onBack={() => undefined}
        />
      </PreferencesProvider>,
    )
    expect(screen.queryByRole('textbox', { name: '后续消息' })).not.toBeInTheDocument()
  })

  it('supports navigation, copying, language switching, and both themes', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const { onBack, onOpenNavigation } = renderWorkbench()

    await user.click(screen.getByRole('button', { name: '返回会话' }))
    await user.click(screen.getByRole('button', { name: '打开导航' }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(onOpenNavigation).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '复制链接' }))
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(screen.getByRole('status')).toHaveTextContent('会话链接已复制')
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')

    await user.click(screen.getByRole('button', { name: '切换到英文' }))
    const workbench = screen.getByRole('main')
    expect(within(workbench).getByRole('heading', { name: 'Queued for execution' })).toBeInTheDocument()
    expect(within(workbench).getByRole('button', { name: 'Back to Sessions' })).toBeInTheDocument()
    expect(within(workbench).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(within(workbench).queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('labels unresolved legacy configuration without fabricating revision IDs', () => {
    renderWorkbench({
      configurationResolutionVersion: 0,
      expertRevisionId: undefined,
      environmentRevisionId: undefined,
      repositoryId: undefined,
    })

    expect(screen.getAllByText('未解析（旧版会话记录）')).toHaveLength(3)
  })

  it.each([
    ['running', 'active', [attemptEvent(1, 'running')], '正在执行'],
    ['retrying', 'active', [attemptEvent(1, 'failed', 'PROVIDER_TIMEOUT'), attemptEvent(2, 'running')], '正在重试'],
    ['failed', 'failed', [attemptEvent(1, 'failed', 'PROVIDER_REJECTED')], '执行失败'],
    ['completed', 'completed', [attemptEvent(1, 'succeeded')], '执行已完成'],
  ] as const)('renders the authoritative %s Attempt state', (_name, status, events, title) => {
    renderWorkbench({ status }, { events: [...events], timelineStatus: 'ready' })

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '执行动态' })).toHaveTextContent(`#${events.at(-1)!.sequence}`)
  })

  it('keeps retry and failure detail when session.updated follows attempt.updated', () => {
    const sessionQueuedEvent: SessionEventDto = {
      organizationId: session.organizationId,
      spaceId: session.spaceId,
      sessionId: session.id,
      eventId: 'event-session-queued',
      sequence: 5,
      type: 'session.updated',
      resourceType: 'session',
      resourceId: session.id,
      actorId: 'worker-1',
      commandId: 'command-1',
      requestId: 'request-session-queued',
      occurredAt: session.updatedAt,
      payload: { status: 'queued', version: 3 },
    }
    renderWorkbench({ status: 'queued', version: 3 }, {
      events: [
        attemptEvent(2, 'failed', 'PROVIDER_TIMEOUT'),
        sessionQueuedEvent,
      ],
      timelineStatus: 'ready',
    })

    expect(screen.getByRole('heading', { name: '正在等待重试' })).toBeInTheDocument()
    expect(screen.getByText(/第 2 次尝试失败，错误代码：PROVIDER_TIMEOUT；下一次尝试已排队/)).toBeInTheDocument()
  })

  it('renders canonical messages and preserves timeline data while automatic retry is visible', () => {
    renderWorkbench({}, {
      messages: [message],
      events: [attemptEvent(1, 'running')],
      timelineStatus: 'error',
      timelineError: 'Timeline temporarily unavailable.',
    })

    expect(screen.getByRole('region', { name: '会话消息' })).toHaveTextContent(message.content)
    expect(screen.getByRole('region', { name: '会话消息' })).toHaveTextContent('用户')
    expect(screen.getByRole('alert')).toHaveTextContent('实时更新暂时中断，正在自动重试。')
    expect(screen.getByRole('alert')).toHaveTextContent('Timeline temporarily unavailable.')
  })
})
