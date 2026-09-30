import { useEffect, useState } from 'react'
import { inviteFriendToEvent } from '../../api/events'
import { loadAllFriends, type Friend } from '../../api/users'
import { Button, Header, Icon, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { SocialProps } from '../FriendPages'
import '../social.css'

export function EventInvitesScreen({ id, back }: SocialProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [sendError, setSendError] = useState('')
  const [retryRevision, setRetryRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    loadAllFriends(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setFriends(items)
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить друзей')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [retryRevision])
  async function send() {
    if (!id || !selected.length || busy) return
    setBusy(true)
    setSendError('')
    const results = await Promise.allSettled(
      selected.map((userId) => inviteFriendToEvent(id, userId)),
    )
    const failed = selected.filter((_, index) => results[index].status === 'rejected')
    if (!failed.length) {
      back()
    } else {
      setSelected(failed)
      const sentCount = selected.length - failed.length
      setSendError(
        sentCount
          ? `Отправлено: ${sentCount}. Не удалось отправить: ${failed.length}. Повторите для оставшихся.`
          : 'Не удалось отправить приглашения. Попробуйте ещё раз.',
      )
    }
    setBusy(false)
  }
  return (
    <>
      <Header title="Пригласить друзей" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : loadError ? (
          <StatePanel
            title="Не удалось загрузить друзей"
            description={loadError}
            action="Повторить"
            onAction={() => setRetryRevision((value) => value + 1)}
          />
        ) : friends.length ? (
          friends.map((friend) => (
            <PersonRow
              key={friend.user.id}
              person={friend.user}
              onClick={() => {
                if (busy) return
                setSendError('')
                setSelected((current) =>
                  current.includes(friend.user.id)
                    ? current.filter((value) => value !== friend.user.id)
                    : [...current, friend.user.id],
                )
              }}
              trailing={
                selected.includes(friend.user.id) ? <Icon name="check" size={22} /> : undefined
              }
            />
          ))
        ) : (
          <StatePanel title="Пока нет друзей" />
        )}
        {sendError && <p className="error-text social-request-error" role="alert">{sendError}</p>}
      </div>
      <div className="bottom-action">
        <Button onClick={() => void send()} disabled={!selected.length || busy || loading || !!loadError}>
          {busy ? 'Отправляем…' : `Пригласить · ${selected.length}`}
        </Button>
      </div>
    </>
  )
}
