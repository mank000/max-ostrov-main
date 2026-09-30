import { listField, readFeedCursor, request } from './http'
import { type PostMedia } from './posts'

export type Comment = {
  id: number
  rank_position?: number
  post_id: number
  parent_comment_id?: number
  author: {
    id: number
    display_name: string
    username?: string
    photo_url?: string
  }
  reply_to?: {
    id: number
    display_name: string
    username?: string
    photo_url?: string
  }
  body: string
  media: PostMedia[]
  like_count: number
  liked_by_me: boolean
  created_at: string
}

export async function loadPostComments(
  postId: number,
  cursor?: number | string,
  signal?: AbortSignal,
) {
  const suffix =
    typeof cursor === 'string'
      ? `?rank_cursor=${encodeURIComponent(cursor)}`
      : cursor
        ? `?before_id=${cursor}`
        : ''
  const body = await request<Record<string, unknown>>(`/posts/${postId}/comments${suffix}`, {
    signal,
  })
  return {
    comments: listField<Comment>(body, 'comments'),
    nextCursor: readFeedCursor(body),
  }
}

export async function createPostComment(
  postId: number,
  body: string,
  parentCommentId?: number,
  mediaIds: number[] = [],
) {
  return request<Comment>(`/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: body.trim(),
      media_ids: mediaIds,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    }),
  })
}

export async function updateComment(commentId: number, body: string, mediaIds: number[] = []) {
  return request<void>(`/comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: body.trim(), media_ids: mediaIds }),
  })
}

export async function deleteComment(commentId: number) {
  return request<void>(`/comments/${commentId}`, { method: 'DELETE' })
}

export async function setCommentLike(commentId: number, liked: boolean) {
  return request<void>(`/comments/${commentId}/like`, {
    method: liked ? 'PUT' : 'DELETE',
  })
}

export async function loadCommentUpdates(postId: number, ids: number[], signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/posts/${postId}/comments?ids=${ids.join(',')}`, { signal })
  return listField<Comment>(body, 'comments')
}
