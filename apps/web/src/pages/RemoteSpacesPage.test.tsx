import type { SpaceDto, SpaceMigrationPreview } from '@cosmos/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import {
  createSpace,
  listSpaces,
  previewSpaceMigration,
  setDefaultSpace,
  updateSpace,
} from '../services/cosmosApi'
import { RemoteSpacesPage } from './RemoteSpacesPage'

vi.mock('../services/cosmosApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/cosmosApi')>(),
  createSpace: vi.fn(), listSpaces: vi.fn(), previewSpaceMigration: vi.fn(),
  setDefaultSpace: vi.fn(), updateSpace: vi.fn(),
}))

const now = '2026-07-22T00:00:00.000Z'
const platform: SpaceDto = {
  id: 'space-platform', organizationId: 'cosmos', name: 'Platform', slug: 'platform',
  description: 'Platform work.', isDefault: true, status: 'active', defaultExpertId: null,
  defaultEnvironmentId: null, settings: {}, version: 1, createdAt: now, updatedAt: now,
}
const commerce: SpaceDto = { ...platform, id: 'space-commerce', name: 'Commerce', slug: 'commerce', description: 'Commerce work.', isDefault: false }
const preview: SpaceMigrationPreview = {
  source: platform, target: commerce,
  resourceCounts: { sessions: 4, experts: 2, environments: 1, automations: 1, files: 3 },
  canMigrate: false, blockingReasons: ['The Default Space cannot be migrated.'],
}
const props = {
  organizationId: 'cosmos', activeSpaceId: platform.id,
  accessibleSpaces: [
    { id: platform.id, name: platform.name, role: 'space_manager' as const, isDefault: true },
    { id: commerce.id, name: commerce.name, role: 'space_manager' as const },
  ],
  auth: { accessToken: 'token-a' }, credentialVersion: 1, canManage: true,
  onSelectSpace: vi.fn(), onWorkspaceRefresh: vi.fn(),
}

function renderPage(overrides: Partial<typeof props> = {}) {
  return render(<PreferencesProvider><RemoteSpacesPage {...props} {...overrides} /></PreferencesProvider>)
}

describe('Remote Spaces page', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    vi.clearAllMocks()
    vi.mocked(listSpaces).mockResolvedValue({ items: [platform, commerce], projectionUpdatedAt: now })
  })

  it('shows authority data, switches scope, and permission-gates mutations', async () => {
    const user = userEvent.setup()
    const onSelectSpace = vi.fn()
    const first = renderPage({ onSelectSpace })
    expect(await screen.findByText('Platform work.')).toBeInTheDocument()
    expect(screen.getByText('默认')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '切换到此 Space' }))
    expect(onSelectSpace).toHaveBeenCalledWith(commerce.id)
    first.unmount()

    renderPage({ canManage: false, credentialVersion: 2 })
    await screen.findByText('Platform work.')
    expect(screen.queryByRole('button', { name: '创建 Space' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })

  it('creates, edits, and changes the Default Space with server versions', async () => {
    const user = userEvent.setup()
    const created = { ...commerce, id: 'space-release', name: 'Release', slug: 'release' }
    vi.mocked(createSpace).mockResolvedValueOnce(created)
    vi.mocked(updateSpace).mockResolvedValueOnce({ ...commerce, description: 'Updated commerce.', version: 2 })
    vi.mocked(setDefaultSpace).mockResolvedValueOnce({ ...commerce, isDefault: true, version: 2 })
    renderPage()
    await screen.findByText('Platform work.')

    await user.click(screen.getByRole('button', { name: '创建 Space' }))
    const createForm = screen.getByRole('heading', { name: '编辑工作区' }).closest('form')!
    await user.type(within(createForm).getByLabelText('名称'), 'Release')
    await user.click(within(createForm).getByRole('button', { name: '保存 Space' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Space 已创建。')
    expect(createSpace).toHaveBeenCalledWith('cosmos', expect.objectContaining({ name: 'Release' }), expect.stringMatching(/^space-create-/), props.auth)

    const commerceCard = screen.getByRole('heading', { name: 'Commerce' }).closest('article')!
    await user.click(within(commerceCard).getByRole('button', { name: '编辑' }))
    const editForm = screen.getByRole('heading', { name: '编辑工作区' }).closest('form')!
    const description = within(editForm).getByLabelText('描述')
    await user.clear(description); await user.type(description, 'Updated commerce.')
    await user.click(within(editForm).getByRole('button', { name: '保存 Space' }))
    await waitFor(() => expect(updateSpace).toHaveBeenCalledWith('cosmos', commerce.id, expect.objectContaining({ description: 'Updated commerce.' }), 1, expect.stringMatching(/^space-update-/), props.auth))

    const updatedCard = screen.getByRole('heading', { name: 'Commerce' }).closest('article')!
    await user.click(within(updatedCard).getByRole('button', { name: '设为默认' }))
    await waitFor(() => expect(setDefaultSpace).toHaveBeenCalledWith('cosmos', commerce.id, 2, expect.stringMatching(/^space-default-/), props.auth))
    expect(props.onWorkspaceRefresh).toHaveBeenCalled()
  })

  it('renders load errors and a non-destructive migration impact preview', async () => {
    const user = userEvent.setup()
    vi.mocked(previewSpaceMigration).mockResolvedValueOnce(preview)
    const first = renderPage()
    await screen.findByText('Platform work.')
    await user.selectOptions(screen.getByLabelText('迁移目标 Space'), commerce.id)
    await user.click(screen.getByRole('button', { name: '计算影响' }))
    expect(await screen.findByText('Platform → Commerce')).toBeInTheDocument()
    expect(screen.getByText('The Default Space cannot be migrated.')).toBeInTheDocument()
    expect(screen.getByText(/真实迁移执行将在/)).toBeInTheDocument()
    first.rerender(<PreferencesProvider><RemoteSpacesPage key={commerce.id} {...props} activeSpaceId={commerce.id} /></PreferencesProvider>)
    await screen.findByText('Commerce work.')
    expect(screen.queryByText('Platform → Commerce')).not.toBeInTheDocument()
    expect(screen.getByLabelText('迁移目标 Space')).toHaveValue('')
    first.unmount()

    vi.mocked(listSpaces).mockRejectedValueOnce(new Error('Space service unavailable.'))
    renderPage({ credentialVersion: 2 })
    expect(await screen.findByRole('alert')).toHaveTextContent('Space service unavailable.')
  })
})
