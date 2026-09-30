import type { PointerEvent } from 'react'
import type { PostMedia } from '../../../api/posts'
import { CLOSE_DISTANCE, FIT_SCALE, PAGE_DISTANCE, TAP_MOVE_TOLERANCE } from './geometry'
import type { MediaView } from './useMediaView'

export function pointerHandlers(view: MediaView, items: PostMedia[], index: number, onClose: () => void) {
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
    pointerGesture,
    clearChromeTimer,
    applyOffset,
    clampOffset,
    handlePhotoTap,
  } = view
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch' || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, video, input, textarea, select, a')) return
    pointerGesture.current = {
      active: true,
      pointerId: event.pointerId,
      kind: !isVideo && scaleRef.current > FIT_SCALE + 0.01 ? 'pan' : 'swipe',
      axis: 'none',
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    }
    setInteracting(true)
    clearChromeTimer()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function pointerMove(event: PointerEvent<HTMLElement>) {
    const current = pointerGesture.current
    if (!current.active || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.kind === 'pan' && !isVideo) {
      applyOffset(clampOffset({ x: current.originX + dx, y: current.originY + dy }))
      event.preventDefault()
      return
    }
    if (current.axis === 'none' && Math.hypot(dx, dy) >= 6) {
      current.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    }
    if (current.axis === 'x') {
      let x = dx
      if ((index === 0 && x > 0) || (index === items.length - 1 && x < 0)) x *= 0.28
      dragRef.current = { x, y: 0 }
      setDrag(dragRef.current)
    } else if (current.axis === 'y') {
      dragRef.current = { x: 0, y: dy }
      setDrag(dragRef.current)
    }
    event.preventDefault()
  }

  function finishPointerGesture(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = pointerGesture.current
    if (!current.active || current.pointerId !== event.pointerId) return
    const movedX = event.clientX - current.startX
    const movedY = event.clientY - current.startY
    const axis = current.axis
    pointerGesture.current.active = false
    setInteracting(false)
    dragRef.current = { x: 0, y: 0 }
    setDrag(dragRef.current)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { }

    if (cancelled) {
      if (current.kind === 'pan') applyOffset(clampOffset(offsetRef.current))
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }
    if (current.kind === 'pan') {
      if (!isVideo && Math.hypot(movedX, movedY) < TAP_MOVE_TOLERANCE) {
        handlePhotoTap(event.clientX, event.clientY)
        return
      }
      applyOffset(clampOffset(offsetRef.current))
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }
    if (
      !isVideo &&
      Math.abs(movedX) < TAP_MOVE_TOLERANCE &&
      Math.abs(movedY) < TAP_MOVE_TOLERANCE
    ) {
      handlePhotoTap(event.clientX, event.clientY)
      return
    }
    if (axis === 'x' && Math.abs(movedX) > PAGE_DISTANCE && items.length > 1) {
      if (movedX < 0) next()
      else previous()
      return
    }
    if (axis === 'y' && Math.abs(movedY) > CLOSE_DISTANCE) {
      clearChromeTimer()
      onClose()
      return
    }
    if (chromeVisibleRef.current) scheduleChromeHide()
  }

  return { pointerDown, pointerMove, finishPointerGesture }
}
