import { useEffect, useRef, useState } from 'react'
import { createEvent, loadEventCategories, type CreateEventInput, type Event } from '../api/events'
import { operationKey } from '../api/http'
import { deleteMedia, uploadEventPhoto } from '../api/media'
import {
  eventBasicsError,
  eventTimeAndPlaceError
} from '../event-form'
import { EventBasicsFields } from '../features/events/EventBasicsFields'
import { EventReview } from '../features/events/EventReview'
import { EventTimePlaceFields } from '../features/events/EventTimePlaceFields'
import { LocationPicker } from '../features/events/LocationPicker'
import { useEventArtwork } from '../features/events/useEventArtwork'
import { useEventDraft } from '../features/events/useEventDraft'
import { useEventLocation } from '../features/events/useEventLocation'
import { validPoint } from '../ui-utils'
import { AvatarCropper } from '../ui/components/AvatarCropper'
import { Button, Cell, Field, Header, Icon } from '../ui/components/BasicUI'
import './comment-experience.css'
import './details.css'

export function CreateEventScreen({
  city,
  back,
  onCreated,
}: {
  city: string
  back: () => void
  onCreated: (event: Event) => void
}) {
  const [step, setStep] = useState(0)
  const [draft, setField] = useEventDraft(city)
  const {
    title,
    description,
    category,
    start,
    end,
    venue,
    address,
    eventCity,
    latitude,
    longitude,
    price,
    ticketUrl,
  } = draft
  const [categories, setCategories] = useState<string[]>([])
  const [categoryLoadError, setCategoryLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [error, setError] = useState('')
  const artwork = useEventArtwork(busy, setError)
  const { headerArtwork, iconArtwork, artworkCrop, setArtworkCrop, confirmArtworkCrop } = artwork
  const location = useEventLocation(draft, setField, step, setStep, setError)
  const { resolvingAddress, resolveTypedAddress } = location
  useEffect(() => {
    const controller = new AbortController()
    loadEventCategories(controller.signal)
      .then((items) => setCategories(items.map((item) => item.name)))
      .catch(() => {
        if (!controller.signal.aborted) setCategoryLoadError(true)
      })
    return () => controller.abort()
  }, [])
  function locationError() {
    return eventTimeAndPlaceError({
      start,
      end,
      venue,
      city: eventCity,
      address,
      latitude,
      longitude,
      price,
      ticketUrl,
    })
  }
  function previous() {
    if (step === -1) setStep(0)
    else if (step === 10) setStep(1)
    else if (step) setStep(step - 1)
    else back()
  }
  async function next() {
    setError('')
    if (step === 0) {
      const issue = eventBasicsError(title, category, description)
      if (issue) {
        setError(issue)
        return
      }
    }
    if (step === 1) {
      const issue = locationError()
      if (issue) {
        setError(issue)
        return
      }
      if (!(await resolveTypedAddress())) return
    }
    setStep(step + 1)
  }
  async function submit() {
    if (sending.current) return
    const issue = locationError()
    if (issue) {
      setError(issue)
      setStep(1)
      return
    }
    if (!validPoint(latitude, longitude)) {
      setError('Уточните адрес или выберите точку на карте')
      setStep(1)
      return
    }
    let input: CreateEventInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      starts_at: new Date(start).toISOString(),
      ...(end ? { ends_at: new Date(end).toISOString() } : {}),
      location: {
        venue_name: venue.trim() || address.trim().slice(0, 160) || 'Точка на карте',
        address: address.trim(),
        city: eventCity.trim(),
        ...(latitude === undefined ? {} : { latitude }),
        ...(longitude === undefined ? {} : { longitude }),
      },
      ...(price ? { price_min_rubles: Number(price) } : {}),
      ...(ticketUrl.trim() ? { ticket_url: ticketUrl.trim() } : {}),
    }
    const uploadedMediaIDs: number[] = []
    let committed = false
    sending.current = true
    setBusy(true)
    setError('')
    try {
      if (headerArtwork) {
        const source = await uploadEventPhoto(headerArtwork.source)
        uploadedMediaIDs.push(source.id)
        const crop = await uploadEventPhoto(headerArtwork.crop)
        uploadedMediaIDs.push(crop.id)
        input = {
          ...input,
          header_source_media_id: source.id,
          header_media_id: crop.id,
        }
      }
      if (iconArtwork) {
        const source = await uploadEventPhoto(iconArtwork.source)
        uploadedMediaIDs.push(source.id)
        const crop = await uploadEventPhoto(iconArtwork.crop)
        uploadedMediaIDs.push(crop.id)
        input = {
          ...input,
          icon_source_media_id: source.id,
          icon_media_id: crop.id,
        }
      }
      const created = await createEvent(input, operationKey())
      committed = true
      onCreated(created)
    } catch (cause) {
      if (!committed && uploadedMediaIDs.length)
        await Promise.allSettled(uploadedMediaIDs.map(deleteMedia))
      setError(cause instanceof Error ? cause.message : 'Не удалось создать мероприятие')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  if (artworkCrop)
    return (
      <AvatarCropper
        file={artworkCrop.file}
        saving={false}
        onCancel={() => setArtworkCrop(null)}
        onConfirm={confirmArtworkCrop}
        aspectRatio={artworkCrop.kind === 'header' ? 16 / 9 : 1}
        shape={artworkCrop.kind === 'header' ? 'rounded' : 'square'}
        title={artworkCrop.kind === 'header' ? 'Шапка мероприятия' : 'Иконка мероприятия'}
        subtitle={artworkCrop.kind === 'header' ? 'Кадр 16:9' : 'Квадратный кадр 1:1'}
        footerHint={
          artworkCrop.kind === 'header'
            ? 'Эта область будет видна в шапке страницы мероприятия.'
            : 'Эта область будет использоваться как квадратная иконка мероприятия.'
        }
        outputWidth={artworkCrop.kind === 'header' ? 1280 : 512}
        ariaLabel={
          artworkCrop.kind === 'header'
            ? 'Кадрировать шапку мероприятия'
            : 'Кадрировать иконку мероприятия'
        }
      />
    )
  if (step === -1)
    return (
      <>
        <Header title="Категория" back={previous} />
        <div className="screen-scroll event-form event-category-picker">
          {categories.map((item) => (
            <Cell
              key={item}
              icon="calendar"
              title={item}
              trailing={category === item ? <Icon name="check" size={20} /> : undefined}
              onClick={() => {
                setField('category', item)
                setStep(0)
              }}
            />
          ))}
          {categoryLoadError && (
            <p className="error-text">Не удалось загрузить список категорий. Введите свою.</p>
          )}
          <Field label="Своя категория" value={category} onChange={(value) => setField('category', value)} />
        </div>
        <div className="bottom-action event-category-action">
          <Button disabled={!category.trim()} onClick={() => setStep(0)}>
            Готово
          </Button>
        </div>
      </>
    )
  if (step === 10)
    return (
      <LocationPicker
        latitude={latitude}
        longitude={longitude}
        onCancel={previous}
        onSelect={location.selectPoint}
      />
    )
  return (
    <>
      <Header title="Новое мероприятие" back={previous} />
      <div className={'screen-scroll event-form' + (step === 1 ? ' event-form--time-place' : '')}>
        <div className="event-form__intro">
          <span>Шаг {step + 1} из 3</span>
          <div
            className="event-form__progress"
            role="progressbar"
            aria-label="Создание мероприятия"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={step + 1}
          >
            {[0, 1, 2].map((index) => (
              <i key={index} className={index <= step ? 'is-active' : ''} />
            ))}
          </div>
          <h2>
            {step === 0
              ? 'Расскажите о встрече'
              : step === 1
                ? 'Время и место'
                : 'Проверьте мероприятие'}
          </h2>
          <p>
            {step === 0
              ? 'Что ждёт участников?'
              : step === 1
                ? 'Когда и где увидимся?'
                : 'Перед публикацией проверьте детали.'}
          </p>
        </div>
        {step === 0 && <EventBasicsFields draft={draft} setField={setField} setStep={setStep} artwork={artwork} busy={busy} />}
        {step === 1 && <EventTimePlaceFields draft={draft} setField={setField} location={location} />}
        {step === 2 && <EventReview draft={draft} setStep={setStep} artwork={artwork} location={location} />}
      </div>
      <div className="bottom-action event-form__bottom-action">
        {error && <p className="error-text">{error}</p>}
        <Button
          disabled={busy || resolvingAddress}
          onClick={step === 2 ? () => void submit() : () => void next()}
        >
          {busy
            ? 'Создаём…'
            : resolvingAddress
              ? 'Ищем адрес…'
              : step === 0
                ? 'Далее: время и место'
                : step === 1
                  ? 'Далее: проверка'
                  : 'Создать мероприятие'}
        </Button>
      </div>
    </>
  )
}

export default CreateEventScreen
