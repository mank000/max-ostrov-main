import { useCallback, useEffect, useRef, useState } from 'react'
import { labels } from './Reports'
import { moderationApi, type AuditAction, type Session } from './api'
import { Icon, dateTime } from './ui'

export function AuditPage({ session }: { session: Session }) {
  const [actions, setActions] = useState<AuditAction[]>([])
  const [cursor, setCursor] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const load = useCallback(async (beforeId?: number) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError('')
    try {
      const page = await moderationApi.audit(beforeId, controller.signal)
      if (controller.signal.aborted) return
      setActions((current) =>
        beforeId ? [...current, ...(page.actions || [])] : page.actions || [],
      )
      setCursor(page.next_cursor)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить журнал')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setLoading(false)
      }
    }
  }, [])
  useEffect(() => {
    void load()
    return () => {
      pending.current?.abort()
      pending.current = null
    }
  }, [load])
  return (
    <main className="audit-view">
      <div className="view-heading">
        <div>
          <h1>Журнал решений</h1>
          <p>Действия команды сохраняются с автором и временем.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Обновить журнал"
          onClick={() => void load()}
        >
          <Icon name="refresh" />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="audit-list">
        {actions.map((item) => (
          <article key={item.id} className="audit-row">
            <span className="audit-row__icon">
              <Icon name="journal" />
            </span>
            <div>
              <strong>{item.action}</strong>
              <p>{item.reason}</p>
              <small>
                Модератор #{item.actor_user_id}
                {item.actor_user_id === session.user_id ? ' · вы' : ''} ·{' '}
                {item.target_type && `${labels[item.target_type]} #${item.target_id} · `}
                {dateTime(item.created_at)}
              </small>
            </div>
          </article>
        ))}
        {!loading && !actions.length && !error && (
          <div className="empty-state">
            <Icon name="journal" size={30} />
            <h2>Записей пока нет</h2>
            <p>Решения по жалобам появятся здесь.</p>
          </div>
        )}
      </div>
      {loading && <p className="loading-state">Загружаем журнал…</p>}
      {cursor && !loading && (
        <button
          className="button button--secondary load-more"
          type="button"
          onClick={() => void load(cursor)}
        >
          Показать ещё
        </button>
      )}
    </main>
  )
}
