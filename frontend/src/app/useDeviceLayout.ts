import { useSyncExternalStore } from 'react'

// Layout follows the available WebView space, including a resized desktop window.
export const desktopQuery = '(min-width: 960px)'
const media = window.matchMedia(desktopQuery)
const subscribe = (notify: () => void) => {
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}

export function useDeviceLayout() {
  return useSyncExternalStore(subscribe, () => media.matches, () => false)
}
