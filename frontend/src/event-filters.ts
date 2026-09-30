import { readTabValue, saveTabValue } from './ui-utils'

export function readEventCategories(): string[] {
  try {
    const value: unknown = JSON.parse(readTabValue('kutezh-categories') || '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function saveEventCategories(categories: string[]) {
  saveTabValue('kutezh-categories', JSON.stringify(categories))
}

export function isThisWeekend(date: Date, now = new Date()): boolean {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = start.getDay()
  start.setDate(start.getDate() + (day === 0 ? -1 : 6 - day))
  const end = new Date(start)
  end.setDate(end.getDate() + 2)
  return date >= start && date < end
}
