import { readTabValue } from '../../ui-utils'
import { useState } from 'react'
import { purchaseStoreItem } from '../../api/rewards'
import { Button, Cell, Header, Icon } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { useStore } from './useStore'

export function BoostEvent({ route, data, back, navigate, onError, confirm }: ScreenProps) {
  const items = useStore(onError).filter((item) => item.kind === 'event_boost')
  const [code, setCode] = useState(() => readTabValue('kutezh-purchase') || '')
  const [eventId, setEventId] = useState(route.id || 0)
  const [busy, setBusy] = useState(false)
  const item = items.find((value) => value.code === code)
  async function submit() {
    if (!item || !eventId || busy) return
    setBusy(true)
    try {
      await purchaseStoreItem(item.code, eventId)
      data.refresh('recommendations', 'activity')
      window.dispatchEvent(new Event('kutezh:events-updated'))
      confirm({
        title: 'Покупка завершена',
        description: 'Мероприятие поднято выше обычных событий в списке.',
        confirm: 'Открыть мероприятие',
        onConfirm: () => navigate('event', eventId),
      })
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Header title="Продвижение события" back={back} />
      <div className="screen-scroll">
        <h2 className="section-title">Выберите продвижение</h2>
        {items.map((value) => (
          <Cell
            key={value.code}
            icon="star"
            title={value.title}
            detail={`${value.coin_price} монет · ${value.description}`}
            trailing={code === value.code ? <Icon name="check" size={20} /> : undefined}
            onClick={() => setCode(value.code)}
          />
        ))}
        <h2 className="section-title">Ваше мероприятие</h2>
        {data.profileEvents
          .filter((value) => value.organizer.user_id === data.profile?.id)
          .map((value) => (
            <Cell
              key={value.id}
              icon="calendar"
              title={value.title}
              detail={value.location.city}
              trailing={eventId === value.id ? <Icon name="check" size={20} /> : undefined}
              onClick={() => setEventId(value.id)}
            />
          ))}
      </div>
      <div className="bottom-action">
        <Button disabled={!item || !eventId || busy} onClick={() => void submit()}>
          {busy ? 'Покупаем…' : 'Продвинуть мероприятие'}
        </Button>
      </div>
    </>
  )
}
