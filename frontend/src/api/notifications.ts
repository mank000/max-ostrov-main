import { listField, readCursor, request } from './http'

export type Notification = {
  id: number
  kind: string
  title: string
  body: string
  event_id?: number
  post_id?: number
  is_clip?: boolean
  gift_id?: number
  group_id?: number
  actor_user_id?: number
  actor_display_name?: string
  actor_username?: string
  actor_photo_url?: string
  read_at?: string
  created_at: string
}

export async function loadNotificationsPage(
  unreadOnly = false,
  signal?: AbortSignal,
  beforeId?: number,
) {
  const body = await request<Record<string, unknown>>(
    `/users/me/notifications?unread_only=${unreadOnly ? 'true' : 'false'}${beforeId ? `&before_id=${beforeId}` : ''}`,
    { signal },
  )
  return {
    notifications: listField<Notification>(body, 'notifications'),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function markNotificationRead(notificationId: number) {
  return request<void>(`/users/me/notifications/${notificationId}/read`, {
    method: 'PUT',
  })
}

export async function markAllNotificationsRead() {
  return request<void>('/users/me/notifications', { method: 'PUT' })
}

export async function markDatingMatchesRead() {
  return request<void>('/users/me/notifications/dating-matches/read', { method: 'PUT' })
}

export function loadNotificationCounts(signal?: AbortSignal) {
  return request<{
    unread: number
    gifts: number
    clips: number
    messages: number
    matches: number
  }>('/users/me/notifications/counts', { signal })
}
