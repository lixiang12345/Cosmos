import type { ApprovalDto } from '@relay/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { decideApproval, listApprovals } from '../services/relayApi'
import { RemoteApprovalsPage, type RemoteApprovalsPageProps } from './RemoteApprovalsPage'

vi.mock('../services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/relayApi')>(),
  decideApproval: vi.fn(),
  listApprovals: vi.fn(),
}))

const approval: ApprovalDto = {
  organizationId: 'relay',
  spaceId: 'platform',
  id: 'approval-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  toolCallId: 'tool-call-1',
  action: 'Merge pull request #42',
  riskLevel: 'high',
  reasons: ['Protected branch write', 'Production release gate'],
  evidence: [{ type: 'test', label: 'Required checks', value: 'All checks passed' }],
  status: 'pending',
  requestedBy: 'requester-1',
  assignedTo: ['reviewer-1', 'reviewer-2'],
  requiredApprovals: 2,
  approvalCount: 0,
  actorHasDecided: false,
  expiresAt: '2026-07-14T01:00:00.000Z',
  decidedBy: null,
  decisionNote: null,
  decidedAt: null,
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T01:00:00.000Z',
  version: 1,
}
const props: RemoteApprovalsPageProps = {
  organizationId: approval.organizationId,
  spaceId: approval.spaceId,
  auth: { accessToken: 'token-a', requestIdentity: 'reviewer-1\u00001' },
  credentialVersion: 1,
  onOpenSession: vi.fn(),
}

function page(items: ApprovalDto[] = [approval]) {
  return {
    organizationId: approval.organizationId,
    spaceId: approval.spaceId,
    items,
    page: { nextCursor: null, hasMore: false },
  }
}

function renderPage(overrides: Partial<RemoteApprovalsPageProps> = {}) {
  return render(<PreferencesProvider><RemoteApprovalsPage {...props} {...overrides} /></PreferencesProvider>)
}

describe('Remote Approvals page', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    vi.mocked(listApprovals).mockReset().mockResolvedValue(page())
    vi.mocked(decideApproval).mockReset()
  })

  it('loads the pending inbox and exposes redacted evidence and Session navigation', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    renderPage({ onOpenSession })

    expect(await screen.findByRole('heading', { level: 2, name: approval.action })).toBeInTheDocument()
    expect(screen.getByText('Protected branch write')).toBeInTheDocument()
    expect(screen.getByText('All checks passed')).toBeInTheDocument()
    expect(screen.getByText('0 / 2')).toBeInTheDocument()
    expect(listApprovals).toHaveBeenCalledWith(
      approval.organizationId,
      approval.spaceId,
      { limit: 100, status: 'pending', assignedToMe: undefined },
      expect.objectContaining({ accessToken: 'token-a' }),
      expect.any(AbortSignal),
    )
    await user.click(screen.getByRole('button', { name: '查看完整会话' }))
    expect(onOpenSession).toHaveBeenCalledWith(approval.sessionId)
  })

  it('records a partial two-person approval once and waits for the other approver', async () => {
    const user = userEvent.setup()
    vi.mocked(decideApproval).mockResolvedValue({
      ...approval,
      approvalCount: 1,
      actorHasDecided: true,
      updatedAt: '2026-07-13T02:00:00.000Z',
      version: 2,
    })
    renderPage()
    await screen.findByText('Protected branch write')
    await user.click(screen.getByRole('button', { name: '批准并继续' }))

    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith(
      approval.organizationId,
      approval.spaceId,
      approval.id,
      { decision: 'approved', note: undefined },
      1,
      expect.stringMatching(/^approval:/),
      expect.objectContaining({ accessToken: 'token-a' }),
    ))
    expect(await screen.findByText('你的批准已记录，仍在等待另一位审批人。')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
  })

  it('keeps a reviewer decision disabled after the inbox is reloaded', async () => {
    vi.mocked(listApprovals).mockResolvedValue(page([{
      ...approval,
      approvalCount: 1,
      actorHasDecided: true,
      version: 2,
    }]))
    renderPage()

    expect(await screen.findByText('你的决定已记录，等待其他审批人。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
  })

  it('requires a note for rejection and requested changes', async () => {
    const user = userEvent.setup()
    vi.mocked(decideApproval).mockResolvedValue({
      ...approval,
      status: 'changes_requested',
      decidedBy: 'reviewer-1',
      decisionNote: 'Add rollback evidence.',
      decidedAt: '2026-07-13T02:00:00.000Z',
      updatedAt: '2026-07-13T02:00:00.000Z',
      version: 2,
    })
    renderPage()
    await screen.findByText('Protected branch write')
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '要求修改' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '决策说明' }), 'Add rollback evidence.')
    await user.click(screen.getByRole('button', { name: '要求修改' }))

    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith(
      approval.organizationId,
      approval.spaceId,
      approval.id,
      { decision: 'changes_requested', note: 'Add rollback evidence.' },
      approval.version,
      expect.any(String),
      expect.any(Object),
    ))
    expect(await screen.findByText('决策已记录，门禁状态已更新。')).toBeInTheDocument()
    expect(screen.queryByText('Protected branch write')).not.toBeInTheDocument()
  })

  it('switches to assigned and historical views with server-side filters', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Protected branch write')
    await user.click(screen.getByRole('tab', { name: '指派给我' }))
    await waitFor(() => expect(listApprovals).toHaveBeenLastCalledWith(
      approval.organizationId,
      approval.spaceId,
      { limit: 100, status: 'pending', assignedToMe: true },
      expect.any(Object),
      expect.any(AbortSignal),
    ))
    await user.click(screen.getByRole('tab', { name: '全部' }))
    await waitFor(() => expect(listApprovals).toHaveBeenLastCalledWith(
      approval.organizationId,
      approval.spaceId,
      { limit: 100, status: undefined, assignedToMe: undefined },
      expect.any(Object),
      expect.any(AbortSignal),
    ))
  })
})
