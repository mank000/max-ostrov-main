import { sessionHeaders } from './credentials'
import { request } from './http'
export type AdminTarget = 'user' | 'post' | 'comment' | 'event'
export type AdminAction = 'hide' | 'restore' | 'suspend' | 'unsuspend'
export type AdminUser = {
  id: number
  max_user_id: number
  display_name: string
  username: string
  city: string
  role: string
  suspended: boolean
}
export type AdminContent = {
  id: number
  target_type: AdminTarget
  author_id: number
  author_name: string
  text: string
  hidden: boolean
  created_at: string
}
export type AdminAudit = {
  id: number
  target_type: AdminTarget
  target_id: number
  actor_user_id: number
  action: string
  reason: string
  created_at: string
}
export function adminAction(
  target_type: AdminTarget,
  target_id: number,
  action: AdminAction,
  reason: string,
) {
  return request<void>('/admin/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_type, target_id, action, reason }),
  })
}
export function adminUsers(
  q: string,
  status: string,
  beforeId?: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q, status, limit: '30' })
  if (beforeId) params.set('before_id', String(beforeId))
  return request<{ users: AdminUser[]; next_cursor: number | null }>(
    `/admin/users?${params}`,
    { signal },
  )
}
export function adminContent(
  kind: AdminTarget,
  q: string,
  status: string,
  beforeId?: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    q,
    status,
    target_type: kind,
    limit: '30',
  })
  if (beforeId) params.set('before_id', String(beforeId))
  return request<{ content: AdminContent[]; next_cursor: number | null }>(
    `/admin/content?${params}`,
    { signal },
  )
}
export function adminAudit(beforeId?: number, signal?: AbortSignal) {
  return request<{ actions: AdminAudit[]; next_cursor: number | null }>(
    `/admin/audit?limit=30${beforeId ? `&before_id=${beforeId}` : ''}`,
    { signal },
  )
}

export type AdminSupportStatus = 'open' | 'closed' | 'all'
export type AdminSupportAttachment = {
  id: number
  mime_type: string
  width: number
  height: number
  duration_ms: number
  url: string
}
export type AdminSupportMessage = {
  id: number
  sender: 'user' | 'staff'
  body: string
  created_at: string
  media: AdminSupportAttachment[]
}
export type AdminSupportUser = {
  id: number
  provider_user_id: number
  display_name: string
  username: string
}
export type AdminSupportChat = {
  id: number
  status: 'new' | 'open' | 'closed'
  updated_at: string
  user?: AdminSupportUser
  messages: AdminSupportMessage[]
}
export type AdminSupportThread = {
  id: number
  provider_user_id: number
  user_id: number
  display_name: string
  username: string
  status: 'open' | 'closed'
  updated_at: string
  latest_body: string
  latest_sender: string
  latest_at?: string | null
}
export function adminSupport(status: AdminSupportStatus, signal?: AbortSignal) {
  return request<{ threads: AdminSupportThread[] }>(
    `/admin/support?status=${encodeURIComponent(status)}`,
    { signal },
  )
}
export function adminSupportThread(id: number, signal?: AbortSignal) {
  return request<AdminSupportChat>(`/admin/support/${id}`, { signal })
}
export function adminSupportReply(id: number, body: string, file?: File | null) {
  const data = new FormData()
  data.append('body', body.trim())
  if (file) data.append('file', file)
  return request<{ message: AdminSupportMessage }>(
    `/admin/support/${id}/messages`,
    { method: 'POST', body: data },
    300000,
  )
}
export function adminSupportClose(id: number) {
  return request<void>(`/admin/support/${id}/close`, { method: 'POST' })
}
export function adminSupportReopen(id: number) {
  return request<void>(`/admin/support/${id}/reopen`, { method: 'POST' })
}
export async function adminSupportMedia(
  threadId: number,
  mediaId: number,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/v1/admin/support/${threadId}/media/${mediaId}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: sessionHeaders(),
    signal,
  })
  if (!response.ok) throw new Error('Не удалось загрузить вложение')
  return response.blob()
}
