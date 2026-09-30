import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPost } from '../api/posts'
import { ApiError, operationKey } from '../api/http'
import { deleteMedia, type MediaAsset } from '../api/media'
import { uploadClip, type Clip } from '../api/clips'
import { Sheet as ClipSheet } from '../ui/components/Sheet'
import { Icon } from '../ui/components/BasicUI'
import { clock, exportClip, inspectFile, type EditSettings } from './media'

export function ClipEditor({
  backRequest,
  file,
  city,
  onClose,
  onPublished,
}: {
  backRequest: RefObject<(() => void) | null>
  file: File
  city: string
  onClose: () => void
  onPublished: (clip: Clip) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [playing, setPlaying] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const uploaded = useRef<MediaAsset | null>(null)
  const prepared = useRef<File | null>(null)
  const serverEncoding = useRef(false)
  const key = useRef(operationKey())
  const [source, setSource] = useState('')
  const [duration, setDuration] = useState(0)
  const [edit, setEdit] = useState<EditSettings>({
    start: 0,
    end: 0,
    cover: 0,
    muted: false,
    rotation: 0,
    portrait: false,
  })
  const [caption, setCaption] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'edit' | 'export' | 'upload' | 'publish'>(
    'edit',
  )
  const [progress, setProgress] = useState(0)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [discard, setDiscard] = useState(false)
  const [locked, setLocked] = useState(false)
  const busy = phase !== 'edit'

  useEffect(() => {
    dialog.current?.showModal()
    return () => dialog.current?.close()
  }, [])
  useEffect(() => {
    backRequest.current = () => {
      if (phase !== 'publish') setDiscard(true)
    }
    return () => {
      backRequest.current = null
    }
  }, [backRequest, phase])
  useEffect(() => {
    let cancelled = false
    const url = URL.createObjectURL(file)
    setSource(url)
    inspectFile(file)
      .then((metadata) => {
        if (!cancelled) {
          setDuration(metadata.duration)
          setEdit((value) => ({
            ...value,
            end: Math.min(180, metadata.duration),
          }))
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Не удалось открыть видео',
          )
      })
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
      controller.current?.abort()
    }
  }, [file])
  useEffect(() => {
    if (!source || !duration) return
    let cancelled = false
    const preview = document.createElement('video')
    preview.muted = true
    preview.playsInline = true
    preview.preload = 'auto'
    const canvas = document.createElement('canvas')
    canvas.width = 56
    canvas.height = 72
    const frames: string[] = []
    let timer = 0
    const cleanup = () => {
      clearTimeout(timer)
      preview.onseeked = null
      preview.onloadeddata = null
      preview.onerror = null
      preview.removeAttribute('src')
      preview.load()
    }
    const next = () => {
      if (cancelled) return
      try {
        canvas.getContext('2d')?.drawImage(preview, 0, 0, 56, 72)
        frames.push(canvas.toDataURL('image/jpeg', 0.5))
      } catch {
        cleanup()
        return
      }
      setThumbnails([...frames])
      if (frames.length < 8)
        preview.currentTime = Math.min(
          duration - 0.05,
          (duration * frames.length) / 8,
        )
      else cleanup()
    }
    preview.onloadeddata = next
    preview.onseeked = next
    preview.onerror = cleanup
    preview.src = source
    timer = window.setTimeout(cleanup, 15000)
    return () => {
      cancelled = true
      cleanup()
    }
  }, [source, duration])

  useEffect(() => {
    const element = preview.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setPreviewSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function change(patch: Partial<EditSettings>) {
    if (locked) return
    prepared.current = null
    serverEncoding.current = false
    setEdit((value) => {
      const next = { ...value, ...patch }
      next.cover = Math.min(
        Math.max(next.start, next.cover),
        Math.max(next.start, next.end - 0.1),
      )
      return next
    })
  }
  async function publish() {
    if (busy || duration === 0 || edit.end - edit.start < 0.25) return
    const abort = new AbortController()
    controller.current = abort
    setError('')
    try {
      if (!prepared.current) {
        setPhase('export')
        setProgress(0)
        if (!serverEncoding.current) {
          try {
            prepared.current = await exportClip(file, edit, abort.signal, setProgress)
          } catch (error) {
            if (abort.signal.aborted) throw error
            if (file.size > 100 * 1024 * 1024)
              throw new Error('Этот браузер не обработал исходный кодек. Для обработки на сервере выберите файл до 100 МБ или более короткий фрагмент.')
            serverEncoding.current = true
          }
        }
      }
      if (!uploaded.current) {
        setPhase('upload')
        uploaded.current = await uploadClip(serverEncoding.current ? file : prepared.current!, abort.signal, serverEncoding.current ? edit : undefined)
      }
      // Once publication is sent, retain the same payload/key on retries after ambiguous network failures.
      setLocked(true)
      setPhase('publish')
      const post = await createPost(
        {
          is_clip: true,
          cover_ms: Math.round(
            Math.max(
              0,
              Math.min(edit.cover - edit.start, edit.end - edit.start - 0.15),
            ) * 1000,
          ),
          visibility: 'city',
          city,
          caption,
          media_ids: [uploaded.current.id],
          tagged_user_ids: [],
        },
        key.current,
      )
      uploaded.current = null
      onPublished({
        ...post,
        following: false,
        cover_ms: Math.round((edit.cover - edit.start) * 1000),
        senders: [],
      })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 403 || err.status === 422)) {
        setLocked(false)
        key.current = operationKey()
      }
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        setError(
          err instanceof Error ? err.message : 'Не удалось опубликовать видео',
        )
    } finally {
      setPhase('edit')
      controller.current = null
    }
  }
  function close() {
    controller.current?.abort()
    if (uploaded.current && !locked)
      void deleteMedia(uploaded.current.id).catch(() => {})
    onClose()
  }
  return (
    <dialog
      ref={dialog}
      className="clip-editor"
      aria-label="Видеоредактор"
      onCancel={(event) => {
        event.preventDefault()
        if (phase !== 'publish') setDiscard(true)
      }}
    >
      <header className="clip-editor-header">
        <button
          disabled={phase === 'publish'}
          onClick={() => setDiscard(true)}
          aria-label="Закрыть редактор"
        >
          <Icon name="close" />
        </button>
        <strong>Ваше видео</strong>
        <span>480p</span>
      </header>
      <div className="clip-editor-scroll">
        <div
          ref={preview}
          className={`clip-editor-preview ${edit.portrait ? 'is-portrait' : ''}`}
        >
          <video
            ref={video}
            src={source || undefined}
            playsInline
            muted={edit.muted}
            style={{
              width:
                (edit.rotation % 180
                  ? previewSize.height
                  : previewSize.width) || undefined,
              height:
                (edit.rotation % 180
                  ? previewSize.width
                  : previewSize.height) || undefined,
              transform: `translate(-50%, -50%) rotate(${edit.rotation}deg)`,
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={() => {
              const v = video.current
              if (
                v &&
                !v.paused &&
                (v.currentTime >= edit.end || v.currentTime < edit.start)
              )
                v.currentTime = edit.start
            }}
            onPlay={() => {
              setPlaying(true)
              const v = video.current
              if (
                v &&
                (v.currentTime < edit.start || v.currentTime >= edit.end)
              )
                v.currentTime = edit.start
            }}
          />
          <button
            className="clip-preview-play"
            disabled={!duration || busy}
            aria-label={
              playing ? 'Приостановить предпросмотр' : 'Смотреть предпросмотр'
            }
            onClick={() => {
              if (video.current?.paused)
                void video.current
                  .play()
                  .catch(() =>
                    setError('Не удалось воспроизвести исходное видео'),
                  )
              else video.current?.pause()
            }}
          >
            <span className="clip-preview-play-icon" aria-hidden="true">
              {playing ? 'Ⅱ' : '▶'}
            </span>
          </button>
        </div>
        <fieldset
          disabled={busy || locked || !duration}
          className="clip-editor-tools"
        >
          <div className="clip-tool-row">
            <button
              type="button"
              aria-pressed={edit.muted}
              onClick={() => change({ muted: !edit.muted })}
            >
              {edit.muted ? 'Без звука' : 'Звук включён'}
            </button>
            <button
              type="button"
              onClick={() =>
                change({
                  rotation: ((edit.rotation + 90) %
                    360) as EditSettings['rotation'],
                })
              }
            >
              Повернуть ↻
            </button>
            <button
              type="button"
              aria-pressed={edit.portrait}
              onClick={() => change({ portrait: !edit.portrait })}
            >
              {edit.portrait ? 'Кадр 9:16' : 'Весь кадр'}
            </button>
          </div>
          <div className="clip-trim-title">
            <div>
              <strong>Фрагмент видео</strong>
              <small>Потяните синие края — останется только выделенная часть</small>
            </div>
            <span>{clock(edit.end - edit.start)} / 3:00</span>
          </div>
          <div className="clip-trim-control">
            <div className="clip-filmstrip" aria-hidden="true">
              {thumbnails.map((frame, i) => (
                <img key={i} src={frame} alt="" />
              ))}
            </div>
            <span
              className="clip-trim-mask clip-trim-mask--before"
              style={{ width: `${duration ? (edit.start / duration) * 100 : 0}%` }}
              aria-hidden="true"
            />
            <span
              className="clip-trim-mask clip-trim-mask--after"
              style={{ width: `${duration ? ((duration - edit.end) / duration) * 100 : 0}%` }}
              aria-hidden="true"
            />
            <span
              className="clip-trim-selection"
              style={{
                left: `${duration ? (edit.start / duration) * 100 : 0}%`,
                width: `${duration ? ((edit.end - edit.start) / duration) * 100 : 100}%`,
              }}
              aria-hidden="true"
            />
            <input
              className="clip-trim-range clip-trim-range--start"
              aria-label="Начало фрагмента"
              type="range"
              min="0"
              max={duration}
              step="0.05"
              value={edit.start}
              onChange={(event) => {
                const requested = Number(event.target.value)
                const start = Math.max(0, Math.min(requested, edit.end - 0.25))
                change({
                  start,
                  end: Math.min(edit.end, start + 180),
                })
                if (video.current) video.current.currentTime = start
              }}
            />
            <input
              className="clip-trim-range clip-trim-range--end"
              aria-label="Конец фрагмента"
              type="range"
              min="0"
              max={duration}
              step="0.05"
              value={edit.end}
              onChange={(event) => {
                const requested = Number(event.target.value)
                const end = Math.max(
                  edit.start + 0.25,
                  Math.min(requested, duration, edit.start + 180),
                )
                change({ end })
                if (video.current) {
                  video.current.pause()
                  video.current.currentTime = end - 0.1
                }
              }}
            />
          </div>
          <div className="clip-trim-values">
            <span><small>Начало</small><strong>{clock(edit.start)}</strong></span>
            <span><small>Конец</small><strong>{clock(edit.end)}</strong></span>
          </div>
          <label>
            Обложка <output>{clock(edit.cover)}</output>
            <input
              aria-label="Кадр обложки"
              type="range"
              min={edit.start}
              max={Math.max(edit.start, edit.end - 0.1)}
              step="0.1"
              value={edit.cover}
              onChange={(event) => {
                const cover = Number(event.target.value)
                change({ cover })
                if (video.current) {
                  video.current.pause()
                  video.current.currentTime = cover
                }
              }}
            />
          </label>
        </fieldset>
        <label className="clip-caption-label">
          Подпись
          <textarea
            disabled={busy || locked}
            maxLength={2000}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="О чём это видео?"
            rows={2}
          />
        </label>
        <p className="clip-editor-hint">
          Ролик увидят все. Пока он готовится на твоём устройстве, не закрывай
          приложение.
        </p>
        {error && (
          <p role="alert" className="clip-error">
            {error}
          </p>
        )}
      </div>
      <footer className="clip-editor-footer">
        {busy ? (
          <>
            <span role="status">
              {phase === 'export'
                ? `Готовим видео · ${Math.round(progress * 100)}%`
                : phase === 'upload'
                  ? 'Загружаем видео…'
                  : 'Публикуем…'}
            </span>
            <progress
              max="1"
              value={phase === 'export' ? progress : undefined}
            />
            {phase !== 'publish' && (
              <button onClick={() => controller.current?.abort()}>
                Отменить
              </button>
            )}
          </>
        ) : (
          <button
            className="clip-primary"
            disabled={!duration}
            onClick={() => void publish()}
          >
            {locked ? 'Повторить публикацию' : 'Опубликовать'}
          </button>
        )}
      </footer>
      {discard && (
        <ClipSheet title="Закрыть редактор?" onClose={() => setDiscard(false)}>
          <p>
            {locked
              ? 'Видео могло успеть опубликоваться. Загляни в свои ролики, прежде чем отправлять ещё раз.'
              : 'Если закрыть редактор сейчас, изменения пропадут.'}
          </p>
          <div className="clip-discard-actions">
            <button className="clip-primary clip-dialog-continue" onClick={() => setDiscard(false)}>
              Продолжить редактирование
            </button>
            <button className="clip-discard-close" onClick={close}>
              Закрыть редактор
            </button>
          </div>
        </ClipSheet>
      )}
    </dialog>
  )
}
