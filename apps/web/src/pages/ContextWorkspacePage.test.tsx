import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/context'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { WorkspaceContext } from '../workspace/context'
import { ContextWorkspacePage } from './ContextWorkspacePage'

const auth: AuthContextValue = {
  status: 'authenticated',
  mode: 'development',
  actorId: 'user-local-admin',
  displayName: 'Local admin',
  demoMode: true,
  credentialVersion: 1,
  handleUnauthorized: async () => undefined,
  signIn: async () => undefined,
  signOut: async () => undefined,
}

const workspace = {
  status: 'ready' as const,
  me: {
    actor: { id: 'user-local-admin', kind: 'user' as const },
    organizations: [{
      id: 'relay',
      name: 'Relay',
      role: 'organization_owner' as const,
      spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
    }],
  },
  activeOrganization: {
    id: 'relay',
    name: 'Relay',
    role: 'organization_owner' as const,
    spaces: [{ id: 'platform', name: 'Platform', role: 'space_manager' as const }],
  },
  activeSpace: { id: 'platform', name: 'Platform', role: 'space_manager' as const },
  selectSpace: vi.fn(),
  refresh: vi.fn(),
}

function renderPage() {
  const onNewTask = vi.fn()
  const result = render(
    <PreferencesProvider>
      <AuthContext.Provider value={auth}>
        <WorkspaceContext.Provider value={workspace}>
          <ContextWorkspacePage
            repositories={[
              { id: 'repo-platform', fullName: 'relay/platform', defaultBranch: 'main' },
              { id: 'repo-web', fullName: 'relay/web', defaultBranch: 'main' },
            ]}
            demoMode
            contextEnabled={false}
            onOpenNavigation={vi.fn()}
            onNewTask={onNewTask}
          />
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </PreferencesProvider>,
  )
  return { ...result, onNewTask }
}

describe('Context workspace', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'light')
  })

  it('searches sample evidence, switches the preview, and packs the context', async () => {
    const user = userEvent.setup()
    const { onNewTask } = renderPage()

    await user.click(screen.getByRole('button', { name: '支付重试策略在哪里实现？' }))
    await user.click(screen.getByRole('button', { name: '检索证据' }))

    expect(await screen.findByRole('heading', { name: '5 项高相关证据' })).toBeInTheDocument()
    const clientHit = screen.getByRole('button', { name: /src\/clients\/payment-client\.ts/ })
    await user.click(clientHit)
    expect(screen.getByRole('article')).toHaveTextContent('src/clients/payment-client.ts')
    expect(screen.getByRole('article')).toHaveTextContent('requestPayment')

    await user.click(screen.getByRole('button', { name: '打包上下文' }))
    expect(await screen.findByRole('heading', { name: /5 证据来源/ })).toBeInTheDocument()
    expect(screen.getAllByText('src/retry/policy.ts', { exact: true }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '携带上下文开始会话' }))
    expect(onNewTask).toHaveBeenCalledWith(
      undefined,
      '支付重试策略在哪里实现？',
      expect.objectContaining({ hits: expect.arrayContaining([expect.objectContaining({ path: 'src/retry/policy.ts' })]) }),
    )

    await user.selectOptions(screen.getByRole('combobox', { name: '代码库' }), 'relay/web')
    expect(screen.queryByRole('heading', { name: '5 项高相关证据' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '代码库' })).toHaveValue('relay/web')
  })

  it('hides stale evidence as soon as the search inputs change', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: '支付重试策略在哪里实现？' }))
    await user.click(screen.getByRole('button', { name: '检索证据' }))
    expect(await screen.findByRole('heading', { name: '5 项高相关证据' })).toBeInTheDocument()

    const query = screen.getByRole('textbox', { name: '描述你要理解或修改的内容…' })
    await user.type(query, ' 新条件')
    expect(screen.queryByRole('heading', { name: '5 项高相关证据' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '从真实工程问题开始，而不是猜关键词' })).toBeInTheDocument()
  })
})
