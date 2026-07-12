import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('opens all sessions through the SPA router without losing mounted context', async () => {
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

    await user.click(screen.getByRole('button', { name: '查看全部' }))

    expect(screen.getByRole('heading', { name: 'Sessions route' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'SPA context' })).toHaveTextContent('preserved:/sessions')
  })
})
