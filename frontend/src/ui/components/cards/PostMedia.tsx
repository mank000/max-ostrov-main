import { mediaURL } from '../../../api/credentials'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { type PostMedia } from '../../../api/posts'
import '../cards.css'

export function mediaDuration(value?: number) {
  if (!value) return ''
  const total = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function mediaRatio(media?: PostMedia) {
  const width = Number(media?.width) || 1
  const height = Number(media?.height) || 1

  return Math.min(2.4, Math.max(9 / 16, width / height))
}

export function PostMediaButton({
  media,
  onActivate,
  compact = false,
  inGallery = false,
}: {
  media: PostMedia
  onActivate: () => void
  compact?: boolean
  inGallery?: boolean
}) {
  const video = media.mime_type?.startsWith('video/')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    if (!video || nearViewport) return
    const button = buttonRef.current
    if (!button || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true)
        observer.disconnect()
      }
    }, { rootMargin: '350px' })
    observer.observe(button)
    return () => observer.disconnect()
  }, [video, nearViewport])
  const boundedPhoto = !video && !inGallery
  const className = `${compact ? 'post-card__repost-media' : 'post-card__media'} ${video ? 'is-video' : ''} ${inGallery ? 'is-gallery-slide' : ''} ${boundedPhoto ? 'is-bounded-feed' : ''}`
  const style = boundedPhoto
    ? ({ '--post-media-ratio': String(mediaRatio(media)) } as CSSProperties)
    : undefined
  return (
    <button
      ref={buttonRef}
      className={className}
      style={style}
      type="button"
      onClick={onActivate}
      aria-label={video ? 'Открыть видео' : 'Открыть фотографию'}
    >
      {video ? (
        <>
          <video src={nearViewport ? mediaURL(media.url) : undefined} muted playsInline preload="metadata" />
          <span className="post-card__video-badge">
            <span className="post-card__video-play" />
            {mediaDuration(media.duration_ms)}
          </span>
        </>
      ) : (
        <img
          src={mediaURL(media.url)}
          alt={compact ? 'Фото исходной публикации' : 'Фото публикации'}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
    </button>
  )
}

export function PostMediaCarousel({
  items,
  onMedia,
  compact = false,
}: {
  items: PostMedia[]
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
  compact?: boolean
}) {
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLElement | null>(null)
  const pointerRef = useRef<{
    id: number
    x: number
    y: number
    startScrollLeft: number
    moved: boolean
    axis: 'none' | 'x' | 'y'
  } | null>(null)
  const suppressClickUntilRef = useRef(0)

  if (!items.length) return null
  if (items.length === 1) {
    return (
      <PostMediaButton
        media={items[0]}
        compact={compact}
        onActivate={() => onMedia(items[0], items)}
      />
    )
  }

  const style = {
    '--post-gallery-ratio': String(mediaRatio(items[0])),
  } as CSSProperties
  const open = (media: PostMedia) => {
    if (performance.now() < suppressClickUntilRef.current) return
    onMedia(media, items)
  }
  const finishPointerGesture = (
    event: { pointerId: number; clientX: number; currentTarget: HTMLElement },
    cancelled = false,
  ) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return

    const track = event.currentTarget
    const draggedHorizontally = pointer.axis === 'x' && pointer.moved
    if (draggedHorizontally) {
      suppressClickUntilRef.current = performance.now() + 420
      if (!cancelled && track.clientWidth > 0) {
        const dx = event.clientX - pointer.x
        const startIndex = Math.round(pointer.startScrollLeft / track.clientWidth)
        const travelled = Math.abs(dx)
        const threshold = Math.min(72, track.clientWidth * 0.12)
        const nextIndex =
          travelled >= threshold
            ? startIndex + (dx < 0 ? 1 : -1)
            : Math.round(track.scrollLeft / track.clientWidth)
        const next = Math.max(0, Math.min(items.length - 1, nextIndex))
        track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' })
      }
    }

    track.classList.remove('is-pointer-dragging')
    try {
      if (track.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId)
    } catch { }
    pointerRef.current = null
  }

  return (
    <div
      className={`post-card__gallery ${compact ? 'post-card__gallery--compact' : ''}`}
      style={style}
    >
      <section
        ref={trackRef}
        className="post-card__gallery-track"
        onScroll={() => {
          const track = trackRef.current
          if (!track || track.clientWidth < 1) return
          const next = Math.max(
            0,
            Math.min(items.length - 1, Math.round(track.scrollLeft / track.clientWidth)),
          )
          setActive((current) => (current === next ? current : next))
        }}
        onPointerDownCapture={(event) => {
          if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return
          pointerRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startScrollLeft: event.currentTarget.scrollLeft,
            moved: false,
            axis: 'none',
          }
        }}
        onPointerMoveCapture={(event) => {
          const pointer = pointerRef.current
          if (!pointer || pointer.id !== event.pointerId) return

          const dx = event.clientX - pointer.x
          const dy = event.clientY - pointer.y
          const distance = Math.hypot(dx, dy)
          if (!pointer.moved && distance >= 8) pointer.moved = true

          if (pointer.axis === 'none' && pointer.moved) {
            const absX = Math.abs(dx)
            const absY = Math.abs(dy)
            if (absX > absY * 1.08) {
              pointer.axis = 'x'
              event.currentTarget.classList.add('is-pointer-dragging')
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch { }
            } else if (absY > absX * 1.08) {
              pointer.axis = 'y'
            }
          }

          if (pointer.axis !== 'x') return
          event.currentTarget.scrollLeft = pointer.startScrollLeft - dx
          if (event.cancelable) event.preventDefault()
        }}
        onPointerUpCapture={(event) => finishPointerGesture(event)}
        onPointerCancelCapture={(event) => finishPointerGesture(event, true)}
        onLostPointerCapture={(event) => {
          if (pointerRef.current?.id === event.pointerId) {
            event.currentTarget.classList.remove('is-pointer-dragging')
            pointerRef.current = null
          }
        }}
        onClickCapture={(event) => {
          if (performance.now() >= suppressClickUntilRef.current) return
          event.preventDefault()
          event.stopPropagation()
        }}
        aria-label="Фотографии публикации"
      >
        {items.map((media) => (
          <PostMediaButton
            key={media.id || media.url}
            media={media}
            compact={compact}
            inGallery
            onActivate={() => open(media)}
          />
        ))}
      </section>
      <div className="post-card__gallery-counter" aria-live="polite">
        {active + 1}/{items.length}
      </div>
      {items.length <= 8 && (
        <div className="post-card__gallery-dots" aria-hidden="true">
          {items.map((media, itemIndex) => (
            <span key={media.id || media.url} className={itemIndex === active ? 'is-active' : ''} />
          ))}
        </div>
      )}
    </div>
  )
}
