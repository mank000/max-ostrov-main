import { useState } from 'react'
import { cityDisplayName } from '../../ui-utils'
import { Field, Icon } from '../../ui/components/BasicUI'
import { CheckControl } from '../../ui/components/CheckControl'
import type { EventDraft, SetEventField } from './useEventDraft'
import type { useEventLocation } from './useEventLocation'

export function EventTimePlaceFields({ draft, setField, location }: { draft: EventDraft; setField: SetEventField; location: ReturnType<typeof useEventLocation> }) {
  const { start, end, address, eventCity, price, ticketUrl } = draft
  const [showEnd, setShowEnd] = useState(() => Boolean(end))
  const [showTicketFields, setShowTicketFields] = useState(
    () => Boolean(price.trim() || ticketUrl.trim()),
  )
  const {
    autocomplete,
    resolvingAddress,
    resolveTypedAddress,
    placeSearchBusy,
    addressChoices,
    resolvedAddress,
    changeAddress,
    changeEventCity,
    chooseAddress,
    openLocationPicker,
    fillFromCurrentLocation,
  } = location
  return (
    <div className="event-form__fields event-form__fields--time-place">
      <div className="event-form__section-label">Когда</div>
      <div className="event-form__time-stack">
        <Field label="Начало" value={start} onChange={(value) => setField('start', value)} type="datetime-local" />
        <CheckControl
          className="event-form__option-toggle"
          markPosition="end"
          label="Указать время окончания"
          checked={showEnd}
          onChange={(checked) => {
            setShowEnd(checked)
            if (!checked) setField('end', '')
          }}
        />
        {showEnd && (
          <div className="event-form__option-fields event-form__option-fields--single">
            <Field
              label="Окончание"
              value={end}
              onChange={(value) => setField('end', value)}
              type="datetime-local"
              min={start || undefined}
              clearable
            />
          </div>
        )}
      </div>
      <div className="event-form__section-heading">
        <div className="event-form__section-label">Где</div>
        {eventCity.trim() && (
          <span className="event-form__city-context">
            <Icon name="pin" size={14} />
            {cityDisplayName(eventCity)}
          </span>
        )}
      </div>
      <Field
          label="Город"
          value={eventCity}
          onChange={changeEventCity}
        placeholder="Название города"
      />
      <div className="event-form__place-search">
        <Field
          label="Место или адрес"
          value={address}
          onChange={changeAddress}
          placeholder="Название места или улица и дом"
        />
        {placeSearchBusy && (
          <span className="event-form__place-search-status" role="status">
            Ищем…
          </span>
        )}
        {addressChoices.length > 0 && (
          <div
            className="event-form__address-popover"
            role="listbox"
            aria-label="Подходящие места"
          >
            {addressChoices.map((place) => (
              <button
                className="event-form__address-option"
                key={place.latitude + ':' + place.longitude}
                type="button"
                role="option"
                onClick={() => chooseAddress(place)}
              >
                <Icon name="pin" size={18} />
                <span>
                  <strong>{place.title}</strong>
                  <small>
                    {place.subtitle || [place.city, place.region].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <em>{place.scope === 'city' ? 'В городе' : place.city || 'В регионе'}</em>
              </button>
            ))}
          </div>
        )}
      </div>
      {resolvedAddress && (
        <p className="event-form__resolved" role="status">
          <Icon name="check" size={16} />
          {resolvedAddress}
        </p>
      )}
      <div className="event-form__location-actions">
        {!autocomplete && <button className="form-link" type="button" disabled={resolvingAddress || address.trim().length < 2} onClick={() => void resolveTypedAddress()}>
          <Icon name="search" size={18} />{resolvingAddress ? 'Ищем…' : 'Найти адрес'}
        </button>}
        <button className="form-link" type="button" onClick={openLocationPicker}>
          <Icon name="pin" size={18} />
          На карте
        </button>
        <button className="form-link" type="button" aria-busy={resolvingAddress} onClick={fillFromCurrentLocation}>
          <Icon name="location" size={18} />
          Моя геопозиция
        </button>
      </div>
      <div className="event-form__ticketing">
        <CheckControl
          className="event-form__option-toggle"
          markPosition="end"
          label="Есть билеты или регистрация"
          checked={showTicketFields}
          onChange={(checked) => {
            setShowTicketFields(checked)
            if (!checked) {
              setField('price', '')
              setField('ticketUrl', '')
            }
          }}
        />
        {showTicketFields && (
          <div className="event-form__option-fields event-form__option-fields--tickets">
            <Field
              label="Цена от, ₽ · если платно"
              value={price}
              onChange={(value) => setField('price', value)}
              type="number"
            />
            <Field
              label="Ссылка на билеты или регистрацию"
              value={ticketUrl}
              onChange={(value) => setField('ticketUrl', value)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
