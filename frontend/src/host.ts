import { requestLocation } from './location'

type HostProvider = 'max' | 'browser'

type HostLocation = {
  latitude: number
  longitude: number
}

type MiniAppBackButton = {
  show: () => void
  hide: () => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
}

type MiniAppHost = {
  platform?: string
  downloadFile?: (url: string, name: string) => Promise<unknown> | void
  initData: string
  initDataUnsafe?: { start_param?: string }
  colorScheme?: 'light' | 'dark'
  close?: () => void
  ready?: () => void
  expand?: () => void
  disableVerticalSwipes?: () => void | Promise<unknown>
  disableClosingConfirmation?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  BackButton?: MiniAppBackButton
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void
    selectionChanged?: () => void
  }
  openLink?: (url: string) => void
  openMaxLink?: (url: string) => void
  shareContent?: (params: { text?: string; link?: string }) => Promise<unknown>
  shareMaxContent?: (params: { text?: string; link?: string }) => Promise<unknown>
}

export type HostAdapter = {
  provider: HostProvider
  identity: 'MAX' | 'Браузер'
  initData: string
  colorScheme?: 'light' | 'dark'
  backButton?: MiniAppBackButton
  isEmbedded: boolean
  ready: () => void
  expand: () => void
  protectClosing: () => void
  setChromeColor: (color: string) => void
  requestLocation: () => Promise<HostLocation | null>
  hapticSelection: () => boolean
  hapticImpact: (style?: 'light' | 'medium' | 'heavy') => boolean
  openChat: (chatId: string) => boolean
  openLink: (url: string) => void
  downloadFile?: (url: string, name: string) => Promise<unknown>
  share: (params: { text?: string; link?: string }) => Promise<boolean>
}

function maxHost(): MiniAppHost | undefined {
  if (typeof window === 'undefined') return undefined
  return window.WebApp?.initData ? window.WebApp : undefined
}

function safeWebURL(value: string): string | null {
  try {
    const base = typeof window === 'undefined' ? 'https://kutezh.local' : window.location?.href
    const url = new URL(value, base)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export function getHost(): HostAdapter {
  const max = maxHost()
  const provider: HostProvider = max ? 'max' : 'browser'
  const raw = max
  const identity = max ? 'MAX' : 'Браузер'

  const openLink = (value: string) => {
    const url = safeWebURL(value)
    if (!url) return
    const hostname = new URL(url).hostname.toLowerCase()
    if (provider === 'max' && hostname === 'max.ru' && raw?.openMaxLink) raw.openMaxLink(url)
    else if (raw?.openLink) raw.openLink(url)
    else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  }

  return {
    provider,
    identity,
    initData: max?.initData || '',
    colorScheme: raw?.colorScheme,
    backButton: raw?.BackButton,
    isEmbedded: provider !== 'browser',
    ready: () => {
      try {
        raw?.ready?.()
      } catch { }
    },
    expand: () => {
      try {
        raw?.expand?.()
      } catch { }
    },
    protectClosing: () => {
      try { void Promise.resolve(maxHost()?.disableVerticalSwipes?.()).catch(() => {}) } catch {}
      try { maxHost()?.disableClosingConfirmation?.() } catch { }
    },
    setChromeColor: (color) => {
      try {
        raw?.setHeaderColor?.(color)
      } catch { }
      try {
        raw?.setBackgroundColor?.(color)
      } catch { }
    },
    requestLocation,
    hapticSelection: () => {
      if (!raw?.HapticFeedback?.selectionChanged) return false
      try {
        raw.HapticFeedback.selectionChanged()
        return true
      } catch {
        return false
      }
    },
    hapticImpact: (style = 'light') => {
      if (!raw?.HapticFeedback?.impactOccurred) return false
      try {
        raw.HapticFeedback.impactOccurred(style)
        return true
      } catch {
        return false
      }
    },
    openLink,
    downloadFile: raw?.downloadFile && raw.platform !== 'web' ? (value, name) => {
      const url = safeWebURL(value)
      if (!url || new URL(url).protocol !== 'https:')
        return Promise.reject(new Error('Скачивание доступно только через HTTPS'))
      return Promise.resolve(raw.downloadFile!(url, name))
    } : undefined,
    openChat: (chatId) => {
      if (!/^[1-9]\d{0,18}$/.test(chatId)) return false
      if (raw && raw.platform !== 'web' && raw.openLink) {
        raw.openLink(`max://chat/id/${chatId}`)
        raw.close?.()
        return true
      }
      if (raw?.openMaxLink) {
        raw.openMaxLink(`https://max.ru/${chatId}`)
        return true
      }
      if (typeof window === 'undefined') return false
      window.open(`https://web.max.ru/${chatId}`, '_blank', 'noopener,noreferrer')
      return true
    },
    share: async (params) => {
      if (provider === 'max' && raw?.shareMaxContent) {
        await raw.shareMaxContent(params)
        return true
      }
      if (provider === 'max' && raw?.shareContent) {
        await raw.shareContent(params)
        return true
      }
      if (provider === 'max') {
        const text = [params.text, params.link].filter(Boolean).join('\n')
        if (text) {
          openLink(`https://max.ru/:share?text=${encodeURIComponent(text)}`)
          return true
        }
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: params.text, url: params.link })
        return true
      }
      return false
    },
  }
}
