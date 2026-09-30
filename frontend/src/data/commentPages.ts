import type { Comment } from '../api/comments'

export function mergeComments(current: Comment[], incoming: Comment[]) {
  const items = new Map(current.map((comment) => [comment.id, comment]))
  for (const comment of incoming) {
    const previous = items.get(comment.id)
    items.set(comment.id, { ...comment, rank_position: previous?.rank_position ?? comment.rank_position })
  }
  return [...items.values()]
}

export function replyIds(comments: Comment[], rootId: number) {
  const children = new Map<number, number[]>()
  for (const comment of comments) {
    if (!comment.parent_comment_id) continue
    const siblings = children.get(comment.parent_comment_id)
    if (siblings) siblings.push(comment.id)
    else children.set(comment.parent_comment_id, [comment.id])
  }
  const ids = new Set([rootId])
  const pending = [rootId]
  for (let index = 0; index < pending.length; index++) {
    for (const id of children.get(pending[index]) || []) {
      if (ids.has(id)) continue
      ids.add(id)
      pending.push(id)
    }
  }
  return ids
}
