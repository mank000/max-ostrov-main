import { useEffect, useState } from 'react'

type Host = {
  initData?: string
  colorScheme?: 'light' | 'dark'
  ready?: () => void
  expand?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  disableVerticalSwipes?: () => void | Promise<unknown>
  disableClosingConfirmation?: () => void
  onEvent?: (name: string, fn: () => void) => void
  offEvent?: (name: string, fn: () => void) => void
  BackButton?: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void }
  HapticFeedback?: { selectionChanged: () => void; notificationOccurred: (kind: 'success') => void }
}



export function getHost() {
  const host = window as unknown as { WebApp?: Host }
  const app = host.WebApp
  return app?.initData ? app : undefined
}

function protectClosing(host: Host | undefined) {
  if (!host) return
  try { void Promise.resolve(host.disableVerticalSwipes?.()).catch(() => {}) } catch { /* Older hosts may not support this method. */ }
  try { host.disableClosingConfirmation?.() } catch { /* Older hosts may not support this method. */ }
}

export function tap(win = false) {
  try {
    const feedback = getHost()?.HapticFeedback
    if (win) feedback?.notificationOccurred('success')
    else feedback?.selectionChanged()
  } catch { /* Older hosts may not support haptics. */ }
}

export function useTheme(embeddedTheme?: 'light' | 'dark') {
  const [choice, setChoice] = useState<'light' | 'dark' | null>(null)
  const [system, setSystem] = useState(() => getHost()?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const theme = embeddedTheme || choice || system
  useEffect(() => {
    if (embeddedTheme) return
    const host = getHost()
    const media = matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSystem(host?.colorScheme || (media.matches ? 'dark' : 'light'))
    host?.onEvent?.('themeChanged', sync)
    media.addEventListener('change', sync)
    host?.ready?.()
    host?.expand?.()
    const protect = () => { if (!document.hidden) protectClosing(getHost()) }
    protect()
    document.addEventListener('visibilitychange', protect)
    window.addEventListener('pageshow', protect)
    return () => {
      host?.offEvent?.('themeChanged', sync)
      media.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', protect)
      window.removeEventListener('pageshow', protect)
    }
  }, [embeddedTheme])
  useEffect(() => {
    if (embeddedTheme) return
    document.documentElement.dataset.theme = theme
    const color = theme === 'dark' ? '#17181c' : '#ffffff'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
    try {
      getHost()?.setHeaderColor?.(color)
      getHost()?.setBackgroundColor?.(color)
    } catch { /* Custom chrome colors are optional in old clients. */ }
  }, [theme, embeddedTheme])
  return { theme, toggle: () => setChoice(theme === 'dark' ? 'light' : 'dark') }
}
