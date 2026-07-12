import { Languages, Moon, Sun } from 'lucide-react'
import { usePreferences } from '../preferences'
import { IconButton } from './ui'

export function GlobalControls({ className = '' }: { className?: string }) {
  const { locale, theme, t, toggleLocale, toggleTheme } = usePreferences()

  const themeLabel = theme === 'dark'
    ? t('preferences.switchToLight')
    : t('preferences.switchToDark')
  const localeLabel = locale === 'zh'
    ? t('preferences.switchToEnglish')
    : t('preferences.switchToChinese')

  return (
    <div
      className={`global-controls ${className}`.trim()}
      role="group"
      aria-label={t('preferences.controls')}
    >
      <IconButton
        icon={theme === 'dark' ? Sun : Moon}
        label={themeLabel}
        onClick={toggleTheme}
      />
      <IconButton
        icon={Languages}
        label={localeLabel}
        className="locale-toggle"
        data-locale={locale === 'zh' ? '中' : 'EN'}
        onClick={toggleLocale}
      />
    </div>
  )
}
