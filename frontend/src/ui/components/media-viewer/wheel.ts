import type { WheelEvent } from 'react'
import type { PostMedia } from '../../../api/posts'
import { FIT_SCALE, MAX_SCALE, MIN_SCALE, WHEEL_CLOSE_DISTANCE, WHEEL_COOLDOWN_MS, WHEEL_IDLE_MS, WHEEL_PAGE_DISTANCE, clamp } from './geometry'
import type { MediaView } from './useMediaView'

export function wheelHandlers(view: MediaView, items: PostMedia[], index: number, onClose: () => void) {
  const {
    isVideo,
    setDrag,
    dragRef,
    setInteracting,
    chromeVisibleRef,
    scheduleChromeHide,
    previous,
    next,
    offsetRef,
    scaleRef,
    clearChromeTimer,
    applyOffset,
    clampOffset,
    wheelGesture,
    wheelIdleTimer,
    wheelLockedUntil,
    zoomAround,
    resetZoom,
  } = view
  function resetWheelGesture() {
    wheelGesture.current = { axis: 'none', x: 0, y: 0 }
    dragRef.current = { x: 0, y: 0 }
    setDrag(dragRef.current)
    setInteracting(false)
    if (wheelIdleTimer.current !== null) {
      window.clearTimeout(wheelIdleTimer.current)
      wheelIdleTimer.current = null
    }
  }

  function scheduleWheelReset() {
    if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current)
    wheelIdleTimer.current = window.setTimeout(() => {
      resetWheelGesture()
      if (chromeVisibleRef.current) scheduleChromeHide()
    }, WHEEL_IDLE_MS)
  }

  function wheel(event: WheelEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (target.closest('button, video, input, textarea, select, a')) return

    if (!isVideo && event.ctrlKey) {
      if (!event.defaultPrevented) event.preventDefault()
      setInteracting(true)
      const nextScale = clamp(
        scaleRef.current * Math.exp(-event.deltaY * 0.012),
        MIN_SCALE,
        MAX_SCALE,
      )
      zoomAround(nextScale, event.clientX, event.clientY)
      if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current)
      wheelIdleTimer.current = window.setTimeout(() => {
        setInteracting(false)
        if (scaleRef.current < FIT_SCALE) window.requestAnimationFrame(resetZoom)
        else applyOffset(clampOffset(offsetRef.current))
        wheelIdleTimer.current = null
      }, WHEEL_IDLE_MS)
      return
    }

    event.preventDefault()
    setInteracting(true)
    clearChromeTimer()

    if (!isVideo && scaleRef.current > FIT_SCALE + 0.01) {
      applyOffset(
        clampOffset({
          x: offsetRef.current.x - event.deltaX,
          y: offsetRef.current.y - event.deltaY,
        }),
      )
      scheduleWheelReset()
      return
    }

    const now = Date.now()
    if (now < wheelLockedUntil.current) return

    const current = wheelGesture.current
    if (current.axis === 'none') {
      if (Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) < 1) return
      current.axis = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? 'x' : 'y'
    }
    current.x += event.deltaX
    current.y += event.deltaY

    if (current.axis === 'x') {
      let visualX = -current.x
      if ((index === 0 && visualX > 0) || (index === items.length - 1 && visualX < 0))
        visualX *= 0.28
      dragRef.current = { x: visualX, y: 0 }
      setDrag(dragRef.current)
      if (Math.abs(current.x) >= WHEEL_PAGE_DISTANCE && items.length > 1) {
        const direction = current.x > 0 ? 1 : -1
        resetWheelGesture()
        wheelLockedUntil.current = now + WHEEL_COOLDOWN_MS
        if (direction > 0) next()
        else previous()
        return
      }
    } else {
      dragRef.current = { x: 0, y: -current.y }
      setDrag(dragRef.current)
      if (Math.abs(current.y) >= WHEEL_CLOSE_DISTANCE) {
        resetWheelGesture()
        wheelLockedUntil.current = now + WHEEL_COOLDOWN_MS
        clearChromeTimer()
        onClose()
        return
      }
    }
    scheduleWheelReset()
  }

  return { wheel }
}
