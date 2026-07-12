import type { SessionDto } from '@relay/contracts'
import { render, screen, within } from '@testing-library/react'
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
  version: 2,
}

function renderWorkbench(overrides: Partial<SessionDto> = {}) {
  const onBack = vi.fn()
  const onOpenNavigation = vi.fn()
  const view = render(
    <PreferencesProvider>
      <RemoteSessionWorkbench
        session={{ ...session, ...overrides }}
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
    expect(screen.getByRole('heading', { name: '命令已接受，但执行面未接通' })).toBeInTheDocument()
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
    expect(within(workbench).getByRole('heading', { name: 'Command accepted, but the execution plane is not connected' })).toBeInTheDocument()
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
})
