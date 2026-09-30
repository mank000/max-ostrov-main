import { type CitySuggestion, type PlaceSuggestion } from './api/places'
import { cityDisplayName, validPoint } from './ui-utils'

const trustedTicketDomains = [
  'afisha.yandex.ru',
  'ticketland.ru',
  'kassir.ru',
  'redkassa.ru',
  'qtickets.ru',
  'qtickets.tours',
  'timepad.ru',
  'ticketscloud.com',
]

export function eventTicketURLIssue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (
      new TextEncoder().encode(trimmed).length > 2048 ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.port ||
      /\s/.test(trimmed)
    )
      return 'Проверьте ссылку на билеты'
    if (url.protocol !== 'https:') return 'Ссылка на билеты должна начинаться с https://'
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    const trusted = trustedTicketDomains.some(
      (domain) => host === domain || host.endsWith('.' + domain),
    )
    if (!trusted)
      return 'Используйте ссылку Яндекс Афиши, Ticketland, KASSIR.RU, RedKassa, Qtickets, Timepad или Ticketscloud'
    return ''
  } catch {
    return 'Проверьте ссылку на билеты'
  }
}

export function matchEventCity(cities: CitySuggestion[], name: string): CitySuggestion | undefined {
  const normalized = name.trim().toLocaleLowerCase('ru')
  return cities.find((item) => cityDisplayName(item.name).toLocaleLowerCase('ru') === normalized)
}

export function eventAddressCandidates(places: PlaceSuggestion[], city: string): PlaceSuggestion[] {
  const normalized = city.trim().toLocaleLowerCase('ru')
  return places.filter(
    (item) => item.scope === 'city' || item.city.toLocaleLowerCase('ru') === normalized,
  )
}

export function eventBasicsError(title: string, category: string, description: string): string {
  if (!title.trim()) return 'Укажите название мероприятия'
  if (Array.from(title.trim()).length > 120) return 'Название должно быть короче 121 символа'
  if (!category.trim()) return 'Выберите категорию'
  if (Array.from(category.trim()).length > 64) return 'Категория должна быть короче 65 символов'
  if (!description.trim()) return 'Добавьте описание мероприятия'
  if (Array.from(description.trim()).length > 4000) return 'Описание должно быть короче 4001 символа'
  return ''
}

export function eventTimeAndPlaceError(
  input: {
    start: string
    end: string
    venue: string
    city: string
    address: string
    latitude?: number
    longitude?: number
    price: string
    ticketUrl: string
  },
  now = Date.now(),
): string {
  if (!input.start) return 'Укажите время начала'
  const startsAt = new Date(input.start).getTime()
  if (!Number.isFinite(startsAt) || startsAt <= now) return 'Начало должно быть в будущем'
  if (input.end) {
    const endsAt = new Date(input.end).getTime()
    if (!Number.isFinite(endsAt) || endsAt <= startsAt) return 'Окончание должно быть позже начала'
  }
  if (Array.from(input.venue.trim()).length > 160) return 'Название места должно быть короче 161 символа'
  if (!input.city.trim()) return 'Укажите город встречи'
  if (Array.from(input.city.trim()).length < 2 && input.latitude === undefined)
    return 'Название города должно содержать хотя бы два символа'
  if (Array.from(input.city.trim()).length > 80) return 'Название города должно быть короче 81 символа'
  if (
    !input.venue.trim() &&
    !input.address.trim() &&
    (input.latitude === undefined || input.longitude === undefined)
  )
    return 'Укажите место встречи, адрес или точку на карте'
  if (!input.address.trim() && (input.latitude === undefined || input.longitude === undefined))
    return 'Введите адрес или выберите точку на карте'
  if (Array.from(input.address.trim()).length > 240) return 'Адрес должен быть короче 241 символа'
  if (!validPoint(input.latitude, input.longitude) && (input.latitude !== undefined || input.longitude !== undefined))
    return 'Выберите корректную точку на карте'
  if (input.price && (!Number.isSafeInteger(Number(input.price)) || Number(input.price) < 0))
    return 'Укажите цену целым неотрицательным числом'
  const ticketIssue = eventTicketURLIssue(input.ticketUrl)
  if (ticketIssue) return ticketIssue
  return ''
}
