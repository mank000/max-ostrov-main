import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import {
  deleteClipMessage,
  loadClipMessages,
  markClipMessageThreadRead,
  reactClipMessage,
  type ClipMessage,
} from '../api/clips'
import { reportContent } from '../api/reports'
import { loadFriendDirectMessageTarget } from '../api/users'
import type { HostAdapter } from '../host'
import { Avatar, Icon } from '../ui/components/BasicUI'
import {
  MaxContextMenu,
  MaxContextMenuItem,
  menuAnchorFromRect,
  type MenuAnchor,
} from '../ui/components/ContextMenu'
import { ClipCover } from './ClipCover'

const reactions = ['❤️', '😂', '🔥', '😍', '👏', '😮', '👍', '🥰'] as const

type Thread = {
  peer: ClipMessage['peer']
  messages: ClipMessage[]
  latest: number
  unread: number
}

type MessageMenu = {
  message: ClipMessage
  anchor: MenuAnchor
  view: 'actions' | 'report' | 'delete-all'
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})
const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
})
const shortDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
})

function stamp(value?: string) {
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function dayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(value: string) {
  const date = new Date(value)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (days === 0) return 'Сегодня'
  if (days === 1) return 'Вчера'
  return dayFormat.format(date)
}

function listTime(value: string) {
  const date = new Date(value)
  const now = new Date()
  return dayKey(value) === dayKey(now.toISOString())
    ? timeFormat.format(date)
    : shortDateFormat.format(date)
}

function activity(message: ClipMessage) {
  return stamp(message.replied_at) || stamp(message.created_at)
}

function unread(message: ClipMessage, profileId: number) {
  if (message.recipient_id === profileId && !message.read_at) return true
  return (
    message.sender_id === profileId &&
    Boolean(message.reply_emoji) &&
    !message.reply_read_at
  )
}

function ClipInboxMedia({
  message,
  onOpen,
  onLongPress,
}: {
  message: ClipMessage
  onOpen: () => void
  onLongPress: (rect: DOMRect) => void
}) {
  const media = message.clip.media[0]

  if (!media)
    return (
      <div className="clip-inbox-media-empty">
        <Icon name="film" size={28} />
        <span>Видео недоступно</span>
      </div>
    )

  return (
    <ClipCover
      clip={message.clip}
      onOpen={onOpen}
      onLongPress={onLongPress}
    />
  )
}

export function ClipInbox({
  profileId,
  host,
  desktop,
  backRequest,
  onRead,
  onNotice,
  onOpenVideo,
  onForward,
}: {
  profileId: number
  host: HostAdapter
  desktop: boolean
  backRequest: MutableRefObject<(() => boolean) | null>
  onRead: () => void
  onNotice: (message: string) => void
  onOpenVideo: (
    clips: ClipMessage['clip'][],
    index: number,
    peer: ClipMessage['peer'],
  ) => void
  onForward: (clip: ClipMessage['clip']) => void
}) {
  const [messages, setMessages] = useState<ClipMessage[]>([])
  const [peerId, setPeerId] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [reactionFor, setReactionFor] = useState(0)
  const [busyReaction, setBusyReaction] = useState(0)
  const [openingChat, setOpeningChat] = useState(false)
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null)
  const [messageActionBusy, setMessageActionBusy] = useState(false)
  const chatIds = useRef(new Map<number, string>())
  const chat = useRef<HTMLDivElement>(null)
  const onReadRef = useRef(onRead)

  useEffect(() => {
    onReadRef.current = onRead
  }, [onRead])

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await loadClipMessages(signal)
      if (signal?.aborted) return
      setMessages(next)
      setError('')
    } catch (reason) {
      if (signal?.aborted) return
      if (!quiet)
        setError(
          reason instanceof Error ? reason.message : 'Не удалось открыть присланное',
        )
    } finally {
      if (!signal?.aborted && !quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load, retry])

  useEffect(() => {
    const changed = () => void load(undefined, true)
    window.addEventListener('kutezh:clips-updated', changed)
    return () => window.removeEventListener('kutezh:clips-updated', changed)
  }, [load])

  const threads = useMemo(() => {
    const grouped = new Map<number, Thread>()
    for (const message of messages) {
      const current = grouped.get(message.peer.id)
      if (current) {
        current.messages.push(message)
        current.latest = Math.max(current.latest, activity(message))
        if (unread(message, profileId)) current.unread += 1
      } else {
        grouped.set(message.peer.id, {
          peer: message.peer,
          messages: [message],
          latest: activity(message),
          unread: unread(message, profileId) ? 1 : 0,
        })
      }
    }
    return [...grouped.values()]
      .map((thread) => ({
        ...thread,
        messages: [...thread.messages].sort(
          (a, b) => stamp(a.created_at) - stamp(b.created_at) || a.id - b.id,
        ),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [messages, profileId])

  useEffect(() => {
    if (desktop && !peerId && threads.length) setPeerId(threads[0].peer.id)
  }, [desktop, peerId, threads])

  const thread = threads.find((item) => item.peer.id === peerId)

  useEffect(() => {
    const close = () => {
      if (messageMenu) {
        setMessageMenu(null)
        return true
      }
      if (desktop || !peerId) return false
      setPeerId(0)
      setReactionFor(0)
      return true
    }
    backRequest.current = close
    return () => {
      if (backRequest.current === close) backRequest.current = null
    }
  }, [backRequest, desktop, peerId, messageMenu])

  useEffect(() => {
    if (!peerId || !thread?.unread) return
    let active = true
    void markClipMessageThreadRead(peerId)
      .then(() => {
        if (!active) return
        const now = new Date().toISOString()
        setMessages((items) =>
          items.map((message) => {
            if (message.peer.id !== peerId) return message
            return {
              ...message,
              read_at:
                message.recipient_id === profileId
                  ? message.read_at || now
                  : message.read_at,
              reply_read_at:
                message.sender_id === profileId && message.reply_emoji
                  ? message.reply_read_at || now
                  : message.reply_read_at,
            }
          }),
        )
        onReadRef.current()
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [peerId, profileId, thread?.unread])

  useEffect(() => {
    if (!peerId || !thread?.messages.length) return
    const frame = requestAnimationFrame(() => {
      if (chat.current) chat.current.scrollTop = chat.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [peerId, thread?.messages.length])

  async function react(message: ClipMessage, emoji: string) {
    if (busyReaction || message.recipient_id !== profileId) return
    setBusyReaction(message.id)
    try {
      await reactClipMessage(message.id, emoji)
      const now = new Date().toISOString()
      const hasReaction = Boolean(emoji)
      setMessages((items) =>
        items.map((item) =>
          item.id === message.id
            ? {
                ...item,
                read_at: item.read_at || now,
                reply_emoji: hasReaction ? emoji : undefined,
                replied_at: hasReaction ? now : undefined,
                reply_read_at: undefined,
              }
            : item,
        ),
      )
      setReactionFor(0)
      host.hapticSelection()
      onReadRef.current()
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Не удалось изменить реакцию',
      )
    } finally {
      setBusyReaction(0)
    }
  }

  function openMessageMenu(message: ClipMessage, rect: DOMRect) {
    setReactionFor(0)
    setMessageMenu({
      message,
      anchor: menuAnchorFromRect(rect),
      view: 'actions',
    })
    host.hapticSelection()
  }

  async function removeMessage(message: ClipMessage, forEveryone: boolean) {
    if (messageActionBusy) return
    setMessageActionBusy(true)
    try {
      await deleteClipMessage(message.id, forEveryone)
      const hasOtherMessages = messages.some(
        (item) => item.id !== message.id && item.peer.id === message.peer.id,
      )
      setMessages((items) => items.filter((item) => item.id !== message.id))
      setReactionFor((value) => (value === message.id ? 0 : value))
      setMessageMenu(null)
      if (!hasOtherMessages) setPeerId(0)
      host.hapticSelection()
      onReadRef.current()
      onNotice(forEveryone ? 'Видео удалено у всех' : 'Видео удалено у вас')
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Не удалось удалить видео',
      )
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function reportMessage(message: ClipMessage, reason: string) {
    if (messageActionBusy) return
    setMessageActionBusy(true)
    try {
      await reportContent('post', message.clip.id, reason)
      setMessageMenu(null)
      host.hapticSelection()
      onNotice('Жалоба отправлена')
    } catch (cause) {
      onNotice(
        cause instanceof Error ? cause.message : 'Не удалось отправить жалобу',
      )
    } finally {
      setMessageActionBusy(false)
    }
  }

  async function openMax(peer: Thread['peer']) {
    if (openingChat) return
    setOpeningChat(true)
    try {
      let chatId = chatIds.current.get(peer.id) || ''
      if (!chatId) {
        const target = await loadFriendDirectMessageTarget(peer.id)
        chatId = target.max_chat_id || ''
        if (chatId) chatIds.current.set(peer.id, chatId)
      }
      if (!chatId || !host.openChat(chatId))
        throw new Error('MAX-чат с этим другом пока недоступен')
    } catch (reason) {
      onNotice(
        reason instanceof Error ? reason.message : 'Не удалось открыть MAX-чат',
      )
    } finally {
      setOpeningChat(false)
    }
  }

  function preview(item: Thread) {
    const latest = [...item.messages].sort((a, b) => activity(b) - activity(a))[0]
    if (!latest) return 'Нет сообщений'
    if (latest.reply_emoji && stamp(latest.replied_at) >= stamp(latest.created_at))
      return `Реакция ${latest.reply_emoji}`
    return latest.sender_id === profileId
      ? 'Вы отправили видео'
      : 'Вам отправили видео'
  }

  let previousDay = ''

  return (
    <section className={`clip-inbox${peerId ? ' has-thread' : ''}`} aria-label="Прислано">
      <aside className="clip-inbox-list" aria-label="Диалоги">
        <div className="clip-inbox-list-head">
          <strong>Диалоги</strong>
          <span>Видео и реакции</span>
        </div>
        {loading && !messages.length && (
          <div className="clip-inbox-state" role="status">
            <span className="clip-spinner" />
            <strong>Открываем диалоги</strong>
          </div>
        )}
        {!loading && error && !messages.length && (
          <div className="clip-inbox-state">
            <Icon name="info" size={30} />
            <strong>Не удалось открыть присланное</strong>
            <span>{error}</span>
            <button onClick={() => setRetry((value) => value + 1)}>Повторить</button>
          </div>
        )}
        {!loading && !error && !threads.length && (
          <div className="clip-inbox-state">
            <Icon name="message" size={34} />
            <strong>Пока тихо</strong>
            <span>Отправленные друзьям видео появятся здесь как диалоги.</span>
          </div>
        )}
        <div className="clip-inbox-conversations">
          {threads.map((item) => {
            const latest = [...item.messages].sort(
              (a, b) => activity(b) - activity(a),
            )[0]
            return (
              <button
                key={item.peer.id}
                type="button"
                className={`clip-inbox-conversation${peerId === item.peer.id ? ' is-active' : ''}`}
                onClick={() => {
                  setPeerId(item.peer.id)
                  setReactionFor(0)
                }}
              >
                <Avatar
                  name={item.peer.display_name}
                  url={item.peer.photo_url}
                  size={48}
                />
                <span className="clip-inbox-conversation-copy">
                  <strong>{item.peer.display_name}</strong>
                  <small>{preview(item)}</small>
                </span>
                <span className="clip-inbox-conversation-side">
                  <time>{latest ? listTime(latest.replied_at || latest.created_at) : ''}</time>
                  {item.unread > 0 && (
                    <span className="clip-inbox-unread">
                      {item.unread > 9 ? '9+' : item.unread}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="clip-inbox-thread" aria-label={thread ? `Диалог с ${thread.peer.display_name}` : 'Диалог'}>
        {thread ? (
          <>
            <header className="clip-inbox-thread-head">
              <button
                type="button"
                className="clip-inbox-thread-back"
                aria-label="К диалогам"
                onClick={() => {
                  setPeerId(0)
                  setReactionFor(0)
                }}
              >
                <Icon name="back" size={22} />
              </button>
              <Avatar
                name={thread.peer.display_name}
                url={thread.peer.photo_url}
                size={38}
              />
              <span>
                <strong>{thread.peer.display_name}</strong>
                <small>Можно отвечать только реакциями</small>
              </span>
              <button
                type="button"
                className="clip-inbox-max"
                disabled={openingChat}
                onClick={() => void openMax(thread.peer)}
              >
                <Icon name="message" size={18} />
                <span>MAX</span>
              </button>
            </header>

            <div className="clip-inbox-chat" ref={chat}>
              <div className="clip-inbox-note">
                <Icon name="info" size={16} />
                <span>Здесь нет текстовых сообщений. Реагируйте на видео или продолжите разговор в MAX.</span>
              </div>
              {thread.messages.map((message, messageIndex) => {
                const outgoing = message.sender_id === profileId
                const key = dayKey(message.created_at)
                const showDay = key !== previousDay
                previousDay = key
                const picker = !outgoing && reactionFor === message.id
                return (
                  <Fragment key={message.id}>
                    {showDay && (
                      <div className="clip-inbox-day">{dayLabel(message.created_at)}</div>
                    )}
                    <article
                      className={`clip-inbox-message ${outgoing ? 'is-outgoing' : 'is-incoming'}`}
                    >
                      {!outgoing && (
                        <Avatar
                          name={thread.peer.display_name}
                          url={thread.peer.photo_url}
                          size={30}
                        />
                      )}
                      <div className="clip-inbox-message-body">
                        <div className="clip-inbox-bubble">
                          <div className="clip-inbox-media">
                            <ClipInboxMedia
                              message={message}
                              onOpen={() =>
                                onOpenVideo(
                                  thread.messages.map((item) => item.clip),
                                  messageIndex,
                                  thread.peer,
                                )
                              }
                              onLongPress={(rect) =>
                                openMessageMenu(message, rect)
                              }
                            />
                            {message.reply_emoji &&
                              (outgoing ? (
                                <span
                                  className={`clip-inbox-reaction-badge${!message.reply_read_at ? ' is-new' : ''}`}
                                  aria-label={`Реакция ${message.reply_emoji}`}
                                >
                                  {message.reply_emoji}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="clip-inbox-reaction-badge"
                                  aria-label="Убрать реакцию"
                                  disabled={busyReaction === message.id}
                                  onClick={() => void react(message, '')}
                                >
                                  {message.reply_emoji}
                                </button>
                              ))}
                          </div>
                          {message.clip.caption && (
                            <div className="clip-inbox-media-copy">
                              <span>{message.clip.caption}</span>
                            </div>
                          )}
                        </div>
                        <div className="clip-inbox-message-meta">
                          <time>{timeFormat.format(new Date(message.created_at))}</time>
                          {outgoing && (
                            <span>{message.read_at ? 'Просмотрено' : 'Отправлено'}</span>
                          )}
                          {!outgoing && (
                            <button
                              type="button"
                              className="clip-inbox-react"
                              aria-expanded={picker}
                              onClick={() =>
                                setReactionFor((value) =>
                                  value === message.id ? 0 : message.id,
                                )
                              }
                            >
                              {message.reply_emoji ? 'Изменить' : 'Реакция'}
                            </button>
                          )}
                        </div>
                        {picker && (
                          <div className="clip-inbox-reactions" aria-label="Выберите реакцию">
                            {reactions.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                disabled={busyReaction === message.id}
                                aria-pressed={message.reply_emoji === emoji}
                                onClick={() =>
                                  void react(
                                    message,
                                    message.reply_emoji === emoji ? '' : emoji,
                                  )
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  </Fragment>
                )
              })}
            </div>

            <footer className="clip-inbox-rule">
              <span>Только реакции на присланное</span>
              <button
                type="button"
                disabled={openingChat}
                onClick={() => void openMax(thread.peer)}
              >
                <Icon name="external" size={16} />
                Открыть чат в MAX
              </button>
            </footer>
          </>
        ) : (
          <div className="clip-inbox-thread-empty">
            <Icon name="message" size={38} />
            <strong>Выберите диалог</strong>
            <span>Присланные ролики будут расположены как личные сообщения.</span>
          </div>
        )}
      </section>

      {messageMenu && (
        <MaxContextMenu
          anchor={messageMenu.anchor}
          label={
            messageMenu.view === 'report'
              ? 'Пожаловаться'
              : messageMenu.view === 'delete-all'
                ? 'Удалить у всех?'
                : 'Действия с видео'
          }
          onClose={() => {
            if (!messageActionBusy) setMessageMenu(null)
          }}
        >
          {messageMenu.view === 'actions' && (
            <>
              {messageMenu.message.recipient_id === profileId && (
                <MaxContextMenuItem
                  label="Ответить"
                  icon="message"
                  onClick={() => {
                    setReactionFor(messageMenu.message.id)
                    setMessageMenu(null)
                    host.hapticSelection()
                  }}
                />
              )}
              <MaxContextMenuItem
                label="Переслать"
                icon="send"
                onClick={() => {
                  const clip = messageMenu.message.clip
                  setMessageMenu(null)
                  onForward(clip)
                  host.hapticSelection()
                }}
              />
              {messageMenu.message.clip.author.id !== profileId && (
                <MaxContextMenuItem
                  label="Пожаловаться"
                  icon="info"
                  onClick={() =>
                    setMessageMenu((current) =>
                      current ? { ...current, view: 'report' } : current,
                    )
                  }
                />
              )}
              <MaxContextMenuItem
                label="Удалить у себя"
                icon="trash"
                destructive
                loading={messageActionBusy}
                onClick={() =>
                  void removeMessage(messageMenu.message, false)
                }
              />
              {messageMenu.message.sender_id === profileId && (
                <MaxContextMenuItem
                  label="Удалить у всех"
                  icon="trash"
                  destructive
                  onClick={() =>
                    setMessageMenu((current) =>
                      current ? { ...current, view: 'delete-all' } : current,
                    )
                  }
                />
              )}
            </>
          )}

          {messageMenu.view === 'report' && (
            <>
              {[
                'Спам или обман',
                'Оскорбления или травля',
                'Опасный или недопустимый контент',
                'Нарушение прав',
              ].map((reason) => (
                <MaxContextMenuItem
                  key={reason}
                  label={reason}
                  icon="info"
                  loading={messageActionBusy}
                  onClick={() =>
                    void reportMessage(messageMenu.message, reason)
                  }
                />
              ))}
              <MaxContextMenuItem
                label="Назад"
                icon="back"
                disabled={messageActionBusy}
                onClick={() =>
                  setMessageMenu((current) =>
                    current ? { ...current, view: 'actions' } : current,
                  )
                }
              />
            </>
          )}

          {messageMenu.view === 'delete-all' && (
            <>
              <MaxContextMenuItem
                label="Удалить у всех"
                icon="trash"
                destructive
                loading={messageActionBusy}
                onClick={() =>
                  void removeMessage(messageMenu.message, true)
                }
              />
              <MaxContextMenuItem
                label="Отмена"
                icon="back"
                disabled={messageActionBusy}
                onClick={() =>
                  setMessageMenu((current) =>
                    current ? { ...current, view: 'actions' } : current,
                  )
                }
              />
            </>
          )}
        </MaxContextMenu>
      )}
    </section>
  )
}
