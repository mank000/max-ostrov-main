import { PlayerIcon } from './PlayerIcon'
import { formatMediaTime as formatTime } from '../../mediaTime'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const AUTO_HIDE_MS = 2600
const DOUBLE_TAP_MS = 285
const SEEK_SECONDS = 10

type PiPDocument = Document & {
  pictureInPictureEnabled?: boolean
  pictureInPictureElement?: Element | null
  exitPictureInPicture?: () => Promise<void>
}

type PiPVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>
  webkitEnterFullscreen?: () => void
}

export function MediaVideo({
  src,
  active,
  nearby,
}: {
  src: string
  active: boolean
  nearby: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<number | null>(null)
  const tapTimerRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const lastTapRef = useRef<{
    at: number
    x: number
    y: number
  } | null>(null)
  const resumeAfterScrubRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [bufferedTime, setBufferedTime] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubTime, setScrubTime] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [pipAvailable, setPipAvailable] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [seekFeedback, setSeekFeedback] = useState<{
    delta: number
    token: number
  } | null>(null)

  function clearHideTimer() {
    if (hideTimerRef.current === null) {
      return
    }
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }

  function scheduleHide() {
    clearHideTimer()
    if (!active || !playing || scrubbing || speedOpen) {
      return
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setControlsVisible(false)
    }, AUTO_HIDE_MS)
  }

  function revealControls() {
    setControlsVisible(true)
    scheduleHide()
  }

  async function safePlay() {
    const video = videoRef.current
    if (!video) {
      return
    }
    setFailed(false)
    try {
      await video.play()
    } catch {
      setControlsVisible(true)
    }
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (video.ended) {
      video.currentTime = 0
      setCurrentTime(0)
      void safePlay()
      return
    }
    if (video.paused) {
      void safePlay()
    } else {
      video.pause()
    }
    revealControls()
  }

  function announceSeek(delta: number) {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current)
    }
    setSeekFeedback({ delta, token: Date.now() })
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null
      setSeekFeedback(null)
    }, 620)
  }

  function seekBy(delta: number) {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) {
      return
    }
    const next = Math.max(0, Math.min(video.duration, video.currentTime + delta))
    video.currentTime = next
    setCurrentTime(next)
    setScrubTime(next)
    announceSeek(delta)
    revealControls()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) {
      return
    }
    video.muted = !video.muted
    setMuted(video.muted)
    revealControls()
  }

  function setRate(rate: number) {
    const video = videoRef.current
    if (!video) {
      return
    }
    video.playbackRate = rate
    setPlaybackRate(rate)
    setSpeedOpen(false)
    revealControls()
  }

  async function toggleFullscreen() {
    const root = rootRef.current
    const video = videoRef.current as PiPVideo | null
    if (!root || !video) {
      return
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (root.requestFullscreen) {
        await root.requestFullscreen()
      } else {
        video.webkitEnterFullscreen?.()
      }
    } catch {
      video.webkitEnterFullscreen?.()
    }
    revealControls()
  }

  async function togglePiP() {
    const video = videoRef.current as PiPVideo | null
    const doc = document as PiPDocument
    if (!video || !doc.pictureInPictureEnabled || !video.requestPictureInPicture) {
      return
    }
    try {
      if (doc.pictureInPictureElement === video) {
        await doc.exitPictureInPicture?.()
      } else {
        await video.requestPictureInPicture()
      }
    } catch {
      setPipActive(false)
    }
    revealControls()
  }

  function syncBuffered() {
    const video = videoRef.current
    if (!video || !video.buffered.length) {
      setBufferedTime(0)
      return
    }
    setBufferedTime(video.buffered.end(video.buffered.length - 1))
  }

  function handleSurfaceClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest('[data-video-control]')) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const now = performance.now()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const previous = lastTapRef.current

    if (
      previous &&
      now - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(x - previous.x, y - previous.y) <= 52
    ) {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current)
      }
      tapTimerRef.current = null
      lastTapRef.current = null
      seekBy(x < rect.width / 2 ? -SEEK_SECONDS : SEEK_SECONDS)
      return
    }

    lastTapRef.current = {
      at: now,
      x,
      y,
    }
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current)
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null
      lastTapRef.current = null
      togglePlayback()
    }, 220)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (!active) {
      video.pause()
      setSpeedOpen(false)
      setControlsVisible(true)
      clearHideTimer()
      return
    }
    setMuted(video.muted)
    setPlaybackRate(video.playbackRate || 1)
    setPipAvailable(
      Boolean((document as PiPDocument).pictureInPictureEnabled) &&
        typeof (video as PiPVideo).requestPictureInPicture === 'function',
    )
    setControlsVisible(true)
  }, [active, src])

  useEffect(() => {
    if (!active) {
      return
    }
    if (!playing || scrubbing || speedOpen) {
      clearHideTimer()
      setControlsVisible(true)
      return
    }
    scheduleHide()
    return clearHideTimer
  }, [active, playing, scrubbing, speedOpen])

  useEffect(() => {
    const fullscreenChanged = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', fullscreenChanged)
    return () => document.removeEventListener('fullscreenchange', fullscreenChanged)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    const enter = () => setPipActive(true)
    const leave = () => setPipActive(false)
    video.addEventListener('enterpictureinpicture', enter)
    video.addEventListener('leavepictureinpicture', leave)
    return () => {
      video.removeEventListener('enterpictureinpicture', enter)
      video.removeEventListener('leavepictureinpicture', leave)
    }
  }, [src])

  useEffect(() => {
    if (!active) {
      return
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.closest('button, input, textarea, select, a')) {
        return
      }

      let handled = true
      if (event.key === ' ' || event.key.toLowerCase() === 'k' || event.key === 'Enter') {
        togglePlayback()
      } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'j') {
        seekBy(-SEEK_SECONDS)
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') {
        seekBy(SEEK_SECONDS)
      } else if (event.key.toLowerCase() === 'm') {
        toggleMute()
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen()
      } else if (event.key.toLowerCase() === 'p' && pipAvailable) {
        void togglePiP()
      } else {
        handled = false
      }

      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [active, pipAvailable, playing, duration, currentTime, muted, fullscreen])

  useEffect(() => {
    return () => {
      clearHideTimer()
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current)
      }
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  const shownTime = scrubbing ? scrubTime : currentTime
  const playedPercent = duration > 0 ? Math.min(100, Math.max(0, (shownTime / duration) * 100)) : 0
  const bufferedPercent =
    duration > 0 ? Math.min(100, Math.max(0, (bufferedTime / duration) * 100)) : 0
  const scrubStyle = {
    '--scrub-position': String(playedPercent) + '%',
  } as CSSProperties

  const video = (
    <video
      ref={videoRef}
      src={src}
      playsInline
      preload={nearby ? 'metadata' : 'none'}
      autoPlay={false}
      tabIndex={-1}
      onLoadedMetadata={(event) => {
        const nextDuration = Number.isFinite(event.currentTarget.duration)
          ? event.currentTarget.duration
          : 0
        setDuration(nextDuration)
        setCurrentTime(event.currentTarget.currentTime || 0)
        setScrubTime(event.currentTarget.currentTime || 0)
        setMuted(event.currentTarget.muted)
        setPlaybackRate(event.currentTarget.playbackRate || 1)
        syncBuffered()
      }}
      onDurationChange={(event) => {
        if (Number.isFinite(event.currentTarget.duration)) {
          setDuration(event.currentTarget.duration)
        }
      }}
      onTimeUpdate={(event) => {
        if (!scrubbing) {
          setCurrentTime(event.currentTarget.currentTime)
        }
      }}
      onProgress={syncBuffered}
      onPlay={() => {
        setPlaying(true)
        setWaiting(false)
        setFailed(false)
      }}
      onPlaying={() => {
        setPlaying(true)
        setWaiting(false)
      }}
      onPause={() => {
        setPlaying(false)
        setWaiting(false)
        setControlsVisible(true)
      }}
      onWaiting={() => setWaiting(true)}
      onCanPlay={() => setWaiting(false)}
      onEnded={() => {
        setPlaying(false)
        setWaiting(false)
        setControlsVisible(true)
      }}
      onError={() => {
        setPlaying(false)
        setWaiting(false)
        setFailed(true)
        setControlsVisible(true)
      }}
      onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
      onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
    />
  )

  if (!active) {
    return (
      <div
        className="post-video-player is-inactive"
        aria-hidden="true"
      >
        {video}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={[
        'post-video-player',
        playing ? 'is-playing' : 'is-paused',
        controlsVisible ? 'is-controls-visible' : 'is-controls-hidden',
        scrubbing ? 'is-scrubbing' : '',
        fullscreen ? 'is-fullscreen' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label="Видеоплеер"
      tabIndex={0}
      onClick={handleSurfaceClick}
      onPointerMove={() => revealControls()}
      onPointerLeave={() => scheduleHide()}
      onFocusCapture={() => {
        clearHideTimer()
        setControlsVisible(true)
      }}
      onBlurCapture={() => scheduleHide()}
    >
      {video}

      {waiting && !failed && (
        <div
          className="post-video-player__loading"
          aria-label="Загрузка видео"
        >
          <span />
        </div>
      )}

      {failed && (
        <div
          className="post-video-player__error"
          data-video-control
        >
          <strong>Видео не загрузилось</strong>
          <button
            type="button"
            onClick={() => {
              const element = videoRef.current
              if (!element) {
                return
              }
              setFailed(false)
              element.load()
              void safePlay()
            }}
          >
            Попробовать ещё раз
          </button>
        </div>
      )}

      {!failed && !playing && !waiting && (
        <button
          className="post-video-player__center"
          type="button"
          data-video-control
          aria-label={videoRef.current?.ended ? 'Смотреть заново' : 'Воспроизвести'}
          onClick={togglePlayback}
        >
          <PlayerIcon
            name={videoRef.current?.ended ? 'replay' : 'play'}
            size={30}
          />
        </button>
      )}

      {seekFeedback && (
        <div
          key={seekFeedback.token}
          className={
            'post-video-player__seek-feedback ' + (seekFeedback.delta < 0 ? 'is-left' : 'is-right')
          }
          aria-live="polite"
        >
          <span>{seekFeedback.delta < 0 ? '−10' : '+10'}</span>
          <small>сек</small>
        </div>
      )}

      <div
        className="post-video-player__controls"
        data-video-control
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="post-video-player__timeline"
          style={scrubStyle}
        >
          <div
            className="post-video-player__timeline-rail"
            aria-hidden="true"
          >
            <span
              className="post-video-player__timeline-buffered"
              style={{ width: String(bufferedPercent) + '%' }}
            />
            <span
              className="post-video-player__timeline-played"
              style={{ width: String(playedPercent) + '%' }}
            />
          </div>
          {scrubbing && <output>{formatTime(scrubTime)}</output>}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={shownTime}
            disabled={!duration}
            aria-label="Перемотка видео"
            aria-valuetext={formatTime(shownTime) + ' из ' + formatTime(duration)}
            onPointerDown={() => {
              const element = videoRef.current
              resumeAfterScrubRef.current = Boolean(element && !element.paused)
              element?.pause()
              setScrubbing(true)
              setScrubTime(element?.currentTime || currentTime)
              clearHideTimer()
              setControlsVisible(true)
            }}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              setScrubTime(next)
              setCurrentTime(next)
              if (videoRef.current) {
                videoRef.current.currentTime = next
              }
            }}
            onPointerUp={() => {
              setScrubbing(false)
              if (resumeAfterScrubRef.current) {
                void safePlay()
              }
              resumeAfterScrubRef.current = false
              scheduleHide()
            }}
            onPointerCancel={() => {
              setScrubbing(false)
              resumeAfterScrubRef.current = false
              scheduleHide()
            }}
          />
        </div>

        <div className="post-video-player__row">
          <button
            type="button"
            aria-label={playing ? 'Пауза' : 'Воспроизвести'}
            title={playing ? 'Пауза' : 'Воспроизвести'}
            onClick={togglePlayback}
          >
            <PlayerIcon name={playing ? 'pause' : 'play'} />
          </button>

          <span
            className="post-video-player__time"
            aria-hidden="true"
          >
            <span>{formatTime(shownTime)}</span>
            <span className="post-video-player__time-divider">/</span>
            <span>{formatTime(duration)}</span>
          </span>

          <span className="post-video-player__spacer" />

          <button
            type="button"
            aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            title={muted ? 'Включить звук' : 'Выключить звук'}
            onClick={toggleMute}
          >
            <PlayerIcon name={muted ? 'muted' : 'volume'} />
          </button>

          <div className="post-video-player__speed">
            <button
              type="button"
              className="post-video-player__rate"
              aria-label="Скорость воспроизведения"
              aria-expanded={speedOpen}
              title="Скорость"
              onClick={() => {
                setSpeedOpen((value) => !value)
                setControlsVisible(true)
                clearHideTimer()
              }}
            >
              {playbackRate === 1 ? '1×' : String(playbackRate) + '×'}
            </button>
            {speedOpen && (
              <div
                className="post-video-player__speed-menu"
                role="menu"
                aria-label="Скорость воспроизведения"
              >
                {SPEEDS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    role="menuitemradio"
                    aria-checked={playbackRate === rate}
                    className={playbackRate === rate ? 'is-active' : ''}
                    onClick={() => setRate(rate)}
                  >
                    {rate === 1 ? 'Обычная' : String(rate) + '×'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {pipAvailable && (
            <button
              type="button"
              aria-label={pipActive ? 'Закрыть картинку в картинке' : 'Картинка в картинке'}
              title="Картинка в картинке"
              onClick={() => void togglePiP()}
            >
              <PlayerIcon name="pip" />
            </button>
          )}

          <button
            type="button"
            aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
            title={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
            onClick={() => void toggleFullscreen()}
          >
            <PlayerIcon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} />
          </button>
        </div>
      </div>
    </div>
  )
}
