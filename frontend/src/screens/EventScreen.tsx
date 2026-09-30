import { mediaURL } from '../api/credentials'
import { useEffect, useState } from 'react'
import { latestEvent, loadEvent, setParticipation, setSaved, type Event } from '../api/events'
import { eventTicketURLIssue } from '../event-form'
import { Button, Cell, Header, IconButton, StatePanel } from '../ui/components/BasicUI'
import { eventDate, eventHeaderURL, eventTime } from '../ui/components/ContentCards'
import type { AppDataResult } from '../useAppData'
import './comment-experience.css'
import { ContentReportSheet } from './ContentReportSheet'
import './details.css'

export function EventScreen({
  eventId,
  data,
  back,
  navigate,
  onMap,
  onTicket,
  confirm,
  onNotice,
}: {
  eventId: number
  data: AppDataResult
  back: () => void
  navigate: (view: string, id?: number) => void
  onMap: (event: Event) => void
  onTicket: (url: string) => void
  confirm: (
    modal: {
      title: string
      description?: string
      confirm: string
      onConfirm: () => void
      destructive?: boolean
    } | null,
  ) => void
  onNotice: (message: string) => void
}) {
  const [loadedEvent, setLoadedEvent] = useState<Event | null>(null)
  const event = data.deletedEventIds.has(eventId)
    ? null
    : latestEvent(loadedEvent?.id === eventId ? loadedEvent : null, data.eventOverrides[eventId])
  const [loading, setLoading] = useState(() => !data.eventOverrides[eventId])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reporting, setReporting] = useState(false)
  const ticketURL =
    event?.ticket_url && !eventTicketURLIssue(event.ticket_url) ? event.ticket_url : ''
  const joined = data.participatingEventIds.has(eventId)
  const saved = data.savedEventIds.has(eventId)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loadEvent(eventId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setLoadedEvent(value)
          data.applyEventUpdate(value)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить мероприятие')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [eventId, data.applyEventUpdate])
  async function toggleParticipation() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await setParticipation(eventId, !joined)
      data.setParticipatingEventIds((current) => {
        const next = new Set(current)
        if (joined) next.delete(eventId)
        else next.add(eventId)
        return next
      })
      data.refresh('activity')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить участие')
    } finally {
      setSaving(false)
    }
  }
  async function toggleSaved() {
    try {
      await setSaved(eventId, !saved)
      data.setSavedEventIds((current) => {
        const next = new Set(current)
        if (saved) next.delete(eventId)
        else next.add(eventId)
        return next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить мероприятие')
    }
  }
  return (
    <>
      <Header
        title="Мероприятие"
        back={back}
        actions={
          <IconButton
            icon="bookmark"
            label={saved ? 'Убрать из сохранённого' : 'Сохранить'}
            onClick={() => void toggleSaved()}
            active={saved}
          />
        }
      />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : event ? (
          <>
            <div className="event-hero">
              {eventHeaderURL(event) && (
                <img
                  className="event-hero__image"
                  src={mediaURL(eventHeaderURL(event))}
                  alt=""
                  decoding="async"
                />
              )}
              <div className="event-hero__copy">
                <span>{event.category.toLocaleUpperCase('ru')}</span>
                <h2>{event.title}</h2>
                <p>
                  {event.location.city} · {eventDate(event.starts_at)}
                </p>
              </div>
            </div>
            <Cell
              icon="calendar"
              title={eventDate(event.starts_at, {
                day: 'numeric',
                month: 'long',
                weekday: 'long',
              })}
              detail={`${eventTime(event.starts_at)}${event.ends_at ? `–${eventTime(event.ends_at)}` : ''}`}
              onClick={() => { }}
            />
            <Cell
              icon="pin"
              title={event.location.venue_name || event.location.city}
              detail={event.location.address}
              onClick={() => onMap(event)}
            />
            <Cell
              icon="external"
              title={event.price_min_rubles ? `От ${event.price_min_rubles} ₽` : 'Бесплатно'}
              detail={
                ticketURL
                  ? 'Билеты на сайте организатора'
                  : event.ticket_url
                    ? 'Ссылка на билеты заблокирована'
                    : ''
              }
              onClick={() => {
                if (ticketURL) onTicket(ticketURL)
                else if (event.ticket_url) onNotice('Ссылка на билеты заблокирована')
              }}
            />
            <h2 className="section-title">О мероприятии</h2>
            <p className="event-description">{event.description}</p>
            <Cell
              icon="users"
              title="Участники мероприятия"
              detail={joined ? 'Вы участвуете' : 'Посмотреть участников'}
              onClick={() => navigate('participants', eventId)}
            />
            {joined && (
              <Cell
                icon="users"
                title="Группы"
                detail="Найдите компанию для встречи"
                onClick={() => navigate('groups', eventId)}
              />
            )}
            <Cell
              icon="share"
              title="Пригласить друзей"
              onClick={() => navigate('eventinvites', eventId)}
            />
            {event.organizer.user_id !== data.profile?.id && (
              <Cell
                icon="info"
                title="Пожаловаться на мероприятие"
                onClick={() => setReporting(true)}
              />
            )}
            {joined && (
              <Cell
                icon="check"
                title="Подтверждение посещения"
                onClick={() => navigate('attendance', eventId)}
              />
            )}
            {event.organizer.user_id === data.profile?.id && (
              <Cell
                icon="settings"
                title="Управление мероприятием"
                onClick={() => navigate('eventmanage', eventId)}
              />
            )}
          </>
        ) : (
          <StatePanel
            title="Не удалось загрузить"
            description={error}
            action="Назад"
            onAction={back}
          />
        )}
      </div>
      {event && event.organizer.user_id !== data.profile?.id && (
        <div className="bottom-action">
          {error && <p className="error-text">{error}</p>}
          <Button
            variant={joined ? 'secondary' : 'primary'}
            disabled={saving}
            onClick={() =>
              joined
                ? confirm({
                  title: 'Отменить участие?',
                  description: 'Вы больше не будете в списке участников мероприятия.',
                  confirm: 'Отменить участие',
                  destructive: true,
                  onConfirm: () => {
                    confirm(null)
                    void toggleParticipation()
                  },
                })
                : void toggleParticipation()
            }
          >
            {saving ? 'Подождите…' : joined ? 'Отменить участие' : 'Я пойду'}
          </Button>
        </div>
      )}
      {reporting && event && (
        <ContentReportSheet
          targetType="event"
          targetId={event.id}
          title="Пожаловаться на мероприятие"
          preview={event.title}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false)
            onNotice('Жалоба отправлена на проверку')
          }}
        />
      )}
    </>
  )
}
