import { useEffect, useMemo, useState } from 'react'
import { latestEvent, loadEvents, type Event } from '../api/events'
import { isThisWeekend, readEventCategories, saveEventCategories } from '../event-filters'
import { Chip, Header, IconButton, SearchField, StatePanel } from '../ui/components/BasicUI'
import { EventCard, EventRow } from '../ui/components/ContentCards'
import type { AppDataResult } from '../useAppData'
import { useDeviceLayout } from '../app/useDeviceLayout'
import './main.css'
import type { Navigate } from './tab-types'

export function EventsScreen({
  city,
  data,
  navigate,
}: {
  city: string
  data: AppDataResult
  navigate: Navigate
}) {
  const desktop = useDeviceLayout()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'today' | 'weekend' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState(readEventCategories)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const refreshEvents = () => setRetry((value) => value + 1)
    window.addEventListener('kutezh:events-updated', refreshEvents)
    return () => window.removeEventListener('kutezh:events-updated', refreshEvents)
  }, [])
  function selectCategories(value: string[]) {
    setCategories(value)
    saveEventCategories(value)
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loadEvents(controller.signal, city)
      .then((items) => {
        if (!controller.signal.aborted) setEvents(items)
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Не удалось загрузить мероприятия')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [city, retry])
  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) => !data.deletedEventIds.has(event.id))
        .map((event) => latestEvent(event, data.eventOverrides[event.id])),
    [events, data.deletedEventIds, data.eventOverrides],
  )
  const filtered = useMemo(() => {
    const now = new Date()
    return visibleEvents.filter((event) => {
      if (
        query &&
        !`${event.title} ${event.description} ${event.location.venue_name}`
          .toLocaleLowerCase('ru')
          .includes(query.toLocaleLowerCase('ru'))
      )
        return false
      if (categories.length && !categories.some((name) => name.toLocaleLowerCase('ru') === event.category.toLocaleLowerCase('ru'))) return false
      if (filter === 'all') return true
      const date = new Date(event.starts_at)
      if (filter === 'today') return date.toDateString() === now.toDateString()
      return isThisWeekend(date, now)
    })
  }, [visibleEvents, query, filter, categories])
  const featured =
    filtered.find((event) => event.is_promoted) ||
    filtered.find((event) => data.recommendedEvents.some((item) => item.id === event.id)) ||
    filtered[0]
  return (
    <>
      <Header
        title="Мероприятия"
        actions={
          desktop ? <button className="desktop-primary-action" type="button" onClick={() => navigate('createevent')}>Создать мероприятие</button>
            : <IconButton icon="plus" label="Создать мероприятие" onClick={() => navigate('createevent')} active />
        }
      />
      <div className="screen-scroll">
        <div className="events-toolbar">
        <div className="events-search page-pad">
          <SearchField value={query} onChange={setQuery} placeholder="Поиск мероприятий" />
        </div>
        <div className="events-filters">
          <Chip active={filter === 'today'} onClick={() => setFilter('today')}>
            Сегодня
          </Chip>
          <Chip active={filter === 'weekend'} onClick={() => setFilter('weekend')}>
            Выходные
          </Chip>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            Все
          </Chip>
        </div>
        <div className="events-city">
          <button type="button" onClick={() => navigate('city')}>
            {city || 'Выберите город'}
          </button>
          {desktop ? <button className="desktop-category-action" type="button" onClick={() => navigate('filters')}>
            Категории{categories.length > 0 ? ` · ${categories.length}` : ''}
          </button> : <IconButton icon="filter" label="Фильтры" onClick={() => navigate('filters')} active />}
        </div>
        </div>
        {loading ? (
          <StatePanel title="" loading />
        ) : error ? (
          <StatePanel
            title="Не удалось загрузить"
            description={error}
            action="Повторить"
            onAction={() => setRetry((value) => value + 1)}
          />
        ) : filtered.length ? (
          <>
            <h2 className="section-title">
              {filter === 'weekend'
                ? 'На этих выходных'
                : filter === 'today'
                  ? 'Сегодня'
                  : 'Мероприятия'}
            </h2>
            {featured && (
              <EventCard event={featured} onClick={() => navigate('event', featured.id)} />
            )}
            <div className="events-list">
              {filtered
                .filter((event) => event.id !== featured?.id)
                .map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    onClick={() => navigate('event', event.id)}
                  />
                ))}
            </div>
          </>
        ) : visibleEvents.length ? (
          <StatePanel title="Ничего не найдено" description="Попробуйте другой день или категорию."
            action="Сбросить фильтры" onAction={() => {
              setFilter('all')
              setQuery('')
              selectCategories([])
            }} />
        ) : (
          <StatePanel title="Пока нет мероприятий"
            description={city ? 'В этом городе пока нет событий. Организуйте встречу сами.'
              : 'Пока нет событий. Организуйте встречу сами.'}
            action="Создать мероприятие" onAction={() => navigate('createevent')} />
        )}
      </div>
    </>
  )
}
