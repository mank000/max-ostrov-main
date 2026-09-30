export const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000
export const PRESENCE_PROFILE_REFRESH_MS = 15_000

export function compactLastSeen(lastSeenAt?: string, now = Date.now()) {
  if (!lastSeenAt) return ''
  const timestamp = Date.parse(lastSeenAt)
  if (!Number.isFinite(timestamp)) return ''

  const elapsed = Math.max(60_000, now - timestamp)
  const minutes = Math.max(1, Math.floor(elapsed / 60_000))
  if (minutes < 60) return `${minutes} мин`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч`

  const days = Math.floor(hours / 24)
  if (days < 31) {
    if (days % 10 === 1 && days % 100 !== 11) return `${days} день`
    if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return `${days} дня`
    return `${days} дней`
  }

  if (days < 365) return `${Math.max(1, Math.floor(days / 30))} мес`
  return `${Math.max(1, Math.floor(days / 365))} г`
}
