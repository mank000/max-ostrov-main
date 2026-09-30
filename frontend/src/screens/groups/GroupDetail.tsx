import { useCallback, useEffect, useState } from 'react'
import {
  joinGroup,
  leaveGroup,
  loadEventGroups,
  loadGroupMembers,
  requestGroupJoin,
  type Group,
  type GroupMember,
} from '../../api/groups'
import { Button, Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { ScreenProps } from '../screen-types'
import { chatProviderLabel, groupStatus, policyLabel, rememberedEventId } from './group-utils'

export function GroupDetail({
  route,
  active,
  back,
  navigate,
  onError,
  confirm,
  host,
}: ScreenProps) {
  const eventId = rememberedEventId(route.id)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!route.id || !eventId) {
        setGroup(null)
        setError('Не удалось определить мероприятие этой группы')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const controller = signal ? null : new AbortController()
      const activeSignal = signal || controller!.signal
      try {
        const groups = await loadEventGroups(eventId, activeSignal)
        if (activeSignal.aborted) return
        const next = groups.find((item) => item.id === route.id) || null
        setGroup(next)
        if (!next) {
          setMembers([])
          setError('Группа больше недоступна')
        } else if (next.joined) {
          try {
            setMembers(await loadGroupMembers(next.id, activeSignal))
          } catch (memberError) {
            if (!activeSignal.aborted)
              setError(
                memberError instanceof Error
                  ? memberError.message
                  : 'Не удалось загрузить состав группы',
              )
          }
        } else {
          setMembers([])
        }
      } catch (groupError) {
        if (!activeSignal.aborted) {
          setGroup(null)
          setMembers([])
          setError(groupError instanceof Error ? groupError.message : 'Не удалось загрузить группу')
        }
      }
      if (!activeSignal.aborted) setLoading(false)
    },
    [route.id, eventId],
  )

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [active, refresh])

  async function action() {
    if (!group || busy) return
    setBusy(true)
    try {
      if (group.joined) {
        await leaveGroup(group.id)
        navigate('groups', group.event_id)
        return
      }
      if (group.join_policy === 'open' || group.invited) {
        await joinGroup(group.id)
      } else if (group.join_policy === 'request' && !group.join_requested) {
        await requestGroupJoin(group.id)
        confirm({
          title: 'Заявка отправлена',
          confirm: 'Готово',
          onConfirm: () => confirm(null),
        })
      }
      await refresh()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const actionLabel = !group
    ? ''
    : group.joined
      ? 'Выйти из группы'
      : group.join_requested
        ? 'Заявка отправлена'
        : group.invited
          ? 'Вступить по приглашению'
          : group.reinvite_required
            ? 'Нужно новое приглашение'
            : group.join_policy === 'open'
              ? 'Вступить'
              : group.join_policy === 'request'
                ? 'Отправить заявку'
                : 'Только по приглашению'
  const actionDisabled =
    busy ||
    !group ||
    (!group.joined &&
      (group.join_requested ||
        (group.reinvite_required && !group.invited) ||
        (group.join_policy === 'invite_only' && !group.invited) ||
        group.available_places <= 0))

  return (
    <>
      <Header title="Группа" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : group ? (
          <>
            <div className="group-hero">
              <span className="group-hero__status">{groupStatus(group)}</span>
              <h2>{group.title}</h2>
              <p>
                {group.member_count} из {group.capacity} участников ·{' '}
                {policyLabel(group.join_policy)}
              </p>
              <small>
                {group.available_places > 0
                  ? `Свободно мест: ${group.available_places}`
                  : 'Свободных мест нет'}
              </small>
            </div>
            {group.invited && !group.joined && (
              <div className="group-invite-banner">
                <strong>Вас пригласили в эту группу</strong>
                <span>
                  Нажмите «Вступить по приглашению» — после этого откроются состав и чат группы.
                </span>
              </div>
            )}
            <Cell
              icon="calendar"
              title="Мероприятие"
              onClick={() => navigate('event', group.event_id)}
            />
            {group.joined && group.chat_url && group.chat_provider === host.provider && (
              <Cell
                icon="send"
                title={`Чат группы в ${chatProviderLabel(group.chat_provider)}`}
                detail="Открыть в текущем мессенджере"
                onClick={() => host.openLink(group.chat_url!)}
              />
            )}
            {group.joined && group.chat_url && group.chat_provider !== host.provider && (
              <p className="group-chat-mismatch">
                Чат привязан к {chatProviderLabel(group.chat_provider)} и не открывается из другого
                мессенджера.
              </p>
            )}
            {group.is_leader && (
              <Cell
                icon="settings"
                title="Управление группой"
                detail="Название, чат, заявки и участники"
                onClick={() => navigate('groupmanage', group.id)}
              />
            )}
            <h2 className="section-title">Участники · {members.length || group.member_count}</h2>
            {group.joined ? (
              members.length ? (
                members.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    detail={person.is_leader ? 'Лидер группы' : undefined}
                    onClick={() => navigate('userprofile', person.id)}
                  />
                ))
              ) : (
                <StatePanel title="Список участников недоступен" />
              )
            ) : (
              <StatePanel title="Состав виден участникам группы" />
            )}
          </>
        ) : (
          <StatePanel title="Группа недоступна" description={error} />
        )}
      </div>
      {group && (
        <div className="bottom-action">
          <Button
            variant={group.joined || group.join_requested ? 'secondary' : 'primary'}
            disabled={actionDisabled}
            onClick={() =>
              group.joined
                ? confirm({
                  title: 'Выйти из группы?',
                  description: group.title,
                  confirm: 'Выйти',
                  destructive: true,
                  onConfirm: () => void action(),
                })
                : void action()
            }
          >
            {busy ? 'Подождите…' : actionLabel}
          </Button>
        </div>
      )}
    </>
  )
}
