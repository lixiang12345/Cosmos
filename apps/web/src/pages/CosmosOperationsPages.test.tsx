import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from '../preferences'
import { CosmosHomePage } from './CosmosOperationsPages'

const expert = {
  id: 'expert-reviewer',
  version: 1,
  name: 'Code reviewer',
  description: 'Reviews production changes.',
  launchGuidance: 'Describe the change to review.',
  group: 'Engineering',
  tools: 'Repository read',
  environment: 'Production',
  approval: 'Required',
  successRate: '98%',
  repository: 'cosmos/platform',
}

function SpaContextProbe() {
  const location = useLocation()
  const [contextValue, setContextValue] = useState('initial')

  return (
    <>
      <button type="button" onClick={() => setContextValue('preserved')}>Prime SPA context</button>
      <output aria-label="SPA context">{contextValue}:{location.pathname}</output>
      <Routes>
        <Route path="/home" element={<CosmosHomePage experts={[expert]} />} />
        <Route path="/sessions" element={<h1>Sessions route</h1>} />
      </Routes>
    </>
  )
}

describe('Cosmos home navigation', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
  })

  it('opens an Expert without losing mounted SPA context', async () => {
    const user = userEvent.setup()
    render(
      <PreferencesProvider>
        <MemoryRouter initialEntries={['/home']}>
          <SpaContextProbe />
        </MemoryRouter>
      </PreferencesProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Prime SPA context' }))
    expect(screen.getByRole('status', { name: 'SPA context' })).toHaveTextContent('preserved:/home')

    await user.click(screen.getByRole('radio', { name: expert.name }))

    expect(screen.getByText(expert.description)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'SPA context' })).toHaveTextContent('preserved:/home')
  })

  it('previews ContextEngine evidence and requires confirmation before launch', async () => {
    const user = userEvent.setup()
    const contextPack = {
      provider: 'contextengine-plugin' as const,
      repository: 'cosmos/platform',
      task: '检查鉴权边界',
      packedText: 'src/auth.ts evidence',
      estimatedTokens: 832,
      truncated: false,
      durationMs: 12,
      hits: [{
        path: 'src/auth.ts', startLine: 10, endLine: 28, symbol: 'authorizeSpace', language: 'typescript',
        content: 'function authorizeSpace() {}', preview: 'authorizeSpace', score: 0.95, source: 'hybrid',
        intent: 'implementation', channels: ['fts', 'semantic'],
      }],
    }
    const contextPreflight = vi.fn(async () => contextPack)
    const onCreateSession = vi.fn(async () => undefined)
    render(
      <PreferencesProvider>
        <MemoryRouter>
          <CosmosHomePage
            experts={[expert]}
            contextEnabled
            contextPreflight={contextPreflight}
            onCreateSession={onCreateSession}
          />
        </MemoryRouter>
      </PreferencesProvider>,
    )

    await user.type(screen.getByRole('textbox', { name: '会话任务' }), '检查鉴权边界')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByLabelText('上下文预检')).toHaveTextContent('src/auth.ts')
    expect(screen.getByLabelText('上下文预检')).toHaveTextContent('832')
    expect(onCreateSession).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '附加并启动' }))

    expect(onCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '检查鉴权边界',
      contextPack,
    }))
  })

  it('supports the prototype shortcuts dialog and restores trigger focus on Escape', async () => {
    const user = userEvent.setup()
    render(
      <PreferencesProvider>
        <MemoryRouter>
          <CosmosHomePage experts={[expert]} />
        </MemoryRouter>
      </PreferencesProvider>,
    )

    const trigger = screen.getByRole('button', { name: '键盘快捷键' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '键盘快捷键' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('enhances the prompt with the prototype shortcut and submits Enter without Shift', async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn(async () => undefined)
    render(
      <PreferencesProvider>
        <MemoryRouter>
          <CosmosHomePage experts={[expert]} onCreateSession={onCreateSession} />
        </MemoryRouter>
      </PreferencesProvider>,
    )

    const task = screen.getByRole('textbox', { name: '会话任务' })
    await user.type(task, '检查边界')
    await user.keyboard('{Control>}e{/Control}')
    expect((task as HTMLTextAreaElement).value).toContain('可验证的完成标准')

    await user.keyboard('{Enter}')
    expect(onCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      expertId: expert.id,
      prompt: expect.stringContaining('检查边界'),
    }))
  })
})
