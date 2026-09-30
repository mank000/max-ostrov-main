import { type Post } from './api/posts'

const POST_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

function editableUntil(post: Pick<Post, 'created_at'>) {
  const createdAt = Date.parse(post.created_at)
  return Number.isFinite(createdAt) ? createdAt + POST_EDIT_WINDOW_MS : 0
}

export function postIsEditable(post: Pick<Post, 'created_at'>, now = Date.now()) {
  const deadline = editableUntil(post)
  return deadline > 0 && now <= deadline
}
