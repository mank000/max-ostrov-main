import { useEffect, useState } from 'react'
import { loadCoinTransactions, type CoinTransaction } from '../../api/rewards'
import { Cell, Header, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'

export function Transactions({ back, onError }: ScreenProps) {
  const [items, setItems] = useState<CoinTransaction[]>([])
  useEffect(() => {
    const controller = new AbortController()
    loadCoinTransactions(undefined, controller.signal)
      .then((value) => setItems(value.transactions))
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [onError])
  return (
    <>
      <Header title="История монет" back={back} />
      <div className="screen-scroll">
        {items.length ? (
          items.map((item) => (
            <Cell
              key={item.id}
              icon="coins"
              title={item.description}
              detail={new Date(item.created_at).toLocaleDateString('ru-RU')}
              trailing={
                <strong className={item.amount > 0 ? 'economy-positive' : ''}>
                  {item.complimentary ? 'Без списания' : `${item.amount > 0 ? '+' : ''}${item.amount}`}
                </strong>
              }
              onClick={() => { }}
            />
          ))
        ) : (
          <StatePanel title="Пока нет операций" />
        )}
      </div>
    </>
  )
}
