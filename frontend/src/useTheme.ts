import { useEffect, useState } from 'react'
import type { HostAdapter } from './host'
import { readSetting, saveSetting } from './ui-utils'

export type Theme = 'light' | 'dark'
export type ThemeMode = 'auto' | Theme

export function useTheme(host: HostAdapter) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const preference = readSetting('kutezh-theme')
    return preference === 'light' || preference === 'dark' || preference === 'auto'
      ? preference
      : 'auto'
  })
  const [systemTheme, setSystemTheme] = useState<Theme>(() => {
    if (typeof window.matchMedia === 'function')
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    return host.colorScheme === 'dark' ? 'dark' : 'light'
  })
  const theme: Theme = themeMode === 'auto' ? systemTheme : themeMode

  useEffect(() => {
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    const syncSystemTheme = () =>
      setSystemTheme(
        media ? (media.matches ? 'dark' : 'light') : host.colorScheme === 'dark' ? 'dark' : 'light',
      )
    syncSystemTheme()
    media?.addEventListener('change', syncSystemTheme)
    window.addEventListener('focus', syncSystemTheme)
    const syncWhenVisible = () => {
      if (!document.hidden) syncSystemTheme()
    }
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      media?.removeEventListener('change', syncSystemTheme)
      window.removeEventListener('focus', syncSystemTheme)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [host.colorScheme])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.themeMode = themeMode
    document.documentElement.style.colorScheme = theme
    host.setChromeColor(theme === 'dark' ? '#17181c' : '#ffffff')
    host.ready()
    host.expand()
  }, [theme, themeMode, host])
  function changeTheme(next: ThemeMode) {
    setThemeMode(next)
    saveSetting('kutezh-theme', next)
  }
  return { theme, themeMode, changeTheme }
}
