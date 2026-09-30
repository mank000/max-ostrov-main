import { mediaURL } from '../../api/credentials'
import { Cell } from '../../ui/components/BasicUI'
import { EventCategoryArtwork, eventDate, eventTime } from '../../ui/components/ContentCards'
import type { useEventArtwork } from './useEventArtwork'
import type { EventDraft } from './useEventDraft'
import type { useEventLocation } from './useEventLocation'

export function EventReview({ draft, setStep, artwork, location }: {
  draft: EventDraft
  setStep: (value: number) => void
  artwork: ReturnType<typeof useEventArtwork>
  location: ReturnType<typeof useEventLocation>
}) {
  const { title, description, category, start, end, venue, address, eventCity, price, ticketUrl } = draft
  const { headerPreview, iconPreview } = artwork
  const { resolvedAddress } = location
  return (
    <div className="event-review">
      <div className={`event-review__hero ${headerPreview ? 'has-header' : ''}`}>
        {headerPreview && (
          <img className="event-review__header-image" src={mediaURL(headerPreview)} alt="" />
        )}
        <div className="event-review__identity">
          {iconPreview ? (
            <img className="event-review__icon" src={mediaURL(iconPreview)} alt="" />
          ) : (
            <EventCategoryArtwork
              event={{
                category: category || 'Встреча',
                title: title || 'Мероприятие',
              }}
              className="event-review__icon"
              size={25}
            />
          )}
          <div>
            <span>{category}</span>
            <h3>{title}</h3>
          </div>
        </div>
        <p>{description}</p>
        <button type="button" onClick={() => setStep(0)}>
          Изменить описание и оформление
        </button>
      </div>
      <Cell
        icon="calendar"
        title={start ? `${eventDate(start)} · ${eventTime(start)}` : ''}
        detail={end ? `До ${eventDate(end)} · ${eventTime(end)}` : undefined}
        onClick={() => setStep(1)}
      />
      <Cell
        icon="pin"
        title={venue.trim() || address.trim() || 'Точка на карте'}
        detail={`${eventCity} · ${address || resolvedAddress}`}
        onClick={() => setStep(1)}
      />
      <Cell
        icon="external"
        title={Number(price) > 0 ? `От ${price} ₽` : 'Бесплатно'}
        detail={ticketUrl ? 'Есть ссылка на билеты' : undefined}
        onClick={() => setStep(1)}
      />
    </div>
  )
}
