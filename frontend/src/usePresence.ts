import { useEffect } from 'react'
import { sendPresenceHeartbeat } from './api/auth'
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from './presence'

export function usePresence(active: boolean) {
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let disposed = false
    let sending = false
    const heartbeat = () => {
      if (disposed || sending || document.hidden || !navigator.onLine) return
      sending = true
      void sendPresenceHeartbeat(controller.signal)
        .catch(() => { })
        .finally(() => {
          sending = false
        })
    }
    const onVisible = () => {
      if (!document.hidden) heartbeat()
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS)
    window.addEventListener('focus', heartbeat)
    window.addEventListener('online', heartbeat)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', heartbeat)
      window.removeEventListener('online', heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}
