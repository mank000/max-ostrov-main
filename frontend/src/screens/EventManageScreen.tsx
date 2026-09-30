import { deleteEvent } from '../api/events'
import { Cell, Header, StatePanel } from '../ui/components/BasicUI'
import { eventDate, eventTime } from '../ui/components/ContentCards'
import type { ScreenProps } from './screen-types'
import { useEvent } from './useEvent'

export function EventManage({
  route,
  back,
  navigate,
  confirm,
  onError,
  data,
  onEventDeleted,
}: ScreenProps) {
  const { event, error } = useEvent(route.id, data)
  return (
    <>
      <Header title="Управление мероприятием" back={back} />
      <div className="screen-scroll">
        {event ? (
          <>
            <div className="extra-pad">
              <h2 className="section-title event-manage-title">{event.title}</h2>
              <p className="extra-body">
                {eventDate(event.starts_at)} · {eventTime(event.starts_at)}
              </p>
            </div>
            <Cell
              icon="edit"
              title="Редактировать"
              onClick={() => navigate('eventedit', event.id)}
            />
            <Cell
              icon="users"
              title="Участники"
              onClick={() => navigate('participants', event.id)}
            />
            <Cell
              icon="check"
              title="Подтверждения посещения"
              onClick={() => navigate('attendanceadmin', event.id)}
            />
            <Cell
              icon="star"
              title="Продвинуть мероприятие"
              onClick={() => navigate('boostevent', event.id)}
            />
            <Cell
              icon="trash"
              title="Удалить мероприятие"
              onClick={() =>
                confirm({
                  title: 'Удалить мероприятие?',
                  description: event.title,
                  confirm: 'Удалить',
                  destructive: true,
                  onConfirm: () => {
                    void deleteEvent(event.id)
                      .then(() => onEventDeleted(event.id))
                      .catch((cause) => onError(String(cause)))
                  },
                })
              }
            />
          </>
        ) : (
          <StatePanel
            title={error ? 'Не удалось загрузить' : ''}
            description={error}
            loading={!error}
          />
        )}
      </div>
    </>
  )
}
