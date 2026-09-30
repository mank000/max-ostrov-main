import { useEffect, useMemo, useState } from 'react'
import { inviteToGroup, loadEventGroups, type Group } from '../../api/groups'
import { loadEventParticipants, type EventParticipant } from '../../participants-api'
import { Button, Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { ScreenProps } from '../screen-types'
import { rememberedEventId } from './group-utils'

export function GroupInvites({ route, back, navigate, onError }: ScreenProps) {
  const eventId = rememberedEventId(route.id)
  const [group, setGroup] = useState<Group | null>(null)
  const [people, setPeople] = useState<EventParticipant[]>([])
  const [sent, setSent] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState<number | null>(null)

  useEffect(() => {
    if (!route.id || !eventId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    Promise.allSettled([
      loadEventGroups(eventId, controller.signal),
      loadEventParticipants(eventId, controller.signal),
    ])
      .then(([groupsResult, peopleResult]) => {
        if (controller.signal.aborted) return
        if (groupsResult.status === 'fulfilled')
          setGroup(groupsResult.value.find((item) => item.id === route.id) || null)
        if (peopleResult.status === 'fulfilled') setPeople(peopleResult.value)
        if (groupsResult.status === 'rejected') onError(String(groupsResult.reason))
        if (peopleResult.status === 'rejected') onError(String(peopleResult.reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, eventId, onError])

  const candidates = useMemo(
    () => people.filter((person) => !person.group_id && person.id !== group?.leader_user_id),
    [people, group?.leader_user_id],
  )

  async function invite(userId: number) {
    if (!route.id || busyUser !== null || sent.has(userId) || (group?.available_places ?? 0) <= 0)
      return
    setBusyUser(userId)
    try {
      await inviteToGroup(route.id, userId)
      setSent((current) => new Set(current).add(userId))
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusyUser(null)
    }
  }

  return (
    <>
      <Header title="Пригласить в группу" back={back} />
      <div className="screen-scroll">
        <div className="extra-pad">
          <p className="extra-body">
            Можно приглашать только участников этого мероприятия, которые ещё не состоят в другой
            группе.
          </p>
        </div>
        {loading ? (
          <StatePanel title="" loading />
        ) : candidates.length ? (
          candidates.map((person) => (
            <div key={person.id} className="extra-request">
              <PersonRow
                person={person}
                detail={person.username ? `@${person.username}` : person.city}
                onClick={() => navigate('userprofile', person.id)}
              />
              <div>
                <Button
                  variant={sent.has(person.id) ? 'secondary' : 'primary'}
                  disabled={
                    busyUser !== null || sent.has(person.id) || (group?.available_places ?? 0) <= 0
                  }
                  onClick={() => void invite(person.id)}
                >
                  {(group?.available_places ?? 0) <= 0
                    ? 'Нет мест'
                    : sent.has(person.id)
                      ? 'Приглашён'
                      : busyUser === person.id
                        ? 'Отправляем…'
                        : 'Пригласить'}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <StatePanel
            title={
              (group?.available_places ?? 0) <= 0
                ? 'В группе нет свободных мест'
                : 'Сейчас некого приглашать'
            }
          />
        )}
      </div>
    </>
  )
}
