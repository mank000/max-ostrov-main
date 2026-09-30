import { useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { HostAdapter } from './host'

export const EDGE_SWIPE_WIDTH = 30
const BACK_COMMIT_PROGRESS = 0.32
const BACK_COMMIT_VELOCITY = 0.55
const BACK_MIN_FLING_DISTANCE = 44
export const BACK_PARALLAX = 0.18
const TRACKPAD_BACK_IDLE_MS = 90
const TRACKPAD_BACK_START_DISTANCE = 12

type Options = {
  shellRef: RefObject<HTMLDivElement | null>
  canGoBack: boolean
  blocked: boolean
  host: Pick<HostAdapter, 'hapticSelection'>
  commitBack: (skipMotion?: boolean) => void
  getMotionLayers: () => { current: HTMLElement | null; previousVisuals: HTMLElement[] }
  cancelRouteAnimations: () => void
  routeAnimations: RefObject<Animation[]>
  navigationLocked: RefObject<boolean>
}

export function useBackGesture({
  shellRef,
  canGoBack,
  blocked,
  host,
  commitBack,
  getMotionLayers,
  cancelRouteAnimations,
  routeAnimations,
  navigationLocked,
}: Options) {
  const backGestureRef = useRef({
    pending: false,
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    progress: 0,
    pendingDx: 0,
    width: 0,
    frame: null as number | null,
    current: null as HTMLElement | null,
    previous: [] as HTMLElement[],
  })

  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell || !canGoBack || blocked) return

    let disposed = false
    let settling = false
    const state = backGestureRef.current
    let gestureSource: 'touch' | 'trackpad' | null = null
    let trackpadEndTimer: number | null = null
    let touchMoveListening = false
    let activeWheelListener = false
    const activeMoveOptions: AddEventListenerOptions = { passive: false, capture: true }
    const passiveWheelOptions: AddEventListenerOptions = { passive: true, capture: true }
    const activeWheelOptions: AddEventListenerOptions = { passive: false, capture: true }
    const stopTouchMove = () => {
      if (touchMoveListening) shell.removeEventListener('touchmove', onTouchMove, activeMoveOptions)
      touchMoveListening = false
    }
    const setWheelActive = (active: boolean) => {
      if (active === activeWheelListener) return
      shell.removeEventListener('wheel', onWheel, active ? passiveWheelOptions : activeWheelOptions)
      if (!disposed) shell.addEventListener('wheel', onWheel, active ? activeWheelOptions : passiveWheelOptions)
      activeWheelListener = active
    }
    const cleanupElements = () => {
      stopTouchMove()
      setWheelActive(false)
      if (trackpadEndTimer !== null) {
        window.clearTimeout(trackpadEndTimer)
        trackpadEndTimer = null
      }
      gestureSource = null
      if (state.frame !== null) cancelAnimationFrame(state.frame)
      state.frame = null
      if (state.current) {
        state.current.style.removeProperty('transform')
        state.current.style.removeProperty('box-shadow')
        state.current.style.removeProperty('will-change')
      }
      state.previous.forEach((element) => {
        element.style.removeProperty('transform')
        element.style.removeProperty('opacity')
        element.style.removeProperty('will-change')
      })
      shell.removeAttribute('data-back-gesture')
      state.pending = false
      state.active = false
      state.progress = 0
      state.pendingDx = 0
      state.current = null
      state.previous = []
    }

    const paint = () => {
      state.frame = null
      if (!state.active || !state.current) return
      const dx = Math.max(0, Math.min(state.width, state.pendingDx))
      const progress = state.width > 0 ? Math.min(1, dx / state.width) : 0
      state.progress = progress
      state.current.style.transform = `translate3d(${dx}px, 0, 0)`
      state.current.style.boxShadow = `-12px 0 30px rgb(0 0 0 / ${(0.14 * (1 - progress)).toFixed(3)})`
      const previousX = -state.width * BACK_PARALLAX * (1 - progress)
      const previousOpacity = 0.9 + progress * 0.1
      state.previous.forEach((element) => {
        element.style.transform = `translate3d(${previousX}px, 0, 0)`
        element.style.opacity = String(previousOpacity)
      })
    }

    const settle = (complete: boolean) => {
      if (disposed || settling) return
      settling = true
      stopTouchMove()
      if (!state.current) {
        cleanupElements()
        navigationLocked.current = false
        settling = false
        return
      }
      if (state.frame !== null) {
        cancelAnimationFrame(state.frame)
        state.frame = null
        paint()
      }
      const current = state.current
      const previous = [...state.previous]
      const width = state.width
      const progress = state.width > 0 ? Math.min(1, state.pendingDx / state.width) : state.progress
      const currentX = Math.max(0, Math.min(width, state.pendingDx))
      const previousX = -width * BACK_PARALLAX * (1 - progress)
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1
        : Math.round(Math.max(120, Math.min(230, 120 + (complete ? 1 - progress : progress) * 140)))
      const animations = [
        current.animate(
          [
            { transform: `translate3d(${currentX}px, 0, 0)` },
            { transform: `translate3d(${complete ? width : 0}px, 0, 0)` },
          ],
          { duration, easing: 'cubic-bezier(.22, .82, .2, 1)', fill: 'both' },
        ),
        ...previous
          .filter((element) => typeof element.animate === 'function')
          .map((element) =>
            element.animate(
              [
                {
                  transform: `translate3d(${previousX}px, 0, 0)`,
                  opacity: 0.9 + progress * 0.1,
                },
                {
                  transform: `translate3d(${complete ? 0 : -width * BACK_PARALLAX}px, 0, 0)`,
                  opacity: complete ? 1 : 0.9,
                },
              ],
              {
                duration,
                easing: 'cubic-bezier(.22, .82, .2, 1)',
                fill: 'both',
              },
            ),
          ),
      ]
      routeAnimations.current = animations
      void Promise.all(
        animations.map((animation) => animation.finished.catch(() => undefined)),
      ).then(() => {
        if (disposed) return
        animations.forEach((animation) => {
          try {
            animation.cancel()
          } catch { }
        })
        routeAnimations.current = []
        if (complete) {
          current.style.transform = `translate3d(${width}px, 0, 0)`
          current.style.boxShadow = 'none'
          previous.forEach((element) => {
            element.style.transform = 'translate3d(0, 0, 0)'
            element.style.opacity = '1'
          })
          host.hapticSelection()
          flushSync(() => commitBack(true))
        }
        cleanupElements()
        navigationLocked.current = false
        settling = false
      })
    }

    const onTouchStart = (event: TouchEvent) => {
      if (navigationLocked.current || gestureSource || event.touches.length !== 1) return
      const touch = event.touches[0]
      const bounds = shell.getBoundingClientRect()
      const edgeX = touch.clientX - bounds.left
      if (edgeX < 0 || edgeX > EDGE_SWIPE_WIDTH) return
      if (blocksBackGesture(event.target)) return
      const { current, previousVisuals } = getMotionLayers()
      if (!current || !previousVisuals.length || typeof current.animate !== 'function') return
      cancelRouteAnimations()
      const now = performance.now()
      gestureSource = 'touch'
      state.pending = true
      state.active = false
      state.startX = touch.clientX
      state.startY = touch.clientY
      state.lastX = touch.clientX
      state.lastTime = now
      state.velocity = 0
      state.progress = 0
      state.pendingDx = 0
      state.width = bounds.width || window.innerWidth
      state.current = current
      state.previous = previousVisuals
      shell.addEventListener('touchmove', onTouchMove, activeMoveOptions)
      touchMoveListening = true
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!state.pending || gestureSource !== 'touch' || settling) return
      if (event.touches.length !== 1) { if (state.active) settle(false); else cleanupElements(); return }
      const touch = event.touches[0]
      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      if (!state.active) {
        if (dx < -4 || (Math.abs(dy) > 8 && Math.abs(dy) * 1.2 > Math.abs(dx))) {
          cleanupElements()
          return
        }
        if (dx < 16 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
        state.active = true
        navigationLocked.current = true
        shell.dataset.backGesture = 'active'
        state.current?.style.setProperty('will-change', 'transform, box-shadow')
        state.previous.forEach((element) => {
          element.style.setProperty('will-change', 'transform, opacity')
        })
      }
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      const now = performance.now()
      const dt = Math.max(1, now - state.lastTime)
      const instantVelocity = (touch.clientX - state.lastX) / dt
      state.velocity = state.velocity * 0.68 + instantVelocity * 0.32
      state.lastX = touch.clientX
      state.lastTime = now
      state.pendingDx = Math.max(0, dx)
      if (state.frame === null) state.frame = requestAnimationFrame(paint)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!state.pending || gestureSource !== 'touch' || settling) return
      if (event.touches.length) { settle(false); return }
      if (!state.active) {
        cleanupElements()
        return
      }
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      const progress = state.width > 0 ? Math.min(1, state.pendingDx / state.width) : 0
      const complete =
        progress >= BACK_COMMIT_PROGRESS ||
        (state.velocity >= BACK_COMMIT_VELOCITY && state.pendingDx >= BACK_MIN_FLING_DISTANCE)
      settle(complete)
    }

    const onTouchCancel = (event: TouchEvent) => {
      if (!state.pending || gestureSource !== 'touch') return
      if (state.active) {
        if (event.cancelable) event.preventDefault()
        event.stopPropagation()
        settle(false)
      } else cleanupElements()
    }

    const blocksBackGesture = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !target.closest('.app-shell')) return true
      if (
        target.closest(
          '.map-host, .map-screen, .pro-media-viewer__stage, iframe, input, textarea, select, [contenteditable="true"], .post-card__gallery',
        )
      )
        return true
      for (
        let element: Element | null = target;
        element && element !== shell;
        element = element.parentElement
      ) {
        if (!(element instanceof HTMLElement)) continue
        const style = getComputedStyle(element)
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
          return true
      }
      return false
    }

    const finishTrackpadGesture = () => {
      trackpadEndTimer = null
      if (!state.pending || gestureSource !== 'trackpad') return
      if (!state.active) {
        cleanupElements()
        return
      }
      const progress = state.width > 0 ? Math.min(1, state.pendingDx / state.width) : 0
      const complete =
        progress >= BACK_COMMIT_PROGRESS ||
        (state.velocity >= BACK_COMMIT_VELOCITY && state.pendingDx >= BACK_MIN_FLING_DISTANCE)
      gestureSource = null
      settle(complete)
    }

    const onWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
      )
        return
      const dx = -event.deltaX
      const absX = Math.abs(event.deltaX)
      const absY = Math.abs(event.deltaY)

      if (!state.pending) {
        if (
          navigationLocked.current ||
          gestureSource ||
          dx <= 0 ||
          absX < 2 ||
          absX <= absY * 1.15 ||
          blocksBackGesture(event.target)
        )
          return
        const bounds = shell.getBoundingClientRect()
        const { current, previousVisuals } = getMotionLayers()
        if (!current || !previousVisuals.length || typeof current.animate !== 'function') return
        previousVisuals.forEach((element) => {
          element.style.transform = `translate3d(-${BACK_PARALLAX * 100}%, 0, 0)`
        })
        cancelRouteAnimations()
        const now = performance.now()
        gestureSource = 'trackpad'
        state.pending = true
        state.active = false
        state.startX = 0
        state.startY = 0
        state.lastX = 0
        state.lastTime = now
        state.velocity = 0
        state.progress = 0
        state.pendingDx = 0
        state.width = bounds.width || window.innerWidth
        state.current = current
        state.previous = previousVisuals
        setWheelActive(true)
      }

      if (gestureSource !== 'trackpad') return
      if (activeWheelListener && event.cancelable && state.active) event.preventDefault()
      event.stopPropagation()

      if (absX > absY * 0.9) {
        const now = performance.now()
        const dt = Math.max(1, now - state.lastTime)
        const previousDx = state.pendingDx
        state.pendingDx = Math.max(0, Math.min(state.width, state.pendingDx + dx))
        const instantVelocity = (state.pendingDx - previousDx) / dt
        state.velocity = state.velocity * 0.68 + instantVelocity * 0.32
        state.lastTime = now

        if (!state.active && state.pendingDx >= TRACKPAD_BACK_START_DISTANCE) {
          state.active = true
          navigationLocked.current = true
          shell.dataset.backGesture = 'active'
          state.current?.style.setProperty('will-change', 'transform, box-shadow')
          state.previous.forEach((element) => {
            element.style.setProperty('will-change', 'transform, opacity')
          })
        }
        if (state.active && state.frame === null) state.frame = requestAnimationFrame(paint)
      }

      if (trackpadEndTimer !== null) window.clearTimeout(trackpadEndTimer)
      trackpadEndTimer = window.setTimeout(finishTrackpadGesture, TRACKPAD_BACK_IDLE_MS)
    }

    const startOptions: AddEventListenerOptions = {
      passive: true,
      capture: true,
    }
    shell.addEventListener('touchstart', onTouchStart, startOptions)
    shell.addEventListener('touchend', onTouchEnd, activeMoveOptions)
    shell.addEventListener('touchcancel', onTouchCancel, activeMoveOptions)
    shell.addEventListener('wheel', onWheel, passiveWheelOptions)
    return () => {
      disposed = true
      stopTouchMove()
      if (settling) cancelRouteAnimations()
      shell.removeEventListener('touchstart', onTouchStart, startOptions)
      shell.removeEventListener('touchend', onTouchEnd, activeMoveOptions)
      shell.removeEventListener('touchcancel', onTouchCancel, activeMoveOptions)
      shell.removeEventListener('wheel', onWheel, activeWheelListener ? activeWheelOptions : passiveWheelOptions)
      cleanupElements()
      navigationLocked.current = false
    }
  }, [canGoBack, blocked, host, commitBack, getMotionLayers, cancelRouteAnimations])
}
