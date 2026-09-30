import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadCommentUpdates, loadPostComments, type Comment } from '../api/comments'
import { ApiError } from '../api/http'
import { mergeComments, replyIds } from './commentPages'
import { onPostChange, postChanged } from './postSync'

export function useComments(postId: number) {
  const [comments, setComments] = useState<Comment[]>([])
  const [nextCursor, setNextCursor] = useState<number | string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(comments)
  const pageRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useLayoutEffect(() => { current.current = comments }, [comments])

  useEffect(() => {
    generation.current += 1
    current.current = []
    setComments([])
    setNextCursor(null)
    setError('')
    setLoading(true)
    setLoadingMore(false)
    let initial = true
    let stopped = false
    let pending = false
    let timer = 0
    let request: AbortController | null = null
    const changedIds = new Set<number>()
    const schedule = () => {
      pending = true
      if (!request && !timer && !document.hidden) timer = window.setTimeout(refresh, 150)
    }
    async function refresh() {
      timer = 0
      if (stopped || document.hidden || !navigator.onLine || request) return
      pending = false
      const controller = new AbortController()
      request = controller
      const ids = [...new Set([...current.current.map((comment) => comment.id), ...changedIds])]
      changedIds.clear()
      const newestId = Math.max(0, ...current.current.map((comment) => comment.id))
      try {
        const page = await loadPostComments(postId, initial ? undefined : Number.MAX_SAFE_INTEGER, controller.signal)
        const recent = [...page.comments]
        let tail = page.comments
        while (!initial && newestId > 0 && tail.length === 50 && tail.every((comment) => comment.id > newestId)) {
          const before = Math.min(...tail.map((comment) => comment.id))
          const older = await loadPostComments(postId, before, controller.signal)
          tail = older.comments.filter((comment) => comment.id < before)
          recent.push(...tail.filter((comment) => comment.id > newestId))
        }
        const rows: Comment[] = []
        for (let offset = 0; offset < ids.length; offset += 50) {
          rows.push(...await loadCommentUpdates(postId, ids.slice(offset, offset + 50), controller.signal))
        }
        if (controller.signal.aborted || stopped) return
        const requested = new Set(ids)
        const found = new Set(rows.map((comment) => comment.id))
        setComments((items) => mergeComments(
          items.filter((comment) => !requested.has(comment.id) || found.has(comment.id)),
          mergeComments(recent.filter((comment) => !requested.has(comment.id) || found.has(comment.id)), rows),
        ))
        if (initial) setNextCursor(page.nextCursor)
        initial = false
        setError('')
      } catch (cause) {
        for (const id of ids) changedIds.add(id)
        if (!controller.signal.aborted && !stopped && initial) {
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить комментарии')
        }
      } finally {
        request = null
        if (!stopped) {
          setLoading(false)
          if (pending) schedule()
        }
      }
    }
    const unsubscribe = onPostChange((change) => {
      if (change.postId && change.postId !== postId) return
      if (change.type === 'post.deleted') {
        stopped = true
        pending = false
        generation.current += 1
        window.clearTimeout(timer)
        request?.abort()
        pageRequest.current?.abort()
        pageRequest.current = null
        current.current = []
        setComments([])
        setNextCursor(null)
        setLoading(false)
        setLoadingMore(false)
        return
      }
      if (stopped) return
      if (change.type === 'post.comment_deleted' && change.commentId) {
        generation.current += 1
        request?.abort()
        pageRequest.current?.abort()
        pageRequest.current = null
        setLoadingMore(false)
        const id = change.commentId
        setComments((items) => {
          const removed = replyIds(items, id)
          return items.filter((comment) => !removed.has(comment.id))
        })
      }
      if (change.commentId) changedIds.add(change.commentId)
      if (change.type !== 'post.updated' && change.type !== 'post.created') schedule()
    })
    void refresh()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      request?.abort()
      pageRequest.current?.abort()
      pageRequest.current = null
      unsubscribe()
    }
  }, [postId])

  const loadMore = useCallback(async () => {
    if (!nextCursor || pageRequest.current || loading) return
    const controller = new AbortController()
    const version = generation.current
    pageRequest.current = controller
    setLoadingMore(true)
    setError('')
    try {
      const page = await loadPostComments(postId, nextCursor, controller.signal)
      if (controller.signal.aborted || generation.current !== version) return
      setComments((items) => mergeComments(items, page.comments))
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== version) return
      if (cause instanceof ApiError && cause.status === 400 && typeof nextCursor === 'string') {
        try {
          const page = await loadPostComments(postId, undefined, controller.signal)
          if (controller.signal.aborted || generation.current !== version) return
          setComments((items) => mergeComments(items, page.comments))
          setNextCursor(page.nextCursor)
        } catch (error) {
          if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Не удалось загрузить комментарии')
        }
      } else setError(cause instanceof Error ? cause.message : 'Не удалось загрузить комментарии')
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null
        setLoadingMore(false)
      }
    }
  }, [postId, nextCursor, loading])
  const refresh = useCallback(() => postChanged({ type: 'resync', postId }), [postId])
  return { comments, setComments, nextCursor, loading, loadingMore, error, setError, loadMore, refresh }
}
