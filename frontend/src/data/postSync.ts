import type { Post } from '../api/posts'

export type PostChange = { type: string; postId?: number; commentId?: number }
export type PostBatch = { posts: Map<number, Post>; requested: Set<number> }
type PostListener = (batch: PostBatch) => void
const lists = new Map<PostListener, Set<number>>()
const changes = new Set<(change: PostChange) => void>()
const requests = new Set<(ids: number[]) => void>()

export function watchedPostIds() {
  return [...new Set([...lists.values()].flatMap((ids) => [...ids]))]
}

export function watchPosts(ids: number[], listener: PostListener) {
  lists.set(listener, new Set(ids))
  syncPosts(ids)
  return () => { lists.delete(listener) }
}

export function onPostChange(listener: (change: PostChange) => void) {
  changes.add(listener)
  return () => { changes.delete(listener) }
}

export function postChanged(change: PostChange) {
  for (const listener of changes) listener(change)
}

export function onPostSync(listener: (ids: number[]) => void) {
  requests.add(listener)
  return () => { requests.delete(listener) }
}

export function syncPosts(ids = watchedPostIds()) {
  for (const listener of requests) listener(ids)
}

export function publishPosts(posts: Post[], ids: number[]) {
  const batch = { posts: new Map(posts.map((post) => [post.id, post])), requested: new Set(ids) }
  for (const [listener, watched] of lists) {
    if (ids.some((id) => watched.has(id))) listener(batch)
  }
}

export function updatePost(post: Post, batch: PostBatch): Post | null {
  const updated = batch.requested.has(post.id) ? batch.posts.get(post.id) : post
  if (!updated) return null
  const originalId = updated.repost_of_post_id
  if (!originalId || !batch.requested.has(originalId)) return updated
  const original = batch.posts.get(originalId)
  return { ...updated, repost: original ? { ...original, unavailable: false } : { unavailable: true } }
}
