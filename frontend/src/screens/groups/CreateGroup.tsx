import { SelectField } from '../../ui/components/SelectField'
import { useState } from 'react'
import { createEventGroup, type Group } from '../../api/groups'
import { Button, Field, Header } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { maxChatHint, rememberGroup } from './group-utils'

export function CreateGroup({ route, back, navigate, onError, host }: ScreenProps) {
  const [title, setTitle] = useState('')
  const [capacity, setCapacity] = useState('6')
  const [policy, setPolicy] = useState<Group['join_policy']>('open')
  const [chatURL, setChatURL] = useState('')
  const [busy, setBusy] = useState(false)
  const size = Number(capacity)
  const validCapacity = Number.isInteger(size) && size >= 2 && size <= 12

  async function submit() {
    if (!route.id || !title.trim() || !validCapacity || busy) return
    setBusy(true)
    try {
      const chat = chatURL.trim()
      const group = await createEventGroup(route.id, {
        title: title.trim(),
        capacity: size,
        join_policy: policy,
        chat_provider: chat ? 'max' : '',
        chat_url: chat,
      })
      rememberGroup(group)
      navigate('groupdetail', group.id)
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title="Новая группа" back={back} />
      <div className="screen-scroll extra-pad">
        <Field
          label="Название группы"
          value={title}
          onChange={(value) => setTitle(value.slice(0, 80))}
        />
        <Field
          label="Количество участников"
          value={capacity}
          onChange={setCapacity}
          type="number"
        />
        <p className="extra-hint">От 2 до 12 человек.</p>
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
      </div>
      <div className="bottom-action">
        <Button disabled={busy || !title.trim() || !validCapacity} onClick={() => void submit()}>
          {busy ? 'Создаём…' : 'Создать группу'}
        </Button>
      </div>
    </>
  )
}
