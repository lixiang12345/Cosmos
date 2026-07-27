import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PREFERENCE_STORAGE_KEYS,
  PreferencesProvider,
  usePreferences,
} from './preferences'

function LocaleProbe() {
  const { locale, toggleLocale } = usePreferences()
  return <button type="button" onClick={toggleLocale}>{locale}</button>
}

describe('PreferencesProvider locale contract', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'en')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'light')
  })

  it('restores, exposes, persists, and announces the selected document language', async () => {
    const user = userEvent.setup()
    render(<PreferencesProvider><LocaleProbe /></PreferencesProvider>)

    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(screen.getByRole('button', { name: 'en' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'en' }))

    expect(screen.getByRole('button', { name: 'zh' })).toBeVisible()
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.localStorage.getItem(PREFERENCE_STORAGE_KEYS.locale)).toBe('zh')
  })
})
