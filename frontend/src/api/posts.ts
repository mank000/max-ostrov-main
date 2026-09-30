import { ApiError, collection, listField, readCursor, readFeedCursor, request } from './http'
import { type RelationshipState } from './users'

export type FeedScope = 'all' | 'city' | 'friends'

export type PostMedia = {
  avatar_owner_id?: number
  id: number
  url: string
  width: number
  height: number
  mime_type: 'image/jpeg' | 'image/png' | 'video/mp4' | 'video/quicktime'
  duration_ms?: number
}

type RepostPreview = {
  unavailable: boolean
  id?: number
  event_id?: number
  visibility?: 'city' | 'friends' | 'event'
  city?: string
  author?: {
    id: number
    display_name: string
    username?: string
    photo_url?: string
  }
  caption?: string
  media?: PostMedia[]
  created_at?: string
}

export type Post = {
  id: number
  event_id?: number
  visibility: 'city' | 'friends' | 'event'
  city: string
  author: {
    id: number
    display_name: string
    username?: string
    photo_url?: string
    relationship_state?: RelationshipState
  }
  caption: string
  media: PostMedia[]
  tagged_participants?: Array<{
    id: number
    display_name: string
    username?: string
    photo_url?: string
  }>
  repost_of_post_id?: number
  repost?: RepostPreview
  repost_count?: number
  reposted_by_me?: boolean
  like_count: number
  comment_count: number
  liked_by_me: boolean
  created_at: string
}

export async function loadUserPostsPage(userId: number, signal?: AbortSignal, beforeId = 0) {
  const path =
    beforeId > 0 ? `/users/${userId}/posts?before_id=${beforeId}` : `/users/${userId}/posts`
  const body = await request<{ posts: Post[]; next_cursor?: number }>(path, {
    signal,
  })
  return {
    posts: collection(body.posts),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function loadUserTaggedPostsPage(userId: number, signal?: AbortSignal, beforeId = 0) {
  const params = new URLSearchParams({ view: 'tagged' })
  if (beforeId > 0) params.set('before_id', String(beforeId))
  const body = await request<{ posts: Post[]; next_cursor?: number }>(
    `/users/${userId}/posts?${params}`,
    { signal },
  )
  return {
    posts: collection(body.posts),
    nextCursor: readCursor(body.next_cursor),
  }
}

export type FeedCursor = number | string

export async function loadFeedPage(
  signal?: AbortSignal,
  cursor: FeedCursor = 0,
  scope: FeedScope = 'all',
  city = '',
) {
  const params = new URLSearchParams({ scope })
  if (scope === 'city' && city.trim()) params.set('city', city.trim())
  if (typeof cursor === 'string' && scope === 'all') params.set('rank_cursor', cursor)
  else if (typeof cursor === 'number' && cursor > 0) params.set('before_id', String(cursor))
  const body = await request<{
    posts: Post[]
    next_cursor?: number
    next_rank_cursor?: string
  }>(`/feed?${params}`, { signal })
  return {
    posts: collection(body.posts),
    nextCursor: readFeedCursor(body),
  }
}

export async function loadPost(postId: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(postId) || postId <= 0)
    throw new ApiError('Некорректная публикация', 400)
  return request<Post>(`/posts/${postId}`, { signal })
}

export async function loadMyPostsPage(signal?: AbortSignal, beforeId = 0) {
  const path = beforeId > 0 ? `/users/me/posts?before_id=${beforeId}` : '/users/me/posts'
  const body = await request<{ posts: Post[]; next_cursor?: number }>(path, {
    signal,
  })
  return {
    posts: collection(body.posts),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function loadMyTaggedPostsPage(signal?: AbortSignal, beforeId = 0) {
  const params = new URLSearchParams({ view: 'tagged' })
  if (beforeId > 0) params.set('before_id', String(beforeId))
  const body = await request<{ posts: Post[]; next_cursor?: number }>(`/users/me/posts?${params}`, {
    signal,
  })
  return {
    posts: collection(body.posts),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function setPostLike(postId: number, liked: boolean) {
  return request<void>(`/posts/${postId}/like`, {
    method: liked ? 'PUT' : 'DELETE',
  })
}

export async function deletePost(postId: number) {
  return request<void>(`/posts/${postId}`, { method: 'DELETE' })
}

export async function updatePost(postId: number, body: { caption: string; media_ids?: number[] }) {
  return request<Post>(`/posts/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createPost(
  input: {
    is_clip?: boolean
    cover_ms?: number
    event_id?: number
    visibility: Post['visibility']
    city: string
    caption: string
    media_ids: number[]
    tagged_user_ids: number[]
    repost_of_post_id?: number
  },
  idempotencyKey: string,
) {
  return request<Post>('/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  })
}

export type PostLiker = {
  id: number
  display_name: string
  username?: string
  photo_url?: string
}

export async function loadPostLikes(postId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/posts/${postId}/likes`, { signal })
  return listField<PostLiker>(body, 'users')
}

export async function loadPostUpdates(ids: number[], signal?: AbortSignal) {
  const body = await request<{ posts: Post[] }>(`/posts/updates?ids=${ids.join(',')}`, { signal })
  return collection(body.posts)
}
