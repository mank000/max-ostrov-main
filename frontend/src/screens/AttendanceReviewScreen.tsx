import { mediaURL } from '../api/credentials'
import { useEffect, useState } from 'react'
import {
  loadAttendanceReviews,
  reviewAttendance,
  type AttendanceConfirmation,
} from '../api/attendance'
import { loadEventParticipants, type EventParticipant } from '../participants-api'
import { Button, Header, StatePanel, Tabs } from '../ui/components/BasicUI'
import { PersonRow } from '../ui/components/ContentCards'
import type { ScreenProps } from './screen-types'

export function AttendanceAdmin({ route, back, navigate, onError, openMedia }: ScreenProps) {
  const [items, setItems] = useState<AttendanceConfirmation[]>([])
  const [people, setPeople] = useState<EventParticipant[]>([])
  const [tab, setTab] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => {
    if (!route.id) return
    const controller = new AbortController()
    Promise.all([
      loadAttendanceReviews(route.id, controller.signal),
      loadEventParticipants(route.id, controller.signal).catch(() => [] as EventParticipant[]),
    ])
      .then(([reviews, participants]) => {
        setItems(reviews)
        setPeople(participants)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) onError(String(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route.id, onError])
  async function review(item: AttendanceConfirmation, status: 'confirmed' | 'rejected') {
    if (!route.id || busy) return
    setBusy(item.user_id)
    try {
      const updated = await reviewAttendance(route.id, item.user_id, status)
      setItems((current) =>
        current.map((value) => (value.user_id === item.user_id ? updated : value)),
      )
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(null)
    }
  }
  const visible = items.filter((item) =>
    tab === 'pending' ? item.status === 'pending' : item.status !== 'pending',
  )
  return (
    <>
      <Header title="Проверка посещений" back={back} />
      <Tabs
        items={[
          {
            id: 'pending',
            label: `Ожидают · ${items.filter((item) => item.status === 'pending').length}`,
          },
          { id: 'reviewed', label: 'Проверенные' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : visible.length ? (
          visible.map((item) => {
            const person = people.find((value) => value.id === item.user_id)
            return (
              <div className="extra-request" key={item.user_id}>
                <PersonRow
                  person={person || { id: item.user_id, display_name: 'Участник' }}
                  detail={`${item.location_matched ? 'Геопроверка пройдена' : 'Без геопроверки'} · ${item.media_ids.length} фото`}
                  onClick={() => navigate('userprofile', item.user_id)}
                />
                {item.media_ids.length > 0 && (
                  <div className="attendance-photos">
                    {item.media_ids.map((mediaId) => (
                      <button
                        key={mediaId}
                        type="button"
                        onClick={() => openMedia(`/api/v1/media/${mediaId}/content`)}
                      >
                        <img src={mediaURL(`/api/v1/media/${mediaId}/content`)} alt="Фото посещения" />
                      </button>
                    ))}
                  </div>
                )}
                {item.status === 'pending' ? (
                  <div>
                    <Button
                      disabled={busy === item.user_id}
                      onClick={() => void review(item, 'confirmed')}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === item.user_id}
                      onClick={() => void review(item, 'rejected')}
                    >
                      Отклонить
                    </Button>
                  </div>
                ) : (
                  <p className="extra-hint">
                    {item.status === 'confirmed' ? 'Подтверждено' : 'Отклонено'}
                  </p>
                )}
              </div>
            )
          })
        ) : (
          <StatePanel title={tab === 'pending' ? 'Нет заявок на проверку' : 'Пока нет решений'} />
        )}
      </div>
    </>
  )
}
