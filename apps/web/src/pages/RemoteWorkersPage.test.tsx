import type { SessionWorkerDto } from '@relay/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { listSessionWorkers } from '../services/relayApi'
import { RemoteWorkersPage, type RemoteWorkersPageProps } from './RemoteWorkersPage'

vi.mock('../services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/relayApi')>(),
  listSessionWorkers: vi.fn(),
}))

const root: SessionWorkerDto = {
  organizationId: 'organization-a',
  spaceId: 'space-a',
  sessionId: 'session-a',
  id: 'worker-root',
  parentTurnId: 'turn-a',
  parentWorkerId: null,
  expertRevisionId: 'expert-revision-a',
  name: 'Review implementation',
  instructions: 'Review the implementation and report concrete issues.',
  status: 'running',
  depth: 1,
  ordinal: 1,
  resultSummary: null,
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:01:00.000Z',
  completedAt: null,
  version: 2,
}
const child: SessionWorkerDto = {
  ...root,
  id: 'worker-child',
  parentWorkerId: root.id,
  name: 'Check migration safety',
  instructions: 'Inspect the migration and tenant isolation constraints.',
  status: 'completed',
  depth: 2,
  resultSummary: 'No cross-tenant access was observed.',
  completedAt: '2026-07-13T08:02:00.000Z',
  version: 3,
}
const props: RemoteWorkersPageProps = {
  organizationId: root.organizationId,
  spaceId: root.spaceId,
  sessionId: root.sessionId,
  auth: { accessToken: 'token-a', requestIdentity: 'actor-a\u00001' },
  credentialVersion: 1,
  onBackToSession: vi.fn(),
}

function renderPage(overrides: Partial<RemoteWorkersPageProps> = {}) {
  return render(<PreferencesProvider><RemoteWorkersPage {...props} {...overrides} /></PreferencesProvider>)
}

describe('Remote Workers page', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    vi.mocked(listSessionWorkers).mockReset().mockResolvedValue({
      organizationId: root.organizationId,
      spaceId: root.spaceId,
      sessionId: root.sessionId,
      items: [root, child],
      page: { nextCursor: null, hasMore: false },
    })
  })

  it('renders the authoritative parent-child hierarchy without mutation controls', async () => {
    const user = userEvent.setup()
    const onBackToSession = vi.fn()
    renderPage({ onBackToSession })

    expect(await screen.findByRole('heading', { level: 1, name: 'Worker 树' })).toBeInTheDocument()
    const treeItems = screen.getAllByRole('treeitem')
    expect(treeItems).toHaveLength(2)
    expect(treeItems[0]).toHaveAttribute('aria-level', '1')
    expect(treeItems[1]).toHaveAttribute('aria-level', '2')
    expect(screen.getByText('No cross-tenant access was observed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /取消 Worker|重试 Worker|删除 Worker/ })).not.toBeInTheDocument()
    expect(listSessionWorkers).toHaveBeenCalledWith(
      root.organizationId,
      root.spaceId,
      root.sessionId,
      expect.objectContaining({ accessToken: 'token-a' }),
      expect.any(AbortSignal),
      { limit: 50 },
    )
    await user.click(screen.getByRole('button', { name: '返回会话' }))
    expect(onBackToSession).toHaveBeenCalledOnce()
  })

  it('loads a subsequent page and preserves parent-first order', async () => {
    const user = userEvent.setup()
    vi.mocked(listSessionWorkers)
      .mockResolvedValueOnce({
        organizationId: root.organizationId,
        spaceId: root.spaceId,
        sessionId: root.sessionId,
        items: [root],
        page: { nextCursor: 'worker-cursor', hasMore: true },
      })
      .mockResolvedValueOnce({
        organizationId: root.organizationId,
        spaceId: root.spaceId,
        sessionId: root.sessionId,
        items: [child],
        page: { nextCursor: null, hasMore: false },
      })
    renderPage()
    await user.click(await screen.findByRole('button', { name: '加载更多 Worker' }))
    await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(2))
    expect(listSessionWorkers).toHaveBeenLastCalledWith(
      root.organizationId,
      root.spaceId,
      root.sessionId,
      expect.any(Object),
      undefined,
      { cursor: 'worker-cursor', limit: 50 },
    )
  })

  it('keeps the loaded tree visible when a subsequent page fails', async () => {
    const user = userEvent.setup()
    vi.mocked(listSessionWorkers)
      .mockResolvedValueOnce({
        organizationId: root.organizationId,
        spaceId: root.spaceId,
        sessionId: root.sessionId,
        items: [root],
        page: { nextCursor: 'worker-cursor', hasMore: true },
      })
      .mockRejectedValueOnce(new Error('Unable to load the next Worker page.'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: '加载更多 Worker' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the next Worker page.')
    expect(screen.getByRole('treeitem')).toHaveTextContent(root.name)
  })

  it('shows retryable errors and an honest empty state', async () => {
    vi.mocked(listSessionWorkers).mockRejectedValueOnce(new Error('Worker service unavailable.'))
    const { unmount } = renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Worker service unavailable.')
    unmount()
    vi.mocked(listSessionWorkers).mockResolvedValueOnce({
      organizationId: root.organizationId,
      spaceId: root.spaceId,
      sessionId: root.sessionId,
      items: [],
      page: { nextCursor: null, hasMore: false },
    })
    renderPage({ credentialVersion: 2 })
    expect(await screen.findByText('当前没有 Worker')).toBeInTheDocument()
  })
})
