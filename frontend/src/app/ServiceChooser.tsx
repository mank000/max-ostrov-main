import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { loadWallet, type Wallet } from '../api/rewards'
import type { Profile } from '../api/users'
import { useResource } from '../data/useResource'
import { Avatar, Icon } from '../ui/components/BasicUI'
import './service-chooser.css'
import { useDeviceLayout } from './useDeviceLayout'

export type ServiceName = 'social' | 'dating' | 'games' | 'clips'

const services: { id: ServiceName; title: string; image: string }[] = [
  { id: 'games', title: 'Игры', image: '04_service_games.png' },
  { id: 'social', title: 'Соцсеть', image: '03_service_events.png' },
  { id: 'clips', title: 'Видео', image: '06_service_videos.png' },
  { id: 'dating', title: 'Знакомства', image: '05_service_dating.png' },
]
const middleStart = services.length * 2
const carouselServices = Array.from({ length: services.length * 5 }, (_, index) => services[index % services.length])
const decorations = ['headphones', 'coins', 'gamepad-small', 'ticket', 'heart', 'sparkle']
const formatCoins = new Intl.NumberFormat('ru-RU')

type Props = {
  profile: Profile
  initialService: ServiceName
  notifications: number
  clipNotifications: number
  datingNotifications: number
  onSelect: (service: ServiceName) => void
  onOpen: (view: 'profile' | 'notifications' | 'support' | 'rewards' | 'transactions') => void
  onUnauthorized: () => void
}

export function ServiceChooser({
  profile,
  initialService,
  notifications,
  clipNotifications,
  datingNotifications,
  onSelect,
  onOpen,
  onUnauthorized,
}: Props) {
  const desktop = useDeviceLayout()
  const initialIndex = middleStart + Math.max(0, services.findIndex((item) => item.id === initialService))
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const activeRef = useRef(initialIndex)
  const slider = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const recenterFrame = useRef(0)
  const scrollTarget = useRef<number | null>(null)
  const wallet = useResource<Wallet | null>(true, loadWallet, null, onUnauthorized)
  const refreshWallet = wallet.refresh
  const name = profile.display_name || profile.first_name

  useEffect(() => {
    const refreshWhenVisible = () => { if (!document.hidden) refreshWallet() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [refreshWallet])

  const centerSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    if (desktop) return
    const viewport = slider.current
    const card = viewport?.children[index] as HTMLElement | undefined
    if (!viewport || !card) return
    scrollTarget.current = index
    viewport.scrollTo({
      left: card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
    })
  }, [desktop])

  useLayoutEffect(() => {
    const viewport = slider.current
    if (!viewport) return
    const resize = new ResizeObserver(() => centerSlide(activeRef.current, 'instant'))
    resize.observe(viewport)
    centerSlide(initialIndex, 'instant')
    return () => { resize.disconnect(); cancelAnimationFrame(recenterFrame.current) }
  }, [centerSlide, initialIndex])

  function selectCard(index: number) {
    centerSlide(index)
  }

  function selectServiceDot(index: number) {
    let delta = (index - activeRef.current % services.length + services.length) % services.length
    if (delta > services.length / 2) delta -= services.length
    centerSlide(activeRef.current + delta)
  }

  // Keep a middle copy under the viewport without changing the visible position.
  // The extra copies preserve native momentum and let swipes cross either end.
  function recenter(index = activeRef.current) {
    const viewport = slider.current
    const nextIndex = middleStart + index % services.length
    if (!viewport || nextIndex === index) return
    const current = viewport.children[index] as HTMLElement
    const next = viewport.children[nextIndex] as HTMLElement
    const delta = next.offsetLeft - current.offsetLeft
    const focused = viewport.contains(document.activeElement)
    viewport.dataset.recentering = 'true'
    activeRef.current = nextIndex
    flushSync(() => setActiveIndex(nextIndex))
    viewport.scrollLeft += delta
    if (drag.current) drag.current.left += delta
    if (scrollTarget.current !== null) scrollTarget.current += nextIndex - index
    if (focused) next.focus({ preventScroll: true })
    cancelAnimationFrame(recenterFrame.current)
    recenterFrame.current = requestAnimationFrame(() => { delete viewport.dataset.recentering })
  }

  function finishScroll() {
    const viewport = slider.current
    if (!viewport || drag.current) return
    const target = scrollTarget.current
    if (target !== null) {
      const card = viewport.children[target] as HTMLElement
      const targetLeft = card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2
      // A scrollend from an interrupted animation must not cancel a newer selection.
      if (Math.abs(viewport.scrollLeft - targetLeft) > 2) return
    }
    scrollTarget.current = null
    recenter()
  }

  function updateActiveFromScroll() {
    const viewport = slider.current
    if (!viewport) return
    const center = viewport.scrollLeft + viewport.clientWidth / 2
    let closest = 0
    let distance = Infinity
    Array.from(viewport.children).forEach((child, index) => {
      const card = child as HTMLElement
      const nextDistance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center)
      if (nextDistance < distance) { distance = nextDistance; closest = index }
    })
    activeRef.current = closest
    setActiveIndex(closest)
    if (closest < services.length || closest >= carouselServices.length - services.length) recenter(closest)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    scrollTarget.current = null
    // Touch scrolling and momentum belong to the browser; only mouse dragging needs help.
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    drag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const delta = event.clientX - current.x
    if (!current.moved && Math.abs(delta) < 6) return
    if (!current.moved) {
      current.moved = true
      suppressClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.dataset.dragging = 'true'
    }
    event.preventDefault()
    event.currentTarget.scrollLeft = current.left - delta
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (current.moved) { updateActiveFromScroll(); centerSlide(activeRef.current) }
  }

  return (
    <main className="service-chooser" aria-label="Выбор сервиса">
      <div className="service-hub">
        <img className="service-hub-background" src="/assets/artur/background.png" alt="" />
        <header className="service-hub-header">
          <button type="button" className="service-hub-user" onClick={() => onOpen('profile')} aria-label="Открыть мой профиль">
            <Avatar name={name} url={profile.photo_url} size={48} />
            <span><strong>{profile.username ? `@${profile.username}` : name}</strong><small>{profile.username ? name : 'Мой профиль'}</small></span>
          </button>
          <div className="service-hub-header-actions">
            <button
              type="button"
              className="service-hub-bell service-hub-support"
              aria-label="Написать в поддержку"
              onClick={() => onOpen('support')}
            >
              <Icon name="message" size={22} />
            </button>
            <button
              type="button"
              className="service-hub-bell"
              aria-label={notifications > 0 ? `Уведомления: ${notifications} новых` : 'Уведомления'}
              onClick={() => onOpen('notifications')}
            >
              <Icon name="bell" size={22} />
              {notifications > 0 && <span className="service-hub-notification-badge">{notifications > 99 ? '99+' : notifications}</span>}
            </button>
          </div>
        </header>

        <div className="service-hub-decor" aria-hidden="true">
          {decorations.map((item) => <img key={item} className={`service-hub-decor-${item}`} src={`/assets/artur/${item}.png`} alt="" />)}
        </div>
        <section className="service-hub-balance" aria-label="Баланс монет" aria-busy={wallet.status.loading}>
          <span>Баланс монет</span>
          <strong aria-live="polite" aria-label={wallet.value?.unlimited ? 'Безлимитный баланс' : undefined}>
            {wallet.value ? (wallet.value.unlimited ? '∞' : formatCoins.format(wallet.value.balance)) : '—'}
          </strong>
          {wallet.status.error ? <button type="button" className="service-hub-wallet-error" onClick={refreshWallet}>Не получилось загрузить баланс · Ещё раз</button>
            : <button type="button" className="service-hub-history" onClick={() => onOpen('transactions')}>
              <img src="/assets/artur/coin.png" alt="" />{wallet.status.loaded ? 'История монет' : 'Загружаем баланс…'}<Icon name="chevron" size={16} />
            </button>}
        </section>

        <div className="service-hub-slider" role="group" aria-label="Сервисы" ref={slider}
          onScroll={updateActiveFromScroll} onScrollEnd={finishScroll} onWheel={() => { scrollTarget.current = null }} onPointerDown={startDrag} onPointerMove={moveDrag}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}
          onKeyDown={(event) => {
            suppressClick.current = false
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const index = activeRef.current + (event.key === 'ArrowRight' ? 1 : -1)
            selectCard(index)
            const card = slider.current?.children[index] as HTMLElement | undefined
            card?.focus({ preventScroll: true })
          }}>
          {carouselServices.map((service, index) => <button key={index} type="button"
            tabIndex={index === activeIndex ? 0 : -1} aria-hidden={Math.abs(index - activeIndex) > 1}
            className={`service-hub-card${index === activeIndex ? ' is-active' : ''}`}
            aria-label={`${index === activeIndex ? 'Открыть' : 'Выбрать'}: ${service.title}`}
            onFocus={(event) => { if (!slider.current?.dataset.recentering && event.currentTarget.matches(':focus-visible')) centerSlide(index) }}
            onClick={() => index === activeRef.current ? onSelect(service.id) : selectCard(index)}>
            <img src={`/assets/artur/${service.image}`} alt="" draggable={false} />
            {((service.id === 'clips' && clipNotifications > 0) || (service.id === 'dating' && datingNotifications > 0)) && (
              <span className="service-card-badge">
                {(service.id === 'clips' ? clipNotifications : datingNotifications) > 99 ? '99+' : (service.id === 'clips' ? clipNotifications : datingNotifications)}
              </span>
            )}
          </button>)}
        </div>

        <div className="service-hub-dots" role="group" aria-label="Выбранный сервис">
          {services.map((service, index) => <button key={service.id} type="button" aria-label={service.title}
            aria-pressed={index === activeIndex % services.length} onClick={() => selectServiceDot(index)}><span />{service.title}</button>)}
        </div>
        <button type="button" className="service-hub-spend" onClick={() => onOpen('rewards')}>
          <img src="/assets/artur/coin.png" alt="" />Потрать монетки<Icon name="chevron" size={22} />
        </button>
      </div>
    </main>
  )
}
