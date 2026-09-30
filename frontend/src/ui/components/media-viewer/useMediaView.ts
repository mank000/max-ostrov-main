import { mediaURL } from '../../../api/credentials'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PostMedia } from '../../../api/posts'
import { AUTO_HIDE_MS, DOUBLE_TAP_MAX_DISTANCE, DOUBLE_TAP_SCALE, FIT_SCALE, Gesture, MIN_SCALE, PointerGesture, TAP_DELAY_MS, WheelGesture, clamp, containMediaSize } from './geometry'

export function useMediaView(items: PostMedia[], index: number, onIndexChange: (index: number) => void, onClose: () => void) {
  const item = items[index]
  const isVideo = item?.mime_type?.startsWith('video/')
  const [scale, setScale] = useState(1)
  const [fitSize, setFitSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const offsetRef = useRef({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const dragRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const [interacting, setInteracting] = useState(false)
  const [chromeVisible, setChromeVisibleState] = useState(true)
  const chromeVisibleRef = useRef(true)
  const hideChromeTimer = useRef<number | null>(null)
  const tapTimer = useRef<number | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const activeSlideRef = useRef<HTMLDivElement | null>(null)
  const activeImageRef = useRef<HTMLImageElement | null>(null)
  const gesture = useRef<Gesture>({
    kind: 'none',
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    startDistance: 0,
    startScale: 1,
  })
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null)
  const swipeAxis = useRef<'none' | 'x' | 'y'>('none')
  const pointerGesture = useRef<PointerGesture>({
    active: false,
    pointerId: -1,
    kind: 'swipe',
    axis: 'none',
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })
  const wheelGesture = useRef<WheelGesture>({ axis: 'none', x: 0, y: 0 })
  const wheelIdleTimer = useRef<number | null>(null)
  const wheelLockedUntil = useRef(0)
  const currentIndex = useRef(index)
  const resetIndex = useRef<number | null>(null)
  useLayoutEffect(() => {
    currentIndex.current = index
  }, [index])

  useEffect(() => {
    if (resetIndex.current === index) return
    resetIndex.current = index
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    dragRef.current = { x: 0, y: 0 }
    setScale(1)
    setFitSize(null)
    setOffset({ x: 0, y: 0 })
    setDrag({ x: 0, y: 0 })
    lastTap.current = null
    pointerGesture.current.active = false
    wheelGesture.current = { axis: 'none', x: 0, y: 0 }
    if (wheelIdleTimer.current !== null) {
      window.clearTimeout(wheelIdleTimer.current)
      wheelIdleTimer.current = null
    }
  }, [index])

  useLayoutEffect(() => {
    if (isVideo || !item) return
    const measuredIndex = index
    const slide = activeSlideRef.current
    if (!slide) return

    const syncFit = () => {
      if (currentIndex.current !== measuredIndex) return
      const rect = slide.getBoundingClientRect()
      const image = activeImageRef.current
      const sourceWidth = image?.naturalWidth || item.width
      const sourceHeight = image?.naturalHeight || item.height
      const next = containMediaSize(rect.width, rect.height, sourceWidth, sourceHeight)
      if (next) setFitSize(next)
    }

    syncFit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncFit)
    observer?.observe(slide)
    window.addEventListener('resize', syncFit, { passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncFit)
    }
  }, [index, isVideo, item])

  useEffect(() => {
    if (typeof Image === 'undefined') return
    for (const neighbor of [items[index - 1], items[index + 1]]) {
      if (!neighbor || neighbor.mime_type?.startsWith('video/')) continue
      const preload = new Image()
      preload.decoding = 'async'
      preload.src = mediaURL(neighbor.url) || neighbor.url
    }
  }, [index, items])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (!isVideo && event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (!isVideo && event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, isVideo, items.length, onClose, onIndexChange])

  useEffect(() => {
    const visibleIndex = index
    chromeVisibleRef.current = true
    setChromeVisibleState(true)
    if (hideChromeTimer.current !== null) window.clearTimeout(hideChromeTimer.current)
    hideChromeTimer.current = window.setTimeout(() => {
      hideChromeTimer.current = null
      if (currentIndex.current !== visibleIndex) return
      chromeVisibleRef.current = false
      setChromeVisibleState(false)
    }, AUTO_HIDE_MS)
    return () => {
      if (hideChromeTimer.current !== null) window.clearTimeout(hideChromeTimer.current)
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
      if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current)
    }
  }, [index])


  function clearChromeTimer() {
    if (hideChromeTimer.current === null) return
    window.clearTimeout(hideChromeTimer.current)
    hideChromeTimer.current = null
  }

  function scheduleChromeHide() {
    clearChromeTimer()
    hideChromeTimer.current = window.setTimeout(() => {
      chromeVisibleRef.current = false
      setChromeVisibleState(false)
      hideChromeTimer.current = null
    }, AUTO_HIDE_MS)
  }

  function setChromeVisible(next: boolean) {
    chromeVisibleRef.current = next
    setChromeVisibleState(next)
    if (next) scheduleChromeHide()
    else clearChromeTimer()
  }

  function toggleChrome() {
    setChromeVisible(!chromeVisibleRef.current)
  }

  function applyOffset(next: { x: number; y: number }) {
    offsetRef.current = next
    setOffset(next)
  }

  function clampOffset(next: { x: number; y: number }, nextScale = scaleRef.current) {
    const viewport = activeSlideRef.current
    const image = activeImageRef.current
    if (!viewport || !image) {
      const boundX = Math.max(0, window.innerWidth * (nextScale - FIT_SCALE) * 0.5)
      const boundY = Math.max(0, window.innerHeight * (nextScale - FIT_SCALE) * 0.5)
      return {
        x: clamp(next.x, -boundX, boundX),
        y: clamp(next.y, -boundY, boundY),
      }
    }
    const boundX = Math.max(0, (image.clientWidth * nextScale - viewport.clientWidth) / 2)
    const boundY = Math.max(0, (image.clientHeight * nextScale - viewport.clientHeight) / 2)
    return {
      x: clamp(next.x, -boundX, boundX),
      y: clamp(next.y, -boundY, boundY),
    }
  }

  function zoomAround(nextScale: number, clientX?: number, clientY?: number) {
    if (Math.abs(nextScale - FIT_SCALE) <= 0.05) {
      resetZoom()
      return
    }
    const currentScale = Math.max(MIN_SCALE, scaleRef.current)
    let nextOffset = offsetRef.current
    const stage =
      activeSlideRef.current?.getBoundingClientRect() ?? stageRef.current?.getBoundingClientRect()
    if (stage && clientX !== undefined && clientY !== undefined) {
      const centerX = stage.left + stage.width / 2
      const centerY = stage.top + stage.height / 2
      const imageX = (clientX - centerX - offsetRef.current.x) / currentScale
      const imageY = (clientY - centerY - offsetRef.current.y) / currentScale
      nextOffset = {
        x: clientX - centerX - imageX * nextScale,
        y: clientY - centerY - imageY * nextScale,
      }
    }
    scaleRef.current = nextScale
    setScale(nextScale)
    applyOffset(clampOffset(nextOffset, nextScale))
  }


  function previous() {
    if (index <= 0) return
    onIndexChange(index - 1)
  }

  function next() {
    if (index >= items.length - 1) return
    onIndexChange(index + 1)
  }

  function resetZoom() {
    scaleRef.current = FIT_SCALE
    setScale(FIT_SCALE)
    applyOffset({ x: 0, y: 0 })
  }

  function toggleZoom(clientX?: number, clientY?: number) {
    if (isVideo) return
    if (Math.abs(scaleRef.current - FIT_SCALE) > 0.05) resetZoom()
    else zoomAround(DOUBLE_TAP_SCALE, clientX, clientY)
  }

  function handlePhotoTap(clientX: number, clientY: number) {
    const now = Date.now()
    const previousTap = lastTap.current
    const isDoubleTap =
      previousTap !== null &&
      now - previousTap.at <= TAP_DELAY_MS &&
      Math.hypot(clientX - previousTap.x, clientY - previousTap.y) <= DOUBLE_TAP_MAX_DISTANCE

    if (isDoubleTap) {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
      tapTimer.current = null
      lastTap.current = null
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => toggleZoom(clientX, clientY))
      })
      if (chromeVisibleRef.current) scheduleChromeHide()
      return
    }

    lastTap.current = { at: now, x: clientX, y: clientY }
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null
      lastTap.current = null
      toggleChrome()
    }, TAP_DELAY_MS)
  }











  return {
    item,
    isVideo,
    scale,
    fitSize,
    setFitSize,
    offset,
    drag,
    setDrag,
    dragRef,
    interacting,
    setInteracting,
    chromeVisible,
    chromeVisibleRef,
    stageRef,
    activeSlideRef,
    activeImageRef,
    gesture,
    lastTap,
    swipeAxis,
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
    wheelGesture,
    wheelIdleTimer,
    wheelLockedUntil,
    zoomAround,
    resetZoom,
    setScale,
  }
}

export type MediaView = ReturnType<typeof useMediaView>
