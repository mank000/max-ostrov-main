import { useEffect, useState } from 'react'
import { latestEvent, loadUserEventsPage } from '../../api/events'
import { Button, Header, StatePanel } from '../../ui/components/BasicUI'
import { EventRow } from '../../ui/components/ContentCards'
import type { SocialProps } from '../FriendPages'
import '../social.css'

export function UserEventsScreen({ id, back, navigate, onError, data }: SocialProps) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof loadUserEventsPage>>['events']>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!id) return
    if (data.profile?.id === id) {
      navigate('myevents')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    loadUserEventsPage(id, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setItems(page.events)
        setNextCursor(page.nextCursor)
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, data.profile?.id, navigate, onError])

  async function loadMore() {
    if (!id || !nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await loadUserEventsPage(id, undefined, nextCursor)
      setItems((current) => {
        const seen = new Set(current.map((item) => item.event.id))
        return [...current, ...page.events.filter((item) => !seen.has(item.event.id))]
      })
      setNextCursor(page.nextCursor)
    } catch (error) {
      onError(String(error))
    } finally {
      setLoadingMore(false)
    }
  }

  const visibleItems = items
    .filter((item) => !data.deletedEventIds.has(item.event.id))
    .map((item) => ({
      ...item,
      event: latestEvent(item.event, data.eventOverrides[item.event.id]),
    }))
  return (
    <>
      <Header title="Мероприятия" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : visibleItems.length ? (
          <>
            {visibleItems.map((item) => (
              <EventRow
                key={item.event.id}
                event={item.event}
                onClick={() => navigate('event', item.event.id)}
              />
            ))}
            {nextCursor && (
              <div className="page-pad load-more">
                <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <StatePanel title="Пока нет мероприятий" />
        )}
      </div>
    </>
  )
}
