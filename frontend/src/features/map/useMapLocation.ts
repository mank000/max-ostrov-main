import { useCallback, useEffect, useRef, useState } from 'react'
import { locationError, requestLocation, watchLocation, type LocationPoint } from '../../location'

export function useMapLocation(active: boolean, ready: boolean, send: (message: object) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [tracking, setTracking] = useState(false)
  const trackingRef = useRef(false)
  const request = useRef<AbortController | null>(null)
  const clearWatch = useRef<(() => void) | null>(null)
  const lastPoint = useRef<LocationPoint | null>(null)
  const enabled = useRef(false)
  enabled.current = active && ready

  const stop = useCallback(() => {
    request.current?.abort()
    request.current = null
    clearWatch.current?.()
    clearWatch.current = null
  }, [])

  const showPoint = useCallback((point: LocationPoint, focus: boolean) => {
    if (!enabled.current || document.hidden) return
    lastPoint.current = point
    setAccuracy(point.accuracy)
    setError('')
    send({ type: 'kutezh:location-update', ...point, focus })
  }, [send])

  const follow = useCallback(() => {
    clearWatch.current?.()
    clearWatch.current = watchLocation(
      (point) => {
        if (lastPoint.current && point.timestamp < lastPoint.current.timestamp) return
        showPoint(point, false)
      },
      (cause) => {
        if (!enabled.current || document.hidden) return
        setError(cause.message)
        if (cause.code === 1) {
          clearWatch.current?.()
          clearWatch.current = null
          trackingRef.current = false
          setTracking(false)
        }
      },
    )
  }, [showPoint])

  const locate = useCallback(async (focus = true) => {
    if (!enabled.current) {
      setError('Карта ещё загружается. Нажмите геолокацию после загрузки.')
      return
    }
    stop()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError('')
    try {
      const point = await requestLocation(controller.signal)
      if (controller.signal.aborted || !enabled.current || document.hidden) return
      showPoint(point, focus)
      trackingRef.current = true
      setTracking(true)
      follow()
    } catch (cause) {
      if (!controller.signal.aborted) { setError(locationError(cause).message); trackingRef.current = false; setTracking(false) }
    } finally {
      if (request.current === controller) { request.current = null; setPending(false) }
    }
  }, [follow, showPoint, stop])

  useEffect(() => {
    if (!active || !ready) { stop(); setPending(false) }
    else if (trackingRef.current && !document.hidden) void locate(false)
    const visibility = () => {
      if (document.hidden) { stop(); setPending(false) }
      else if (enabled.current && trackingRef.current) void locate(false)
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', stop)
    window.addEventListener('pageshow', visibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', stop)
      window.removeEventListener('pageshow', visibility)
    }
  }, [active, ready, locate, stop])

  return { locate, pending, error, accuracy, tracking }
}
