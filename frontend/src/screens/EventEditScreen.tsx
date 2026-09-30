import { mediaURL } from '../api/credentials'
import { useEffect, useRef, useState } from 'react'
import { updateEvent, type CreateEventInput } from '../api/events'
import { deleteMedia, PHOTO_INPUT_ACCEPT, preparePhotoFile, uploadEventPhoto } from '../api/media'
import { eventTicketURLIssue } from '../event-form'
import { AvatarCropper } from '../ui/components/AvatarCropper'
import { Button, Field, Header, Icon, StatePanel } from '../ui/components/BasicUI'
import { EventCategoryArtwork } from '../ui/components/ContentCards'
import type { ScreenProps } from './screen-types'
import { useEvent } from './useEvent'

export function localDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export type EventEditCropTarget =
  | { kind: 'header' | 'icon'; file: File; sourceMediaID?: undefined }
  | { kind: 'header' | 'icon'; src: string; sourceMediaID: number }

export function EventEdit({ route, back, onError, data, onEventUpdated }: ScreenProps) {
  const { event, error } = useEvent(route.id, data)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [venue, setVenue] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [price, setPrice] = useState('')
  const [ticketUrl, setTicketUrl] = useState('')
  const [headerSourceMediaID, setHeaderSourceMediaID] = useState<number>()
  const [headerMediaID, setHeaderMediaID] = useState<number>()
  const [iconSourceMediaID, setIconSourceMediaID] = useState<number>()
  const [iconMediaID, setIconMediaID] = useState<number>()
  const [cropTarget, setCropTarget] = useState<EventEditCropTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const uploadedArtworkIDs = useRef(new Set<number>())
  const replacedArtworkIDs = useRef(new Set<number>())

  useEffect(() => {
    if (!event) return
    setTitle(event.title)
    setDescription(event.description)
    setCategory(event.category)
    setStart(localDateTime(event.starts_at))
    setEnd(localDateTime(event.ends_at))
    setVenue(event.location.venue_name)
    setAddress(event.location.address)
    setCity(event.location.city)
    setPrice(event.price_min_rubles ? String(event.price_min_rubles) : '')
    setTicketUrl(event.ticket_url || '')
    setHeaderSourceMediaID(event.header_source_media_id)
    setHeaderMediaID(event.header_media_id)
    setIconSourceMediaID(event.icon_source_media_id)
    setIconMediaID(event.icon_media_id)
  }, [event])

  useEffect(
    () => () => {
      for (const mediaID of uploadedArtworkIDs.current) void deleteMedia(mediaID).catch(() => { })
    },
    [],
  )

  async function chooseArtwork(kind: 'header' | 'icon', file?: File) {
    if (!file || busy) return
    setBusy(true)
    try {
      const prepared = await preparePhotoFile(file)
      setCropTarget({ kind, file: prepared })
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Не удалось подготовить изображение')
    } finally {
      setBusy(false)
    }
  }

  function recropArtwork(kind: 'header' | 'icon') {
    const sourceMediaID = kind === 'header' ? headerSourceMediaID : iconSourceMediaID
    if (!sourceMediaID || busy) return
    setCropTarget({
      kind,
      src: `/api/v1/media/${sourceMediaID}/content`,
      sourceMediaID,
    })
  }

  async function saveArtworkCrop(cropFile: File) {
    const target = cropTarget
    if (!target || busy) return
    setBusy(true)
    let newSourceMediaID = target.sourceMediaID
    let uploadedSourceMediaID = 0
    try {
      if ('file' in target) {
        const source = await uploadEventPhoto(target.file)
        newSourceMediaID = source.id
        uploadedSourceMediaID = source.id
        uploadedArtworkIDs.current.add(source.id)
      }
      const crop = await uploadEventPhoto(cropFile)
      uploadedArtworkIDs.current.add(crop.id)

      if (target.kind === 'header') {
        if (
          headerSourceMediaID &&
          headerSourceMediaID !== newSourceMediaID &&
          !uploadedArtworkIDs.current.has(headerSourceMediaID)
        )
          replacedArtworkIDs.current.add(headerSourceMediaID)
        if (
          headerMediaID &&
          headerMediaID !== crop.id &&
          !uploadedArtworkIDs.current.has(headerMediaID)
        )
          replacedArtworkIDs.current.add(headerMediaID)
        setHeaderSourceMediaID(newSourceMediaID)
        setHeaderMediaID(crop.id)
      } else {
        if (
          iconSourceMediaID &&
          iconSourceMediaID !== newSourceMediaID &&
          !uploadedArtworkIDs.current.has(iconSourceMediaID)
        )
          replacedArtworkIDs.current.add(iconSourceMediaID)
        if (iconMediaID && iconMediaID !== crop.id && !uploadedArtworkIDs.current.has(iconMediaID))
          replacedArtworkIDs.current.add(iconMediaID)
        setIconSourceMediaID(newSourceMediaID)
        setIconMediaID(crop.id)
      }
      setCropTarget(null)
    } catch (cause) {
      if (uploadedSourceMediaID) {
        uploadedArtworkIDs.current.delete(uploadedSourceMediaID)
        await deleteMedia(uploadedSourceMediaID).catch(() => { })
      }
      onError(cause instanceof Error ? cause.message : 'Не удалось сохранить кадрирование')
    } finally {
      setBusy(false)
    }
  }

  function removeArtwork(kind: 'header' | 'icon') {
    const sourceMediaID = kind === 'header' ? headerSourceMediaID : iconSourceMediaID
    const mediaID = kind === 'header' ? headerMediaID : iconMediaID
    if (sourceMediaID && !uploadedArtworkIDs.current.has(sourceMediaID))
      replacedArtworkIDs.current.add(sourceMediaID)
    if (mediaID && !uploadedArtworkIDs.current.has(mediaID)) replacedArtworkIDs.current.add(mediaID)
    if (kind === 'header') {
      setHeaderSourceMediaID(undefined)
      setHeaderMediaID(undefined)
    } else {
      setIconSourceMediaID(undefined)
      setIconMediaID(undefined)
    }
  }

  async function save() {
    if (!event || busy) return
    if (
      !title.trim() ||
      !description.trim() ||
      !category.trim() ||
      !start ||
      !venue.trim() ||
      !city.trim()
    ) {
      onError('Заполните обязательные поля')
      return
    }
    const ticketIssue = eventTicketURLIssue(ticketUrl)
    if (ticketIssue) {
      onError(ticketIssue)
      return
    }
    const input: CreateEventInput = {
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      starts_at: new Date(start).toISOString(),
      ends_at: end ? new Date(end).toISOString() : undefined,
      location: {
        ...event.location,
        venue_name: venue.trim(),
        address: address.trim(),
        city: city.trim(),
      },
      price_min_rubles: price ? Number(price) : undefined,
      ticket_url: ticketUrl.trim() || undefined,
      header_source_media_id: headerSourceMediaID,
      header_media_id: headerMediaID,
      icon_source_media_id: iconSourceMediaID,
      icon_media_id: iconMediaID,
    }
    setBusy(true)
    try {
      const updated = await updateEvent(event.id, input)
      onEventUpdated(updated)

      const keep = new Set(
        [headerSourceMediaID, headerMediaID, iconSourceMediaID, iconMediaID].filter(
          (value): value is number => Boolean(value),
        ),
      )
      const cleanup = new Set<number>(replacedArtworkIDs.current)
      for (const mediaID of uploadedArtworkIDs.current) if (!keep.has(mediaID)) cleanup.add(mediaID)

      uploadedArtworkIDs.current.clear()
      replacedArtworkIDs.current.clear()
      await Promise.allSettled(
        [...cleanup].filter((mediaID) => !keep.has(mediaID)).map(deleteMedia),
      )
      back()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Не удалось сохранить мероприятие')
    } finally {
      setBusy(false)
    }
  }

  if (cropTarget)
    return (
      <AvatarCropper
        file={'file' in cropTarget ? cropTarget.file : undefined}
        src={'src' in cropTarget ? cropTarget.src : undefined}
        saving={busy}
        onCancel={() => setCropTarget(null)}
        onConfirm={saveArtworkCrop}
        aspectRatio={cropTarget.kind === 'header' ? 16 / 9 : 1}
        shape={cropTarget.kind === 'header' ? 'rounded' : 'square'}
        title={cropTarget.kind === 'header' ? 'Шапка мероприятия' : 'Иконка мероприятия'}
        subtitle={cropTarget.kind === 'header' ? 'Кадр 16:9' : 'Квадратный кадр 1:1'}
        outputWidth={cropTarget.kind === 'header' ? 1280 : 512}
      />
    )

  const headerURL = headerMediaID ? `/api/v1/media/${headerMediaID}/content` : ''
  const iconURL = iconMediaID ? `/api/v1/media/${iconMediaID}/content` : ''

  return (
    <>
      <Header title="Редактировать мероприятие" back={back} />
      <div className="screen-scroll extra-pad">
        {event ? (
          <>
            <section className="event-edit-artwork" aria-label="Оформление мероприятия">
              <div className="event-artwork-editor__head">
                <strong>Оформление</strong>
                <span>Шапка необязательна. Без иконки используется квадрат категории.</span>
              </div>
              <div className="event-edit-artwork__row">
                <div className="event-edit-artwork__preview event-edit-artwork__preview--header">
                  {headerURL ? (
                    <img src={mediaURL(headerURL)} alt="" />
                  ) : (
                    <span>
                      <Icon name="photo" size={24} />
                      Без шапки
                    </span>
                  )}
                </div>
                <div className="event-edit-artwork__actions">
                  <label>
                    <Icon name="photo" size={17} />
                    {headerURL ? 'Заменить шапку' : 'Добавить шапку'}
                    <input
                      type="file"
                      accept={PHOTO_INPUT_ACCEPT}
                      disabled={busy}
                      onChange={(input) => {
                        const file = input.target.files?.[0]
                        input.target.value = ''
                        void chooseArtwork('header', file)
                      }}
                    />
                  </label>
                  {headerSourceMediaID && (
                    <button type="button" onClick={() => recropArtwork('header')} disabled={busy}>
                      <Icon name="edit" size={17} />
                      Кадрировать
                    </button>
                  )}
                  {headerURL && (
                    <button
                      className="is-destructive"
                      type="button"
                      onClick={() => removeArtwork('header')}
                      disabled={busy}
                    >
                      <Icon name="trash" size={17} />
                      Убрать
                    </button>
                  )}
                </div>
              </div>
              <div className="event-edit-artwork__row">
                <div className="event-edit-artwork__preview event-edit-artwork__preview--icon">
                  {iconURL ? (
                    <img src={mediaURL(iconURL)} alt="" />
                  ) : (
                    <EventCategoryArtwork
                      event={{
                        category: category || event.category,
                        title: title || event.title,
                      }}
                      className="event-edit-artwork__category"
                      size={26}
                    />
                  )}
                </div>
                <div className="event-edit-artwork__actions">
                  <label>
                    <Icon name="photo" size={17} />
                    {iconURL ? 'Заменить иконку' : 'Добавить иконку'}
                    <input
                      type="file"
                      accept={PHOTO_INPUT_ACCEPT}
                      disabled={busy}
                      onChange={(input) => {
                        const file = input.target.files?.[0]
                        input.target.value = ''
                        void chooseArtwork('icon', file)
                      }}
                    />
                  </label>
                  {iconSourceMediaID && (
                    <button type="button" onClick={() => recropArtwork('icon')} disabled={busy}>
                      <Icon name="edit" size={17} />
                      Кадрировать
                    </button>
                  )}
                  {iconURL && (
                    <button
                      className="is-destructive"
                      type="button"
                      onClick={() => removeArtwork('icon')}
                      disabled={busy}
                    >
                      <Icon name="trash" size={17} />
                      Убрать
                    </button>
                  )}
                </div>
              </div>
            </section>
            <Field label="Название" value={title} onChange={setTitle} />
            <Field label="Категория" value={category} onChange={setCategory} />
            <Field label="Описание" value={description} onChange={setDescription} multiline />
            <Field label="Начало" value={start} onChange={setStart} type="datetime-local" />
            <Field label="Окончание" value={end} onChange={setEnd} type="datetime-local" min={start || undefined} clearable />
            <Field label="Место" value={venue} onChange={setVenue} />
            <Field label="Адрес" value={address} onChange={setAddress} />
            <Field label="Город" value={city} onChange={setCity} />
            <Field label="Цена от, ₽" value={price} onChange={setPrice} type="number" />
            <Field label="Ссылка на билеты" value={ticketUrl} onChange={setTicketUrl} />
          </>
        ) : (
          <StatePanel
            title={error ? 'Не удалось загрузить' : ''}
            description={error}
            loading={!error}
          />
        )}
      </div>
      {event && (
        <div className="bottom-action">
          <Button
            disabled={busy || !title.trim() || !description.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      )}
    </>
  )
}
