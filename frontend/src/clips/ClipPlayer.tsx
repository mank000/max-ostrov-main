import { formatMediaTime } from '../ui/mediaTime'
import { useClipCaption } from './useClipCaption'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { mediaURL } from '../api/credentials'
import { clipFeedback, type Clip } from '../api/clips'
import { Avatar, Icon } from '../ui/components/BasicUI'

type Props = {
  clip: Clip
  active: boolean
  nearby: boolean
  muted: boolean
  self: boolean
  busy: boolean
  playbackRate: number
  onMute: () => void
  onLike: () => void
  onFollow: () => void
  onProfile: () => void
  onComments: () => void
  onShare: () => void
  onMenu: () => void
}

export function ClipPlayer({
  clip,
  active,
  nearby,
  muted,
  self,
  busy,
  playbackRate,
  onMute,
  onLike,
  onFollow,
  onProfile,
  onComments,
  onShare,
  onMenu,
}: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const watch = useRef(0)
  const previous = useRef(0)
  const rate = useRef(playbackRate)
  const holdTimer = useRef<number | null>(null)
  const holdActive = useRef(false)
  const holdOrigin = useRef({ x: 0, y: 0 })
  const suppressSideClick = useRef(false)
  const seekingRef = useRef(false)
  const seekWasPlaying = useRef(false)
  const { caption, expanded, toggleCaption } = useClipCaption(clip.id, active)
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(0)
  const [seekPosition, setSeekPosition] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const media = clip.media[0]
  const declaredDuration = (media?.duration_ms || 0) / 1000
  const [mediaDuration, setMediaDuration] = useState(declaredDuration)
  const duration = mediaDuration > 0 ? mediaDuration : declaredDuration
  const displayPosition = Math.min(
    Math.max(0, seeking ? seekPosition : position),
    Math.max(duration, 0),
  )
  const progress = duration > 0 ? Math.min(100, Math.max(0, (displayPosition / duration) * 100)) : 0
  const captionLength = Array.from(clip.caption || '').length
  const hasLongCaption = captionLength > 96 || (clip.caption || '').includes('\n')

  useEffect(() => {
    rate.current = playbackRate
    const v = video.current
    if (v && !holdActive.current) {
      v.playbackRate = playbackRate
    }
  }, [playbackRate, clip.id])

  useEffect(() => {
    setPosition(0)
    setSeekPosition(0)
    setSeeking(false)
    setMediaDuration(declaredDuration)
    caption.current?.scrollTo({ top: 0, behavior: 'auto' })
    seekingRef.current = false
    seekWasPlaying.current = false
    holdActive.current = false
    suppressSideClick.current = false
  }, [clip.id, declaredDuration])

  useEffect(() => {
    const v = video.current
    if (!v) {
      return
    }
    let disposed = false
    const play = () => {
      if (active && !document.hidden && !seekingRef.current) {
        v.playbackRate = holdActive.current ? 2 : rate.current
        void v
          .play()
          .then(() => {
            if (disposed || document.hidden || seekingRef.current) {
              v.pause()
            } else {
              setPaused(false)
            }
          })
          .catch(() => {
            if (!disposed) {
              setPaused(true)
            }
          })
      }
    }
    const visibility = () => {
      if (document.hidden) {
        v.pause()
      } else {
        play()
      }
    }
    if (active) {
      previous.current = 0
      play()
    } else {
      v.pause()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', visibility)
      v.pause()
      if (active && watch.current > 0) {
        void clipFeedback(clip.id, watch.current).catch(() => {})
        watch.current = 0
      }
    }
  }, [active, clip.id])

  useEffect(() => {
    if (video.current) {
      video.current.muted = muted
    }
  }, [muted])

  useEffect(() => {
    if (!active || !muted) {
      return
    }
    const unmuteOnVolumeUp = (event: KeyboardEvent) => {
      const volumeUp =
        event.key === 'AudioVolumeUp' ||
        event.key === 'VolumeUp' ||
        event.code === 'AudioVolumeUp' ||
        event.code === 'VolumeUp'
      if (volumeUp) {
        onMute()
      }
    }
    window.addEventListener('keydown', unmuteOnVolumeUp, true)
    return () => window.removeEventListener('keydown', unmuteOnVolumeUp, true)
  }, [active, muted, onMute])

  useEffect(
    () => () => {
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current)
      }
      holdTimer.current = null
      holdActive.current = false
      if (video.current) {
        video.current.playbackRate = rate.current
      }
      caption.current?.scrollTo({ top: 0, behavior: 'auto' })
    },
    [],
  )

  if (!media) {
    return null
  }

  function toggle() {
    const v = video.current
    if (!v) {
      return
    }
    if (error) {
      setLoading(true)
      setError(false)
      v.load()
    }
    if (v.paused) {
      void v
        .play()
        .then(() => setPaused(false))
        .catch(() => setPaused(true))
    } else {
      v.pause()
      setPaused(true)
    }
  }

  function cancelPendingHold() {
    if (holdTimer.current === null) {
      return
    }
    window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  function startSpeedHold(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) {
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    cancelPendingHold()
    suppressSideClick.current = false
    holdOrigin.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      const v = video.current
      if (!v) {
        return
      }
      holdActive.current = true
      suppressSideClick.current = true
      v.playbackRate = 2
    }, 220)
  }

  function moveSpeedHold(event: ReactPointerEvent<HTMLDivElement>) {
    if (holdTimer.current === null) {
      return
    }
    const dx = event.clientX - holdOrigin.current.x
    const dy = event.clientY - holdOrigin.current.y
    if (Math.hypot(dx, dy) > 12) {
      cancelPendingHold()
    }
  }

  function finishSpeedHold(event: ReactPointerEvent<HTMLDivElement>) {
    cancelPendingHold()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    if (!holdActive.current) {
      return
    }
    holdActive.current = false
    const v = video.current
    if (v) {
      v.playbackRate = rate.current
    }
  }

  function cancelSpeedHold(event: ReactPointerEvent<HTMLDivElement>) {
    finishSpeedHold(event)
    suppressSideClick.current = false
  }

  function sideClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (suppressSideClick.current) {
      suppressSideClick.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    toggle()
  }

  function seekTo(raw: number) {
    if (!Number.isFinite(raw) || duration <= 0) {
      return
    }
    const next = Math.min(duration, Math.max(0, raw))
    setSeekPosition(next)
    setPosition(next)
    const v = video.current
    if (v) {
      v.currentTime = next
    }
  }

  function beginSeek(event: ReactPointerEvent<HTMLInputElement>) {
    event.stopPropagation()
    const v = video.current
    seekWasPlaying.current = Boolean(v && !v.paused)
    seekingRef.current = true
    if (v) {
      v.pause()
    }
    setPaused(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSeeking(true)
    seekTo(Number(event.currentTarget.value))
  }

  function restoreAfterSeek() {
    const v = video.current
    const shouldResume = seekWasPlaying.current
    seekWasPlaying.current = false
    seekingRef.current = false
    setSeeking(false)
    if (!v) {
      return
    }
    if (shouldResume && active && !document.hidden) {
      void v
        .play()
        .then(() => setPaused(false))
        .catch(() => setPaused(true))
    } else {
      v.pause()
      setPaused(true)
    }
  }

  function finishSeek(event: ReactPointerEvent<HTMLInputElement>) {
    event.stopPropagation()
    seekTo(Number(event.currentTarget.value))
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    restoreAfterSeek()
  }

  return (
    <article
      className="clip-card"
      aria-label={`Видео ${clip.author.display_name}`}
    >
      <video
        ref={video}
        src={nearby ? mediaURL(media.url) : undefined}
        playsInline
        loop
        muted={muted}
        preload={nearby ? 'auto' : 'none'}
        onLoadedMetadata={() => {
          const v = video.current
          if (!v) {
            return
          }
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setMediaDuration(v.duration)
          }
          v.playbackRate = holdActive.current ? 2 : rate.current
        }}
        onDurationChange={() => {
          const value = video.current?.duration || 0
          if (Number.isFinite(value) && value > 0) {
            setMediaDuration(value)
          }
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false)
          setError(false)
        }}
        onError={() => {
          if (nearby) {
            setError(true)
            setLoading(false)
          }
        }}
        onTimeUpdate={() => {
          const v = video.current
          if (!v) {
            return
          }
          if (!seeking) {
            setPosition(v.currentTime)
          }
          const now = performance.now()
          if (active && !v.paused && !document.hidden && previous.current) {
            watch.current += Math.min(1000, now - previous.current)
          }
          previous.current = now
        }}
      />
      <button
        className="clip-play-area"
        aria-label={paused ? 'Воспроизвести видео' : 'Приостановить видео'}
        onClick={toggle}
      >
        {error ? (
          <span className="clip-play-state">Не удалось загрузить · Повторить</span>
        ) : loading && active ? (
          <span
            className="clip-spinner"
            aria-label="Загрузка видео"
          />
        ) : paused && active && !seeking ? (
          <span className="clip-play-state">▶</span>
        ) : null}
      </button>

      {(['left', 'right'] as const).map((side) => (
        <div
          key={side}
          className={`clip-speed-zone is-${side}`}
          onPointerDown={startSpeedHold}
          onPointerMove={moveSpeedHold}
          onPointerUp={finishSpeedHold}
          onPointerCancel={cancelSpeedHold}
          onClick={sideClick}
          onContextMenu={(event) => event.preventDefault()}
        />
      ))}
      {paused && active && !seeking && (
        <button
          className={`clip-sound${muted ? ' is-muted' : ''}`}
          style={{
            top: 'calc(50% + 58px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 6,
          }}
          onClick={(event) => {
            event.stopPropagation()
            onMute()
          }}
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
        >
          <Icon
            name="music"
            size={18}
          />
        </button>
      )}

      <aside className="clip-actions">
        <div className="clip-avatar-action">
          <button
            onClick={onProfile}
            aria-label={`Профиль ${clip.author.display_name}`}
          >
            <Avatar
              name={clip.author.display_name}
              url={clip.author.photo_url}
              size={44}
            />
          </button>
          {!self && !clip.following && (
            <button
              className="clip-follow"
              onClick={onFollow}
              disabled={busy}
              aria-label="Подписаться"
            >
              <span className="clip-follow-disc">
                <Icon
                  name="plus"
                  size={16}
                />
              </span>
            </button>
          )}
        </div>

        <button
          onClick={onLike}
          disabled={busy}
          aria-pressed={clip.liked_by_me}
          className={clip.liked_by_me ? 'is-liked' : ''}
          aria-label={clip.liked_by_me ? 'Убрать лайк' : 'Нравится'}
        >
          <Icon
            name="heart"
            size={29}
          />
          {clip.like_count > 0 && <small>{clip.like_count}</small>}
        </button>

        <button
          onClick={onComments}
          aria-label={`Комментарии: ${clip.comment_count}`}
        >
          <Icon
            name="comment"
            size={29}
          />
          {clip.comment_count > 0 && <small>{clip.comment_count}</small>}
        </button>

        <button
          onClick={onShare}
          aria-label="Отправить другу"
        >
          <Icon
            name="send"
            size={28}
          />
        </button>

        <button
          onClick={onMenu}
          aria-label="Действия с видео"
        >
          <Icon
            name="more"
            size={26}
          />
        </button>
      </aside>

      <div className="clip-description">
        {clip.senders.length > 0 && (
          <span className="clip-sent-by">
            Прислал(а): {clip.senders.map((person) => person.display_name).join(', ')}
          </span>
        )}
        <button
          className="clip-author"
          onClick={onProfile}
        >
          {clip.author.username ? `@${clip.author.username}` : clip.author.display_name}
        </button>
        {clip.caption && (
          <div className="clip-caption-wrap">
            <span
              ref={caption}
              className={`clip-caption${expanded ? ' is-expanded' : ''}`}
            >
              {clip.caption}
            </span>
            {hasLongCaption && (
              <button
                className="clip-caption-toggle"
                type="button"
                onClick={toggleCaption}
                aria-expanded={expanded}
              >
                {expanded ? 'Скрыть' : 'Показать'}
              </button>
            )}
          </div>
        )}
        {clip.city && <span className="clip-city">{clip.city}</span>}
      </div>

      <div className={`clip-scrubber${seeking ? ' is-seeking' : ''}`}>
        <div
          className="clip-scrubber-track"
          aria-hidden="true"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(displayPosition, Math.max(duration, 0.01))}
          aria-label="Позиция видео"
          aria-valuetext={`${formatMediaTime(displayPosition, false)} из ${formatMediaTime(duration, false)}`}
          onPointerDown={beginSeek}
          onPointerUp={finishSeek}
          onPointerCancel={(event) => {
            event.stopPropagation()
            restoreAfterSeek()
          }}
          onInput={(event) => {
            event.stopPropagation()
            seekTo(Number(event.currentTarget.value))
          }}
          onChange={(event) => seekTo(Number(event.currentTarget.value))}
          onClick={(event) => event.stopPropagation()}
        />
        {seeking && (
          <output>
            {formatMediaTime(displayPosition, false)} / {formatMediaTime(duration, false)}
          </output>
        )}
      </div>
    </article>
  )
}
