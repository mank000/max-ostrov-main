import { useEffect } from 'react'
import { getHost } from './host'

const textControlSelector = 'input, textarea, select, [contenteditable="true"]'

function textControl(value: Element | null): value is HTMLElement {
  return value instanceof HTMLElement && value.matches(textControlSelector)
}

export function useViewport() {
  useEffect(() => {
    const protect = () => { if (!document.hidden) getHost().protectClosing() }
    protect()
    document.addEventListener('visibilitychange', protect)
    window.addEventListener('pageshow', protect)
    return () => {
      document.removeEventListener('visibilitychange', protect)
      window.removeEventListener('pageshow', protect)
    }
  }, [])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let frame = 0
    let settleTimer = 0
    let adjustedField: HTMLElement | null = null
    let fullHeight = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight,
      viewport.height + viewport.offsetTop,
    )

    const activeField = () => {
      const focused = document.activeElement
      return textControl(focused) ? focused : null
    }

    const keepFieldVisible = (focused = activeField()) => {
      if (!focused || !focused.isConnected) return
      const scroll = focused.closest<HTMLElement>('.screen-scroll')
      if (!scroll) return

      const field = focused.getBoundingClientRect()
      const container = scroll.getBoundingClientRect()
      const visibleTop = Math.max(container.top, viewport.offsetTop) + 16
      const visibleBottom =
        Math.min(container.bottom, viewport.offsetTop + viewport.height) - 16

      if (visibleBottom <= visibleTop) return

      let delta = 0
      if (field.bottom > visibleBottom) delta = field.bottom - visibleBottom
      else if (field.top < visibleTop) delta = field.top - visibleTop
      if (Math.abs(delta) < 1) return

      const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
      scroll.scrollTop = Math.max(0, Math.min(maxScroll, scroll.scrollTop + delta))
    }

    const applyViewport = () => {
      frame = 0
      const focused = activeField()
      root.style.setProperty(
        '--app-viewport-height',
        `${Math.round(viewport.height)}px`,
      )

      if (!focused || window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        fullHeight = Math.max(
          document.documentElement.clientHeight,
          window.innerHeight,
          viewport.height + viewport.offsetTop,
        )
        root.style.setProperty('--keyboard-height', '0px')
        delete root.dataset.keyboardOpen
        adjustedField = null
        return
      }

      fullHeight = Math.max(
        fullHeight,
        document.documentElement.clientHeight,
        window.innerHeight,
        viewport.height + viewport.offsetTop,
      )
      const coveredHeight = Math.max(
        0,
        fullHeight - viewport.height - Math.max(0, viewport.offsetTop),
      )
      const keyboardHeight = coveredHeight >= 96 ? coveredHeight : 0

      root.style.setProperty(
        '--keyboard-height',
        `${Math.round(keyboardHeight)}px`,
      )

      if (!keyboardHeight) {
        delete root.dataset.keyboardOpen
        adjustedField = null
        return
      }

      root.dataset.keyboardOpen = 'true'

      if (adjustedField !== focused) {
        adjustedField = focused
        keepFieldVisible(focused)
      }

      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => keepFieldVisible(focused), 90)
    }

    const syncViewport = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(applyViewport)
    }

    const focusIn = (event: FocusEvent) => {
      if (textControl(event.target instanceof Element ? event.target : null))
        adjustedField = null
      syncViewport()
    }

    syncViewport()
    viewport.addEventListener('resize', syncViewport, { passive: true })
    viewport.addEventListener('scroll', syncViewport, { passive: true })
    window.addEventListener('resize', syncViewport, { passive: true })
    document.addEventListener('focusin', focusIn)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
      document.removeEventListener('focusin', focusIn)
      root.style.removeProperty('--app-viewport-height')
      root.style.removeProperty('--keyboard-height')
      delete root.dataset.keyboardOpen
    }
  }, [])

}
