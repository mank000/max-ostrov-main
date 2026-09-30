import { useEffect, useState } from 'react'
import {
  loadGroupInvitations,
  resolveGroupInvitation,
  type GroupInvitation,
} from '../../api/groups'
import { Button, Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { rememberGroup } from './group-utils'

export function GroupIncoming({ back, navigate, onError }: ScreenProps) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof loadGroupInvitations>>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadGroupInvitations(controller.signal)
      .then(setItems)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [onError])

  async function resolve(item: GroupInvitation, accept: boolean) {
    if (busy !== null) return
    setBusy(item.group.id)
    try {
      await resolveGroupInvitation(item.group.id, accept)
      setItems((current) => current.filter((value) => value.group.id !== item.group.id))
      if (accept) {
        rememberGroup(item.group)
        navigate('groupdetail', item.group.id)
      }
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Header title="Приглашения в группы" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : items.length ? (
          items.map((item) => (
            <div className="extra-request" key={item.group.id}>
              <Cell
                icon="users"
                title={item.group.title}
                detail={`${item.group.member_count} из ${item.group.capacity} участников`}
                onClick={() => {
                  rememberGroup(item.group)
                  navigate('groupdetail', item.group.id)
                }}
              />
              <div>
                <Button
                  disabled={busy !== null || item.group.available_places <= 0}
                  onClick={() => void resolve(item, true)}
                >
                  {item.group.available_places <= 0 ? 'Нет мест' : 'Вступить'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void resolve(item, false)}
                >
                  Отклонить
                </Button>
              </div>
            </div>
          ))
        ) : (
          <StatePanel title="Пока нет приглашений" />
        )}
      </div>
    </>
  )
}
