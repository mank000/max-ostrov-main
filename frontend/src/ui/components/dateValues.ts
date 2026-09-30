export function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return localDateValue(date) === value ? date : null
}

export function dateInRange(value: string, min?: string, max?: string) {
  if (!/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/.test(value)) return false
  return (
    Boolean(parseDateValue(value.slice(0, 10))) &&
    (!min || value.slice(0, min.length) >= min) &&
    (!max || value.slice(0, max.length) <= max)
  )
}
