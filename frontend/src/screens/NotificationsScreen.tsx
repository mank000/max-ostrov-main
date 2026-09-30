import { saveTabValue } from '../ui-utils'
import { useEffect, useRef, useState } from 'react'
import {
  loadNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../api/notifications'
import {
  Avatar,
  Button,
  Header,
  Icon,
  IconButton,
  StatePanel,
  Tabs,
  type IconName,
} from '../ui/components/BasicUI'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function notificationIcon(kind: string): IconName {
  if (kind === 'friend_birthday') return 'calendar'
  if (kind.includes('friend') || kind.includes('group')) return 'users'
  if (kind.includes('gift')) return 'gift'
  if (kind.includes('event')) return 'calendar'
  if (kind.includes('achievement')) return 'award'
  if (kind.includes('like')) return 'heart'
  if (kind.includes('comment')) return 'comment'
  return 'bell'
}

export function notificationTime(value: string) {
  const created = new Date(value)
  if (Number.isNaN(created.getTime())) return ''
  const diff = Math.max(0, Date.now() - created.getTime())
  if (diff < 60_000) return 'только что'
  if (diff < 60 * 60_000) return `${Math.max(1, Math.floor(diff / 60_000))} мин`
  if (diff < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(diff / (60 * 60_000)))} ч`
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.max(1, Math.floor(diff / (24 * 60 * 60_000)))} д`
  return created.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

export function Notifications({ back, navigate, openClip, onError, data }: ScreenProps) {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [cursor, setCursor] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const moreRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setItems([])
    setCursor(null)
    loadNotificationsPage(tab === 'unread', controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setItems(page.notifications)
        setCursor(page.nextCursor)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      moreRequest.current?.abort()
      moreRequest.current = null
    }
  }, [tab, retry])

  async function loadMore() {
    if (!cursor || moreRequest.current) return
    const controller = new AbortController()
    moreRequest.current = controller
    setLoadingMore(true)
    setError('')
    try {
      const page = await loadNotificationsPage(tab === 'unread', controller.signal, cursor)
      if (controller.signal.aborted) return
      setItems((current) => [...current, ...page.notifications])
      setCursor(page.nextCursor)
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause))
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null
        setLoadingMore(false)
      }
    }
  }

  async function open(item: Notification) {
    try {
      if (!item.read_at) {
        await markNotificationRead(item.id)
        setItems((current) =>
          current.map((value) =>
            value.id === item.id ? { ...value, read_at: new Date().toISOString() } : value,
          ),
        )
        data.refresh('inbox')
      }
      if (item.post_id) {
        if (item.is_clip && openClip) openClip(item.post_id, item.kind.includes('comment'))
        else navigate(item.kind === 'post_comment' ? 'comments' : 'post', item.post_id)
      } else if (item.kind === 'gift_received' || item.gift_id) navigate('gifts')
      else if (item.kind === 'friend_request') navigate('friendrequests')
      else if (item.kind === 'group_invitation' && item.group_id) {
        if (item.event_id)
          saveTabValue(`kutezh-group-${item.group_id}`, String(item.event_id))
        navigate('groupdetail', item.group_id)
      } else if (item.kind === 'achievement_unlocked') navigate('rewards')
      else if (item.event_id) navigate('event', item.event_id)
      else if (item.kind === 'dating_like') return
      else if (item.actor_user_id) navigate('userprofile', item.actor_user_id)
    } catch (error) {
      onError(String(error))
    }
  }

  async function markAll() {
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })))
      data.refresh('inbox')
    } catch (error) {
      onError(String(error))
    }
  }

  const visible = tab === 'unread' ? items.filter((item) => !item.read_at) : items
  const today = new Date().toDateString()
  const recent = visible.filter((item) => new Date(item.created_at).toDateString() === today)
  const earlier = visible.filter((item) => new Date(item.created_at).toDateString() !== today)
  const unreadCount = data.unreadNotificationCount

  const rows = (entries: Notification[]) =>
    entries.map((item) => {
      const icon = notificationIcon(item.kind)
      const anonymousDatingLike = item.kind === 'dating_like'
      const actorName = anonymousDatingLike ? '' : item.actor_display_name?.trim()
      const actorUsername = anonymousDatingLike ? '' : item.actor_username?.trim()
      const showActor = !anonymousDatingLike && Boolean(item.actor_user_id)
      return (
        <button
          key={item.id}
          type="button"
          className={`notification-row ${item.read_at ? '' : 'is-unread'}`}
          onClick={() => void open(item)}
        >
          <span className="notification-row__visual">
            {showActor ? (
              <Avatar name={actorName || item.title} url={item.actor_photo_url} size={48} />
            ) : (
              <span className="notification-row__icon">
                <Icon name={icon} size={23} />
              </span>
            )}
            {showActor && (
              <span className="notification-row__type">
                <Icon name={icon} size={12} />
              </span>
            )}
          </span>
          <span className="notification-row__copy">
            <span className="notification-row__meta">
              <strong>{actorName || item.title}</strong>
              <time dateTime={item.created_at}>{notificationTime(item.created_at)}</time>
            </span>
            {actorName && (
              <span className="notification-row__title">
                {item.title}
                {actorUsername ? <small> @{actorUsername.replace(/^@/, '')}</small> : null}
              </span>
            )}
            <span className="notification-row__body">{item.body}</span>
          </span>
          {!item.read_at && (
            <span className="notification-row__dot" role="img" aria-label="Непрочитано" />
          )}
        </button>
      )
    })

  return (
    <>
      <Header
        title="Уведомления"
        back={back}
        actions={
          unreadCount > 0 ? (
            <IconButton icon="check" label="Прочитать все" onClick={() => void markAll()} />
          ) : undefined
        }
      />
      <Tabs
        items={[
          { id: 'all', label: 'Все' },
          {
            id: 'unread',
            label: unreadCount ? `Непрочитанные · ${unreadCount}` : 'Непрочитанные',
          },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen-scroll">
        {error && (
          <StatePanel
            title="Не удалось загрузить уведомления"
            description={error}
            action="Повторить"
            onAction={() => (cursor ? void loadMore() : setRetry((value) => value + 1))}
          />
        )}
        {loading ? (
          <StatePanel title="" loading />
        ) : visible.length ? (
          <>
            {recent.length > 0 && (
              <>
                <h2 className="section-title">Сегодня</h2>
                {rows(recent)}
              </>
            )}
            {earlier.length > 0 && (
              <>
                <h2 className="section-title">Ранее</h2>
                {rows(earlier)}
              </>
            )}
          </>
        ) : !error ? (
          <StatePanel
            title={tab === 'unread' ? 'Всё прочитано' : 'Пока нет уведомлений'}
            description={
              tab === 'unread'
                ? 'Новые заявки, подарки, ответы и напоминания появятся здесь.'
                : undefined
            }
          />
        ) : null}
        {cursor && (
          <div className="page-pad load-more">
            <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
