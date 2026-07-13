import type { FileDto, FileVersionDto } from '@relay/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { getFileContent, listFiles, listFileVersions } from '../services/relayApi'
import { RemoteFilesPage, type RemoteFilesPageProps } from './RemoteFilesPage'

vi.mock('../services/relayApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/relayApi')>(),
  getFileContent: vi.fn(),
  listFiles: vi.fn(),
  listFileVersions: vi.fn(),
}))

const file: FileDto = {
  organizationId: 'organization-a',
  spaceId: null,
  id: 'file-1',
  scope: 'organization',
  ownerUserId: null,
  sessionId: null,
  path: 'standards/release.md',
  mimeType: 'text/markdown',
  size: 15,
  latestVersionId: 'version-2',
  lastWrittenByToolCallId: 'tool-2',
  lastWrittenByExpertId: 'expert-release',
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T02:00:00.000Z',
  archivedAt: null,
  version: 2,
}

const versions: FileVersionDto[] = [2, 1].map((version) => ({
  organizationId: file.organizationId,
  spaceId: null,
  fileId: file.id,
  id: `version-${version}`,
  version,
  contentHash: String(version).repeat(64),
  size: version === 2 ? file.size : 9,
  createdByToolCallId: `tool-${version}`,
  sourceSessionId: 'session-1',
  sourceTurnId: `turn-${version}`,
  createdAt: `2026-07-13T0${version}:00:00.000Z`,
}))

const props: RemoteFilesPageProps = {
  organizationId: file.organizationId,
  spaceId: 'space-a',
  scope: 'organization',
  auth: { accessToken: 'token-a', requestIdentity: 'actor-a\u00001' },
  credentialVersion: 1,
  sessionCreationEnabled: true,
  onRequestModification: vi.fn(),
}

function renderPage(overrides: Partial<RemoteFilesPageProps> = {}) {
  return render(
    <PreferencesProvider>
      <MemoryRouter initialEntries={['/files/organization']}>
        <RemoteFilesPage {...props} {...overrides} />
      </MemoryRouter>
    </PreferencesProvider>,
  )
}

describe('Remote Files page', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    vi.mocked(listFiles).mockReset().mockResolvedValue({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-a',
      scope: 'organization',
      ownerUserId: null,
      sessionId: null,
      items: [file],
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(listFileVersions).mockReset().mockResolvedValue({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-a',
      fileId: file.id,
      items: versions,
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(getFileContent).mockReset().mockResolvedValue({
      blob: new Blob(['# Release notes'], { type: 'text/markdown' }),
      contentType: 'text/markdown',
      fileName: 'release.md',
      etag: `"sha256:${versions[0]?.contentHash}"`,
    })
  })

  it('browses, previews, copies, and requests governed changes without mutation controls', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const onRequestModification = vi.fn()
    renderPage({ onRequestModification })

    expect(await screen.findByText('# Release notes')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '组织文件' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /release\.md/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建文件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制路径' }))
    expect(writeText).toHaveBeenCalledWith('organization/standards/release.md')
    await user.click(screen.getByRole('button', { name: '请求修改' }))
    expect(onRequestModification).toHaveBeenCalledWith('organization/standards/release.md')

    await user.click(screen.getByRole('button', { name: /版本历史/ }))
    expect(screen.getByRole('button', { name: /v2 · 当前/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /v1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /v1/ }))
    expect(screen.getByText('9 B')).toBeInTheDocument()
  })

  it('server-searches within the selected scope and disables change requests for viewers', async () => {
    const user = userEvent.setup()
    renderPage({ sessionCreationEnabled: false })
    await screen.findByText('# Release notes')

    expect(screen.getByRole('button', { name: '请求修改' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '搜索文件' }), 'release')
    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(
      file.organizationId,
      'space-a',
      { scope: 'organization', search: 'release', limit: 100 },
      expect.objectContaining({ accessToken: 'token-a' }),
      expect.any(AbortSignal),
    ))
  })
})
