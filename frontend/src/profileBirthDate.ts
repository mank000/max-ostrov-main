function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function profileBirthDateRange(now = new Date()) {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()

  // The server measures completed years. A 100-year-old may be almost 101.
  const minDate = new Date(Date.UTC(year - 101, month, day))
  if (minDate.getUTCMonth() === month) minDate.setUTCDate(minDate.getUTCDate() + 1)

  const maxDate = new Date(Date.UTC(year - 13, month, day))
  if (maxDate.getUTCMonth() !== month) maxDate.setUTCDate(0)

  return { min: isoDate(minDate), max: isoDate(maxDate) }
}

export function profileBirthDateValid(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) return false
  const { min, max } = profileBirthDateRange(now)
  return value >= min && value <= max
}


export function profileBirthDateAge(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) return null
  let age = now.getUTCFullYear() - year
  const currentMonth = now.getUTCMonth() + 1
  const currentDay = now.getUTCDate()
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age--
  return age
}

export function profileBirthDateAdult(value: string, now = new Date()) {
  const age = profileBirthDateAge(value, now)
  return profileBirthDateValid(value, now) && age !== null && age >= 18
}
