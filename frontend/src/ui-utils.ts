export type CityPin = {
  name: string
  latitude: number
  longitude: number
  area?: boolean
  radius_meters?: number
}

export function cityDisplayName(value: string): string {
  return (value.split(',')[0] || value).trim().slice(0, 80)
}

export function embeddedMapURL(configured = '/map/index.html'): string {
  try {
    const url = new URL(configured, window.location.origin)
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}`
      : '/map/index.html'
  } catch {
    return '/map/index.html'
  }
}

export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const tabValues = new Map<string, string>()

export function readTabValue(key: string): string | null {
  try { return sessionStorage.getItem(key) ?? tabValues.get(key) ?? null }
  catch { return tabValues.get(key) ?? null }
}

export function saveTabValue(key: string, value: string) {
  tabValues.set(key, value)
  try { sessionStorage.setItem(key, value) } catch { /* Embedded storage may be blocked. */ }
}

export function saveSetting(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function validPoint(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  )
}

export function eventIdInURL(search: string): number | null {
  const values = new URLSearchParams(search).getAll('eventId')
  const value = values.length === 1 ? values[0] : null
  if (!value || !/^[1-9]\d*$/.test(value)) return null

  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export type EventStartTarget = 'event' | 'participants' | 'groups' | 'post'

export function eventInStart(
  value: string | null | undefined,
): { id: number; target: EventStartTarget } | null {
  const match = /^(event|participants|groups|post)_([1-9]\d*)$/.exec(value || '')
  if (!match) return null

  const id = Number(match[2])
  return Number.isSafeInteger(id) ? { id, target: match[1] as EventStartTarget } : null
}

export function maxLink(botName: string | null | undefined, payload: string): string | null {
  const username = (botName || '').trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,64}$/.test(username) || !/^[A-Za-z0-9_-]{1,512}$/.test(payload)) return null
  return `https://max.ru/${username}?startapp=${payload}`
}

export function savedCity(): CityPin | null {
  try {
    const city = JSON.parse(readSetting('kutezh-selected-city') || 'null')
    if (
      !city ||
      typeof city.name !== 'string' ||
      city.name.trim().length === 0 ||
      city.name.length > 300 ||
      !validPoint(city.latitude, city.longitude)
    )
      return null

    const radius =
      typeof city.radius_meters === 'number' && Number.isFinite(city.radius_meters)
        ? Math.max(100, Math.min(100000, Math.round(city.radius_meters)))
        : undefined
    const normalized: CityPin = {
      name: city.name.trim(),
      latitude: city.latitude,
      longitude: city.longitude,
    }
    if (city.area === true) normalized.area = true
    if (radius !== undefined) normalized.radius_meters = radius
    return normalized
  } catch {
    return null
  }
}
