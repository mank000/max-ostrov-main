import { useEffect, useState } from 'react'
import { latestEvent, loadMyEvents, type EventHistoryItem } from '../api/events'
import { Header, StatePanel, Tabs } from '../ui/components/BasicUI'
import { EventRow } from '../ui/components/ContentCards'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function MyEvents({
  view,
  back,
  navigate,
  onError,
  data,
}: ScreenProps & { view: 'upcoming' | 'past' | 'created' | 'saved' }) {
  const [tab, setTab] = useState(view)
  const [items, setItems] = useState<EventHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    loadMyEvents(tab, controller.signal)
      .then(setItems)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [tab, onError])
  const visibleItems = items
    .filter((item) => !data.deletedEventIds.has(item.event.id))
    .map((item) => ({
      ...item,
      event: latestEvent(item.event, data.eventOverrides[item.event.id]),
    }))
  return (
    <>
      <Header title="Мои мероприятия" back={back} />
      <Tabs
        items={[
          { id: 'upcoming', label: 'Участвую' },
          { id: 'created', label: 'Созданы' },
          { id: 'past', label: 'Прошедшие' },
          { id: 'saved', label: 'Сохранено' },
        ]}
        value={tab}
        onChange={(value) => setTab(value as typeof tab)}
      />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : visibleItems.length ? (
          visibleItems.map((item) => (
            <EventRow
              key={item.event.id}
              event={item.event}
              onClick={() => navigate('event', item.event.id)}
            />
          ))
        ) : (
          <StatePanel
            title="Пока нет мероприятий"
            action="Найти мероприятие"
            onAction={() => navigate('events')}
          />
        )}
      </div>
    </>
  )
}
