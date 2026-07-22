import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlPlaneProvider } from '../features/control-plane'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { CosmosFilesPage } from './CosmosOperationsPages'

function renderFiles() {
  return render(
    <PreferencesProvider>
      <MemoryRouter initialEntries={['/files/organization']}>
        <ControlPlaneProvider>
          <CosmosFilesPage initialScope="organization" />
        </ControlPlaneProvider>
      </MemoryRouter>
    </PreferencesProvider>,
  )
}

describe('Cosmos Files browser', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    window.localStorage.removeItem('cosmos.controlPlane.v1')
  })

  it('browses scoped files without exposing direct mutation actions', async () => {
    const user = userEvent.setup()
    renderFiles()

    expect(screen.getByRole('heading', { level: 1, name: '组织文件' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: '查看 AGENTS.md' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: '查看 docs/payment-architecture.md' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建文件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('treeitem', { name: 'docs' }))
    expect(screen.queryByRole('treeitem', { name: '查看 docs/payment-architecture.md' })).not.toBeInTheDocument()
  })

  it('copies the scoped path and exposes immutable version snapshots', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderFiles()

    await user.click(screen.getByRole('button', { name: '复制路径' }))
    expect(writeText).toHaveBeenCalledWith('organization/AGENTS.md')
    expect(screen.getByRole('status')).toHaveTextContent('路径已复制')

    await user.click(screen.getByRole('button', { name: /版本历史/ }))
    expect(screen.getByRole('button', { name: /v1 · 当前/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复版本/ })).not.toBeInTheDocument()
  })
})
