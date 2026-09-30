import { collection, readCursor, request } from './http'
import { type Friend } from './users'

type EventLocation = {
  venue_name: string
  address: string
  city: string
  latitude?: number
  longitude?: number
}

export type Event = {
  id: number
  title: string
  description: string
  category: string
  updated_at: string
  starts_at: string
  ends_at?: string
  location: EventLocation
  organizer: { user_id?: number; name: string }
  price_min_rubles?: number
  ticket_url?: string
  header_source_media_id?: number
  header_media_id?: number
  icon_source_media_id?: number
  icon_media_id?: number
  is_official: boolean
  is_promoted: boolean
}

export type EventHistoryItem = {
  event: Event
  participating: boolean
  saved: boolean
}

export type EventCategory = {
  name: string
  event_count: number
}

type EventRecommendation = {
  event: Event
  score: number
  matches_interest: boolean
  friends_attending: number
  participant_count: number
}

export async function loadEvents(signal?: AbortSignal, city?: string) {
  const value = city?.trim()
  const path = value ? `/events?city=${encodeURIComponent(value)}` : '/events'
  return collection((await request<{ events: Event[] }>(path, { signal })).events)
}

export type EventViewport = {
  west: number
  south: number
  east: number
  north: number
}

export async function loadViewportEventsPage(
  viewport: EventViewport,
  signal?: AbortSignal,
  afterId = 0,
) {
  const params = new URLSearchParams({
    west: String(viewport.west),
    south: String(viewport.south),
    east: String(viewport.east),
    north: String(viewport.north),
  })
  if (afterId > 0) params.set('after_id', String(afterId))
  const body = await request<{ events: Event[]; next_cursor?: number }>(
    `/events/viewport?${params}`,
    { signal },
  )
  return {
    events: collection(body.events),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function loadEventCategories(signal?: AbortSignal) {
  return collection(
    (
      await request<{ categories: EventCategory[] }>('/events/categories', {
        signal,
      })
    ).categories,
  )
}

export async function loadRecommendedEvents(signal?: AbortSignal) {
  const items = collection(
    (await request<{ events: EventRecommendation[] }>('/events/recommendations', { signal }))
      .events,
  )
  return items.map((item) => item.event)
}

export async function loadEvent(id: number, signal?: AbortSignal) {
  return request<Event>(`/events/${id}`, { signal })
}

export async function loadUserEventsPage(userId: number, signal?: AbortSignal, beforeId = 0) {
  const path =
    beforeId > 0 ? `/users/${userId}/events?before_id=${beforeId}` : `/users/${userId}/events`
  const events = collection(
    (await request<{ events: EventHistoryItem[] }>(path, { signal })).events,
  )
  return {
    events,
    nextCursor: events.length === 50 ? events.at(-1)?.event.id || null : null,
  }
}

export async function loadMyEvents(
  view: 'upcoming' | 'past' | 'saved' | 'created',
  signal?: AbortSignal,
) {
  return collection(
    (await request<{ events: EventHistoryItem[] }>(`/users/me/events?view=${view}`, { signal }))
      .events,
  )
}

export async function setParticipation(eventId: number, participating: boolean) {
  return request<void>(`/events/${eventId}/participation`, {
    method: participating ? 'PUT' : 'DELETE',
  })
}

export async function setSaved(eventId: number, saved: boolean) {
  return request<void>(`/events/${eventId}/saved`, {
    method: saved ? 'PUT' : 'DELETE',
  })
}

export type EventInvitation = {
  event_id: number
  event_title: string
  starts_at: string
  sender: Friend['user']
  created_at: string
}

export async function inviteFriendToEvent(eventId: number, userId: number) {
  return request<void>(`/events/${eventId}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  })
}

export async function loadEventInvitations(signal?: AbortSignal) {
  return collection(
    (await request<{ invitations: EventInvitation[] }>('/users/me/event-invitations', { signal }))
      .invitations,
  )
}

export async function resolveEventInvitation(eventId: number, senderId: number, accept: boolean) {
  return request<void>(`/events/${eventId}/invitations/${senderId}`, {
    method: accept ? 'PUT' : 'DELETE',
  })
}

export type CreateEventInput = {
  title: string
  description: string
  category: string
  starts_at: string
  ends_at?: string
  location: EventLocation
  ticket_url?: string
  price_min_rubles?: number
  header_source_media_id?: number
  header_media_id?: number
  icon_source_media_id?: number
  icon_media_id?: number
}

export async function createEvent(input: CreateEventInput, idempotencyKey: string) {
  return request<Event>('/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  })
}

export async function updateEvent(eventId: number, input: CreateEventInput) {
  return request<Event>(`/events/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteEvent(eventId: number) {
  return request<void>(`/events/${eventId}`, { method: 'DELETE' })
}

export function loadEventActivity(signal?: AbortSignal) {
  return request<{
    participating_event_ids: number[]
    saved_event_ids: number[]
    group_count: number
  }>('/users/me/event-activity', { signal })
}

export function latestEvent<T extends Event | null | undefined>(
  event: T,
  saved?: Event,
): T | Event {
  if (!event) return saved ?? event
  if (!saved) return event
  return new Date(saved.updated_at).getTime() > new Date(event.updated_at).getTime() ? saved : event
}
