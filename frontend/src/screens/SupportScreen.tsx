import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  loadSupportChat,
  sendSupportMessage,
  supportAttachmentURL,
  SUPPORT_FILE_ACCEPT,
  type SupportChat,
} from '../api/support'
import { Button, Header, Icon, StatePanel } from '../ui/components/BasicUI'
import type { ScreenProps } from './screen-types'
import './support.css'

const timeFormat = new Intl.DateTimeFormat('ru', {
  hour: '2-digit',
  minute: '2-digit',
})

export function SupportScreen({ back, data, navigate }: ScreenProps) {
  const [chat, setChat] = useState<SupportChat | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const thread = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadSupportChat(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setChat(value)
          setError('')
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть поддержку')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    const timer = window.setInterval(() => {
      if (document.hidden || busy) return
      loadSupportChat().then(setChat).catch(() => {})
    }, 5000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [busy])

  useEffect(() => {
    const element = thread.current
    if (!element) return
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
    })
  }, [chat?.messages.length])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || (!body.trim() && !file)) return
    setBusy(true)
    setError('')
    try {
      await sendSupportMessage(body, file)
      setBody('')
      setFile(null)
      setChat(await loadSupportChat())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить сообщение')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header
        title="Поддержка"
        back={back}
        actions={data.profile?.moderation_role ? (
          <Button variant="secondary" onClick={() => navigate('admin')}>
            Чаты пользователей
          </Button>
        ) : undefined}
      />
      <div className="support-screen">
        <div className="support-thread" ref={thread}>
          {loading ? (
            <StatePanel title="" loading />
          ) : (
            <>
              <div className="support-intro">
                <span className="support-intro__icon"><Icon name="message" size={24} /></span>
                <div>
                  <strong>Техподдержка Кутёжа</strong>
                  <p>Опишите вопрос или проблему. Можно приложить фото или видео — ответ появится прямо здесь.</p>
                </div>
              </div>
              {chat?.messages.map((message) => (
                <article
                  className={`support-message support-message--${message.sender === 'user' ? 'mine' : 'staff'}`}
                  key={message.id}
                >
                  <div className="support-message__author">
                    {message.sender === 'user' ? 'Вы' : 'Поддержка'}
                  </div>
                  {message.media?.length > 0 && (
                    <div className="support-message__media">
                      {message.media.map((item) =>
                        item.mime_type.startsWith('video/') ? (
                          <video key={item.id} src={supportAttachmentURL(item)} controls preload="metadata" />
                        ) : (
                          <img key={item.id} src={supportAttachmentURL(item)} alt="Вложение к сообщению" />
                        ),
                      )}
                    </div>
                  )}
                  {message.body && <p>{message.body}</p>}
                  <time dateTime={message.created_at}>{timeFormat.format(new Date(message.created_at))}</time>
                </article>
              ))}
              {!chat?.messages.length && (
                <p className="support-empty">Здесь появится история вашего диалога с поддержкой.</p>
              )}
              {chat?.status === 'closed' && (
                <p className="support-closed">Обращение закрыто. Новое сообщение автоматически откроет его снова.</p>
              )}
            </>
          )}
        </div>

        <form className="support-composer" onSubmit={submit}>
          {error && <p className="support-error" role="alert">{error}</p>}
          {file && (
            <div className="support-file">
              <Icon name={file.type.startsWith('video/') ? 'film' : 'photo'} size={18} />
              <span>{file.name}</span>
              <button type="button" aria-label="Убрать вложение" onClick={() => setFile(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <div className="support-composer__row">
            <input
              ref={fileInput}
              className="support-file-input"
              type="file"
              accept={SUPPORT_FILE_ACCEPT}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] || null)
                event.currentTarget.value = ''
              }}
            />
            <button
              className="support-attach"
              type="button"
              aria-label="Прикрепить фото или видео"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="paperclip" size={22} />
            </button>
            <textarea
              value={body}
              maxLength={2000}
              rows={1}
              placeholder="Сообщение в поддержку"
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
            <button
              className="support-send"
              type="submit"
              aria-label="Отправить"
              disabled={busy || (!body.trim() && !file)}
            >
              <Icon name="send" size={20} />
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
