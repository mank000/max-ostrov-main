import { type Event } from '../../../api/events'
import { type IconName } from '../BasicUI'
import '../cards.css'

export function eventDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) {
  return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value))
}

export function eventTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return eventDate(value)
}

export type EventCategoryVisual = { icon: IconName; label: string }

export function eventCategoryVisual(event: Pick<Event, 'category' | 'title'>): EventCategoryVisual {
  const value = `${event.category} ${event.title}`.toLocaleLowerCase('ru')
  if (/музык|джаз|концерт|сцен/.test(value)) return { icon: 'music', label: 'Музыка' }
  if (/кино|фильм|показ/.test(value)) return { icon: 'film', label: 'Кино' }
  if (/спорт|бег|движ|фитнес|йог/.test(value)) return { icon: 'sport', label: 'Спорт' }
  if (/фото|съём|фотограф/.test(value)) return { icon: 'camera', label: 'Фото' }
  if (/арт|искус|выстав|музе/.test(value)) return { icon: 'palette', label: 'Искусство' }
  if (/игр|квиз|кибер|настол/.test(value)) return { icon: 'game', label: 'Игры' }
  if (/тех|\bit\b|лекц|frontend|нетворк|конференц/.test(value))
    return { icon: 'code', label: 'Технологии' }
  if (/кофе|бранч|еда|фуд|ресторан/.test(value)) return { icon: 'coffee', label: 'Еда' }
  return { icon: 'users', label: event.category || 'Встреча' }
}

export function eventHeaderURL(event: Pick<Event, 'header_media_id'>) {
  return event.header_media_id ? `/api/v1/media/${event.header_media_id}/content` : ''
}

export function eventIconURL(event: Pick<Event, 'icon_media_id'>) {
  return event.icon_media_id ? `/api/v1/media/${event.icon_media_id}/content` : ''
}
