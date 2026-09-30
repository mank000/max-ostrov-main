import { useEffect, useState } from 'react'
import {
  loadEventGroups,
  loadGroupMergeRequests,
  requestGroupMerge,
  resolveGroupMerge,
  type Group,
} from '../../api/groups'
import { Button, Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { rememberedEventId } from './group-utils'

export function GroupMerge({ route, back, onError }: ScreenProps) {
  const eventId = rememberedEventId(route.id)
  const [items, setItems] = useState<Awaited<ReturnType<typeof loadGroupMergeRequests>>>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [requested, setRequested] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!route.id || !eventId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    Promise.allSettled([
      loadGroupMergeRequests(route.id, controller.signal),
      loadEventGroups(eventId, controller.signal),
    ])
      .then(([requestResult, groupResult]) => {
        if (controller.signal.aborted) return
        if (requestResult.status === 'fulfilled') setItems(requestResult.value)
        if (groupResult.status === 'fulfilled') setGroups(groupResult.value)
        if (requestResult.status === 'rejected') onError(String(requestResult.reason))
        if (groupResult.status === 'rejected') onError(String(groupResult.reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, eventId, onError])

  const current = groups.find((group) => group.id === route.id)
  const others = groups.filter(
    (group) =>
      group.id !== route.id &&
      current &&
      current.member_count + group.member_count <= group.capacity,
  )

  async function resolve(sourceId: number, accept: boolean) {
    if (!route.id || busy) return
    setBusy(true)
    try {
      await resolveGroupMerge(route.id, sourceId, accept)
      setItems((currentItems) => currentItems.filter((item) => item.source_group.id !== sourceId))
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function ask(targetId: number) {
    if (!route.id || busy) return
    setBusy(true)
    try {
      await requestGroupMerge(route.id, targetId)
      setRequested((currentSet) => new Set(currentSet).add(targetId))
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title="Объединение групп" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : (
          <>
            <h2 className="section-title">Входящие предложения</h2>
            {items.length ? (
              items.map((item) => (
                <div className="extra-request" key={item.source_group.id}>
                  <Cell
                    icon="users"
                    title={item.source_group.title}
                    detail={`${item.source_group.member_count} участников`}
                    onClick={() => { }}
                  />
                  <div>
                    <Button
                      disabled={busy}
                      onClick={() => void resolve(item.source_group.id, true)}
                    >
                      Принять
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void resolve(item.source_group.id, false)}
                    >
                      Отклонить
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <StatePanel title="Пока нет предложений" />
            )}
            <h2 className="section-title">Пойти одной группой</h2>
            {others.length ? (
              others.map((group) => (
                <div className="extra-request" key={group.id}>
                  <Cell
                    icon="users"
                    title={group.title}
                    detail={`${group.member_count}/${group.capacity} участников`}
                    onClick={() => { }}
                  />
                  <div>
                    <Button
                      disabled={busy || requested.has(group.id)}
                      onClick={() => void ask(group.id)}
                    >
                      {requested.has(group.id) ? 'Предложение отправлено' : 'Предложить'}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <StatePanel
                title="Нет подходящих групп"
                description="Показываются только группы, в которые поместится объединённый состав."
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
