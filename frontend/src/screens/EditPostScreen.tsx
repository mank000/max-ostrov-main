import { mediaURL } from '../api/credentials'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { deleteMedia, PHOTO_INPUT_ACCEPT, uploadPhoto, uploadVideo } from '../api/media'
import { updatePost, type PostMedia } from '../api/posts'
import { Button, Header, Icon, StatePanel } from '../ui/components/BasicUI'
import type { SocialProps } from './FriendPages'
import './social.css'

export function editPostMediaDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) return 'Видео'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function EditPostScreen({ id, back, data, openMedia }: SocialProps) {
  const post = [...data.posts, ...data.profilePosts].find((item) => item.id === id)
  const [caption, setCaption] = useState(post?.caption || '')
  const [media, setMedia] = useState<PostMedia[]>(post?.media || [])
  const [draggingMedia, setDraggingMedia] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const mediaRef = useRef<PostMedia[]>(post?.media || [])
  const uploadedMediaRef = useRef(new Set<number>())
  const aliveRef = useRef(true)
  const savedRef = useRef(false)
  const suppressMediaClick = useRef(false)
  const dragRef = useRef<{
    mediaId: number
    pointerId: number
    pointerType: string
    element: HTMLDivElement
    startX: number
    startY: number
    active: boolean
  } | null>(null)

  useEffect(
    () => () => {
      aliveRef.current = false
      if (!savedRef.current) {
        for (const mediaId of uploadedMediaRef.current) void deleteMedia(mediaId).catch(() => { })
      }
    },
    [],
  )

  function setOrderedMedia(next: PostMedia[]) {
    mediaRef.current = next
    setMedia(next)
  }

  async function addMedia(files?: FileList | null) {
    if (!files?.length || uploading || saving) return
    const freeSlots = Math.max(0, 10 - mediaRef.current.length)
    if (!freeSlots) {
      setError('К публикации можно прикрепить не больше 10 файлов')
      return
    }

    const selected = Array.from(files)
    const batch = selected.slice(0, freeSlots)
    setError(
      selected.length > freeSlots ? 'Добавлены первые доступные файлы — максимум 10 вложений' : '',
    )
    setUploading(true)

    try {
      for (const file of batch) {
        const video = file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name)
        const uploaded = video ? await uploadVideo(file) : await uploadPhoto(file)
        if (!aliveRef.current) {
          await deleteMedia(uploaded.id).catch(() => { })
          continue
        }
        uploadedMediaRef.current.add(uploaded.id)
        const next = [...mediaRef.current, uploaded]
        setOrderedMedia(next)
      }
    } catch (cause) {
      if (aliveRef.current)
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить медиафайл')
    } finally {
      if (aliveRef.current) setUploading(false)
    }
  }

  function removeMedia(item: PostMedia) {
    if (saving || uploading) return
    setError('')
    setOrderedMedia(mediaRef.current.filter((mediaItem) => mediaItem.id !== item.id))
    if (uploadedMediaRef.current.delete(item.id)) {
      void deleteMedia(item.id).catch((cause) => {
        if (aliveRef.current)
          setError(
            cause instanceof Error ? cause.message : 'Не удалось удалить загруженный медиафайл',
          )
      })
    }
  }

  function startMediaDrag(event: ReactPointerEvent<HTMLDivElement>, mediaId: number) {
    if (saving || uploading || (event.pointerType === 'mouse' && event.button !== 0)) return
    const element = event.currentTarget
    const drag = {
      mediaId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      element,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    dragRef.current = drag
    try {
      element.setPointerCapture(event.pointerId)
    } catch { }
  }

  function moveMediaDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (!drag.active) {
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const threshold = drag.pointerType === 'mouse' ? 3 : 7
      if (Math.hypot(deltaX, deltaY) < threshold) return
      if (drag.pointerType !== 'mouse' && Math.abs(deltaX) <= Math.abs(deltaY)) return
      drag.active = true
      suppressMediaClick.current = true
      setDraggingMedia(drag.mediaId)
    }

    event.preventDefault()
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-edit-media-id]')
    const targetId = Number(target?.dataset.editMediaId || 0)
    if (!targetId || targetId === drag.mediaId) return

    const current = mediaRef.current
    const from = current.findIndex((item) => item.id === drag.mediaId)
    const to = current.findIndex((item) => item.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrderedMedia(next)
  }

  function finishMediaDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      if (drag.element.hasPointerCapture(drag.pointerId))
        drag.element.releasePointerCapture(drag.pointerId)
    } catch { }
    if (!drag.active) return
    setDraggingMedia(null)
    window.requestAnimationFrame(() => {
      suppressMediaClick.current = false
    })
    event.preventDefault()
  }

  function cancelMediaDrag() {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.active) {
      setDraggingMedia(null)
      window.requestAnimationFrame(() => {
        suppressMediaClick.current = false
      })
    }
  }

  async function save() {
    if (!post || saving || uploading || (!caption.trim() && !mediaRef.current.length)) return
    setSaving(true)
    setError('')
    try {
      const updated = await updatePost(post.id, {
        caption: caption.trim(),
        media_ids: mediaRef.current.map((item) => item.id),
      })
      savedRef.current = true
      data.setPosts((current) => current.map((item) => (item.id === post.id ? updated : item)))
      data.setProfilePosts((current) =>
        current.map((item) => (item.id === post.id ? updated : item)),
      )

      const retained = new Set(mediaRef.current.map((item) => item.id))
      const detachedMediaIds = post.media
        .filter((item) => !retained.has(item.id))
        .map((item) => item.id)
      void Promise.allSettled(detachedMediaIds.map(deleteMedia))
      back()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить публикацию')
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }

  return (
    <>
      <Header title="Редактирование" back={back} />
      <div className="screen-scroll">
        {post ? (
          <div className="edit-post">
            <div className="edit-post__copy">
              <label htmlFor="edit-post-caption">Текст</label>
              <textarea
                id="edit-post-caption"
                maxLength={2000}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Текст публикации"
                disabled={saving}
              />
            </div>
            <section className="edit-post__media" aria-label="Медиа публикации">
              <div className="edit-post__media-head">
                <div>
                  <strong>Медиа</strong>
                  <span>
                    {media.length > 1
                      ? 'Удерживайте и перетаскивайте, чтобы изменить порядок'
                      : 'Фото и видео публикации'}
                  </span>
                </div>
                <span>{media.length}/10</span>
              </div>
              <div className="edit-post__media-strip">
                {media.length < 10 && (
                  <label
                    className={`edit-post__add ${uploading ? 'is-busy' : ''}`}
                    aria-label="Добавить фото или видео"
                  >
                    <Icon name="plus" size={24} />
                    <span>{uploading ? 'Загрузка…' : 'Добавить'}</span>
                    <input
                      type="file"
                      accept={`${PHOTO_INPUT_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`}
                      multiple
                      disabled={saving || uploading}
                      onChange={(event) => {
                        const files = event.currentTarget.files
                        event.currentTarget.value = ''
                        void addMedia(files)
                      }}
                    />
                  </label>
                )}
                {media.map((item) => (
                  <div
                    key={item.id}
                    className={`edit-post__media-item ${draggingMedia === item.id ? 'is-dragging' : ''}`}
                    data-edit-media-id={item.id}
                    onPointerDown={(event) => startMediaDrag(event, item.id)}
                    onPointerMove={moveMediaDrag}
                    onPointerUp={finishMediaDrag}
                    onPointerCancel={cancelMediaDrag}
                    onLostPointerCapture={cancelMediaDrag}
                  >
                    <button
                      className="edit-post__preview"
                      type="button"
                      aria-label={
                        item.mime_type.startsWith('video/') ? 'Открыть видео' : 'Открыть фото'
                      }
                      onClick={() => {
                        if (!suppressMediaClick.current) openMedia(item, mediaRef.current)
                      }}
                    >
                      {item.mime_type.startsWith('video/') ? (
                        <>
                          <video
                            src={mediaURL(item.url)}
                            muted
                            playsInline
                            preload="metadata"
                            draggable={false}
                          />
                          <span className="edit-post__video-badge">
                            {editPostMediaDuration(item.duration_ms)}
                          </span>
                        </>
                      ) : (
                        <img src={mediaURL(item.url)} alt="" draggable={false} />
                      )}
                    </button>
                    <button
                      className="edit-post__remove"
                      type="button"
                      aria-label="Удалить медиафайл"
                      disabled={saving || uploading}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeMedia(item)
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <StatePanel title="Публикация не найдена" />
        )}
      </div>
      <div className="bottom-action">
        {error && <p className="error-text">{error}</p>}
        <Button
          onClick={() => void save()}
          disabled={!post || saving || uploading || (!caption.trim() && !media.length)}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </div>
    </>
  )
}
