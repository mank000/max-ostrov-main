import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { mediaURL } from '../api/credentials'
import type { Clip } from '../api/clips'
import { clock } from './media'

// Decode only visible thumbnails; the chosen cover remains a timestamp in shared video media.
export function ClipCover({
  clip,
  onOpen,
  onLongPress,
}: {
  clip: Clip
  onOpen: () => void
  onLongPress?: (rect: DOMRect) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const pressTimer = useRef<number | null>(null)
  const pressOrigin = useRef({ x: 0, y: 0 })
  const ignoreClickUntil = useRef(0)
  const [poster, setPoster] = useState('')

  function cancelLongPress() {
    if (pressTimer.current === null) return
    window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  function startLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!onLongPress || !event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelLongPress()
    pressOrigin.current = { x: event.clientX, y: event.clientY }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      const rect = button.current?.getBoundingClientRect()
      if (!rect) return
      ignoreClickUntil.current = Date.now() + 900
      onLongPress(rect)
    }, 420)
  }

  function moveLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pressTimer.current === null) return
    const dx = event.clientX - pressOrigin.current.x
    const dy = event.clientY - pressOrigin.current.y
    if (Math.hypot(dx, dy) > 12) cancelLongPress()
  }

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!onLongPress) return
    event.preventDefault()
    cancelLongPress()
    ignoreClickUntil.current = Date.now() + 900
    onLongPress(event.currentTarget.getBoundingClientRect())
  }

  useEffect(
    () => () => {
      cancelLongPress()
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    const stop = () => {
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    }
    const capture = () => {
      if (cancelled || !video.videoWidth) return
      const canvas = document.createElement('canvas')
      const scale = Math.min(
        480 / video.videoWidth,
        854 / video.videoHeight,
        1,
      )
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      try {
        const context = canvas.getContext('2d', { alpha: false })
        if (context) {
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          setPoster(canvas.toDataURL('image/jpeg', 0.88))
        }
      } catch {
        /* An unavailable media thumbnail must not prevent opening the clip. */
      }
      stop()
    }
    video.onloadeddata = () => {
      if (clip.cover_ms > 0)
        video.currentTime = Math.min(clip.cover_ms / 1000, video.duration - 0.1)
      else capture()
    }
    video.onseeked = capture
    video.onerror = stop
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect()
          video.src = mediaURL(clip.media[0].url)
          video.load()
        }
      },
      { rootMargin: '0px' },
    )
    if (button.current) observer.observe(button.current)
    return () => {
      cancelled = true
      observer.disconnect()
      stop()
    }
  }, [clip.id, clip.cover_ms, clip.media])

  return (
    <button
      ref={button}
      className="clip-cover"
      onPointerDown={startLongPress}
      onPointerMove={moveLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={openContextMenu}
      onClick={(event) => {
        if (Date.now() < ignoreClickUntil.current) {
          event.preventDefault()
          return
        }
        onOpen()
      }}
      aria-label={`Открыть видео: ${clip.caption || clip.author.display_name}`}
    >
      {poster && <img src={poster} alt="" />}
      <span>{clock((clip.media[0]?.duration_ms || 0) / 1000)}</span>
    </button>
  )
}
