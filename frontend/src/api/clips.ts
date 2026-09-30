import { request } from './http'
import type { Post } from './posts'
import type { MediaAsset } from './media'
import type { EditSettings } from '../clips/media'

export type Clip = Post & {
  following: boolean
  cover_ms: number
  senders: Post['author'][]
}
export type ClipScope = 'for-you' | 'following' | 'inbox' | 'author'
export type ClipPage = { clips: Clip[]; next_cursor?: string }
export type ClipMessage = {
  id: number
  sender_id: number
  recipient_id: number
  peer: Post['author']
  clip: Clip
  created_at: string
  read_at?: string
  reply_emoji?: string
  replied_at?: string
  reply_read_at?: string
}
const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
export const loadClips = (
  scope: ClipScope,
  cursor: string,
  authorId: number,
  signal?: AbortSignal,
) =>
  request<ClipPage>(
    `/clips?${new URLSearchParams({ scope, cursor, ...(authorId ? { author_id: String(authorId) } : {}) })}`,
    { signal },
  )
export const loadClip = (id: number, signal?: AbortSignal) =>
  request<Clip>(`/clips/${id}`, { signal })

export const shareClip = (id: number, recipient: number) =>
  request<void>(`/clips/${id}/share`, {
    method: 'POST',
    ...json({ recipient_id: recipient }),
  })
export const clipFeedback = (id: number, watched: number, hidden = false) =>
  request<void>(`/clips/${id}/feedback`, {
    method: 'PUT',
    ...json({
      watched_ms: Math.min(180000, Math.max(0, Math.round(watched))),
      hidden,
    }),
  })
export const uploadClip = (file: File, signal: AbortSignal, edit?: EditSettings) => {
  const body = new FormData()
  body.append('file', file)
  if (edit) {
    body.set('transcode', '1')
    body.set('start', String(edit.start))
    body.set('end', String(edit.end))
    body.set('rotation', String(edit.rotation))
    body.set('muted', edit.muted ? '1' : '0')
    body.set('portrait', edit.portrait ? '1' : '0')
  }
  return request<MediaAsset>(
    '/media/clips',
    { method: 'POST', body, signal },
    edit ? 330000 : 180000,
  )
}


export const markClipInboxRead = () =>
  request<void>('/clips/inbox', { method: 'PUT' })

export const loadClipMessages = (signal?: AbortSignal) =>
  request<{ messages: ClipMessage[] }>('/clips/inbox', { signal }).then(
    (body) => body.messages || [],
  )

export const markClipMessageThreadRead = (peerId: number) =>
  request<void>(`/clips/inbox/${peerId}/read`, { method: 'PUT' })

export const reactClipMessage = (shareId: number, emoji: string) =>
  request<void>(`/clips/inbox/${shareId}/react`, {
    method: 'PUT',
    ...json({ emoji }),
  })

export const deleteClipMessage = (shareId: number, forEveryone = false) =>
  request<void>(
    `/clips/inbox/${shareId}${forEveryone ? '?for_everyone=1' : ''}`,
    { method: 'DELETE' },
  )
