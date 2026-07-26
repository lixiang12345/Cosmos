import { useCallback, useEffect, useRef, useState } from 'react'
import { usePreferences } from '../preferences'
import {
  PrototypeKeyboardIcon,
  PrototypeMoonIcon,
  PrototypeSidebarIcon,
  PrototypeSunIcon,
  PrototypeTopbarSearchIcon,
} from './PrototypeIcons'

type PrototypePageTopbarProps = {
  crumb?: string
  compact?: boolean
  navigationCollapsed?: boolean
  onOpenNavigation?: () => void
  onOpenCommand?: () => void
}

function copy(locale: 'zh' | 'en', zh: string, en: string) {
  return locale === 'zh' ? zh : en
}

export function PrototypePageTopbar({
  crumb = '',
  compact = false,
  navigationCollapsed = false,
  onOpenNavigation,
  onOpenCommand,
}: PrototypePageTopbarProps) {
  const { locale, theme, toggleTheme } = usePreferences()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsTriggerRef = useRef<HTMLButtonElement>(null)
  const shortcutsCloseRef = useRef<HTMLButtonElement>(null)
  const shortcutsDialogRef = useRef<HTMLElement>(null)

  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false)
    shortcutsTriggerRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (!shortcutsOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeShortcuts()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(shortcutsDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    if (shortcutsOpen) shortcutsCloseRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeShortcuts, shortcutsOpen])

  return (
    <>
      <header className="prototype-topbar">
        <div className="prototype-topbar-left">
          {navigationCollapsed && onOpenNavigation ? (
            <button type="button" className="icon-btn" aria-label={copy(locale, '显示导航', 'Show sidebar')} title="Show sidebar (⌘.)" onClick={onOpenNavigation}>
              <PrototypeSidebarIcon aria-hidden="true" />
            </button>
          ) : null}
          {crumb ? <span className="prototype-crumb">{crumb}</span> : null}
        </div>
        <div className="prototype-topbar-right">
          {!compact ? <>
            <button type="button" className="pill-btn" disabled title={copy(locale, '设计文档未在生产控制面发布', 'Design documentation is not published in the production console')}>Philosophy</button>
            <button type="button" className="pill-btn" disabled title={copy(locale, '展示模式仅存在于原型', 'Showcase mode is prototype-only')}>Showcase</button>
            {onOpenCommand ? <button type="button" className="pill-btn" aria-label={copy(locale, '搜索 Cosmos', 'Search Cosmos')} title="Command palette (⌘K)" onClick={onOpenCommand}><PrototypeTopbarSearchIcon aria-hidden="true" />Search <kbd>⌘K</kbd></button> : null}
          </> : null}
          <button type="button" className="icon-btn" aria-label={theme === 'dark' ? copy(locale, '切换到浅色模式', 'Switch to light mode') : copy(locale, '切换到深色模式', 'Switch to dark mode')} title="Theme" onClick={toggleTheme}>
            {theme === 'dark' ? <PrototypeSunIcon aria-hidden="true" /> : <PrototypeMoonIcon aria-hidden="true" />}
          </button>
          <button ref={shortcutsTriggerRef} type="button" className="icon-btn" aria-label={copy(locale, '键盘快捷键', 'Keyboard shortcuts')} title="Shortcuts (⌘/)" onClick={() => setShortcutsOpen(true)}><PrototypeKeyboardIcon aria-hidden="true" /></button>
        </div>
      </header>
      {shortcutsOpen ? (
        <div className="prototype-shortcuts-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeShortcuts() }}>
          <section ref={shortcutsDialogRef} className="prototype-shortcuts" role="dialog" aria-modal="true" aria-labelledby="prototype-page-shortcuts-title">
            <header><h2 id="prototype-page-shortcuts-title">Keyboard shortcuts</h2><button ref={shortcutsCloseRef} type="button" className="icon-btn" aria-label={copy(locale, '关闭', 'Close')} onClick={closeShortcuts}>×</button></header>
            <div><span>Open command palette</span><kbd>⌘K</kbd><span>New session</span><kbd>⌘⇧O</kbd><span>Toggle left sidebar</span><kbd>⌘.</kbd><span>Enhance prompt</span><kbd>⌘E</kbd></div>
          </section>
        </div>
      ) : null}
    </>
  )
}
