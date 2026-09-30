export type EventParticipant = {
  id: number
  username?: string
  display_name: string
  bio: string
  city: string
  photo_url?: string
  interests: string[]
  common_interests: string[]
  is_friend: boolean
  is_organizer: boolean
  group_id?: number
  equipped_decoration_code?: string
}

import { ApiError, request } from './api/http'

export async function loadEventParticipants(eventId: number, signal: AbortSignal) {
  try {
    const payload = await request<{ participants: EventParticipant[] | null }>(
      `/events/${eventId}/participants`,
      { signal },
    )
    if (payload.participants === null) return []
    if (!Array.isArray(payload.participants))
      throw new ApiError('Некорректный список участников', 502)
    return payload.participants
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new ApiError('Список доступен только участникам мероприятия', 403)
    }
    throw error
  }
}

export async function sendFriendRequest(userId: number) {
  return request<void>(`/users/${userId}/friend-requests`, { method: 'POST' })
}

export async function cancelFriendRequest(userId: number) {
  return request<void>(`/users/${userId}/friend-requests`, {
    method: 'DELETE',
  })
}
