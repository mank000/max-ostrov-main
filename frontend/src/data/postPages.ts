import type { Post } from '../api/posts'

export function appendPosts(current: Post[], incoming: Post[]) {
  const byId = new Map(incoming.map((post) => [post.id, post]))
  const seen = new Set(current.map((post) => post.id))
  return [
    ...current.map((post) => byId.get(post.id) || post),
    ...[...byId.values()].filter((post) => !seen.has(post.id)),
  ]
}

export function refreshPostHead(current: Post[], incoming: Post[]) {
  const seen = new Set(current.map((post) => post.id))
  const byId = new Map(incoming.map((post) => [post.id, post]))
  return [
    ...[...byId.values()].filter((post) => !seen.has(post.id)),
    ...current.map((post) => byId.get(post.id) || post),
  ]
}
