import { SelectField } from '../../ui/components/SelectField'
import { useEffect, useState } from 'react'
import {
  loadEventGroups,
  loadGroupMembers,
  removeGroupMember,
  transferGroupLeadership,
  updateGroup,
  type Group,
  type GroupMember,
} from '../../api/groups'
import { Button, Cell, Field, Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { ScreenProps } from '../screen-types'
import { maxChatHint, rememberedEventId } from './group-utils'

export function GroupManage({ route, back, navigate, onError, confirm, host }: ScreenProps) {
  const eventId = rememberedEventId(route.id)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [title, setTitle] = useState('')
  const [capacity, setCapacity] = useState('6')
  const [policy, setPolicy] = useState<Group['join_policy']>('open')
  const [chatURL, setChatURL] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!route.id || !eventId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    Promise.allSettled([
      loadEventGroups(eventId, controller.signal),
      loadGroupMembers(route.id, controller.signal),
    ])
      .then(([groupsResult, membersResult]) => {
        if (controller.signal.aborted) return
        if (groupsResult.status === 'fulfilled') {
          const current = groupsResult.value.find((item) => item.id === route.id) || null
          setGroup(current)
          if (current) {
            setTitle(current.title)
            setCapacity(String(current.capacity))
            setPolicy(current.join_policy)
            setChatURL(current.chat_provider === host.provider ? current.chat_url || '' : '')
          }
        } else {
          onError(String(groupsResult.reason))
        }
        if (membersResult.status === 'fulfilled') setMembers(membersResult.value)
        else onError(String(membersResult.reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, eventId, onError, host.provider])

  const size = Number(capacity)
  const validCapacity =
    Number.isInteger(size) && size >= 2 && size <= 12 && (!group || size >= group.member_count)
  const canSave = Boolean(group?.is_leader && title.trim() && validCapacity && !busy)

  async function save() {
    if (!route.id || !group || !canSave) return
    setBusy(true)
    try {
      const nextTitle = title.trim()
      const chat = chatURL.trim()
      const chatProvider = chat ? 'max' : ''
      const chatValue = chat
      await updateGroup(route.id, {
        title: nextTitle,
        capacity: size,
        join_policy: policy,
        chat_provider: chatProvider,
        chat_url: chatValue,
      })
      setGroup((current) =>
        current
          ? {
            ...current,
            title: nextTitle,
            capacity: size,
            join_policy: policy,
            chat_provider: chatProvider || undefined,
            chat_url: chatValue || undefined,
            available_places: Math.max(0, size - current.member_count),
          }
          : current,
      )
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(person: GroupMember) {
    if (!route.id || !group?.is_leader || busy || person.is_leader) return
    setBusy(true)
    try {
      await removeGroupMember(route.id, person.id)
      setMembers((current) => current.filter((item) => item.id !== person.id))
      setGroup((current) =>
        current
          ? {
            ...current,
            member_count: Math.max(1, current.member_count - 1),
            available_places: Math.min(current.capacity - 1, current.available_places + 1),
          }
          : current,
      )
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function transferLeadership(person: GroupMember) {
    if (!route.id || !group?.is_leader || busy || person.is_leader) return
    setBusy(true)
    try {
      await transferGroupLeadership(route.id, person.id)
      confirm(null)
      navigate('groupdetail', route.id)
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title="Управление группой" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : group?.is_leader ? (
          <>
            <div className="extra-pad">
              <h2 className="section-title">Настройки</h2>
              <Field
                label="Название группы"
                value={title}
                onChange={(value) => setTitle(value.slice(0, 80))}
              />
              <Field
                label="Лимит участников"
                value={capacity}
                onChange={setCapacity}
                type="number"
              />
              {!validCapacity && (
                <p className="extra-hint">
                  Лимит — от 2 до 12 и не меньше текущего числа участников ({group.member_count}).
                </p>
              )}
              <SelectField label="Вступление" value={policy} onChange={value => setPolicy(value as Group['join_policy'])}
            options={[{ value: 'open', label: 'Открытая группа' }, { value: 'request', label: 'По заявке' }, { value: 'invite_only', label: 'По приглашению' }]} />
              {host.provider === 'max' && (
                <>
                  <Field
                    label="Ссылка на чат в MAX"
                    value={chatURL}
                    onChange={(value) => setChatURL(value.slice(0, 500))}
                  />
                  <p className="group-chat-hint">{maxChatHint()}</p>
                </>
              )}
              <Button disabled={!canSave} onClick={() => void save()}>
                {busy ? 'Сохраняем…' : 'Сохранить настройки'}
              </Button>
            </div>

            {group.join_policy === 'request' && (
              <Cell
                icon="users"
                title="Заявки на вступление"
                onClick={() => navigate('grouprequests', group.id)}
              />
            )}
            <Cell
              icon="plus"
              title="Пригласить участника"
              detail={
                group.available_places > 0
                  ? `Свободно мест: ${group.available_places}`
                  : 'Свободных мест нет'
              }
              onClick={() => navigate('groupinvites', group.id)}
            />
            <Cell
              icon="users"
              title="Объединить группы"
              onClick={() => navigate('groupmerge', group.id)}
            />

            <h2 className="section-title">Участники · {members.length || group.member_count}</h2>
            {members.length ? (
              members.map((person) => (
                <div className="extra-request" key={person.id}>
                  <PersonRow
                    person={person}
                    detail={person.is_leader ? 'Лидер группы' : undefined}
                    onClick={() => navigate('userprofile', person.id)}
                  />
                  {person.id !== group.leader_user_id && (
                    <div>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          confirm({
                            title: 'Передать лидерство?',
                            description: `${person.display_name} станет лидером группы, а вы останетесь участником.`,
                            confirm: 'Передать',
                            onConfirm: () => void transferLeadership(person),
                          })
                        }
                      >
                        Сделать лидером
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          confirm({
                            title: 'Удалить из группы?',
                            description: person.display_name,
                            confirm: 'Удалить',
                            destructive: true,
                            onConfirm: () => {
                              confirm(null)
                              void removeMember(person)
                            },
                          })
                        }
                      >
                        Удалить
                      </Button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <StatePanel title="Участники не найдены" />
            )}
          </>
        ) : (
          <StatePanel
            title="Управление недоступно"
            description="Эти действия доступны только лидеру группы."
          />
        )}
      </div>
    </>
  )
}
