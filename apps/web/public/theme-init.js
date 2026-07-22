try {
  const storedTheme = localStorage.getItem('cosmos.theme')
  const theme = storedTheme === 'light' || storedTheme === 'dark'
    ? storedTheme
    : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  const storedLocale = localStorage.getItem('cosmos.locale')
  const locale = storedLocale === 'zh' || storedLocale === 'en'
    ? storedLocale
    : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'

  document.documentElement.dataset.theme = theme
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'dark' ? '#0e1012' : '#f7f8f7',
  )
} catch {
  // The React preference provider applies safe defaults after startup.
}
