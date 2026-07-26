import type { FileDto, FileVersionDto } from '@cosmos/contracts'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { getFileContent, listFiles, listFileVersions } from '../services/cosmosApi'
import { RemoteFilesPage, type RemoteFilesPageProps } from './RemoteFilesPage'

vi.mock('../services/cosmosApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/cosmosApi')>(),
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

    const folderRow = await screen.findByRole('row', { name: '打开文件夹: standards' })
    await user.click(folderRow)
    await user.click(screen.getByRole('row', { name: '预览文件: release.md' }))
    expect(await screen.findByText('# Release notes')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '组织文件' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /release\.md/ })).toBeInTheDocument()
    await user.click(screen.getByRole('treeitem', { name: 'standards' }))
    expect(screen.queryByRole('treeitem', { name: /release\.md/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('treeitem', { name: 'standards' }))
    expect(screen.getByRole('treeitem', { name: /release\.md/ })).toBeInTheDocument()
    await user.click(screen.getByRole('row', { name: '预览文件: release.md' }))
    expect(screen.getByRole('button', { name: '上传不可用' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '新建文件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制路径' }))
    expect(writeText).toHaveBeenCalledWith('organization/standards/release.md')
    await user.click(screen.getByRole('button', { name: '请求修改' }))
    expect(onRequestModification).toHaveBeenCalledWith('organization/standards/release.md')

    await user.click(screen.getByRole('button', { name: /版本历史/ }))
    expect(screen.getByRole('menuitemradio', { name: /v2 · 当前/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /v1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: /v1/ }))
    await user.click(screen.getByRole('button', { name: /版本历史/ }))
    expect(screen.getByRole('menuitemradio', { name: /v1/ })).toHaveAttribute('aria-checked', 'true')

    const fileIconPaths = screen.getByRole('row', { name: '预览文件: release.md' }).querySelectorAll('svg path')
    expect(fileIconPaths[0]).toHaveAttribute('d', 'M4.2 2.5h4.3L11.8 5.8V13.5H4.2V2.5z')
    expect(fileIconPaths[1]).toHaveAttribute('d', 'M8.5 2.5V5.8h3.3')
  })

  it('server-searches within the selected scope and disables change requests for viewers', async () => {
    const user = userEvent.setup()
    renderPage({ sessionCreationEnabled: false })
    await user.click(await screen.findByRole('row', { name: '打开文件夹: standards' }))
    await user.click(screen.getByRole('row', { name: '预览文件: release.md' }))
    await screen.findByText('# Release notes')

    expect(screen.getByRole('button', { name: '请求修改' })).toBeDisabled()
    await user.keyboard('{Meta>}p{/Meta}')
    const searchInput = screen.getByRole('textbox', { name: '搜索文件' })
    expect(searchInput).toHaveFocus()
    await user.type(searchInput, 'release')
    await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(
      file.organizationId,
      'space-a',
      { scope: 'organization', search: 'release', limit: 100 },
      expect.objectContaining({ accessToken: 'token-a' }),
      expect.any(AbortSignal),
    ))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '搜索文件' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Organization VFS' })).toHaveFocus())
  })

  it('loads the exact Session Workspace scope and returns governed changes to the conversation', async () => {
    const user = userEvent.setup()
    const workspaceFile: FileDto = {
      ...file,
      spaceId: 'space-a',
      scope: 'workspace',
      sessionId: 'session-1',
    }
    const workspaceVersions = versions.map((version) => ({ ...version, spaceId: 'space-a' }))
    const onBackToSession = vi.fn()
    const onRequestModification = vi.fn()
    vi.mocked(listFiles).mockResolvedValueOnce({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-a',
      scope: 'workspace',
      ownerUserId: null,
      sessionId: 'session-1',
      items: [workspaceFile],
      page: { nextCursor: null, hasMore: false },
    })
    vi.mocked(listFileVersions).mockResolvedValueOnce({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-a',
      fileId: file.id,
      items: workspaceVersions,
      page: { nextCursor: null, hasMore: false },
    })

    renderPage({
      scope: 'workspace',
      sessionId: 'session-1',
      onBackToSession,
      onRequestModification,
    })

    expect(await screen.findByRole('heading', { name: '会话工作区文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Workspace VFS' })).toBeInTheDocument()
    expect(listFiles).toHaveBeenCalledWith(
      file.organizationId,
      'space-a',
      { scope: 'workspace', sessionId: 'session-1', search: undefined, limit: 100 },
      expect.objectContaining({ accessToken: 'token-a' }),
      expect.any(AbortSignal),
    )
    await user.click(screen.getByRole('button', { name: '返回会话' }))
    expect(onBackToSession).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('row', { name: '打开文件夹: standards' }))
    await user.click(screen.getByRole('row', { name: '预览文件: release.md' }))
    await user.click(screen.getByRole('button', { name: '请求修改' }))
    expect(onRequestModification).toHaveBeenCalledWith('workspace/standards/release.md')
  })

  it('renders the prototype loading state before a scoped empty response', async () => {
    let resolveList: ((value: Awaited<ReturnType<typeof listFiles>>) => void) | undefined
    vi.mocked(listFiles).mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve }))
    renderPage()

    expect(screen.getByText('正在加载…')).toBeInTheDocument()
    expect(screen.getByText('正在加载文件…')).toBeInTheDocument()

    await act(async () => resolveList?.({
      organizationId: file.organizationId,
      requestedSpaceId: 'space-a',
      scope: 'organization',
      ownerUserId: null,
      sessionId: null,
      items: [],
      page: { nextCursor: null, hasMore: false },
    }))
    expect(await screen.findByText('当前范围没有文件')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '空文件夹' })).toBeInTheDocument()
  })

  it('shows a recoverable permission-style error without concealing the retry path', async () => {
    const user = userEvent.setup()
    vi.mocked(listFiles)
      .mockRejectedValueOnce(new Error('You do not have permission to list Files.'))
      .mockResolvedValueOnce({
        organizationId: file.organizationId,
        requestedSpaceId: 'space-a',
        scope: 'organization',
        ownerUserId: null,
        sessionId: null,
        items: [],
        page: { nextCursor: null, hasMore: false },
      })
    renderPage()

    const tree = screen.getByRole('complementary', { name: '文件树' })
    expect(await within(tree).findByRole('alert')).toHaveTextContent('You do not have permission to list Files.')
    await user.click(within(tree).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('当前范围没有文件')).toBeInTheDocument()
    expect(listFiles).toHaveBeenCalledTimes(2)
  })
})
