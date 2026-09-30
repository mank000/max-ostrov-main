import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { Profile } from './api'
import { profilePhotoUrl } from './api'

const icons = import.meta.glob('./icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
function Icon({ name }: { name: string }) {
  return (
    <span
      className="icon"
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        maskImage: `url("${icons[`./icons/${name}.svg`]}")`,
        WebkitMaskImage: `url("${icons[`./icons/${name}.svg`]}")`,
      }}
    />
  )
}

function VerificationBadge({ tier }: { tier?: Profile['verification_tier'] }) {
  if (!tier || tier === 'none') {
    return null
  }
  const full = tier === 'full'
  const label = full
    ? 'Синяя галочка: селфи совпало с актуальным фото профиля'
    : 'Жёлтая галочка: возраст оценён по селфи, фото профиля не подтверждено'
  return (
    <span
      className={`dating-verification-badge dating-verification-badge--${tier}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">✓</span>
    </span>
  )
}

function Photos({
  card,
  photoURL,
  onReport,
  paused,
  tapBlocked,
}: {
  card: Profile
  photoURL: typeof profilePhotoUrl
  onReport: () => void
  paused: boolean
  tapBlocked: RefObject<number>
}) {
  const photos = card.photos?.length ? card.photos : card.photo ? [card.photo] : []
  const [photoIndex, setIndex] = useState(0)
  const index = Math.min(photoIndex, Math.max(0, photos.length - 1))
  const currentPhoto = photos[index]
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(true)
  const photo = useRef<HTMLDivElement>(null)
  const progress = useRef<HTMLSpanElement>(null)
  const elapsed = useRef(0)
  const image = useRef<HTMLImageElement>(null)
  const advance = (direction: number) => {
    if (index + direction < 0 || index + direction >= photos.length) {
      return
    }
    elapsed.current = 0
    setLoaded(false)
    setIndex(index + direction)
  }
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio > 0.5),
      { threshold: [0.5] },
    )
    if (photo.current) {
      observer.observe(photo.current)
    }
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setIndex(index)
    elapsed.current = 0
    if (progress.current) {
      progress.current.style.transform = 'scaleX(0)'
    }
    setLoaded(Boolean(image.current?.complete))
  }, [currentPhoto, index])
  useEffect(() => {
    if (paused || !loaded || !visible || photos.length < 2) {
      return
    }
    let frame = 0,
      last = performance.now()
    const tick = (now: number) => {
      if (!document.hidden) {
        elapsed.current = Math.min(5000, elapsed.current + Math.max(0, Math.min(now - last, 100)))
      }
      last = now
      if (progress.current) {
        progress.current.style.transform = `scaleX(${elapsed.current / 5000})`
      }
      if (elapsed.current >= 5000) {
        if (index < photos.length - 1) {
          advance(1)
        }
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [index, paused, loaded, visible, photos.length])
  return (
    <div
      className="discovery-photos"
      ref={photo}
    >
      <div
        className="discovery-photo-track"
        tabIndex={0}
        role="region"
        aria-label="Фотографии анкеты. Нажмите слева или справа для переключения, удерживайте для паузы"
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (performance.now() < tapBlocked.current) {
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          advance(event.clientX < rect.left + rect.width / 2 ? -1 : 1)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return
          }
          event.preventDefault()
          advance(event.key === 'ArrowLeft' ? -1 : 1)
        }}
      >
        {photos.length ? (
          <img
            ref={image}
            key={currentPhoto}
            src={photoURL(currentPhoto)}
            alt={`${card.name}, фото ${index + 1}`}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        ) : (
          <div className="discovery-photo-empty">{card.name[0]}</div>
        )}
      </div>
      {photos.length > 1 && (
        <>
          <div
            className="discovery-story-progress"
            aria-hidden="true"
          >
            {photos.map((_, i) => (
              <span key={i}>
                <span
                  ref={i === index ? progress : undefined}
                  style={{
                    transform: `scaleX(${i < index ? 1 : i === index ? elapsed.current / 5000 : 0})`,
                  }}
                />
              </span>
            ))}
          </div>
          <span
            className="discovery-photo-count"
            aria-live="polite"
          >
            {index + 1}/{photos.length}
          </span>
        </>
      )}
      <div className="swipe-tint swipe-tint-like">
        <Icon name="heart" />
      </div>
      <div className="swipe-tint swipe-tint-pass">
        <Icon name="close" />
      </div>
      <button
        type="button"
        className="discovery-menu"
        aria-label="Пожаловаться или скрыть"
        onClick={onReport}
      >
        <Icon name="more" />
      </button>
    </div>
  )
}

type Props = {
  card: Profile
  me: Profile
  nextCard?: Profile
  suspended?: boolean
  photoURL: typeof profilePhotoUrl
  busy: boolean
  canUndo: boolean
  onUndo: () => void
  onSwipe: (kind: 'like' | 'pass') => Promise<boolean>
  onReport: () => void
  details: string[]
  goal: string
}
export function Discovery({
  card,
  me,
  nextCard,
  suspended = false,
  photoURL,
  busy,
  canUndo,
  onUndo,
  onSwipe,
  onReport,
  details,
  goal,
}: Props) {
  const article = useRef<HTMLDivElement>(null)
  const underneath = useRef<HTMLDivElement>(null)
  const tapBlocked = useRef(0)
  const [held, setHeld] = useState(false)
  const pointer = useRef<{
    id: number
    x: number
    y: number
    time: number
    dx: number
    lastX: number
    lastTime: number
    velocity: number
    axis: 'pending' | 'horizontal' | 'vertical'
  } | null>(null)
  const stopHorizontalTouch = useRef<(() => void) | null>(null)
  useEffect(() => () => stopHorizontalTouch.current?.(), [])

  useEffect(() => {
    if (!nextCard) {
      return
    }
    const sources = (
      nextCard.photos?.length ? nextCard.photos : nextCard.photo ? [nextCard.photo] : []
    ).slice(0, 2)
    const images = sources.map((source) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = photoURL(source)
      void image.decode?.().catch(() => {})
      return image
    })
    return () => {
      for (const image of images) {
        image.src = ''
      }
    }
  }, [nextCard?.user_id, nextCard?.photo, nextCard?.photos, photoURL])

  const committing = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const paint = (x: number, animate = false) => {
    const node = article.current
    if (!node) {
      return
    }
    const width = Math.max(320, node.clientWidth || 400)
    const reveal = Math.min(1, Math.abs(x) / (width * 0.52))
    node.style.transition = animate
      ? 'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease'
      : 'none'
    node.style.transform = `translate3d(${x}px,0,0)`

    node.style.opacity = String(1 - reveal * 0.92)
    if (underneath.current) {
      underneath.current.style.transition = animate
        ? 'transform 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease'
        : 'none'
      underneath.current.style.transform = `scale(${0.955 + 0.045 * reveal})`
      underneath.current.style.opacity = String(0.68 + 0.32 * reveal)
    }
    node.style.setProperty('--like-opacity', String(Math.min(0.55, Math.max(0, x / 220))))
    node.style.setProperty('--pass-opacity', String(Math.min(0.5, Math.max(0, -x / 220))))
  }
  async function decide(kind: 'like' | 'pass') {
    if (busy || committing.current) {
      return
    }
    committing.current = true
    setLeaving(true)
    paint((kind === 'like' ? 1 : -1) * (article.current?.clientWidth || 400) * 1.2, true)
    const ok = await onSwipe(kind)
    if (!ok) {
      committing.current = false
      setLeaving(false)
      paint(0, true)
    }
  }
  function down(event: PointerEvent<HTMLElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest('button,a,input')
    ) {
      return
    }
    tapBlocked.current = 0
    setHeld(true)
    pointer.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      dx: 0,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      axis: 'pending',
    }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const p = pointer.current
    if (!p || p.id !== event.pointerId) {
      return
    }
    const dx = event.clientX - p.x,
      dy = event.clientY - p.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      tapBlocked.current = performance.now() + 400
    }
    if (busy || committing.current) {
      return
    }
    if (p.axis === 'pending') {
      if (Math.abs(dy) >= 10 && Math.abs(dy) >= Math.abs(dx) * 0.9) {
        p.axis = 'vertical'
      } else if (Math.abs(dx) >= 12 && Math.abs(dx) >= Math.abs(dy) * 1.35) {
        p.axis = 'horizontal'
        event.currentTarget.setPointerCapture(event.pointerId)
        const node = article.current
        if (node && !stopHorizontalTouch.current) {
          const keepHorizontal = (touch: TouchEvent) => {
            if (pointer.current?.axis === 'horizontal' && touch.cancelable) {
              touch.preventDefault()
            }
          }
          node.addEventListener('touchmove', keepHorizontal, { passive: false })
          stopHorizontalTouch.current = () => node.removeEventListener('touchmove', keepHorizontal)
        }
      }
    }
    if (p.axis === 'horizontal') {
      tapBlocked.current = performance.now() + 400
      const now = event.timeStamp
      const dt = now - p.lastTime
      if (dt > 0) {
        p.velocity = (event.clientX - p.lastX) / dt
      }
      p.lastX = event.clientX
      p.lastTime = now
      p.dx = dx
      paint(dx - Math.sign(dx) * Math.min(8, Math.abs(dx)))
    }
  }
  function end(event: PointerEvent<HTMLElement>, cancel = false) {
    const p = pointer.current
    if (!p || p.id !== event.pointerId) {
      return
    }
    pointer.current = null
    stopHorizontalTouch.current?.()
    stopHorizontalTouch.current = null
    setHeld(false)

    if (cancel || p.axis !== 'pending' || performance.now() - p.time >= 250) {
      tapBlocked.current = performance.now() + 400
    }
    if (
      !cancel &&
      p.axis === 'horizontal' &&
      (Math.abs(p.dx) > Math.min(72, (article.current?.clientWidth || 400) * 0.16) ||
        (Math.abs(p.dx) > 32 &&
          event.timeStamp - p.lastTime < 150 &&
          Math.abs(p.velocity) > 0.45 &&
          Math.sign(p.velocity) === Math.sign(p.dx)))
    ) {
      void decide(p.dx > 0 ? 'like' : 'pass')
    } else if (p.axis === 'horizontal') {
      paint(0, true)
    }
  }
  return (
    <div className="discovery-flow">
      <div
        ref={underneath}
        className="discovery-underlay"
        aria-hidden="true"
      >
        {nextCard ? (
          <>
            <div className="discovery-photos">
              {nextCard.photos?.[0] || nextCard.photo ? (
                <img
                  src={photoURL(nextCard.photos?.[0] || nextCard.photo!)}
                  alt=""
                  draggable={false}
                />
              ) : (
                <div className="discovery-photo-empty">{nextCard.name[0]}</div>
              )}
            </div>
            <div className="discovery-info">
              <h1>
                {nextCard.name}, {nextCard.age}
              </h1>
              <p>{nextCard.city}</p>
            </div>
          </>
        ) : (
          <div className="discovery-deck-end">Анкеты закончились</div>
        )}
      </div>
      <div
        className="discovery-scroll"
        ref={article}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
        onLostPointerCapture={(e) => {
          if (e.target === e.currentTarget) {
            end(e, true)
          }
        }}
      >
        <article className={`discovery-profile ${leaving ? 'is-leaving' : ''}`}>
          <Photos
            card={card}
            photoURL={photoURL}
            onReport={onReport}
            paused={held || busy || leaving || suspended}
            tapBlocked={tapBlocked}
          />
          <section className="discovery-info">
            <div className="discovery-identity">
              <h1>
                {card.name}, {card.age}
              </h1>
              <VerificationBadge tier={card.verification_tier} />
            </div>
            <p className="person-city">
              <Icon name="location" />
              {card.city || 'Город не указан'}
            </p>
            <div className="profile-chips">
              <span className="goal-chip">{goal}</span>
            </div>
            {card.bio && (
              <section>
                <h2>О себе</h2>
                <p className="discovery-bio">{card.bio}</p>
              </section>
            )}
            {!!card.interests?.length && (
              <section>
                <h2>Интересы</h2>
                <div className="card-interests">
                  {card.interests.map((x) => (
                    <span
                      key={x}
                      className={
                        me.interests?.includes(x) ? 'interest-chip common' : 'interest-chip'
                      }
                    >
                      {x}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {!!details.length && (
              <section>
                <h2>Ещё немного обо мне</h2>
                <div className="profile-chips">
                  {details.map((x) => (
                    <span
                      key={x}
                      className="detail-chip"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </section>
        </article>
      </div>
      <div
        className="discovery-actions"
        aria-label="Действия с анкетой"
      >
        <button
          className="discovery-undo"
          aria-label="Вернуть предыдущую анкету"
          title="Вернуть предыдущую анкету"
          disabled={busy || leaving || !canUndo}
          onClick={onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          aria-label="Пропустить"
          title="Пропустить"
          disabled={busy || leaving}
          onClick={() => void decide('pass')}
        >
          <Icon name="close" />
        </button>
        <button
          className="discovery-like"
          aria-label="Нравится"
          title="Нравится"
          disabled={busy || leaving}
          onClick={() => void decide('like')}
        >
          <Icon name="heart" />
        </button>
      </div>
    </div>
  )
}
