export function formatMediaTime(value: number, showHours = true): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  const seconds = String(total % 60).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  if (showHours && hours > 0) {
    return `${hours}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${seconds}`
  }
  return `${Math.floor(total / 60)}:${seconds}`
}
