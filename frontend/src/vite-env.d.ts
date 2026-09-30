import 'vite/client'

declare global {
  interface Window {
    WebApp?: {
      initData: string
      initDataUnsafe?: { start_param?: string }
      disableVerticalSwipes?: () => void | Promise<unknown>
      enableClosingConfirmation?: () => void
      disableClosingConfirmation?: () => void
      colorScheme?: 'light' | 'dark'
      platform?: 'ios' | 'android' | 'desktop' | 'web' | string
      version?: string
      getLaunchContext?: () => Promise<{ entryPoint: 'tabbar' | 'default' }>
      getViewportSize?: () => Promise<{ height: string; width: string }>
      setHeaderColor?: (color: string) => void
      setBackgroundColor?: (color: string) => void
      BackButton?: {
        show: () => void
        hide: () => void
        onClick: (callback: () => void) => void
        offClick: (callback: () => void) => void
      }
      HapticFeedback?: {
        impactOccurred: (style: 'light' | 'medium' | 'heavy') => void
        selectionChanged?: () => void
      }
      downloadFile?: (url: string, name: string) => Promise<unknown> | void
      openLink?: (url: string) => void
      openMaxLink?: (url: string) => void
      shareContent?: (params: { text?: string; link?: string }) => Promise<unknown>
      shareMaxContent?: (params: {
        text?: string
        link?: string
        mid?: string
        chatType?: 'DIALOG' | 'CHAT'
      }) => Promise<unknown>
    }
  }
}
