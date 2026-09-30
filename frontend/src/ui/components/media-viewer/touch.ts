import type { TouchEvent } from 'react'
import type { PostMedia } from '../../../api/posts'
import { CLOSE_DISTANCE, FIT_SCALE, MAX_SCALE, MIN_SCALE, PAGE_DISTANCE, TAP_MOVE_TOLERANCE, clamp, distance } from './geometry'
import type { MediaView } from './useMediaView'

export function touchHandlers(view: MediaView, items: PostMedia[], index: number, onClose: () => void) {
  const {
    item,
    isVideo,
    setDrag,
    dragRef,
    setInteracting,
    chromeVisibleRef,
    stageRef,
    activeSlideRef,
    gesture,
    swipeAxis,
    scheduleChromeHide,
    previous,
    next,
    offsetRef,
    scaleRef,
    clearChromeTimer,
    applyOffset,
    clampOffset,
    handlePhotoTap,
    resetZoom,
    setScale,
  } = view
  function beginPinch(
    a: { clientX: number; clientY: number },
    b: { clientX: number; clientY: number },
  ) {
    gesture.current = {
      kind: 'pinch',
      startX: (a.clientX + b.clientX) / 2,
      startY: (a.clientY + b.clientY) / 2,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
      startDistance: distance(a, b),
      startScale: scaleRef.current,
    }
  }

  function touchStart(event: TouchEvent<HTMLElement>) {
    if (!item) return
    setInteracting(true)
    clearChromeTimer()
    swipeAxis.current = 'none'
    if (!isVideo && event.touches.length >= 2) {
      beginPinch(event.touches[0], event.touches[1])
      return
    }
    const touch = event.touches[0]
    if (!touch) return
    gesture.current = {
      kind: !isVideo && scaleRef.current > 1.01 ? 'pan' : 'swipe',
      startX: touch.clientX,
      startY: touch.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
      startDistance: 0,
      startScale: scaleRef.current,
    }
  }

  function touchMove(event: TouchEvent<HTMLElement>) {
    const current = gesture.current
    if (!isVideo && event.touches.length >= 2) {
      if (current.kind !== 'pinch') beginPinch(event.touches[0], event.touches[1])
      const pinch = gesture.current
      const startDistance = Math.max(1, pinch.startDistance)
      const nextScale = clamp(
        (pinch.startScale * distance(event.touches[0], event.touches[1])) / startDistance,
        MIN_SCALE,
        MAX_SCALE,
      )
      const stage =
        activeSlideRef.current?.getBoundingClientRect() ?? stageRef.current?.getBoundingClientRect()
      let nextOffset = { x: pinch.originX, y: pinch.originY }
      if (stage) {
        const centerX = stage.left + stage.width / 2
        const centerY = stage.top + stage.height / 2
        const currentCenterX = (event.touches[0].clientX + event.touches[1].clientX) / 2
        const currentCenterY = (event.touches[0].clientY + event.touches[1].clientY) / 2
        const imageX =
          (pinch.startX - centerX - pinch.originX) / Math.max(MIN_SCALE, pinch.startScale)
        const imageY =
          (pinch.startY - centerY - pinch.originY) / Math.max(MIN_SCALE, pinch.startScale)
        nextOffset = {
          x: currentCenterX - centerX - imageX * nextScale,
          y: currentCenterY - centerY - imageY * nextScale,
        }
      }
      scaleRef.current = nextScale
      setScale(nextScale)
      applyOffset(clampOffset(nextOffset, nextScale))
      return
    }
    const touch = event.touches[0]
    if (!touch) return
    const dx = touch.clientX - current.startX
    const dy = touch.clientY - current.startY
    if (current.kind === 'pan' && !isVideo) {
      applyOffset(
        clampOffset({
          x: current.originX + dx,
          y: current.originY + dy,
        }),
      )
      return
    }
    if (current.kind === 'swipe') {
      if (swipeAxis.current === 'none' && Math.hypot(dx, dy) >= 8) {
        if (Math.abs(dx) > Math.abs(dy) * 1.08) swipeAxis.current = 'x'
        else if (Math.abs(dy) > Math.abs(dx) * 1.08) swipeAxis.current = 'y'
      }
      if (swipeAxis.current === 'x') {
        let x = dx
        if ((index === 0 && x > 0) || (index === items.length - 1 && x < 0)) x *= 0.28
        dragRef.current = { x, y: 0 }
        setDrag(dragRef.current)
        return
      }
      if (swipeAxis.current === 'y') {
        dragRef.current = { x: 0, y: dy }
        setDrag(dragRef.current)
      }
    }
  }

  function touchEnd(event: TouchEvent<HTMLElement>) {
    setInteracting(false)
    const current = gesture.current
    if (current.kind === 'pinch') {
      const shouldSnapToFit = scaleRef.current < FIT_SCALE || scaleRef.current <= FIT_SCALE + 0.05
      const remaining = event.touches[0]
      if (shouldSnapToFit) {
        if (remaining) resetZoom()
        else window.requestAnimationFrame(resetZoom)
      } else {
        applyOffset(clampOffset(offsetRef.current))
      }
      if (remaining) {
        setInteracting(true)
        gesture.current = {
          kind: scaleRef.current > FIT_SCALE + 0.01 ? 'pan' : 'swipe',
          startX: remaining.clientX,
          startY: remaining.clientY,
          originX: offsetRef.current.x,
          originY: offsetRef.current.y,
          startDistance: 0,
          startScale: scaleRef.current,
        }
        return
      }
      gesture.current.kind = 'none'
      swipeAxis.current = 'none'
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }
    if (current.kind === 'pan') {
      const touch = event.changedTouches[0]
      const moved = touch
        ? Math.hypot(touch.clientX - current.startX, touch.clientY - current.startY)
        : Number.POSITIVE_INFINITY
      gesture.current.kind = 'none'
      swipeAxis.current = 'none'
      if (!isVideo && touch && moved < TAP_MOVE_TOLERANCE) {
        handlePhotoTap(touch.clientX, touch.clientY)
        return
      }
      applyOffset(clampOffset(offsetRef.current))
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }
    const { x, y } = dragRef.current
    const axis = swipeAxis.current
    const touch = event.changedTouches[0]
    const movedX = touch ? touch.clientX - current.startX : x
    const movedY = touch ? touch.clientY - current.startY : y
    dragRef.current = { x: 0, y: 0 }
    setDrag(dragRef.current)
    gesture.current.kind = 'none'
    swipeAxis.current = 'none'
    if (axis === 'y') {
      if (Math.abs(movedY) > CLOSE_DISTANCE) {
        clearChromeTimer()
        onClose()
        return
      }
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }
    if (Math.abs(x) > PAGE_DISTANCE && items.length > 1) {
      if (x < 0) next()
      else previous()
      return
    }
    if (
      !isVideo &&
      touch &&
      Math.abs(movedX) < TAP_MOVE_TOLERANCE &&
      Math.abs(movedY) < TAP_MOVE_TOLERANCE &&
      event.changedTouches.length === 1
    ) {
      handlePhotoTap(touch.clientX, touch.clientY)
      return
    }
    if (chromeVisibleRef.current) scheduleChromeHide()
  }

  return { touchStart, touchMove, touchEnd }
}
