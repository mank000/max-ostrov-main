import { useEffect, useState } from 'react'
import { loadGroupJoinRequests, resolveGroupJoinRequest } from '../../api/groups'
import { Button, Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'

export function GroupRequests({ route, back, navigate, onError }: ScreenProps) {
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof loadGroupJoinRequests>>>([])
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState<number | null>(null)

  useEffect(() => {
    if (!route.id) return
    const controller = new AbortController()
    loadGroupJoinRequests(route.id, controller.signal)
      .then(setRequests)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, onError])

  async function resolve(userId: number, accept: boolean) {
    if (!route.id || busyUser !== null) return
    setBusyUser(userId)
    try {
      await resolveGroupJoinRequest(route.id, userId, accept)
      setRequests((current) => current.filter((item) => item.user_id !== userId))
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusyUser(null)
    }
  }

  return (
    <>
      <Header title="Заявки в группу" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : requests.length ? (
          requests.map((item) => (
            <div className="extra-request" key={item.user_id}>
              <Cell
                icon="user"
                title={item.display_name}
                onClick={() => navigate('userprofile', item.user_id)}
              />
              <div>
                <Button
                  disabled={busyUser !== null}
                  onClick={() => void resolve(item.user_id, true)}
                >
                  Принять
                </Button>
                <Button
                  variant="secondary"
                  disabled={busyUser !== null}
                  onClick={() => void resolve(item.user_id, false)}
                >
                  Отклонить
                </Button>
              </div>
            </div>
          ))
        ) : (
          <StatePanel title="Пока нет заявок" />
        )}
      </div>
    </>
  )
}
