import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { captionReturnKey, parseCaptionReturn, type CaptionReturnCache } from './captionCache'

export function useClipCaption(clipId: number, active: boolean) {
  const caption = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const cancelRestore = useRef<(() => void) | null>(null)
  const localCache = useRef<CaptionReturnCache | null>(null)

  useEffect(() => {
    setExpanded(false)
    localCache.current = null
    return () => {
      cancelRestore.current?.()
      cancelRestore.current = null
    }
  }, [clipId, active])

  function toggleCaption(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    cancelRestore.current?.()
    cancelRestore.current = null
    const button = event.currentTarget
    const feed = button.closest<HTMLElement>('.clips-feed')
    const captionEl = caption.current
    button.blur()
    if (captionEl) captionEl.scrollTop = 0
    const key = captionReturnKey(clipId)

    if (!expanded) {
      if (feed) {
        const cache: CaptionReturnCache = { clipId, feedScrollTop: Math.max(0, feed.scrollTop),
          buttonTop: button.getBoundingClientRect().top, windowScrollY: Math.max(0, window.scrollY) }
        localCache.current = cache
        try { sessionStorage.setItem(key, JSON.stringify(cache)) } catch { /* Приватный WebView может запретить хранилище. */ }
      }
      setExpanded(true)
      return
    }

    let cached = localCache.current
    if (!cached) {
      try { cached = parseCaptionReturn(sessionStorage.getItem(key), clipId) } catch { /* Есть локальный запасной путь выше. */ }
    }
    const oldSnap = feed?.style.scrollSnapType ?? ''
    if (feed) feed.style.scrollSnapType = 'none'
    setExpanded(false)

    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      if (feed) feed.style.scrollSnapType = oldSnap
      localCache.current = null
      try { sessionStorage.removeItem(key) } catch {}
    }
    cancelRestore.current = finish
    const restore = () => {
      if (cancelled || !button.isConnected || !feed?.isConnected || !cached) return
      if (captionEl) captionEl.scrollTop = 0
      window.scrollTo({ top: cached.windowScrollY, behavior: 'auto' })
      feed.scrollTop = cached.feedScrollTop
      const delta = button.getBoundingClientRect().top - cached.buttonTop
      if (Math.abs(delta) > 0.5) feed.scrollTop += delta
    }
    // Схлопывание текста и scroll-snap меняют раскладку в разные кадры.
    // Все отложенные попытки отменяются при уходе с клипа или новом нажатии.
    frame = requestAnimationFrame(() => {
      restore()
      frame = requestAnimationFrame(() => {
        restore()
        timer = setTimeout(() => { restore(); finish() }, 0)
      })
    })
  }

  return { caption, expanded, toggleCaption }
}
