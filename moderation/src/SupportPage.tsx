import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  moderationApi,
  type SupportChat,
  type SupportStatus,
  type SupportThread,
} from './api'
import { Icon, dateTime } from './ui'
import './support.css'

const accept = 'image/jpeg,image/png,video/mp4,video/quicktime,.jpg,.jpeg,.png,.mp4,.mov'

export function SupportPage() {
  const [status, setStatus] = useState<SupportStatus>('open')
  const [threads, setThreads] = useState<SupportThread[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [chat, setChat] = useState<SupportChat | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const messageList = useRef<HTMLDivElement>(null)

  const refreshQueue = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await moderationApi.support(status)
      const next = result.threads || []
      setThreads(next)
      setSelectedId((current) =>
        current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null),
      )
      if (!silent) setError('')
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить обращения')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [status])

  const refreshChat = useCallback(async (id: number, silent = false) => {
    try {
      const value = await moderationApi.supportThread(id)
      setChat(value)
      if (!silent) setError('')
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'Не удалось открыть обращение')
    }
  }, [])

  useEffect(() => {
    setChat(null)
    setSelectedId(null)
    void refreshQueue()
  }, [refreshQueue])

  useEffect(() => {
    if (!selectedId) {
      setChat(null)
      return
    }
    void refreshChat(selectedId)
  }, [selectedId, refreshChat])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || busy) return
      void refreshQueue(true)
      if (selectedId) void refreshChat(selectedId, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [busy, refreshQueue, refreshChat, selectedId])

  useEffect(() => {
    const element = messageList.current
    if (!element) return
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
    })
  }, [chat?.messages.length])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || busy || (!body.trim() && !file)) return
    setBusy(true)
    setError('')
    try {
      await moderationApi.supportReply(selectedId, body, file)
      setBody('')
      setFile(null)
      await Promise.all([refreshChat(selectedId), refreshQueue(true)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить ответ')
    } finally {
      setBusy(false)
    }
  }

  async function changeState() {
    if (!chat || busy) return
    setBusy(true)
    setError('')
    try {
      if (chat.status === 'open') await moderationApi.supportClose(chat.id)
      else await moderationApi.supportReopen(chat.id)
      setChat(null)
      await refreshQueue()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="support-admin">
      <aside className="support-admin__list">
        <div className="support-admin__heading">
          <div>
            <h1>Поддержка</h1>
            <p>Диалоги пользователей с командой.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Обновить" onClick={() => void refreshQueue()}>
            <Icon name="refresh" />
          </button>
        </div>
        <div className="support-admin__tabs">
          {([
            ['open', 'Открытые'],
            ['closed', 'Закрытые'],
            ['all', 'Все'],
          ] as Array<[SupportStatus, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'is-active' : ''}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && <p className="queue-error" role="alert">{error}</p>}
        <div className="support-admin__threads">
          {loading ? (
            <span className="loading-state">Загрузка…</span>
          ) : threads.length ? (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`support-admin__thread${selectedId === thread.id ? ' is-active' : ''}`}
                onClick={() => setSelectedId(thread.id)}
              >
                <span className="support-admin__avatar">
                  {(thread.display_name || thread.username || 'П')[0]?.toLocaleUpperCase('ru')}
                </span>
                <span className="support-admin__thread-copy">
                  <strong>{thread.display_name || (thread.username ? `@${thread.username}` : `MAX #${thread.provider_user_id}`)}</strong>
                  <small>{thread.latest_body || 'Вложение'}</small>
                </span>
                <time>{dateTime(thread.latest_at || thread.updated_at)}</time>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <Icon name="comment" size={30} />
              <h2>Диалогов нет</h2>
              <p>В этой категории пока нет обращений.</p>
            </div>
          )}
        </div>
      </aside>

      <section className="support-admin__chat">
        {!chat ? (
          <div className="support-admin__placeholder">
            <Icon name="comment" size={34} />
            <strong>Выберите обращение</strong>
            <span>История диалога откроется здесь.</span>
          </div>
        ) : (
          <>
            <header className="support-admin__chat-head">
              <div>
                <strong>{chat.user?.display_name || (chat.user?.username ? `@${chat.user.username}` : `MAX #${chat.user?.provider_user_id || 0}`)}</strong>
                <span>Обращение #{chat.id} · {chat.status === 'open' ? 'открыто' : 'закрыто'}</span>
              </div>
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => void changeState()}>
                {chat.status === 'open' ? 'Закрыть' : 'Открыть снова'}
              </button>
            </header>
            <div className="support-admin__messages" ref={messageList}>
              {chat.messages.map((message) => (
                <article
                  key={message.id}
                  className={`support-admin__message support-admin__message--${message.sender}`}
                >
                  <small>{message.sender === 'staff' ? 'Поддержка' : 'Пользователь'}</small>
                  {message.media?.map((item) =>
                    item.mime_type.startsWith('video/') ? (
                      <video
                        key={item.id}
                        src={moderationApi.supportMediaURL(chat.id, item.id)}
                        controls
                        preload="metadata"
                      />
                    ) : (
                      <img
                        key={item.id}
                        src={moderationApi.supportMediaURL(chat.id, item.id)}
                        alt="Вложение пользователя"
                      />
                    ),
                  )}
                  {message.body && <p>{message.body}</p>}
                  <time>{dateTime(message.created_at)}</time>
                </article>
              ))}
            </div>
            <form className="support-admin__composer" onSubmit={submit}>
              {file && (
                <div className="support-admin__file">
                  <span>{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Убрать вложение">
                    <Icon name="close" size={15} />
                  </button>
                </div>
              )}
              <input
                ref={input}
                hidden
                type="file"
                accept={accept}
                onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] || null)
                  event.currentTarget.value = ''
                }}
              />
              <div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Прикрепить фото или видео"
                  disabled={busy || chat.status !== 'open'}
                  onClick={() => input.current?.click()}
                >
                  <Icon name="post" size={18} />
                </button>
                <textarea
                  value={body}
                  maxLength={2000}
                  placeholder={chat.status === 'open' ? 'Ответ пользователю' : 'Обращение закрыто'}
                  disabled={busy || chat.status !== 'open'}
                  onChange={(event) => setBody(event.target.value)}
                />
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={busy || chat.status !== 'open' || (!body.trim() && !file)}
                >
                  Отправить
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
