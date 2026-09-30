import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  adminSupport,
  adminSupportClose,
  adminSupportMedia,
  adminSupportReopen,
  adminSupportReply,
  adminSupportThread,
  type AdminSupportAttachment,
  type AdminSupportChat,
  type AdminSupportStatus,
  type AdminSupportThread,
} from '../api/admin'
import { Button, Icon, StatePanel } from '../ui/components/BasicUI'

const fileAccept = 'image/jpeg,image/png,video/mp4,video/quicktime,.jpg,.jpeg,.png,.mp4,.mov'
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function ProtectedMedia({ threadId, item }: { threadId: number; item: AdminSupportAttachment }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let objectURL = ''
    adminSupportMedia(threadId, item.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectURL = URL.createObjectURL(blob)
        setUrl(objectURL)
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => {
      controller.abort()
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [threadId, item.id])
  if (failed) return <span className="admin-support-media-error">Вложение недоступно</span>
  if (!url) return <span className="admin-support-media-loading">Загрузка вложения…</span>
  return item.mime_type.startsWith('video/')
    ? <video src={url} controls preload="metadata" />
    : <img src={url} alt="Вложение в обращении" />
}

export function AdminSupportPanel() {
  const [status, setStatus] = useState<AdminSupportStatus>('open')
  const [threads, setThreads] = useState<AdminSupportThread[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [chat, setChat] = useState<AdminSupportChat | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const messages = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await adminSupport(status)
      const next = result.threads || []
      setThreads(next)
      setSelectedId((current) => current && next.some((thread) => thread.id === current) ? current : (next[0]?.id ?? null))
      if (!silent) setError('')
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить обращения')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [status])

  const loadChat = useCallback(async (id: number, silent = false) => {
    try {
      setChat(await adminSupportThread(id))
      if (!silent) setError('')
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'Не удалось открыть диалог')
    }
  }, [])

  useEffect(() => {
    setChat(null)
    setSelectedId(null)
    void loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (!selectedId) { setChat(null); return }
    void loadChat(selectedId)
  }, [selectedId, loadChat])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || busy) return
      void loadThreads(true)
      if (selectedId) void loadChat(selectedId, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [busy, loadThreads, loadChat, selectedId])

  useEffect(() => {
    const element = messages.current
    if (!element) return
    requestAnimationFrame(() => { element.scrollTop = element.scrollHeight })
  }, [chat?.messages.length])

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!chat || busy || chat.status !== 'open' || (!body.trim() && !file)) return
    setBusy(true)
    setError('')
    try {
      await adminSupportReply(chat.id, body, file)
      setBody('')
      setFile(null)
      await Promise.all([loadChat(chat.id), loadThreads(true)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить ответ')
    } finally {
      setBusy(false)
    }
  }

  async function toggleClosed() {
    if (!chat || busy) return
    setBusy(true)
    setError('')
    try {
      if (chat.status === 'open') await adminSupportClose(chat.id)
      else await adminSupportReopen(chat.id)
      setChat(null)
      await loadThreads()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус обращения')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-support">
      <div className="admin-support-toolbar">
        <div>
          <strong>Чаты пользователей</strong>
          <small>Ответы появляются у пользователя прямо в разделе «Поддержка».</small>
        </div>
        <button type="button" className="admin-support-refresh" onClick={() => void loadThreads()}>
          <Icon name="more" size={20} /> Обновить
        </button>
      </div>
      <div className="admin-support-filters" role="tablist" aria-label="Статус обращений">
        {([['open', 'Открытые'], ['closed', 'Закрытые'], ['all', 'Все']] as Array<[AdminSupportStatus, string]>).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      {error && <p className="admin-support-error" role="alert">{error}</p>}
      <div className="admin-support-layout">
        <aside className="admin-support-list">
          {loading ? <StatePanel title="" loading /> : threads.length ? threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`admin-support-thread${selectedId === thread.id ? ' is-active' : ''}`}
              onClick={() => setSelectedId(thread.id)}
            >
              <span className="admin-support-avatar">{(thread.display_name || thread.username || 'П')[0]?.toLocaleUpperCase('ru')}</span>
              <span className="admin-support-thread-copy">
                <strong>{thread.display_name || (thread.username ? `@${thread.username}` : `MAX #${thread.provider_user_id}`)}</strong>
                <small>{thread.latest_body || 'Вложение'}</small>
              </span>
              <time>{dateTime.format(new Date(thread.latest_at || thread.updated_at))}</time>
            </button>
          )) : <StatePanel title="Обращений нет" description="В этой категории пока пусто." />}
        </aside>
        <section className="admin-support-chat">
          {!chat ? (
            <StatePanel title="Выберите обращение" description="Здесь появится история диалога и поле ответа." />
          ) : (
            <>
              <header className="admin-support-chat-head">
                <div>
                  <strong>{chat.user?.display_name || (chat.user?.username ? `@${chat.user.username}` : `MAX #${chat.user?.provider_user_id || 0}`)}</strong>
                  <small>Обращение #{chat.id} · {chat.status === 'open' ? 'открыто' : 'закрыто'}</small>
                </div>
                <Button variant="secondary" disabled={busy} onClick={() => void toggleClosed()}>
                  {chat.status === 'open' ? 'Закрыть' : 'Открыть снова'}
                </Button>
              </header>
              <div className="admin-support-messages" ref={messages}>
                {chat.messages.map((message) => (
                  <article key={message.id} className={`admin-support-message admin-support-message--${message.sender}`}>
                    <small>{message.sender === 'staff' ? 'Поддержка' : 'Пользователь'}</small>
                    {message.media?.map((item) => <ProtectedMedia key={item.id} threadId={chat.id} item={item} />)}
                    {message.body && <p>{message.body}</p>}
                    <time>{dateTime.format(new Date(message.created_at))}</time>
                  </article>
                ))}
              </div>
              <form className="admin-support-composer" onSubmit={send}>
                {file && (
                  <div className="admin-support-file">
                    <span>{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} aria-label="Убрать вложение"><Icon name="close" size={16} /></button>
                  </div>
                )}
                <input ref={fileInput} hidden type="file" accept={fileAccept} onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] || null)
                  event.currentTarget.value = ''
                }} />
                <div className="admin-support-composer-row">
                  <button
                    type="button"
                    className="admin-support-attach"
                    aria-label="Прикрепить фото или видео"
                    disabled={busy || chat.status !== 'open'}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="paperclip" size={20} />
                  </button>
                  <textarea
                    value={body}
                    maxLength={2000}
                    placeholder={chat.status === 'open' ? 'Ответ пользователю' : 'Обращение закрыто'}
                    disabled={busy || chat.status !== 'open'}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <Button type="submit" disabled={busy || chat.status !== 'open' || (!body.trim() && !file)}>Отправить</Button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
