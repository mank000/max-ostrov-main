import { useEffect, useState } from 'react'
import { latestEvent, loadEvent, type Event } from '../api/events'
import type { ScreenProps } from './screen-types'

export function useEvent(id: number | undefined, data: ScreenProps['data']) {
  const [loadedEvent, setLoadedEvent] = useState<Event | null>(null)
  const [error, setError] = useState('')
  const deleted = Boolean(id && data.deletedEventIds.has(id))
  const event =
    !deleted && id
      ? latestEvent(loadedEvent?.id === id ? loadedEvent : null, data.eventOverrides[id])
      : null
  useEffect(() => {
    if (!id || deleted) return
    const controller = new AbortController()
    setError('')
    loadEvent(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoadedEvent(value)
          data.applyEventUpdate(value)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [id, deleted, data.applyEventUpdate])
  return { event, error }
}
