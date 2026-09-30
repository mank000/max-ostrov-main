import { mediaURL } from '../api/credentials'
import { cityCatalog } from '../city-catalog'
import { useRef, useState } from 'react'
import { operationKey } from '../api/http'
import {
  deleteMedia,
  PHOTO_INPUT_ACCEPT,
  uploadPhoto,
  uploadVideo,
  type MediaAsset,
} from '../api/media'
import { createPost, type Post } from '../api/posts'
import { type UserSearchResult } from '../api/users'
import { cityDisplayName, type CityPin } from '../ui-utils'
import {
  Avatar,
  Button,
  Cell,
  Header,
  Icon,
  IconButton,
  SearchField,
} from '../ui/components/BasicUI'
import { EventRow } from '../ui/components/ContentCards'
import { CheckControl } from '../ui/components/CheckControl'
import type { AppDataResult } from '../useAppData'
import { CityScreen } from './CityScreen'
import { TagPeoplePicker } from './TagPeoplePicker'
import './comment-experience.css'
import './details.css'

export function CreatePostScreen({
  data,
  city,
  back,
  onCreated,
}: {
  data: AppDataResult
  city: string
  back: () => void
  onCreated: (post: Post) => void
}) {
  const requestKey = useRef({ draft: '', key: '' })
  const busy = useRef(false)
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState<Post['visibility']>('city')
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [eventId, setEventId] = useState<number>()
  const [picker, setPicker] = useState<'city' | 'city-list' | 'event' | 'tags' | null>(null)
  const [postCity, setPostCity] = useState(() => city.trim() || data.profile?.city || '')
  const [postCityPin, setPostCityPin] = useState<CityPin | null>(() => {
    const initialCity = city.trim() || data.profile?.city || ''
    if (!initialCity) return null
    const key = cityDisplayName(initialCity).toLocaleLowerCase('ru')
    return (
      cityCatalog.find(
        (item) => cityDisplayName(item.name).toLocaleLowerCase('ru') === key,
      ) ?? null
    )
  })
  const [tagged, setTagged] = useState<UserSearchResult[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  function selectEvent(nextEventId?: number) {
    if (nextEventId !== eventId && tagged.length) {
      setTagged([])
      setError('Мероприятие изменено. Выберите отметки заново среди доступных участников.')
    }
    setEventId(nextEventId)
    setPicker(null)
  }
  async function addMedia(file?: File) {
    if (!file || uploading || publishing) return
    if (media.length >= 10) {
      setError('К публикации можно прикрепить не больше 10 файлов')
      return
    }
    setUploading(true)
    setUploadName(file.name)
    setError('')
    try {
      const video = file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name)
      const uploaded = video ? await uploadVideo(file) : await uploadPhoto(file)
      setMedia((current) => [...current, uploaded])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить медиафайл')
    } finally {
      setUploading(false)
      setUploadName('')
    }
  }
  async function removeMedia(item: MediaAsset) {
    if (uploading || publishing) return
    try {
      await deleteMedia(item.id)
      setMedia((current) => current.filter((media) => media.id !== item.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить медиафайл')
    }
  }
  async function submit() {
    if (busy.current || uploading || publishing || (!caption.trim() && !media.length)) return
    if (!eventId && !postCity.trim()) {
      setError('Выберите город публикации')
      setPicker('city')
      return
    }
    busy.current = true
    setPublishing(true)
    setError('')
    try {
      const input = {
        caption: caption.trim(), city: postCity.trim(), visibility: eventId ? 'event' as const : visibility,
        event_id: eventId, media_ids: media.map((item) => item.id), tagged_user_ids: tagged.map((person) => person.id),
      }
      const draft = JSON.stringify(input)
      if (requestKey.current.draft !== draft) requestKey.current = { draft, key: operationKey() }
      const created = await createPost(input, requestKey.current.key)
      data.setProfilePosts((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ])
      data.refresh('feed', 'profilePosts')
      onCreated(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось опубликовать')
    } finally {
      busy.current = false
      setPublishing(false)
    }
  }
  if (picker === 'city-list')
    return (
      <CityScreen
        back={() => setPicker('city')}
        city={postCity}
        cityPin={postCityPin}
        setCityPin={(value) => {
          if (!value) return
          setPostCity(cityDisplayName(value.name))
          setPostCityPin(value)
          setError('')
        }}
      />
    )
  if (picker === 'city')
    return (
      <>
        <Header title="Город публикации" back={() => setPicker(null)} />
        <div className="screen-scroll create-post__publication-settings">
          {error && <p className="error-text create-post__city-error">{error}</p>}
          <Cell
            icon="pin"
            title={postCity || 'Выберите город'}
            detail={postCity ? 'Выбранный город' : 'Город нужен для публикации'}
            onClick={() => {
              setError('')
              setPicker('city-list')
            }}
          />
          <CheckControl
            className="create-post__friends-control"
            markPosition="end"
            checked={visibility === 'friends'}
            onChange={(checked) => {
              if (checked && !postCity.trim()) {
                setError('Сначала выберите город публикации')
                return
              }
              setVisibility(checked ? 'friends' : 'city')
              setError('')
            }}
            label={
              <>
                <Icon name="users" size={24} className="create-post__friends-icon" />
                <span className="create-post__friends-copy">
                  <strong>Только друзья</strong>
                  <small>
                    {postCity ? 'Публикацию увидят только ваши друзья' : 'Сначала выберите город'}
                  </small>
                </span>
              </>
            }
          />
        </div>
      </>
    )
  if (picker === 'event')
    return (
      <>
        <Header title="Выберите мероприятие" back={() => setPicker(null)} />
        <div className="screen-scroll">
          <div className="extra-pad">
            <SearchField value={tagQuery} onChange={setTagQuery} placeholder="Найти мероприятие" />
          </div>
          <Cell icon="close" title="Без мероприятия" onClick={() => selectEvent()} />
          <h2 className="section-title">Ваши мероприятия</h2>
          {data.profileEvents
            .filter((item) =>
              item.title.toLocaleLowerCase('ru').includes(tagQuery.toLocaleLowerCase('ru')),
            )
            .map((item) => (
              <EventRow key={item.id} event={item} onClick={() => selectEvent(item.id)} />
            ))}
        </div>
      </>
    )
  if (picker === 'tags')
    return (
      <TagPeoplePicker
        eventId={eventId}
        viewerId={data.profile?.id || 0}
        selected={tagged}
        onChange={setTagged}
        onClose={() => setPicker(null)}
      />
    )
  return (
    <>
      <Header title="Новая публикация" back={back} />
      <div className="screen-scroll create-post">
        <div className="create-post__author">
          <Avatar name={data.profile?.display_name || ''} url={data.profile?.photo_url} size={40} />
          <span>
            <strong>{data.profile?.display_name}</strong>
            <small>
              {eventId
                ? `Мероприятие · ${data.profileEvents.find((item) => item.id === eventId)?.title || 'Выбрано'}`
                : `${postCity || 'Город не выбран'} · ${visibility === 'friends' ? 'Для друзей' : 'Для всех'}`}
            </small>
          </span>
        </div>
        <div className="create-post__composer">
          <textarea
            id="new-post-caption"
            aria-label="Текст публикации"
            maxLength={2000}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Что нового?"
          />
          <span>{caption.length}/2000</span>
        </div>
        <div
          className={`create-post__attachments${media.length ? '' : ' create-post__attachments--empty'}`}
        >
          {media.map((item) => (
            <div className="create-post__photo" key={item.id}>
              {item.mime_type.startsWith('video/') ? (
                <>
                  <video src={mediaURL(item.url)} muted playsInline preload="metadata" />
                  <span className="create-post__video-label">Видео · до 5 минут</span>
                </>
              ) : (
                <img src={mediaURL(item.url)} alt="Прикреплённое фото" />
              )}
              <IconButton
                icon="trash"
                label="Удалить медиафайл"
                onClick={() => void removeMedia(item)}
              />
            </div>
          ))}
          {media.length < 10 && (
            <label className="create-post__add">
              <Icon name="photo" size={26} />
              <span>
                <strong>Добавить фото или видео</strong>
                <small>Видео до 5 минут · 100 МБ</small>
              </span>
              <input
                type="file"
                disabled={uploading || publishing}
                accept={`${PHOTO_INPUT_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`}
                onChange={(e) => {
                  void addMedia(e.target.files?.[0])
                  e.currentTarget.value = ''
                }}
              />
            </label>
          )}
        </div>
        {uploading && (
          <p className="create-post__upload-status" role="status">
            <span className="create-post__upload-spinner" />
            <span>Загружаем {uploadName || 'файл'}…</span>
          </p>
        )}
        <div className="create-post__settings">
          <Cell
            icon="pin"
            title="Город публикации"
            detail={
              visibility === 'friends'
                ? `${postCity || 'Город не выбран'} · только друзья`
                : postCity || 'Выберите город'
            }
            onClick={() => setPicker('city')}
          />
          <Cell
            icon="calendar"
            title="Связать с мероприятием"
            detail={
              data.profileEvents.find((item) => item.id === eventId)?.title || 'Необязательно'
            }
            onClick={() => {
              setTagQuery('')
              setPicker('event')
            }}
          />
          <Cell
            icon="users"
            title="Отметить участников"
            detail={tagged.map((person) => person.display_name).join(', ') || 'Необязательно'}
            onClick={() => {
              setTagQuery('')
              setPicker('tags')
            }}
          />
        </div>
        <p className="create-post__hint">
          Если публикация не отправится, текст и вложения останутся здесь — ничего не пропадёт.
        </p>
      </div>
      <div className="bottom-action">
        {error && <p className="error-text">{error}</p>}
        <Button
          disabled={uploading || publishing || (!caption.trim() && !media.length)}
          onClick={() => void submit()}
        >
          {publishing ? 'Публикуем…' : 'Опубликовать'}
        </Button>
      </div>
    </>
  )
}

export default CreatePostScreen
