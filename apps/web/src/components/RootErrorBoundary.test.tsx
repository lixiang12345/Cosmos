import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RootErrorBoundary } from './RootErrorBoundary'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/sessions/session-1')
})

afterEach(() => {
  consoleError.mockRestore()
})

function BrokenView({ error }: { error: Error }): never {
  throw error
}

describe('RootErrorBoundary', () => {
  it('shows an English asset-loading recovery screen for lazy chunk failures', () => {
    window.localStorage.setItem('cosmos.locale', 'en')
    window.localStorage.setItem('cosmos.theme', 'light')

    render(
      <RootErrorBoundary>
        <BrokenView error={new TypeError('Failed to fetch dynamically imported module')} />
      </RootErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'The application update could not be loaded' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Safe refresh' })).toBeEnabled()
    expect(screen.getByRole('main')).toHaveClass('root-error-screen--light')
    expect(screen.queryByText('Failed to fetch dynamically imported module')).not.toBeInTheDocument()
  })

  it('re-mounts the child tree when the user retries a render error', async () => {
    window.localStorage.setItem('cosmos.locale', 'zh')
    let broken = true

    function RecoverableView() {
      if (broken) throw new Error('render failed')
      return <p>Recovered view</p>
    }

    render(
      <RootErrorBoundary>
        <RecoverableView />
      </RootErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: '页面暂时无法显示' })).toBeInTheDocument()
    broken = false
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('Recovered view')).toBeInTheDocument()
  })

  it('allows one safe refresh per location inside the safety window', async () => {
    window.localStorage.setItem('cosmos.locale', 'en')
    const reloadPage = vi.fn()
    const now = 1_800_000_000_000

    const first = render(
      <RootErrorBoundary now={() => now} reloadPage={reloadPage}>
        <BrokenView error={new Error('render failed')} />
      </RootErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Safe refresh' }))
    expect(reloadPage).toHaveBeenCalledOnce()
    first.unmount()

    render(
      <RootErrorBoundary now={() => now + 1_000} reloadPage={reloadPage}>
        <BrokenView error={new Error('render failed again')} />
      </RootErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: 'Safe refresh' })).toBeDisabled()
    expect(screen.getByText(/prevent a reload loop/i)).toBeInTheDocument()
    expect(reloadPage).toHaveBeenCalledOnce()
  })
})
