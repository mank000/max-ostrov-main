import { ControlOverlay } from '../ui/components/ControlOverlay'
import { SelectField } from '../ui/components/SelectField'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adminAction,
  adminAudit,
  adminContent,
  adminUsers,
  type AdminAction,
  type AdminAudit,
  type AdminContent,
  type AdminTarget,
  type AdminUser,
} from '../api/admin'
import { syncPosts } from '../data/postSync'
import { Button, Header, StatePanel } from '../ui/components/BasicUI'
import type { ScreenProps } from './screen-types'
import { AdminSupportPanel } from './AdminSupportPanel'
import './admin.css'

const labels: Record<AdminTarget, string> = {
  user: 'Пользователи',
  post: 'Публикации',
  comment: 'Комментарии',
  event: 'Мероприятия',
}
const actions: Record<string, string> = {
  hide: 'Удалено из приложения',
  restore: 'Восстановлено',
  suspend: 'Пользователь заблокирован',
  unsuspend: 'Пользователь разблокирован',
  dismiss: 'Жалоба отклонена',
}
type AdminTab = AdminTarget | 'support' | 'audit'

export default function AdminScreen({ data, back, host, onError }: ScreenProps) {
  const role = data.profile?.moderation_role
  const isAdministrator = role === 'administrator'
  const allowed = role === 'administrator' || role === 'moderator'
  const [tab, setTab] = useState<AdminTab>('support')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [content, setContent] = useState<AdminContent[]>([])
  const [audit, setAudit] = useState<AdminAudit[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<{
    type: AdminTarget
    id: number
    action: AdminAction
    title: string
  } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(async (before?: number) => {
    if (!isAdministrator || tab === 'support') {
      setLoading(false)
      return
    }
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setLoading(true)
    setError('')
    try {
      if (tab === 'user') {
        const r = await adminUsers(search, status, before, next.signal)
        if (next.signal.aborted) return
        setUsers((a) => before ? [...a, ...r.users] : r.users)
        setCursor(r.next_cursor)
      } else if (tab === 'audit') {
        const r = await adminAudit(before, next.signal)
        if (next.signal.aborted) return
        setAudit((a) => before ? [...a, ...r.actions] : r.actions)
        setCursor(r.next_cursor)
      } else {
        const r = await adminContent(tab, search, status, before, next.signal)
        if (next.signal.aborted) return
        setContent((a) => before ? [...a, ...r.content] : r.content)
        setCursor(r.next_cursor)
      }
    } catch (e) {
      if (!next.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!next.signal.aborted) setLoading(false)
    }
  }, [isAdministrator, tab, search, status])

  useEffect(() => {
    if (allowed && tab !== 'support') void load()
    return () => controller.current?.abort()
  }, [allowed, tab, load, revision])

  const choose = (value: AdminTab) => {
    setTab(value)
    setStatus('all')
    setQuery('')
    setSearch('')
    setUsers([])
    setContent([])
    setAudit([])
    setCursor(null)
    setError('')
  }

  const ask = (type: AdminTarget, id: number, action: AdminAction, title: string) => {
    setPending({ type, id, action, title })
    setReason('')
    setNotice('')
  }

  async function submit() {
    if (!pending || busy || reason.trim().length < 3) return
    setBusy(true)
    try {
      await adminAction(pending.type, pending.id, pending.action, reason.trim())
      setNotice(actions[pending.action])
      setPending(null)
      setRevision((n) => n + 1)
      syncPosts()
      data.refresh('feed', 'profilePosts', 'friends')
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tabs: AdminTab[] = isAdministrator
    ? ['support', ...(Object.keys(labels) as AdminTarget[]), 'audit']
    : ['support']

  return (
    <>
      <Header title={isAdministrator ? 'Админ-доступ' : 'Модерация'} back={back} />
      {!allowed ? (
        <StatePanel title="Недостаточно прав" />
      ) : (
        <div className="screen-scroll admin-screen">
          <div className="admin-intro">
            <strong>{isAdministrator ? 'Администратор · ∞ монет' : 'Модератор'}</strong>
            <p>
              {isAdministrator
                ? 'Поддержка пользователей, управление контентом и журнал действий.'
                : 'Обращения пользователей и инструменты команды модерации.'}
            </p>
            <Button variant="secondary" onClick={() => host.openLink('https://moderation.kutezh-social.ru/')}>
              Открыть отдельный кабинет
            </Button>
          </div>

          <div className="admin-tabs" role="tablist" aria-label="Разделы администрирования">
            {tabs.map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => choose(value)}
              >
                {value === 'support' ? 'Поддержка' : value === 'audit' ? 'Журнал' : labels[value]}
              </button>
            ))}
          </div>

          {tab === 'support' ? (
            <AdminSupportPanel />
          ) : (
            <>
              {isAdministrator && tab !== 'audit' && (
                <form
                  className="admin-search"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setSearch(query.trim())
                    setRevision((n) => n + 1)
                  }}
                >
                  <input
                    aria-label="Поиск в админ-разделе"
                    placeholder={tab === 'user' ? 'Имя, MAX ID или ID профиля' : 'Текст, ID записи или автора'}
                    maxLength={100}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <Button type="submit">Найти</Button>
                  <SelectField
                    label="Статус"
                    value={status}
                    onChange={setStatus}
                    className="admin-status-field"
                    options={[
                      { value: 'all', label: 'Все' },
                      ...(tab === 'user'
                        ? [{ value: 'suspended', label: 'Заблокированные' }, { value: 'active', label: 'Активные' }]
                        : [{ value: 'hidden', label: 'Удалённые модерацией' }, { value: 'visible', label: 'Опубликованные' }]),
                    ]}
                  />
                </form>
              )}

              {notice && <p className="admin-notice" role="status">{notice}</p>}
              {error && (
                <StatePanel title="Не удалось загрузить" description={error} action="Повторить" onAction={() => void load()} />
              )}

              {!error && tab === 'user' && users.map((u) => (
                <article className="admin-item" key={u.id}>
                  <h3>{u.display_name}</h3>
                  <p>MAX ID: {u.max_user_id || '—'} · Профиль #{u.id}</p>
                  <small>
                    {u.city} · {u.role === 'administrator' ? 'Администратор' : u.role === 'moderator' ? 'Модератор' : u.suspended ? 'Заблокирован' : 'Активен'}
                  </small>
                  {!u.role && u.id !== data.profile?.id && (
                    <Button
                      variant={u.suspended ? 'secondary' : 'destructive'}
                      onClick={() => ask('user', u.id, u.suspended ? 'unsuspend' : 'suspend', u.display_name)}
                    >
                      {u.suspended ? 'Разблокировать' : 'Заблокировать в приложении'}
                    </Button>
                  )}
                </article>
              ))}

              {!error && tab !== 'user' && tab !== 'audit' && content.map((c) => (
                <article className="admin-item" key={c.id}>
                  <h3>{c.author_name} · #{c.id}</h3>
                  <p>{c.text || 'Публикация с медиа'}</p>
                  <small>{c.hidden ? 'Удалено модерацией' : 'Опубликовано'} · {new Date(c.created_at).toLocaleDateString('ru-RU')}</small>
                  <Button
                    variant={c.hidden ? 'secondary' : 'destructive'}
                    onClick={() => ask(c.target_type, c.id, c.hidden ? 'restore' : 'hide', `${labels[c.target_type]} #${c.id}`)}
                  >
                    {c.hidden ? 'Восстановить' : 'Удалить из приложения'}
                  </Button>
                </article>
              ))}

              {!error && tab === 'audit' && audit.map((a) => (
                <article className="admin-item" key={a.id}>
                  <h3>{actions[a.action] || a.action}</h3>
                  <p>{a.reason}</p>
                  <small>
                    {labels[a.target_type]} #{a.target_id} · Администратор #{a.actor_user_id}<br />
                    {new Date(a.created_at).toLocaleString('ru-RU')}
                  </small>
                </article>
              ))}

              {!error && !loading && !(tab === 'user' ? users.length : tab === 'audit' ? audit.length : content.length) && (
                <StatePanel title="Ничего не найдено" />
              )}
              {loading && <p role="status">Загружаем…</p>}
              {cursor && (
                <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>
                  Показать ещё
                </Button>
              )}
            </>
          )}

          {pending && (
            <ControlOverlay title="Действие администратора" onClose={() => { if (!busy) setPending(null) }}>
              <form className="admin-confirm-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
                <h2>
                  {pending.action === 'suspend' ? 'Заблокировать?' : pending.action === 'unsuspend' ? 'Разблокировать?' : pending.action === 'hide' ? 'Удалить из приложения?' : 'Восстановить?'}
                </h2>
                <p>{pending.title}</p>
                <label>
                  Причина
                  <textarea
                    autoFocus
                    aria-label="Причина действия"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Укажите основание для журнала"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={busy || reason.trim().length < 3}
                  variant={pending.action === 'hide' || pending.action === 'suspend' ? 'destructive' : 'primary'}
                >
                  {busy ? 'Применяем…' : 'Подтвердить'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>Отмена</Button>
              </form>
            </ControlOverlay>
          )}
        </div>
      )}
    </>
  )
}
