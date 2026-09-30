import { useEffect, useState } from 'react'
import { latestEvent, loadEvents, type Event } from '../api/events'
import { Header, SearchField, StatePanel } from '../ui/components/BasicUI'
import { EventRow } from '../ui/components/ContentCards'
import type { ScreenProps } from './screen-types'

export function EventSearch({ back, navigate, data }: ScreenProps) {
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    loadEvents(controller.signal)
      .then(setEvents)
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])
  const results = events
    .filter((item) => !data.deletedEventIds.has(item.id))
    .map((item) => latestEvent(item, data.eventOverrides[item.id]))
    .filter((item) =>
      `${item.title} ${item.category} ${item.location.city}`
        .toLocaleLowerCase('ru')
        .includes(query.toLocaleLowerCase('ru')),
    )
  return (
    <>
      <Header title="Поиск мероприятий" back={back} />
      <div className="screen-scroll">
        <div className="extra-pad">
          <SearchField value={query} onChange={setQuery} placeholder="Найти мероприятие" />
        </div>
        {loading ? (
          <StatePanel title="" loading />
        ) : results.length ? (
          results.map((item) => (
            <EventRow key={item.id} event={item} onClick={() => navigate('event', item.id)} />
          ))
        ) : (
          <StatePanel title="Ничего не найдено" />
        )}
      </div>
    </>
  )
}
