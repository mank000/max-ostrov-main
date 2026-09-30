export const FIT_SCALE = 1
export const MIN_SCALE = 0.55
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2
export const DOUBLE_TAP_MAX_DISTANCE = 44
export const PAGE_DISTANCE = 64
export const CLOSE_DISTANCE = 82
export const WHEEL_PAGE_DISTANCE = 72
export const WHEEL_CLOSE_DISTANCE = 110
export const WHEEL_IDLE_MS = 110
export const WHEEL_COOLDOWN_MS = 420
export const TAP_MOVE_TOLERANCE = 16
export const AUTO_HIDE_MS = 3000
export const TAP_DELAY_MS = 280

export type Gesture = {
  kind: 'none' | 'swipe' | 'pan' | 'pinch'
  startX: number
  startY: number
  originX: number
  originY: number
  startDistance: number
  startScale: number
}

export type PointerGesture = {
  active: boolean
  pointerId: number
  kind: 'swipe' | 'pan'
  axis: 'none' | 'x' | 'y'
  startX: number
  startY: number
  originX: number
  originY: number
}

export type WheelGesture = {
  axis: 'none' | 'x' | 'y'
  x: number
  y: number
}

export function distance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function containMediaSize(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0)
    return null
  const fit = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight)
  return { width: sourceWidth * fit, height: sourceHeight * fit }
}

