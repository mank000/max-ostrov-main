import { useCallback, useEffect, useRef, useState } from 'react'
import {
  moderationApi,
  type ManagedContent,
  type ManagedUser,
  type TargetType,
} from './api'
import './manage.css'
const labels = {
  user: 'Пользователи',
  post: 'Публикации',
  comment: 'Комментарии',
  event: 'Мероприятия',
}
export function ManagePage() {
  const [kind, setKind] = useState<TargetType>('user'),
    [status, setStatus] = useState('all'),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState('')
  const [users, setUsers] = useState<ManagedUser[]>([]),
    [content, setContent] = useState<ManagedContent[]>([]),
    [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<{
      type: TargetType
      id: number
      action: 'hide' | 'restore' | 'suspend' | 'unsuspend'
      title: string
    } | null>(null),
    [reason, setReason] = useState('')
  const abort = useRef<AbortController | null>(null)
  const load = useCallback(
    async (before?: number) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setLoading(true)
      setError('')
      try {
        if (kind === 'user') {
          const r = await moderationApi.users(
            search,
            status,
            before,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setUsers((a) => (before ? [...a, ...r.users] : r.users))
          setCursor(r.next_cursor)
        } else {
          const r = await moderationApi.content(
            kind,
            search,
            status,
            before,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setContent((a) => (before ? [...a, ...r.content] : r.content))
          setCursor(r.next_cursor)
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [kind, status, search],
  )
  useEffect(() => {
    void load()
    return () => abort.current?.abort()
  }, [load, revision])
  function ask(
    type: TargetType,
    id: number,
    action: NonNullable<typeof pending>['action'],
    title: string,
  ) {
    setPending({ type, id, action, title })
    setReason('')
    setNotice('')
  }
  async function submit() {
    if (!pending || busy || reason.trim().length < 3) return
    setBusy(true)
    setError('')
    try {
      await moderationApi.manage(
        pending.type,
        pending.id,
        pending.action,
        reason.trim(),
      )
      setPending(null)
      setNotice('Действие выполнено и записано в журнал')
      setRevision((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="manage-page">
      <h1>Управление</h1>
      <p>Поиск, блокировки и восстановление контента без создания жалобы.</p>
      <div
        className="queue-tabs"
        role="tablist"
        aria-label="Объекты управления"
      >
        {(Object.keys(labels) as TargetType[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'is-active' : ''}
            onClick={() => {
              setKind(k)
              setStatus('all')
              setUsers([])
              setContent([])
              setCursor(null)
              setSearch('')
              setQuery('')
            }}
          >
            {labels[k]}
          </button>
        ))}
      </div>
      <form
        className="manage-filters"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(query.trim())
          setRevision((n) => n + 1)
        }}
      >
        <input
          aria-label="Поиск"
          placeholder={kind === 'user' ? 'Имя или MAX ID' : 'Текст или ID'}
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Статус"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Все</option>
          {kind === 'user' ? (
            <>
              <option value="suspended">Заблокированные</option>
              <option value="active">Активные</option>
            </>
          ) : (
            <>
              <option value="hidden">Удалённые модерацией</option>
              <option value="visible">Опубликованные</option>
            </>
          )}
        </select>
        <button className="button button--primary">Найти</button>
      </form>
      {notice && (
        <p role="status" className="queue-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {kind === 'user'
        ? users.map((u) => (
            <article className="manage-item" key={u.id}>
              <div>
                <h2>{u.display_name}</h2>
                <p>
                  MAX ID: {u.max_user_id || '—'} · Профиль #{u.id} · {u.city}
                </p>
                <small>
                  {u.role === 'administrator'
                    ? 'Администратор'
                    : u.role === 'moderator'
                      ? 'Модератор'
                      : u.suspended
                        ? 'Заблокирован'
                        : 'Активен'}
                </small>
              </div>
              {!u.role && (
                <button
                  className="button"
                  onClick={() =>
                    ask(
                      'user',
                      u.id,
                      u.suspended ? 'unsuspend' : 'suspend',
                      u.display_name,
                    )
                  }
                >
                  {u.suspended ? 'Разблокировать' : 'Заблокировать'}
                </button>
              )}
            </article>
          ))
        : content.map((c) => (
            <article className="manage-item" key={c.id}>
              <div>
                <h2>
                  {c.author_name} · #{c.id}
                </h2>
                <p>{c.text || 'Публикация с медиа'}</p>
                <small>
                  {c.hidden ? 'Удалено модерацией' : 'Опубликовано'}
                </small>
              </div>
              <button
                className="button"
                onClick={() =>
                  ask(
                    c.target_type,
                    c.id,
                    c.hidden ? 'restore' : 'hide',
                    `${labels[c.target_type]} #${c.id}`,
                  )
                }
              >
                {c.hidden ? 'Восстановить' : 'Удалить из приложения'}
              </button>
            </article>
          ))}
      {loading && <p role="status">Загружаем…</p>}
      {!loading && !(kind === 'user' ? users.length : content.length) && (
        <p>Ничего не найдено</p>
      )}
      {cursor && (
        <button
          className="button"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          Показать ещё
        </button>
      )}
      {pending && (
        <div className="manage-backdrop">
          <form
            className="manage-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение действия"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <h2>
              {pending.action === 'suspend'
                ? 'Заблокировать?'
                : pending.action === 'unsuspend'
                  ? 'Разблокировать?'
                  : pending.action === 'hide'
                    ? 'Удалить из приложения?'
                    : 'Восстановить?'}
            </h2>
            <p>{pending.title}</p>
            <label>
              Причина
              <textarea
                autoFocus
                aria-label="Причина"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Отмена
              </button>
              <button
                className="button button--primary"
                disabled={busy || reason.trim().length < 3}
              >
                {busy ? 'Применяем…' : 'Подтвердить'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
