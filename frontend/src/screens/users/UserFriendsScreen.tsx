import { useEffect, useRef, useState } from 'react'
import { loadUserFriendsPage, type Friend } from '../../api/users'
import { PRESENCE_PROFILE_REFRESH_MS } from '../../presence'
import { Button, Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { SocialProps } from '../FriendPages'
import '../social.css'

export function UserFriendsScreen({ id, back, navigate }: SocialProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const moreController = useRef<AbortController | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)
  useEffect(() => {
    moreController.current?.abort()
    setFriends([])
    setNextCursor(null)
    setLoadingMore(false)
    setMoreError('')
    if (!id) {
      setError('Профиль не найден')
      setLoading(false)
      return
    }
    let disposed = false
    let hasLoaded = false
    let activeController: AbortController | null = null
    const load = (showLoader = false) => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      if (showLoader) {
        setLoading(true)
        setError('')
      }
      void loadUserFriendsPage(id, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted && !disposed) {
            if (showLoader || !hasLoaded) {
              setFriends(page.friends)
              setNextCursor(page.nextCursor)
              hasLoaded = true
            } else {
              const presence = new Map(page.friends.map((friend) => [friend.user.id, friend.user]))
              setFriends((current) =>
                current.map((friend) => {
                  const updated = presence.get(friend.user.id)
                  return updated
                    ? {
                        ...friend,
                        user: {
                          ...friend.user,
                          is_online: updated.is_online,
                          last_seen_at: updated.last_seen_at,
                        },
                      }
                    : friend
                }),
              )
            }
            setError('')
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted && !disposed && showLoader)
            setError(error instanceof Error ? error.message : 'Не удалось загрузить друзей')
        })
        .finally(() => {
          if (!controller.signal.aborted && !disposed) setLoading(false)
        })
    }
    load(true)
    const timer = window.setInterval(() => {
      if (!document.hidden) load(false)
    }, PRESENCE_PROFILE_REFRESH_MS)
    const onVisible = () => {
      if (!document.hidden) load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      activeController?.abort()
      moreController.current?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, retryRevision])

  async function loadMore() {
    if (!id || !nextCursor || loadingMore) return
    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setLoadingMore(true)
    setMoreError('')
    try {
      const page = await loadUserFriendsPage(id, controller.signal, nextCursor)
      if (controller.signal.aborted) return
      setFriends((current) => [
        ...current,
        ...page.friends.filter((friend) => !current.some((item) => item.user.id === friend.user.id)),
      ])
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (!controller.signal.aborted)
        setMoreError(cause instanceof Error ? cause.message : 'Не удалось загрузить друзей')
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }
  return (
    <>
      <Header title="Друзья пользователя" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : !id ? (
          <StatePanel title="Профиль не найден" />
        ) : error && !friends.length ? (
          <StatePanel
            title="Не удалось загрузить друзей"
            description={error}
            action="Повторить"
            onAction={() => setRetryRevision((value) => value + 1)}
          />
        ) : friends.length ? (
          <>
            {friends.map((item) => (
              <PersonRow
                key={item.user.id}
                person={item.user}
                presence={{
                  online: item.user.is_online,
                  lastSeenAt: item.user.last_seen_at,
                }}
                onClick={() => navigate('userprofile', item.user.id)}
              />
            ))}
            {moreError && (
              <StatePanel
                title="Не удалось загрузить следующую страницу"
                description={moreError}
                action="Повторить"
                onAction={() => void loadMore()}
              />
            )}
            {nextCursor && !moreError && (
              <div className="page-pad load-more">
                <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <StatePanel title="Пока нет друзей" />
        )}
      </div>
    </>
  )
}
