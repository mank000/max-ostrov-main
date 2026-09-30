import type { PostMedia } from '../api/posts'

export function profileAvatarMedia(profile: { id: number; display_name: string; photo_url?: string; avatars?: { media_id: number; url: string }[] } | null): PostMedia[] {
  if (!profile) return []
  const letter = (Array.from(profile.display_name)[0] || '?').replace(/[<>&"']/g, '')
  const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#dfedff"/><text x="300" y="330" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="250" fill="#007aff">${letter}</text></svg>`)}`
  const sources = profile.avatars?.length ? profile.avatars : [{ media_id: 0, url: profile.photo_url || fallback }]
  return sources.map(item => ({ id: item.media_id, url: item.url, avatar_owner_id: profile.id, width: 600, height: 600, mime_type: 'image/jpeg' }))
}
