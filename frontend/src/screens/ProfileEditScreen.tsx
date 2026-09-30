import { SelectField } from '../ui/components/SelectField'
import { mediaURL } from '../api/credentials'
import { useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  deleteMedia,
  PHOTO_INPUT_ACCEPT,
  preparePhotoFile,
  uploadAvatar,
  uploadProfilePhoto,
} from '../api/media'
import {
  addProfileAvatar,
  removeProfileAvatarById,
  reorderProfileAvatars,
  setProfileAvatarCrop,
  updateProfile,
  type Profile,
  type ProfileAvatar,
} from '../api/users'
import { AvatarCropper, createCenteredAvatarCrop } from '../ui/components/AvatarCropper'
import { DateField } from '../ui/components/DateField'
import { profileBirthDateRange, profileBirthDateValid } from '../profileBirthDate'
import { Avatar, Button, Field, Header, Icon } from '../ui/components/BasicUI'
import './comment-experience.css'
import './details.css'

type ProfileAvatarCropTarget =
  | { kind: 'new'; file: File }
  | {
    kind: 'existing'
    sourceMediaId: number
    sourceURL: string
    previousCropMediaId?: number
  }

export function ProfileEditScreen({
  profile,
  back,
  onSaved,
  photosOnly = false,
}: {
  profile: Profile
  photosOnly?: boolean
  back: () => void
  onSaved: (profile: Profile) => void
}) {
  const [name, setName] = useState(profile.display_name)
  const [username, setUsername] = useState(profile.username ? `@${profile.username}` : '')
  const [city, setCity] = useState(profile.city)
  const [gender, setGender] = useState<'man' | 'woman' | ''>(profile.gender || '')
  const [bio, setBio] = useState(profile.bio)
  const [birthDate, setBirthDate] = useState(profile.birth_date || '')
  const birthDateChanged = birthDate !== (profile.birth_date || '')
  const birthDateInvalid = birthDateChanged && Boolean(birthDate) && !profileBirthDateValid(birthDate)
  const birthDateRange = profileBirthDateRange()
  const [avatar, setAvatar] = useState(profile.photo_url)
  const [primaryCropMediaID, setPrimaryCropMediaID] = useState(profile.avatar_media_id)
  const [avatars, setAvatars] = useState<ProfileAvatar[]>(profile.avatars || [])
  const [cropTarget, setCropTarget] = useState<ProfileAvatarCropTarget | null>(null)
  const [draggingAvatar, setDraggingAvatar] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const avatarsRef = useRef<ProfileAvatar[]>(profile.avatars || [])
  const syncedAvatarsRef = useRef<ProfileAvatar[]>(profile.avatars || [])
  const syncedAvatarRef = useRef(profile.photo_url)
  const dragRef = useRef<{
    mediaId: number
    pointerId: number
    element: HTMLDivElement
    timer: number
    active: boolean
  } | null>(null)
  const suppressAvatarClick = useRef(false)
  const primarySource = avatars.find((item) => item.is_primary)

  function applyProfile(updated: Profile) {
    const nextAvatars = updated.avatars || []
    setAvatar(updated.photo_url)
    syncedAvatarRef.current = updated.photo_url
    setPrimaryCropMediaID(updated.avatar_media_id)
    setAvatars(nextAvatars)
    avatarsRef.current = nextAvatars
    syncedAvatarsRef.current = nextAvatars
    onSaved(updated)
  }

  function openCrop(target: ProfileAvatarCropTarget) {
    if (busy) return
    setError('')
    setCropTarget(target)
  }

  async function addAvatarPhoto(file?: File) {
    if (!file || busy) return
    setError('')
    let prepared: File
    try {
      prepared = await preparePhotoFile(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось обработать фотографию')
      return
    }
    if (!primaryCropMediaID) {
      openCrop({ kind: 'new', file: prepared })
      return
    }

    setBusy(true)
    let sourceMediaID = 0
    let linked = false
    try {
      const source = await uploadProfilePhoto(prepared)
      sourceMediaID = source.id
      applyProfile(await addProfileAvatar(source.id))
      linked = true
    } catch (cause) {
      if (sourceMediaID && !linked) await deleteMedia(sourceMediaID).catch(() => { })
      setError(cause instanceof Error ? cause.message : 'Не удалось добавить фотографию')
    } finally {
      setBusy(false)
    }
  }

  async function saveCrop(cropFile: File) {
    const target = cropTarget
    if (!target || busy) return
    setBusy(true)
    setError('')
    let sourceMediaID = target.kind === 'existing' ? target.sourceMediaId : 0
    let cropMediaID = 0
    let committed = false
    try {
      if (target.kind === 'new') {
        const source = await uploadProfilePhoto(target.file)
        sourceMediaID = source.id
      }
      const crop = await uploadAvatar(cropFile)
      cropMediaID = crop.id
      const updated = await setProfileAvatarCrop(sourceMediaID, cropMediaID)
      committed = true
      applyProfile(updated)
      setCropTarget(null)

      if (
        target.kind === 'existing' &&
        target.previousCropMediaId &&
        target.previousCropMediaId !== target.sourceMediaId &&
        target.previousCropMediaId !== crop.id
      ) {
        void deleteMedia(target.previousCropMediaId).catch(() => { })
      }
    } catch (cause) {
      if (!committed) {
        await Promise.allSettled([
          cropMediaID ? deleteMedia(cropMediaID) : Promise.resolve(),
          target.kind === 'new' && sourceMediaID ? deleteMedia(sourceMediaID) : Promise.resolve(),
        ])
      }
      throw cause instanceof Error ? cause : new Error('Не удалось сохранить кадрирование')
    } finally {
      setBusy(false)
    }
  }

  async function commitPrimary(item: ProfileAvatar) {
    if (busy || item.is_primary) return
    setBusy(true)
    setError('')
    let generatedCropMediaID = 0
    let committed = false
    try {
      let cropMediaID = item.crop_media_id
      if (!cropMediaID) {
        const cropFile = await createCenteredAvatarCrop(item.url, `profile-${item.media_id}.jpg`)
        const crop = await uploadAvatar(cropFile)
        generatedCropMediaID = crop.id
        cropMediaID = crop.id
      }
      applyProfile(await setProfileAvatarCrop(item.media_id, cropMediaID))
      committed = true
    } catch (cause) {
      setAvatar(syncedAvatarRef.current)
      setAvatars(syncedAvatarsRef.current)
      avatarsRef.current = syncedAvatarsRef.current
      setError(cause instanceof Error ? cause.message : 'Не удалось выбрать основную фотографию')
    } finally {
      if (generatedCropMediaID && !committed) void deleteMedia(generatedCropMediaID).catch(() => { })
      setBusy(false)
    }
  }

  async function makePrimary(item: ProfileAvatar) {
    if (busy || suppressAvatarClick.current || item.is_primary) return
    setAvatar(item.crop_url || item.url)
    await commitPrimary(item)
  }

  function editPrimaryCrop() {
    if (!primarySource || busy) return
    openCrop({
      kind: 'existing',
      sourceMediaId: primarySource.media_id,
      sourceURL: primarySource.url,
      previousCropMediaId: primarySource.crop_media_id,
    })
  }

  async function deleteAvatar(item: ProfileAvatar) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      applyProfile(await removeProfileAvatarById(item.media_id))
      const mediaIDs = [
        ...new Set(
          [item.media_id, item.crop_media_id].filter((value): value is number => Boolean(value)),
        ),
      ]
      await Promise.allSettled(mediaIDs.map(deleteMedia))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить фотографию')
    } finally {
      setBusy(false)
    }
  }

  function startAvatarDrag(event: ReactPointerEvent<HTMLDivElement>, mediaId: number) {
    if (busy || event.button !== 0) return
    const element = event.currentTarget
    const pointerId = event.pointerId
    const drag = {
      mediaId,
      pointerId,
      element,
      active: false,
      timer: window.setTimeout(() => {
        drag.active = true
        suppressAvatarClick.current = true
        setDraggingAvatar(mediaId)
        try {
          element.setPointerCapture(pointerId)
        } catch { }
      }, 320),
    }
    dragRef.current = drag
  }

  function moveAvatarDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag?.active) return
    event.preventDefault()
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-avatar-id]')
    const targetId = Number(target?.dataset.avatarId || 0)
    if (!targetId || targetId === drag.mediaId) return
    setAvatars((current) => {
      const from = current.findIndex((item) => item.media_id === drag.mediaId)
      const to = current.findIndex((item) => item.media_id === targetId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      const positioned = next.map((item, index) => ({
        ...item,
        position: index,
      }))
      avatarsRef.current = positioned
      return positioned
    })
  }

  function finishAvatarDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    window.clearTimeout(drag.timer)
    dragRef.current = null
    if (!drag.active) return
    try {
      drag.element.releasePointerCapture(drag.pointerId)
    } catch { }
    setDraggingAvatar(null)
    const orderedAvatars = avatarsRef.current
    const intendedPrimary = orderedAvatars[0]
    if (intendedPrimary && !intendedPrimary.is_primary)
      setAvatar(intendedPrimary.crop_url || intendedPrimary.url)
    if (intendedPrimary && !intendedPrimary.is_primary && !intendedPrimary.crop_media_id) {
      window.setTimeout(() => {
        suppressAvatarClick.current = false
      }, 0)
      void commitPrimary(intendedPrimary)
      event.preventDefault()
      return
    }
    const order = orderedAvatars.map((item) => item.media_id)
    setBusy(true)
    setError('')
    void reorderProfileAvatars(order)
      .then(applyProfile)
      .catch((cause) => {
        setAvatar(syncedAvatarRef.current)
        setAvatars(syncedAvatarsRef.current)
        avatarsRef.current = syncedAvatarsRef.current
        setError(cause instanceof Error ? cause.message : 'Не удалось изменить порядок фотографий')
      })
      .finally(() => {
        setBusy(false)
        window.setTimeout(() => {
          suppressAvatarClick.current = false
        }, 0)
      })
    event.preventDefault()
  }

  function cancelAvatarDrag() {
    const drag = dragRef.current
    if (!drag) return
    window.clearTimeout(drag.timer)
    dragRef.current = null
    if (drag.active) {
      setDraggingAvatar(null)
      window.setTimeout(() => {
        suppressAvatarClick.current = false
      }, 0)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy || birthDateInvalid) return
    const nextUsername = username.replace(/^@/, '').trim()
    if (profile.username && !nextUsername) {
      setError('Укажите имя пользователя')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateProfile({
        display_name: name.trim(),
        username: nextUsername && nextUsername !== profile.username ? nextUsername : undefined,
        city: city.trim(),
        gender: gender || undefined,
        bio: bio.trim(),
        birth_date: birthDateChanged && birthDate ? birthDate : undefined,
        participant_visibility: profile.participant_visibility || 'participants',
      })
      applyProfile(updated)
      back()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить профиль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title={photosOnly ? "Фотографии профиля" : "Редактировать профиль"} back={back} />
      <form className="detail-form profile-edit-form" data-photos-only={photosOnly || undefined} onSubmit={save}>
        <div className="screen-scroll profile-edit-layout">
          <div className="profile-edit-photos">
          <div className="profile-edit-avatar">
            <div className="profile-edit-avatar__frame">
              <Avatar name={name} url={avatar} size={88} />
              {primarySource && (
                <button
                  className="profile-edit-avatar__edit"
                  type="button"
                  aria-label="Изменить кадрирование основной фотографии"
                  disabled={busy}
                  onClick={editPrimaryCrop}
                >
                  <Icon name="edit" size={17} />
                </button>
              )}
            </div>
            <span>{avatars.length > 1 ? `${avatars.length} фото профиля` : 'Фото профиля'}</span>
          </div>
          <section className="profile-avatar-manager" aria-label="Фотографии профиля">
            <div className="profile-avatar-manager__head">
              <strong>Фотографии профиля</strong>
              <span>
                Зажми фото и перетащи его. Первое фото станет основным, а круглый кадр
                можно поправить карандашом.
              </span>
            </div>
            <div className="profile-avatar-manager__grid">
              {avatars.map((item) => (
                <div
                  key={item.media_id}
                  className={`profile-avatar-card ${item.is_primary ? 'is-primary' : ''} ${draggingAvatar === item.media_id ? 'is-dragging' : ''}`}
                  data-avatar-id={item.media_id}
                  onPointerDown={(event) => startAvatarDrag(event, item.media_id)}
                  onPointerMove={moveAvatarDrag}
                  onPointerUp={finishAvatarDrag}
                  onPointerCancel={cancelAvatarDrag}
                >
                  <button
                    className="profile-avatar-card__photo"
                    type="button"
                    onClick={() => void makePrimary(item)}
                    aria-label={
                      item.is_primary ? 'Основная фотография' : 'Сделать основной фотографией'
                    }
                  >
                    <img
                      src={mediaURL(item.is_primary && item.crop_url ? item.crop_url : item.url)}
                      alt=""
                      draggable={false}
                    />
                    {item.is_primary && <span>Основная</span>}
                  </button>
                  <button
                    className="profile-avatar-card__delete"
                    type="button"
                    aria-label="Удалить фотографию"
                    disabled={busy}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteAvatar(item)
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
              <label className="profile-avatar-add">
                <Icon name="plus" size={24} />
                <span>Добавить</span>
                <input
                  type="file"
                  accept={PHOTO_INPUT_ACCEPT}
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void addAvatarPhoto(file)
                  }}
                />
              </label>
            </div>
            {!primaryCropMediaID ? (
              <p className="profile-avatar-manager__hint">
                Добавь первое фото — сразу выберем, как оно будет выглядеть в круглой
                аватарке.
              </p>
            ) : (
              <p className="profile-avatar-manager__hint">
                Новое фото добавится целиком. Перетащишь его на первое место — аватарка
                появится сама, а карандашом можно поправить кадр.
              </p>
            )}
          </section>
          </div>
          {!photosOnly && <section className="profile-edit-fields" aria-label="Личные данные">
          <h2>Личные данные</h2>
          <Field label="Имя" value={name} onChange={setName} />
          <Field label="Имя пользователя" value={username} onChange={setUsername} />
          <Field label="Город" value={city} onChange={setCity} />
          <SelectField label="Пол" value={gender} onChange={value => setGender(value as 'man' | 'woman' | '')}
            options={[{ value: '', label: 'Не указан' }, { value: 'man', label: 'Мужчина' }, { value: 'woman', label: 'Женщина' }]} />
          <DateField label="Дата рождения" value={birthDate} onChange={setBirthDate}
            min={birthDateRange.min} max={birthDateRange.max} clearable={!profile.birth_date && Boolean(birthDate)} requireSelection />
          {birthDateInvalid && <p className="error-text">Возраст должен быть от 13 до 100 лет. Выберите другую дату рождения.</p>}
          <Field label="О себе" value={bio} onChange={setBio} multiline />
          </section>}
        </div>
        <div className="bottom-action">
          {error && <p className="error-text">{error}</p>}
          <Button type={photosOnly ? "button" : "submit"} onClick={photosOnly ? back : undefined} disabled={busy || !name.trim() || birthDateInvalid}>
            {busy ? 'Сохраняем…' : photosOnly ? 'Готово' : 'Сохранить'}
          </Button>
        </div>
      </form>
      {cropTarget && (
        <AvatarCropper
          file={cropTarget.kind === 'new' ? cropTarget.file : undefined}
          src={cropTarget.kind === 'existing' ? cropTarget.sourceURL : undefined}
          filename={
            cropTarget.kind === 'existing' ? `profile-${cropTarget.sourceMediaId}.jpg` : undefined
          }
          saving={busy}
          onCancel={() => {
            if (busy) return
            setCropTarget(null)
            setAvatars(syncedAvatarsRef.current)
            avatarsRef.current = syncedAvatarsRef.current
          }}
          onConfirm={saveCrop}
        />
      )}
    </>
  )
}

export default ProfileEditScreen
