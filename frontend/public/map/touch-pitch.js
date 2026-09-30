export function tiltIntent(start, points) {
  const moves = points.map((point, index) => ({ x: point.x - start[index].x, y: point.y - start[index].y }))
  const gap = (pair) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)
  const angle = (pair) => Math.atan2(pair[1].y - pair[0].y, pair[1].x - pair[0].x)
  const angleChange = Math.atan2(Math.sin(angle(points) - angle(start)), Math.cos(angle(points) - angle(start)))
  if (Math.abs(gap(points) - gap(start)) > Math.max(10, gap(start) * 0.12) || Math.abs(angleChange) > Math.PI / 15) return 'other'
  if (moves.every((move) => Math.abs(move.y) >= 3 && Math.abs(move.y) > Math.abs(move.x) * 1.2) && moves[0].y * moves[1].y > 0) return 'tilt'
  if (moves.every((move) => Math.abs(move.x) > 12 && Math.abs(move.x) > Math.abs(move.y))) return 'other'
  return 'pending'
}

export function installTouchPitch(map) {
  const canvas = map.getCanvasContainer()
  let start = null
  let mode = 'pending'
  let pitch = 0
  let nextPitch = 0
  let frame = 0
  let suppressClickUntil = 0
  let panEnabled = false
  let zoomEnabled = false
  const points = (touches) => Array.from(touches).map((touch) => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY }))
  const draw = () => { frame = 0; map.setPitch(nextPitch) }
  const finish = () => {
    if (frame) { cancelAnimationFrame(frame); draw() }
    if (mode === 'tilt') {
      suppressClickUntil = performance.now() + 400
      if (panEnabled) map.dragPan.enable()
      if (zoomEnabled) map.touchZoomRotate.enable()
    }
    start = null
    mode = 'pending'
  }
  const begin = (event) => {
    if (event.touches.length !== 2) { finish(); return }
    start = points(event.touches)
    pitch = map.getPitch()
    mode = 'pending'
  }
  const move = (event) => {
    if (!start || event.touches.length !== 2) return
    const touches = points(event.touches)
    const pair = start.map((point) => touches.find((touch) => touch.id === point.id))
    if (pair.some((point) => !point)) { finish(); return }
    if (event.cancelable) event.preventDefault()
    if (mode === 'pending') {
      mode = tiltIntent(start, pair)
      if (mode === 'tilt') {
        map.stop()
        panEnabled = map.dragPan.isEnabled()
        zoomEnabled = map.touchZoomRotate.isEnabled()
        map.dragPan.disable()
        map.touchZoomRotate.disable()
      }
    }
    if (mode !== 'tilt') return
    event.stopImmediatePropagation()
    const dy = (pair[0].y - start[0].y + pair[1].y - start[1].y) / 2
    nextPitch = Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), pitch - dy * 0.5))
    if (!frame) frame = requestAnimationFrame(draw)
  }
  const end = (event) => {
    if (event.touches.length !== 2) finish()
  }
  const click = (event) => {
    if (performance.now() >= suppressClickUntil) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  map.touchPitch.disable()
  canvas.addEventListener('touchstart', begin, { capture: true, passive: true })
  canvas.addEventListener('touchmove', move, { capture: true, passive: false })
  canvas.addEventListener('touchend', end, { capture: true, passive: true })
  canvas.addEventListener('touchcancel', finish, { capture: true, passive: true })
  canvas.addEventListener('click', click, true)
  window.addEventListener('blur', finish)
  const dispose = (event) => {
    if (event?.type === 'remove') {
      cancelAnimationFrame(frame)
      frame = 0
      start = null
      mode = 'pending'
    } else finish()
    canvas.removeEventListener('touchstart', begin, true)
    canvas.removeEventListener('touchmove', move, true)
    canvas.removeEventListener('touchend', end, true)
    canvas.removeEventListener('touchcancel', finish, true)
    canvas.removeEventListener('click', click, true)
    window.removeEventListener('blur', finish)
    map.off('remove', dispose)
  }
  map.on('remove', dispose)
  return dispose
}
