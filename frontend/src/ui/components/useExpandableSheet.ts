import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import './expandable-sheet.css'

type Drag = {
  pointerId: number
  startY: number
  startHeight: number
  moved: boolean
  canExpand: boolean
  startedExpanded: boolean
  lastY: number
  lastTime: number
  velocity: number
}

type ExpandableSheetOptions = {
  onClose?: () => void
}

const COLLAPSE_DISTANCE = 52
const CLOSE_DISTANCE = 76
const FULL_CLOSE_DISTANCE = 170
const FLING_MIN_DISTANCE = 24
const FLING_VELOCITY = 0.58
const SETTLE_MS = 280
const DISMISS_MS = 220

function viewportHeight() {
  return window.visualViewport?.height || window.innerHeight
}

export function useExpandableSheet<T extends HTMLElement>({
  onClose,
}: ExpandableSheetOptions = {}) {
  const sheetRef = useRef<T>(null)
  const dragRef = useRef<Drag | null>(null)
  const baseHeightRef = useRef(0)
  const finishTimerRef = useRef<number | null>(null)
  const ignoreClickRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(
    () => () => {
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!expanded) return
    const updateHeight = () => {
      if (sheetRef.current && !dragRef.current)
        sheetRef.current.style.height = `${Math.max(0, viewportHeight() - 16)}px`
    }
    window.visualViewport?.addEventListener('resize', updateHeight)
    window.addEventListener('resize', updateHeight)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateHeight)
      window.removeEventListener('resize', updateHeight)
    }
  }, [expanded])

  const reset = useCallback(() => {
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    finishTimerRef.current = null
    dragRef.current = null
    baseHeightRef.current = 0
    ignoreClickRef.current = false
    if (sheetRef.current) {
      sheetRef.current.style.removeProperty('height')
      sheetRef.current.style.removeProperty('transform')
      sheetRef.current.style.removeProperty('transition')
      sheetRef.current.style.removeProperty('animation')
      sheetRef.current.style.removeProperty('opacity')
      sheetRef.current.dataset.sheetExpanded = 'false'
    }
    setExpanded(false)
  }, [])

  function canExpand(sheet: T) {
    const scroller = sheet.querySelector<HTMLElement>('[data-sheet-scroll]') || sheet
    return scroller.scrollHeight > scroller.clientHeight + 2
  }

  function settle(nextExpanded: boolean) {
    const sheet = sheetRef.current
    if (!sheet) return
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    sheet.style.animation = 'none'
    sheet.style.opacity = '1'
    sheet.style.transition = `height ${SETTLE_MS}ms cubic-bezier(.2,.9,.2,1), transform ${SETTLE_MS}ms cubic-bezier(.2,.9,.2,1)`
    sheet.dataset.sheetExpanded = String(nextExpanded)
    sheet.style.transform = 'translateY(0)'
    sheet.style.height = `${nextExpanded ? Math.max(0, viewportHeight() - 16) : baseHeightRef.current}px`
    setExpanded(nextExpanded)
    if (!nextExpanded) {
      finishTimerRef.current = window.setTimeout(() => {
        if (sheetRef.current === sheet && !dragRef.current) sheet.style.removeProperty('height')
        baseHeightRef.current = 0
        finishTimerRef.current = null
      }, SETTLE_MS + 20)
    }
  }

  function dismiss() {
    const sheet = sheetRef.current
    const callback = onCloseRef.current
    if (!sheet || !callback) {
      settle(false)
      return
    }
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current)
    dragRef.current = null
    sheet.style.animation = 'none'
    sheet.style.transition = `transform ${DISMISS_MS}ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease-out`
    sheet.style.transform = `translateY(${Math.max(140, sheet.getBoundingClientRect().height + 24)}px)`
    sheet.style.opacity = '.96'
    sheet.dataset.sheetExpanded = 'false'
    setExpanded(false)
    finishTimerRef.current = window.setTimeout(() => {
      if (sheetRef.current === sheet) {
        sheet.style.removeProperty('height')
        sheet.style.removeProperty('transform')
        sheet.style.removeProperty('transition')
        sheet.style.removeProperty('animation')
        sheet.style.removeProperty('opacity')
        sheet.dataset.sheetExpanded = 'false'
      }
      baseHeightRef.current = 0
      finishTimerRef.current = null
      callback()
    }, DISMISS_MS)
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || dragRef.current || !sheetRef.current) return
    const sheet = sheetRef.current
    if (!expanded || baseHeightRef.current <= 0)
      baseHeightRef.current = sheet.getBoundingClientRect().height
    const now = performance.now()
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      moved: false,
      canExpand: canExpand(sheet),
      startedExpanded: expanded,
      lastY: event.clientY,
      lastTime: now,
      velocity: 0,
    }
    sheet.style.animation = 'none'
    sheet.style.transition = 'none'
    sheet.style.opacity = '1'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    const sheet = sheetRef.current
    if (!drag || !sheet || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.startY
    if (Math.abs(delta) > 5) drag.moved = true
    if (!drag.moved) return

    const now = performance.now()
    const dt = Math.max(1, now - drag.lastTime)
    const instantVelocity = (event.clientY - drag.lastY) / dt
    drag.velocity = drag.velocity * 0.68 + instantVelocity * 0.32
    drag.lastY = event.clientY
    drag.lastTime = now

    const base = baseHeightRef.current
    const maximum = Math.max(base, viewportHeight() - 16)
    const height = drag.startHeight - delta
    sheet.dataset.sheetExpanded = String(drag.canExpand && height > base + 2)

    if (!drag.canExpand && height > base) {
      sheet.style.height = `${base}px`
      sheet.style.transform = `translateY(${-Math.min(12, (height - base) * 0.32)}px)`
    } else if (height > maximum) {
      sheet.style.height = `${maximum}px`
      sheet.style.transform = `translateY(${-Math.min(12, (height - maximum) * 0.12)}px)`
    } else if (height < base) {
      sheet.style.height = `${base}px`
      sheet.style.transform = `translateY(${Math.max(0, base - height)}px)`
    } else {
      sheet.style.height = `${height}px`
      sheet.style.transform = 'translateY(0)'
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    const delta = event.clientY - drag.startY
    if (!drag.moved) return
    ignoreClickRef.current = true

    const base = baseHeightRef.current
    const rawHeight = drag.startHeight - delta
    const belowBase = Math.max(0, base - rawHeight)
    const closingFling = drag.velocity >= FLING_VELOCITY && delta >= FLING_MIN_DISTANCE
    const openingFling = drag.velocity <= -FLING_VELOCITY && delta <= -FLING_MIN_DISTANCE

    if (
      onCloseRef.current &&
      ((!drag.startedExpanded && (delta >= CLOSE_DISTANCE || closingFling)) ||
        (drag.startedExpanded &&
          (belowBase >= CLOSE_DISTANCE ||
            delta >= FULL_CLOSE_DISTANCE ||
            (closingFling && delta >= 96))))
    ) {
      dismiss()
      return
    }

    if (drag.startedExpanded) {
      settle(!(delta >= COLLAPSE_DISTANCE || closingFling))
      return
    }
    settle(drag.canExpand && (delta <= -COLLAPSE_DISTANCE || openingFling))
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    ignoreClickRef.current = false
    settle(drag.startedExpanded)
  }

  function onClick() {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false
      return
    }
    if (!sheetRef.current) return
    if (!expanded) baseHeightRef.current = sheetRef.current.getBoundingClientRect().height
    settle(!expanded && canExpand(sheetRef.current))
  }

  return {
    sheetRef,
    expanded,
    reset,
    dismiss,
    handleProps: {
      type: 'button' as const,
      className: 'sheet-drag-handle',
      'aria-label': expanded ? 'Свернуть или закрыть панель' : 'Развернуть или закрыть панель',
      'aria-expanded': expanded,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel,
      onClick,
    },
  }
}
