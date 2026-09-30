import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  loadEventGroups,
  loadGroupInvitations,
  resolveGroupInvitation,
  type Group,
  type GroupInvitation,
} from '../../api/groups'
import { Button, Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { activeEvent, groupStatus, policyLabel, rememberGroup } from './group-utils'

export function GroupList({ route, active, data, back, navigate, onError }: ScreenProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [invitations, setInvitations] = useState<GroupInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyInvitation, setBusyInvitation] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const currentRevision = useRef(revision)
  useLayoutEffect(() => {
    currentRevision.current = revision
  }, [revision])

  useEffect(() => {
    if (!active) return
    const requestedRevision = revision
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setGroups([])
    setInvitations([])

    async function load() {
      if (route.id) {
        const [groupResult, invitationResult] = await Promise.allSettled([
          loadEventGroups(route.id, controller.signal),
          loadGroupInvitations(controller.signal),
        ])
        if (controller.signal.aborted || currentRevision.current !== requestedRevision) return
        if (groupResult.status === 'fulfilled') setGroups(groupResult.value)
        else
          setError(
            groupResult.reason instanceof Error
              ? groupResult.reason.message
              : 'Не удалось загрузить группы',
          )
        if (invitationResult.status === 'fulfilled') {
          setInvitations(invitationResult.value.filter((item) => item.group.event_id === route.id))
        }
        return
      }

      const ids = data.profileEvents
        .filter((event) => data.participatingEventIds.has(event.id) && activeEvent(event))
        .map((event) => event.id)
      const [results, invitationResult] = await Promise.all([
        Promise.allSettled(ids.map((id) => loadEventGroups(id, controller.signal))),
        loadGroupInvitations(controller.signal).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        ),
      ])
      if (controller.signal.aborted || currentRevision.current !== requestedRevision) return
      setGroups(
        results
          .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
          .filter((group) => group.joined),
      )
      if (invitationResult.status === 'fulfilled') setInvitations(invitationResult.value)
      if (ids.length > 0 && results.every((result) => result.status === 'rejected'))
        setError('Не удалось загрузить ваши группы')
    }

    void load()
      .catch((cause) => {
        if (!controller.signal.aborted && currentRevision.current === requestedRevision) {
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить группы')
          onError(String(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && currentRevision.current === requestedRevision)
          setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, active, data.profileEvents, data.participatingEventIds, onError, revision])

  const hasMembership = groups.some((group) => group.joined)
  const canCreate = Boolean(route.id && !loading && !error && !hasMembership)
  const invitedGroupIds = new Set(invitations.map((item) => item.group.id))
  const visibleGroups = groups.filter((group) => !invitedGroupIds.has(group.id))

  async function resolveInvitation(item: GroupInvitation, accept: boolean) {
    if (busyInvitation !== null) return
    setBusyInvitation(item.group.id)
    try {
      await resolveGroupInvitation(item.group.id, accept)
      setInvitations((current) => current.filter((value) => value.group.id !== item.group.id))
      if (accept) {
        rememberGroup(item.group)
        navigate('groupdetail', item.group.id)
      } else {
        setRevision((value) => value + 1)
      }
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusyInvitation(null)
    }
  }

  return (
    <>
      <Header title={route.id ? 'Группы мероприятия' : 'Мои группы'} back={back} />
      <div className="screen-scroll">
        <div className="extra-pad">
          <p className="extra-body">
            {route.id
              ? 'Найдите компанию, чтобы пойти на мероприятие вместе.'
              : 'Здесь только группы, в которых вы действительно состоите.'}
          </p>
        </div>
        {invitations.length > 0 && (
          <>
            <h2 className="section-title">Приглашения</h2>
            {invitations.map((item) => (
              <div className="extra-request" key={item.group.id}>
                <Cell
                  icon="users"
                  title={item.group.title}
                  detail={`${item.group.member_count} из ${item.group.capacity} · ${policyLabel(item.group.join_policy)}`}
                  onClick={() => {
                    rememberGroup(item.group)
                    navigate('groupdetail', item.group.id)
                  }}
                />
                <div>
                  <Button
                    disabled={busyInvitation !== null || item.group.available_places <= 0}
                    onClick={() => void resolveInvitation(item, true)}
                  >
                    {item.group.available_places <= 0 ? 'Нет мест' : 'Вступить'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busyInvitation !== null}
                    onClick={() => void resolveInvitation(item, false)}
                  >
                    Отклонить
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
        {loading ? (
          <StatePanel title="" loading />
        ) : error && !groups.length ? (
          <StatePanel title="Группы недоступны" description={error} />
        ) : visibleGroups.length ? (
          visibleGroups.map((group) => (
            <Cell
              key={group.id}
              icon="users"
              title={group.title}
              detail={`${group.member_count} из ${group.capacity} · ${groupStatus(group)}`}
              onClick={() => {
                rememberGroup(group)
                navigate('groupdetail', group.id)
              }}
            />
          ))
        ) : invitations.length ? null : (
          <StatePanel title={route.id ? 'Пока нет групп' : 'Вы пока не состоите в группах'} />
        )}
      </div>
      {canCreate && (
        <div className="bottom-action">
          <Button onClick={() => navigate('creategroup', route.id)}>Создать группу</Button>
        </div>
      )}
    </>
  )
}
