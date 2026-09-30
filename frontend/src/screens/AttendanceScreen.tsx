import { mediaURL } from '../api/credentials'
import { useEffect, useState } from 'react'
import { loadAttendance, submitAttendance, type AttendanceConfirmation } from '../api/attendance'
import { deleteMedia, PHOTO_INPUT_ACCEPT, uploadAttendancePhoto, type MediaAsset } from '../api/media'
import { Button, Cell, Header, Icon, StatePanel } from '../ui/components/BasicUI'
import type { ScreenProps } from './screen-types'
import { useEvent } from './useEvent'

export function AttendanceScreen({ route, back, onError, data }: ScreenProps) {
  const { event } = useEvent(route.id, data)
  const [value, setValue] = useState<AttendanceConfirmation | null>(null)
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [photos, setPhotos] = useState<MediaAsset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!route.id) return
    const controller = new AbortController()
    loadAttendance(route.id, controller.signal)
      .then(setValue)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [route.id])
  function locate() {
    if (!navigator.geolocation) {
      onError('Геопозиция недоступна')
      return
    }
    navigator.geolocation.getCurrentPosition(setPosition, (cause) => onError(cause.message), {
      timeout: 8000,
    })
  }
  async function addPhoto(file?: File) {
    if (!file || photos.length >= 5) return
    setBusy(true)
    try {
      const uploaded = await uploadAttendancePhoto(file)
      setPhotos((current) => [...current, uploaded])
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  async function removePhoto(item: MediaAsset) {
    try {
      await deleteMedia(item.id)
      setPhotos((current) => current.filter((value) => value.id !== item.id))
    } catch (cause) {
      onError(String(cause))
    }
  }
  async function send() {
    if (!route.id || busy) return
    setBusy(true)
    try {
      setValue(
        await submitAttendance(route.id, {
          latitude: position?.coords.latitude,
          longitude: position?.coords.longitude,
          media_ids: photos.map((item) => item.id),
        }),
      )
    } catch (cause) {
      onError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Header title="Подтверждение посещения" back={back} />
      <div className="screen-scroll">
        {error && <StatePanel title="Не удалось загрузить" description={error} />}
        {value ? (
          <div className="extra-status">
            <Icon name={value.status === 'confirmed' ? 'check' : 'time'} size={40} />
            <h2>
              {value.status === 'confirmed'
                ? 'Посещение подтверждено'
                : value.status === 'rejected'
                  ? 'Посещение не подтверждено'
                  : 'Ожидает проверки'}
            </h2>
            <p>{event?.title}</p>
          </div>
        ) : (
          <>
            <h2 className="section-title">{event?.title || 'Мероприятие'}</h2>
            <div className="attendance-notice">Подтвердите посещение на месте встречи.</div>
            <Cell
              icon="location"
              title={position ? 'Геопозиция добавлена' : 'Добавить геопозицию'}
              detail="Одноразовая проверка расстояния"
              onClick={locate}
            />
            <Cell
              icon="camera"
              title={photos.length ? `Фотографии · ${photos.length}` : 'Добавить фотографии'}
              detail="До 5 фото, JPEG, PNG, HEIC/HEIF"
              onClick={() => document.getElementById('attendance-photo-input')?.click()}
            />
            <input
              id="attendance-photo-input"
              hidden
              type="file"
              accept={PHOTO_INPUT_ACCEPT}
              onChange={(event) => void addPhoto(event.target.files?.[0])}
            />
            {photos.length > 0 && (
              <div className="attendance-photos">
                {photos.map((item) => (
                  <button key={item.id} type="button" onClick={() => void removePhoto(item)}>
                    <img src={mediaURL(item.url)} alt="Доказательство посещения" />
                    <Icon name="close" size={18} />
                  </button>
                ))}
              </div>
            )}
            <p className="attendance-explainer">
              Доказательства получит организатор. Посещение и награда появятся после его решения.
              Точные координаты сервер не сохраняет.
            </p>
          </>
        )}
      </div>
      {!value && (
        <div className="bottom-action">
          <Button disabled={busy || (!position && !photos.length)} onClick={() => void send()}>
            {busy ? 'Отправляем…' : 'Отправить подтверждение'}
          </Button>
        </div>
      )}
    </>
  )
}
