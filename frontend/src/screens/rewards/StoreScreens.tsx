import { readTabValue, saveTabValue } from '../../ui-utils'
import { useState } from 'react'
import { purchaseStoreItem } from '../../api/rewards'
import { Button, Cell, Header, Icon, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { useStore } from './useStore'

export function Store({ back, navigate, onError }: ScreenProps) {
  const items = useStore(onError)
  return (
    <>
      <Header title="Магазин" back={back} />
      <div className="screen-scroll">
        {items.length ? (
          items
            .filter((item) => item.kind !== 'gift')
            .map((item) => (
              <Cell
                key={item.code}
                icon={item.kind === 'event_boost' ? 'star' : 'gift'}
                title={item.title}
                detail={`${item.description} · ${item.coin_price} монет`}
                onClick={() => {
                  saveTabValue('kutezh-purchase', item.code)
                  navigate(item.kind === 'event_boost' ? 'boostevent' : 'purchase')
                }}
              />
            ))
        ) : (
          <StatePanel title="Товары недоступны" />
        )}
      </div>
    </>
  )
}

export function Purchase({ route, back, navigate, onError, confirm }: ScreenProps) {
  const items = useStore(onError)
  const item = items.find((value) => value.code === readTabValue('kutezh-purchase'))
  const [busy, setBusy] = useState(false)
  async function buy() {
    if (!item || busy) return
    setBusy(true)
    try {
      await purchaseStoreItem(item.code, item.kind === 'event_boost' ? route.id : undefined)
      confirm({
        title: 'Покупка завершена',
        description: item.title,
        confirm: 'Готово',
        onConfirm: () => navigate('rewards'),
      })
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Header title="Покупка" back={back} />
      <div className="screen-scroll extra-pad">
        {item ? (
          <div className="economy-product">
            <Icon name={item.kind === 'event_boost' ? 'star' : 'gift'} size={48} />
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <strong>{item.coin_price} монет</strong>
          </div>
        ) : (
          <StatePanel title="Товар не выбран" />
        )}
      </div>
      {item && (
        <div className="bottom-action">
          <Button disabled={busy} onClick={() => void buy()}>
            {busy ? 'Покупаем…' : 'Купить'}
          </Button>
        </div>
      )}
    </>
  )
}
