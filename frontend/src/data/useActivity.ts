import { useCallback, useMemo, useState, type SetStateAction } from 'react'
import { latestEvent, loadEventActivity, loadMyEvents, loadRecommendedEvents, type Event } from '../api/events'
import { useResource } from './useResource'

const emptyActivity = { events: [] as Event[], participating: new Set<number>(), saved: new Set<number>(), groupCount: 0 }
async function loadActivity(signal: AbortSignal) {
  const [upcoming, past, activity, created] = await Promise.all([
    loadMyEvents('upcoming', signal), loadMyEvents('past', signal),
    loadEventActivity(signal), loadMyEvents('created', signal),
  ])
  const participating = [...upcoming, ...past].filter((item) => item.participating)
  return {
    events: [...new Map([...participating, ...created].map((item) => [item.event.id, item.event])).values()],
    participating: new Set(activity.participating_event_ids),
    saved: new Set(activity.saved_event_ids), groupCount: activity.group_count,
  }
}

export function useActivity(enabled: boolean, onUnauthorized: () => void) {
  const activity = useResource(enabled, loadActivity, emptyActivity, onUnauthorized)
  const recommendations = useResource(enabled, loadRecommendedEvents, [] as Event[], onUnauthorized)
  const [overrides, setOverrides] = useState<Record<number, Event>>({})
  const [deleted, setDeleted] = useState<Set<number>>(() => new Set())
  const applyEventUpdate = useCallback((event: Event) => {
    setOverrides((current) => ({ ...current, [event.id]: event }))
    setDeleted((current) => {
      const next = new Set(current)
      next.delete(event.id)
      return next
    })
  }, [])
  const applyEventDelete = useCallback((id: number) => {
    setDeleted((current) => new Set(current).add(id))
    setOverrides((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])
  const { setValue } = activity
  const setParticipatingEventIds = useCallback((update: SetStateAction<Set<number>>) => {
    setValue((current) => ({ ...current, participating: typeof update === 'function' ? update(current.participating) : update }))
  }, [setValue])
  const setSavedEventIds = useCallback((update: SetStateAction<Set<number>>) => {
    setValue((current) => ({ ...current, saved: typeof update === 'function' ? update(current.saved) : update }))
  }, [setValue])
  const visible = useMemo(() => {
    const events = (items: Event[]) => items.filter((event) => !deleted.has(event.id))
      .map((event) => latestEvent(event, overrides[event.id]))
    const ids = (items: Set<number>) => new Set([...items].filter((id) => !deleted.has(id)))
    return {
      profileEvents: events(activity.value.events), recommendedEvents: events(recommendations.value),
      participatingEventIds: ids(activity.value.participating), savedEventIds: ids(activity.value.saved),
    }
  }, [activity.value, recommendations.value, overrides, deleted])
  const resetActivity = activity.reset
  const resetRecommendations = recommendations.reset
  const reset = useCallback(() => {
    resetActivity(); resetRecommendations(); setOverrides({}); setDeleted(new Set())
  }, [resetActivity, resetRecommendations])
  return {
    ...visible, activity, recommendations, overrides, deleted, reset,
    applyEventUpdate, applyEventDelete, setParticipatingEventIds, setSavedEventIds
  }
}
