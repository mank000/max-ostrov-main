import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/http'
import { loadFriendsPage, type Friend } from '../api/users'
import { idleStatus, loadedStatus } from './useResource'

export function useFriendPages(enabled: boolean, onUnauthorized: () => void) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [birthdaysToday, setBirthdaysToday] = useState<Friend[]>([])
  const [count, setCount] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState(idleStatus)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState('')
  const [revision, setRevision] = useState(0)
  const firstRequest = useRef<AbortController | null>(null)
  const pageRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const unauthorized = useRef(onUnauthorized)
  unauthorized.current = onUnauthorized

  const reset = useCallback(() => {
    firstRequest.current?.abort()
    pageRequest.current?.abort()
    firstRequest.current = null
    pageRequest.current = null
    generation.current += 1
    setFriends([])
    setBirthdaysToday([])
    setCount(0)
    setCursor(null)
    setLoadingMore(false)
    setPageError('')
    setStatus(idleStatus())
  }, [])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) unauthorized.current()
    return error instanceof Error ? error.message : 'Не удалось загрузить друзей'
  }, [])

  useEffect(() => {
    reset()
    return reset
  }, [enabled, reset])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    firstRequest.current?.abort()
    pageRequest.current?.abort()
    firstRequest.current = controller
    const version = ++generation.current
    setPageError('')
    setStatus((current) => ({ ...current, loading: !current.loaded, refreshing: current.loaded, error: '' }))
    void loadFriendsPage(controller.signal).then((page) => {
      if (controller.signal.aborted || version !== generation.current) return
      setFriends(page.friends)
      setBirthdaysToday(page.birthdaysToday)
      setCount(page.totalCount)
      setCursor(page.nextCursor)
      setStatus(loadedStatus())
    }).catch((error: unknown) => {
      if (controller.signal.aborted || version !== generation.current) return
      setStatus((current) => ({ ...current, loading: false, refreshing: false, stale: current.loaded, error: fail(error) }))
    }).finally(() => {
      if (firstRequest.current === controller) firstRequest.current = null
    })
    return () => controller.abort()
  }, [enabled, revision, reset, fail])

  const loadMore = useCallback(async () => {
    if (!enabled || !cursor || pageRequest.current || firstRequest.current) return
    const controller = new AbortController()
    pageRequest.current = controller
    const version = generation.current
    setLoadingMore(true)
    setPageError('')
    try {
      const page = await loadFriendsPage(controller.signal, cursor)
      if (controller.signal.aborted || version !== generation.current) return
      setFriends((current) => {
        const seen = new Set(current.map((friend) => friend.user.id))
        return [...current, ...page.friends.filter((friend) => !seen.has(friend.user.id))]
      })
      setCount(page.totalCount)
      setCursor(page.nextCursor)
    } catch (error) {
      if (controller.signal.aborted || version !== generation.current) return
      if (error instanceof ApiError && error.status === 400) refresh()
      else setPageError(fail(error))
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null
        setLoadingMore(false)
      }
    }
  }, [enabled, cursor, fail, refresh])

  const refreshPresence = useCallback(async () => {
    if (!enabled || firstRequest.current || pageRequest.current || !status.loaded) return
    const controller = new AbortController()
    firstRequest.current = controller
    const version = generation.current
    try {
      const page = await loadFriendsPage(controller.signal)
      if (controller.signal.aborted || version !== generation.current) return
      const presence = new Map(page.friends.map((friend) => [friend.user.id, friend.user]))
      setFriends((current) => current.map((friend) => {
        const user = presence.get(friend.user.id)
        return user ? { ...friend, user: { ...friend.user, is_online: user.is_online, last_seen_at: user.last_seen_at } } : friend
      }))
      setBirthdaysToday(page.birthdaysToday)
      setCount(page.totalCount)
    } catch (error) {
      if (!controller.signal.aborted && version === generation.current && error instanceof ApiError && error.status === 401)
        unauthorized.current()
    } finally {
      if (firstRequest.current === controller) firstRequest.current = null
    }
  }, [enabled, status.loaded])

  return { friends, birthdaysToday, count, cursor, status, loadingMore, pageError, loadMore, refresh, refreshPresence, reset }
}
