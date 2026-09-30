export type LocationPoint = {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

export class LocationError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
    this.name = 'LocationError'
  }
}

export function locationError(error: unknown): LocationError {
  if (error instanceof LocationError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : 0
  if (code === 1) return new LocationError(1, 'Доступ к геопозиции запрещён. Разрешите его для браузера или MAX в настройках устройства и для этого сайта.')
  if (code === 3) return new LocationError(3, 'Не удалось получить свежую геопозицию вовремя. Проверьте службы геолокации и нажмите ещё раз.')
  return new LocationError(2, 'Устройство не определило геопозицию. Проверьте службы геолокации, разрешения браузера или MAX и подключение к сети.')
}

function geolocation(): Geolocation {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    throw new LocationError(0, 'Геолокация доступна только через HTTPS. Откройте защищённую версию приложения.')
  if (typeof navigator === 'undefined' || !navigator.geolocation)
    throw new LocationError(0, 'Этот браузер или версия MAX не поддерживает геолокацию. Откройте приложение в другом браузере или обновите MAX.')
  return navigator.geolocation
}

function point(position: GeolocationPosition): LocationPoint {
  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new LocationError(2, 'Устройство вернуло некорректную геопозицию.')
  if (!Number.isFinite(position.timestamp) || position.timestamp > Date.now() + 5000 || Date.now() - position.timestamp > 60000)
    throw new LocationError(3, 'Устройство вернуло устаревшую геопозицию. Нажмите ещё раз для обновления.')
  if (!Number.isFinite(accuracy) || accuracy < 0)
    throw new LocationError(2, 'Устройство вернуло некорректную точность геопозиции.')
  return { latitude, longitude, accuracy, timestamp: position.timestamp }
}

function readPosition(highAccuracy: boolean, signal?: AbortSignal): Promise<LocationPoint> {
  return new Promise((resolve, reject) => {
    let geo: Geolocation
    try { geo = geolocation() } catch (error) { reject(error); return }
    if (signal?.aborted) { reject(new DOMException('Запрос отменён', 'AbortError')); return }
    let settled = false
    const finish = (value?: LocationPoint, error?: unknown) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(value!)
    }
    const cancel = () => finish(undefined, new DOMException('Запрос отменён', 'AbortError'))
    const timeout = highAccuracy ? 12000 : 8000
    const timer = window.setTimeout(() => finish(undefined, locationError({ code: 3 })), timeout + 1000)
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      geo.getCurrentPosition(
        (position) => {
          try { finish(point(position)) } catch (error) { finish(undefined, error) }
        },
        (error) => finish(undefined, locationError(error)),
        { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 },
      )
    } catch (error) { finish(undefined, locationError(error)) }
  })
}

export async function requestLocation(signal?: AbortSignal): Promise<LocationPoint> {
  try { return await readPosition(true, signal) } catch (error) {
    if (signal?.aborted || !(error instanceof LocationError) || (error.code !== 2 && error.code !== 3)) throw error
    return readPosition(false, signal)
  }
}

export function watchLocation(onPoint: (point: LocationPoint) => void, onError: (error: LocationError) => void): () => void {
  let geo: Geolocation
  try { geo = geolocation() } catch (error) { onError(locationError(error)); return () => {} }
  let active = true
  let id: number
  try {
    id = geo.watchPosition(
      (position) => {
        if (!active) return
        try { onPoint(point(position)) } catch (error) { onError(locationError(error)) }
      },
      (error) => { if (active) onError(locationError(error)) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  } catch (error) { onError(locationError(error)); return () => {} }
  return () => { active = false; geo.clearWatch(id) }
}
