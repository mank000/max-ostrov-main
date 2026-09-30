import { useEffect, useState } from 'react'
import { loadEventCategories, type EventCategory } from '../api/events'
import { readEventCategories, saveEventCategories } from '../event-filters'
import { Button, Chip, Header } from '../ui/components/BasicUI'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function FiltersScreen({ back, navigate }: ScreenProps) {
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [selected, setSelected] = useState(readEventCategories)
  useEffect(() => {
    const controller = new AbortController()
    loadEventCategories(controller.signal)
      .then(setCategories)
      .catch(() => { })
    return () => controller.abort()
  }, [])
  return (
    <>
      <Header
        title="Фильтры"
        back={back}
        actions={
          <button className="header-text-action" type="button" onClick={() => setSelected([])}>
            Сбросить
          </button>
        }
      />
      <div className="screen-scroll extra-pad">
        <h2 className="section-title">Категории</h2>
        <div className="extra-chips">
          {categories.map((item) => (
            <Chip
              key={item.name}
              active={selected.includes(item.name)}
              onClick={() =>
                setSelected((current) =>
                  current.includes(item.name)
                    ? current.filter((value) => value !== item.name)
                    : [...current, item.name],
                )
              }
            >
              {item.name}
            </Chip>
          ))}
        </div>
      </div>
      <div className="bottom-action">
        <Button
          onClick={() => {
            saveEventCategories(selected)
            navigate('events')
          }}
        >
          Показать мероприятия
        </Button>
      </div>
    </>
  )
}
