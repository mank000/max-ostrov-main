import type { Event, EventViewport } from '../../api/events'

export type MapCenter = { latitude: number; longitude: number }
export type MapMessage =
  | { type: 'kutezh:map-ready' | 'kutezh:map-error' }
  | { type: 'kutezh:event-select'; eventId: number }
  | { type: 'kutezh:events-select'; eventIds: number[] }
  | { type: 'kutezh:map-viewport'; bounds?: EventViewport; camera?: { center: MapCenter } }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function coordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
}
function eventID(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseMapMessage(value: unknown): MapMessage | null {
  if (!record(value)) return null
  switch (value.type) {
    case 'kutezh:map-ready':
    case 'kutezh:map-error':
      return { type: value.type }
    case 'kutezh:event-select':
      return eventID(value.eventId) ? { type: value.type, eventId: value.eventId } : null
    case 'kutezh:events-select': {
      if (!Array.isArray(value.eventIds) || value.eventIds.length > 1000 || !value.eventIds.every(eventID)) return null
      return { type: value.type, eventIds: [...new Set(value.eventIds)] }
    }
    case 'kutezh:map-viewport': {
      const message: Extract<MapMessage, { type: 'kutezh:map-viewport' }> = { type: value.type }
      if (value.bounds !== undefined) {
        const b = value.bounds
        if (!record(b) || !coordinate(b.west, 180) || !coordinate(b.east, 180) ||
            !coordinate(b.south, 90) || !coordinate(b.north, 90) || b.south > b.north) return null
        // west > east допустимо: окно карты пересекает линию перемены дат.
        message.bounds = { west: b.west, east: b.east, south: b.south, north: b.north }
      }
      if (value.camera !== undefined) {
        if (!record(value.camera) || !record(value.camera.center)) return null
        const c = value.camera.center
        if (!coordinate(c.latitude, 90) || !coordinate(c.longitude, 180)) return null
        message.camera = { center: { latitude: c.latitude, longitude: c.longitude } }
      }
      return message.bounds || message.camera ? message : null
    }
    default:
      return null
  }
}

export function nearestVisibleEvents(events: Event[], center: MapCenter | null, limit = 30): Event[] {
  const located = events.filter((event) => coordinate(event.location.latitude, 90) && coordinate(event.location.longitude, 180))
  const count = Math.max(0, Math.floor(limit))
  if (!center) return located.slice(0, count)
  const latitudeScale = Math.cos(center.latitude * Math.PI / 180)
  const distance = (event: Event) => {
    const latitude = event.location.latitude! - center.latitude
    const longitude = ((event.location.longitude! - center.longitude + 540) % 360 - 180) * latitudeScale
    return latitude * latitude + longitude * longitude
  }
  return located.sort((a, b) => distance(a) - distance(b)).slice(0, count)
}
