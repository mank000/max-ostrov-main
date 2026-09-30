import { mediaURL } from '../../../api/credentials'
import { type Event } from '../../../api/events'
import { Icon } from '../BasicUI'
import '../cards.css'
import { eventDate, eventTime, eventCategoryVisual, eventHeaderURL, eventIconURL } from './eventFormat'

export function EventCategoryArtwork({
  event,
  className = '',
  size = 25,
}: {
  event: Pick<Event, 'category' | 'title'>
  className?: string
  size?: number
}) {
  const visual = eventCategoryVisual(event)
  return (
    <span
      className={`event-category-artwork ${className}`}
      title={visual.label}
      aria-label={visual.label}
    >
      <Icon name={visual.icon} size={size} />
    </span>
  )
}

export function EventCard({ event, onClick }: { event: Event; onClick: () => void }) {
  const date = eventDate(event.starts_at, {
    day: 'numeric',
    month: 'long',
  }).toLocaleUpperCase('ru')
  const headerURL = eventHeaderURL(event)
  const iconURL = eventIconURL(event)
  return (
    <button
      className={`event-card ${headerURL ? 'event-card--with-header' : 'event-card--without-header'}`}
      type="button"
      onClick={onClick}
    >
      {headerURL && (
        <img className="event-card__image" src={mediaURL(headerURL)} alt="" loading="lazy" decoding="async" />
      )}
      <span className="event-card__body">
        {headerURL ? (
          <>
            <span className="event-card__date">
              {date} · {eventTime(event.starts_at)}
            </span>
            <strong>{event.title}</strong>
          </>
        ) : (
          <span className="event-card__identity">
            {iconURL ? (
              <img
                className="event-card__icon"
                src={mediaURL(iconURL)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <EventCategoryArtwork event={event} className="event-card__category" size={27} />
            )}
            <span className="event-card__identity-copy">
              <span className="event-card__date">
                {date} · {eventTime(event.starts_at)}
              </span>
              <strong>{event.title}</strong>
            </span>
          </span>
        )}
        <span className="event-card__description">{event.description}</span>
        <span className="event-card__meta">
          {event.location.venue_name || event.location.city} ·{' '}
          {event.price_min_rubles ? `от ${event.price_min_rubles} ₽` : 'бесплатно'}
          <Icon name="chevron" size={20} />
        </span>
      </span>
    </button>
  )
}

export function EventRow({ event, onClick }: { event: Event; onClick: () => void }) {
  const iconURL = eventIconURL(event)
  return (
    <button className="event-row" type="button" onClick={onClick}>
      {iconURL ? (
        <img className="event-row__image" src={mediaURL(iconURL)} alt="" loading="lazy" decoding="async" />
      ) : (
        <EventCategoryArtwork
          event={event}
          className="event-row__image event-row__category"
          size={24}
        />
      )}
      <span className="event-row__text">
        <span className="event-row__title">
          <strong>{event.title}</strong>
        </span>
        <small>
          {eventDate(event.starts_at, { weekday: 'short' })}, {eventTime(event.starts_at)} ·{' '}
          {event.location.venue_name || event.location.city} ·{' '}
          {event.price_min_rubles ? `${event.price_min_rubles} ₽` : 'бесплатно'}
        </small>
      </span>
      <Icon name="chevron" size={20} className="event-row__chevron" />
    </button>
  )
}
