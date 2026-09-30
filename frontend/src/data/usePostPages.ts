import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/http'
import type { FeedCursor, Post } from '../api/posts'
import { appendPosts, refreshPostHead } from './postPages'
import { usePostUpdates } from './usePostUpdates'
import { idleStatus, loadedStatus } from './useResource'

type Page<C> = { posts: Post[]; nextCursor: C | null }

export function usePostPages<C extends FeedCursor>(
  enabled: boolean,
  load: (signal: AbortSignal, cursor?: C, refreshHead?: boolean) => Promise<Page<C>>,
  onUnauthorized: () => void,
) {
  const [posts, setPosts] = useState<Post[]>([])
  const [cursor, setCursor] = useState<C | null>(null)
  const [status, setStatus] = useState(idleStatus)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [revision, setRevision] = useState(0)
  const headRequest = useRef<AbortController | null>(null)
  const pageRequest = useRef<AbortController | null>(null)
  const hasHead = useRef(false)
  const generation = useRef(0)
  const refresh = useCallback(() => setRevision((current) => current + 1), [])
  const reset = useCallback(() => {
    headRequest.current?.abort()
    pageRequest.current?.abort()
    headRequest.current = null
    pageRequest.current = null
    generation.current += 1
    hasHead.current = false
    setPosts([])
    setCursor(null)
    setLoadingMore(false)
    setLoadMoreError('')
    setStatus(idleStatus())
  }, [])
  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) onUnauthorized()
    setStatus((current) => ({
      ...current, loading: false, refreshing: false, stale: current.loaded,
      error: error instanceof Error ? error.message : 'Не удалось загрузить публикации',
    }))
  }, [onUnauthorized])

  useEffect(() => {
    reset()
    return reset
  }, [enabled, load, reset])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    headRequest.current = controller
    const first = !hasHead.current
    setStatus((current) => ({ ...current, loading: first, refreshing: !first, error: '' }))
    void load(controller.signal, undefined, !first).then((page) => {
      if (controller.signal.aborted) return
      setPosts((current) => first ? page.posts : refreshPostHead(current, page.posts))
      if (first) setCursor(page.nextCursor)
      hasHead.current = true
      setStatus(loadedStatus())
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(error)
    }).finally(() => {
      if (headRequest.current === controller) headRequest.current = null
    })
    return () => { controller.abort() }
  }, [enabled, load, revision, fail])

  const loadMore = useCallback(async () => {
    if (!enabled || cursor === null || pageRequest.current || headRequest.current) return
    const controller = new AbortController()
    pageRequest.current = controller
    const version = generation.current
    setLoadingMore(true)
    setLoadMoreError('')
    setStatus((current) => ({ ...current, error: '' }))
    try {
      const page = await load(controller.signal, cursor)
      if (controller.signal.aborted || version !== generation.current) return
      setPosts((current) => appendPosts(current, page.posts))
      setCursor(page.nextCursor)
      setStatus(loadedStatus())
    } catch (error) {
      if (controller.signal.aborted || version !== generation.current) return
      if (error instanceof ApiError && error.status === 400 && typeof cursor === 'string') {
        hasHead.current = false
        refresh()
      } else {
        setLoadMoreError(error instanceof Error ? error.message : 'Не удалось загрузить публикации')
        fail(error)
      }
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null
        setLoadingMore(false)
      }
    }
  }, [enabled, cursor, load, fail, refresh])

  usePostUpdates(posts, setPosts)
  return { posts, setPosts, cursor, status, loadingMore, loadMoreError, loadMore, refresh, reset }
}
