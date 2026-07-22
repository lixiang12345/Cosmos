import type { MeResponse } from '@relay/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { AuthContext, type AuthContextValue } from '../auth/context'
import { PreferencesProvider } from '../preferences'
import { getMe } from '../services/relayApi'
import { useWorkspace } from './context'
import { WorkspaceGate } from './WorkspaceGate'
import { WorkspaceProvider } from './WorkspaceProvider'

vi.mock('../services/relayApi', () => ({ getMe: vi.fn() }))

const me: MeResponse = {
  actor: { id: 'user-a', kind: 'user' },
  organizations: [
    {
      id: 'organization-alpha', name: 'Alpha', role: 'organization_admin',
      spaces: [
        { id: 'space-alpha', name: 'Alpha Space', role: 'space_manager' },
        { id: 'space-shared', name: 'Shared Space', role: 'member' },
      ],
    },
    {
      id: 'organization-beta', name: 'Beta', role: 'member',
      spaces: [{ id: 'space-shared', name: 'Shared Space', role: 'viewer' }],
    },
  ],
}

function auth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated', mode: 'oidc', actorId: 'user-a', displayName: 'User A',
    demoMode: false, accessToken: 'access-token', credentialVersion: 1,
    handleUnauthorized: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
    ...overrides,
  }
}

function Probe() {
  const workspace = useWorkspace()
  return (
    <div>
      <output data-testid="status">{workspace.status}</output>
      <output data-testid="selection">{workspace.activeOrganization?.id}:{workspace.activeSpace?.id}</output>
      <output data-testid="error">{workspace.error}</output>
      <button type="button" onClick={() => workspace.selectSpace('organization-beta', 'space-shared')}>Select Beta</button>
      <button type="button" onClick={() => workspace.selectSpace('organization-hidden', 'space-hidden')}>Select hidden</button>
      <button type="button" onClick={workspace.refresh}>Retry</button>
    </div>
  )
}

function StatefulProbe() {
  const workspace = useWorkspace()
  const [draft, setDraft] = useState('')
  return (
    <div>
      <output data-testid="gated-selection">{workspace.activeOrganization?.id}:{workspace.activeSpace?.id}</output>
      <label>Draft<input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    </div>
  )
}

function gatedWorkspace(value: AuthContextValue) {
  return (
    <StrictMode>
      <PreferencesProvider>
        <AuthContext.Provider value={value}>
          <WorkspaceProvider>
            <WorkspaceGate><StatefulProbe /></WorkspaceGate>
          </WorkspaceProvider>
        </AuthContext.Provider>
      </PreferencesProvider>
    </StrictMode>
  )
}

function renderWorkspace(value: AuthContextValue = auth()) {
  return render(
    <StrictMode>
      <AuthContext.Provider value={value}>
        <WorkspaceProvider><Probe /></WorkspaceProvider>
      </AuthContext.Provider>
    </StrictMode>,
  )
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    vi.mocked(getMe).mockReset()
    window.localStorage.clear()
  })

  it('keeps an uncached initial discovery behind the loading state', async () => {
    let resolveDiscovery!: (response: MeResponse) => void
    vi.mocked(getMe).mockReturnValue(new Promise<MeResponse>((resolve) => { resolveDiscovery = resolve }))
    renderWorkspace()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    expect(screen.getByTestId('selection')).toHaveTextContent(':')
    resolveDiscovery(me)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
  })

  it('loads discovery once in StrictMode and chooses the first authorized Space', async () => {
    vi.mocked(getMe).mockResolvedValue(me)
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('selection')).toHaveTextContent('organization-alpha:space-alpha')
    expect(getMe).toHaveBeenCalledTimes(1)
    expect(getMe).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'access-token', onUnauthorized: expect.any(Function),
    }))
  })

  it('chooses the server-authoritative Default Space when no valid preference exists', async () => {
    vi.mocked(getMe).mockResolvedValue({
      ...me,
      organizations: [{
        ...me.organizations[0]!,
        spaces: [
          { ...me.organizations[0]!.spaces[0]!, isDefault: false },
          { ...me.organizations[0]!.spaces[1]!, isDefault: true },
        ],
      }],
    })
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent('organization-alpha:space-shared'))
  })

  it('honors only a persisted selection that still exists in the actor memberships', async () => {
    window.localStorage.setItem('relay.workspace.selection.v1', JSON.stringify({
      actorId: 'user-a', organizationId: 'organization-beta', spaceId: 'space-shared',
    }))
    vi.mocked(getMe).mockResolvedValue(me)
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent('organization-beta:space-shared'))
  })

  it('rejects stale, cross-actor, and unauthorized persisted selections', async () => {
    window.localStorage.setItem('relay.workspace.selection.v1', JSON.stringify({
      actorId: 'user-b', organizationId: 'organization-hidden', spaceId: 'space-hidden',
    }))
    vi.mocked(getMe).mockResolvedValue(me)
    const user = userEvent.setup()
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('selection')).toHaveTextContent('organization-alpha:space-alpha'))
    await user.click(screen.getByRole('button', { name: 'Select hidden' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('organization-alpha:space-alpha')
  })

  it('distinguishes an authenticated actor with no Space access', async () => {
    vi.mocked(getMe).mockResolvedValue({
      actor: me.actor,
      organizations: [{ id: 'organization-empty', name: 'Empty', role: 'viewer', spaces: [] }],
    })
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('empty'))
    expect(screen.getByTestId('selection')).toHaveTextContent(':')
  })

  it('fails closed on actor mismatch and retries a failed discovery', async () => {
    let resolveRetry!: (response: MeResponse) => void
    vi.mocked(getMe)
      .mockRejectedValueOnce(new Error('Membership service unavailable.'))
      .mockReturnValueOnce(new Promise<MeResponse>((resolve) => { resolveRetry = resolve }))
    const user = userEvent.setup()
    renderWorkspace()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    expect(screen.getByTestId('error')).toHaveTextContent('Membership service unavailable.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('loading'))
    resolveRetry({ ...me, actor: { id: 'user-b', kind: 'user' } })
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('does not match'))
    expect(screen.getByTestId('status')).toHaveTextContent('error')
    expect(getMe).toHaveBeenCalledTimes(2)
  })

  it('switches same-named Space ids with their Organization scope intact', async () => {
    vi.mocked(getMe).mockResolvedValue(me)
    const user = userEvent.setup()
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    await user.click(screen.getByRole('button', { name: 'Select Beta' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('organization-beta:space-shared')
    expect(JSON.parse(window.localStorage.getItem('relay.workspace.selection.v1') ?? '{}')).toEqual({
      actorId: 'user-a', organizationId: 'organization-beta', spaceId: 'space-shared',
    })
  })

  it('revalidates a same-actor token rotation without unmounting gated child state', async () => {
    let resolveRevalidation!: (response: MeResponse) => void
    const revalidation = new Promise<MeResponse>((resolve) => { resolveRevalidation = resolve })
    vi.mocked(getMe).mockResolvedValueOnce(me).mockReturnValueOnce(revalidation)
    const user = userEvent.setup()
    const view = render(gatedWorkspace(auth({ accessToken: 'token-a' })))
    await waitFor(() => expect(screen.getByTestId('gated-selection')).toHaveTextContent('organization-alpha:space-alpha'))
    await user.type(screen.getByRole('textbox', { name: 'Draft' }), 'unsaved task')

    view.rerender(gatedWorkspace(auth({ accessToken: 'token-b', credentialVersion: 2 })))

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved task')
    expect(screen.getByTestId('gated-selection')).toHaveTextContent('organization-alpha:space-alpha')
    resolveRevalidation(me)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved task'))
  })

  it('retains the last verified same-actor Workspace when background revalidation fails', async () => {
    vi.mocked(getMe)
      .mockResolvedValueOnce(me)
      .mockRejectedValueOnce(new Error('Membership service unavailable.'))
    const view = renderWorkspace(auth({ accessToken: 'token-a' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    view.rerender(
      <StrictMode>
        <AuthContext.Provider value={auth({ accessToken: 'token-b', credentialVersion: 2 })}>
          <WorkspaceProvider><Probe /></WorkspaceProvider>
        </AuthContext.Provider>
      </StrictMode>,
    )

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('status')).toHaveTextContent('ready')
    expect(screen.getByTestId('selection')).toHaveTextContent('organization-alpha:space-alpha')
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  })

  it('hides the previous Workspace synchronously when the authenticated actor changes', async () => {
    vi.mocked(getMe).mockResolvedValueOnce(me).mockImplementationOnce(() => new Promise(() => undefined))
    const view = render(gatedWorkspace(auth()))
    await waitFor(() => expect(screen.getByTestId('gated-selection')).toHaveTextContent('organization-alpha:space-alpha'))

    view.rerender(gatedWorkspace(auth({ actorId: 'user-b', accessToken: 'token-b' })))

    expect(screen.queryByTestId('gated-selection')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Draft' })).not.toBeInTheDocument()
    expect(screen.getByText(/Loading your Workspaces|正在加载你的工作区/)).toBeInTheDocument()
  })
})
