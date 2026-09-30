import { ManagePage } from './ManagePage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuditPage } from './AuditPage'
import { Login } from './Login'
import { ReportDetail, ReportRow, labels, statusLabels } from './Reports'
import { TeamPage } from './TeamPage'
import { SupportPage } from './SupportPage'
import {
  ApiError,
  moderationApi,
  type Decision,
  type Report,
  type ReportStatus,
  type Session,
  type TargetType,
} from './api'
import { Brand, Icon } from './ui'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [status, setStatus] = useState<ReportStatus>('open')
  const [kind, setKind] = useState<TargetType | 'all'>('all')
  const [view, setView] = useState<'queue' | 'support' | 'audit' | 'team' | 'manage'>('queue')
  const [reports, setReports] = useState<Report[]>([])
  const [cursor, setCursor] = useState<number>()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const pendingReports = useRef<AbortController | null>(null)
  const pendingDetail = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    moderationApi
      .session(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSession(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loadReports = useCallback(
    async (nextStatus: ReportStatus, beforeId?: number) => {
      pendingReports.current?.abort()
      const controller = new AbortController()
      pendingReports.current = controller
      setLoading(true)
      setError('')
      try {
        const page = await moderationApi.reports(nextStatus, kind, beforeId, controller.signal)
        if (controller.signal.aborted) return
        setReports((current) =>
          beforeId ? [...current, ...(page.reports || [])] : page.reports || [],
        )
        setCursor(page.next_cursor)
        if (!beforeId)
          setSelectedId((current) =>
            page.reports?.some((item) => item.id === current)
              ? current
              : (page.reports?.[0]?.id ?? null),
          )
      } catch (cause) {
        if (controller.signal.aborted) return
        if (cause instanceof ApiError && cause.status === 401) setSession(null)
        else setError(cause instanceof Error ? cause.message : 'Не удалось загрузить жалобы')
      } finally {
        if (pendingReports.current === controller) {
          pendingReports.current = null
          setLoading(false)
        }
      }
    },
    [kind],
  )
  useEffect(() => {
    setReports([])
    setSelectedId(null)
    setCursor(undefined)
    if (session && view === 'queue') void loadReports(status)
    return () => {
      pendingReports.current?.abort()
      pendingReports.current = null
      pendingDetail.current?.abort()
      pendingDetail.current = null
    }
  }, [session, status, view, reload, loadReports])
  const visibleReports = useMemo(
    () => (kind === 'all' ? reports : reports.filter((report) => report.target_type === kind)),
    [reports, kind],
  )
  const selected = visibleReports.find((report) => report.id === selectedId) || null

  async function selectReport(id: number) {
    pendingDetail.current?.abort()
    const controller = new AbortController()
    pendingDetail.current = controller
    setSelectedId(id)
    setMobileDetail(true)
    setError('')
    try {
      const latest = await moderationApi.report(id, controller.signal)
      if (controller.signal.aborted) return
      setReports((current) => current.map((item) => (item.id === id ? latest : item)))
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить жалобу')
    } finally {
      if (pendingDetail.current === controller) pendingDetail.current = null
    }
  }
  async function decide(action: Decision, reason: string) {
    if (!selected || saving) return false
    setSaving(true)
    setError('')
    try {
      await moderationApi.decide(selected.id, action, reason, selected.version)
      setNotice('Решение сохранено в журнале')
      setMobileDetail(false)
      setReload((value) => value + 1)
      return true
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const latest = await moderationApi.report(selected.id)
          setReports((current) => current.map((item) => (item.id === latest.id ? latest : item)))
          setError('Жалоба уже изменилась. Данные обновлены; проверьте решение ещё раз.')
        } catch (refreshError) {
          if (refreshError instanceof ApiError && refreshError.status === 401) setSession(null)
          else setError('Жалоба уже изменилась, но обновить её не удалось. Повторите загрузку.')
        }
      } else if (cause instanceof ApiError && cause.status === 401) setSession(null)
      else setError(cause instanceof Error ? cause.message : 'Не удалось сохранить решение')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function logout() {
    try {
      await moderationApi.logout()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выйти. Попробуйте снова.')
      return
    }
    pendingReports.current?.abort()
    pendingDetail.current?.abort()
    setSession(null)
    setReports([])
    setSelectedId(null)
    setCursor(undefined)
    setError('')
    setNotice('')
  }
  function navigate(next: typeof view, nextKind: typeof kind = 'all') {
    setView(next)
    setKind(nextKind)
    setMenuOpen(false)
    setMobileDetail(false)
  }

  if (checking)
    return (
      <div className="startup">
        <Brand />
        <p>Проверяем доступ…</p>
      </div>
    )
  if (!session) return <Login onSignedIn={setSession} />

  const navItems: Array<{
    title: string
    icon: Parameters<typeof Icon>[0]['name']
    action: () => void
    active: boolean
  }> = [
      {
        title: 'Очередь',
        icon: 'queue',
        action: () => navigate('queue'),
        active: view === 'queue' && kind === 'all',
      },
      {
        title: 'Пользователи',
        icon: 'person',
        action: () => navigate('queue', 'user'),
        active: view === 'queue' && kind === 'user',
      },
      {
        title: 'Публикации',
        icon: 'post',
        action: () => navigate('queue', 'post'),
        active: view === 'queue' && kind === 'post',
      },
      {
        title: 'Мероприятия',
        icon: 'event',
        action: () => navigate('queue', 'event'),
        active: view === 'queue' && kind === 'event',
      },
      {
        title: 'Комментарии',
        icon: 'comment',
        action: () => navigate('queue', 'comment'),
        active: view === 'queue' && kind === 'comment',
      },
      {
        title: 'Поддержка',
        icon: 'comment',
        action: () => navigate('support'),
        active: view === 'support',
      },
      {
        title: 'Журнал',
        icon: 'journal',
        action: () => navigate('audit'),
        active: view === 'audit',
      },
      ...(session.role === 'administrator'
        ? [
          {
            title: 'Управление',
            icon: 'person' as const,
            action: () => navigate('manage'),
            active: view === 'manage',
          },
          {
            title: 'Команда',
            icon: 'team' as const,
            action: () => navigate('team'),
            active: view === 'team',
          },
        ]
        : []),
    ]

  return (
    <div className="app-layout">
      <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
        <Brand />
        <nav aria-label="Разделы модерации">
          {navItems.map((item) => (
            <button
              key={item.title}
              className={`nav-item${item.active ? ' is-active' : ''}`}
              type="button"
              onClick={item.action}
            >
              <Icon name={item.icon} size={20} />
              {item.title}
              {item.title === 'Очередь' &&
                kind === 'all' &&
                status === 'open' &&
                reports.length > 0 && (
                  <span>
                    {reports.length}
                    {cursor ? '+' : ''}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <button type="button" onClick={() => void logout()}>
            <Icon name="logout" size={19} /> Выйти
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="topbar__menu"
            type="button"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div>
            <strong>Модерация</strong>
            <span>Кутёж · защищённый кабинет</span>
          </div>
          <div className="topbar__user">
            <span className="topbar__secure">
              <span /> Доступ защищён
            </span>
            <span className="topbar__avatar">{session.role === 'administrator' ? 'А' : 'М'}</span>
            <span className="topbar__identity">
              {session.role === 'administrator' ? 'Администратор' : 'Модератор'}
              <small>#{session.user_id}</small>
            </span>
          </div>
        </header>
        {view !== 'queue' && view !== 'support' && error && (
          <p className="queue-error" role="alert">
            {error}
          </p>
        )}
        {view === 'support' ? (
          <SupportPage />
        ) : view === 'manage' && session.role === 'administrator' ? (<ManagePage />) : view === 'audit' ? (
          <AuditPage session={session} />
        ) : view === 'team' ? (
          <TeamPage />
        ) : (
          <div className={`queue-layout${mobileDetail && selected ? ' queue-layout--detail' : ''}`}>
            <main className="queue-pane">
              <div className="queue-title">
                <div>
                  <h1>
                    {kind === 'all'
                      ? 'Очередь жалоб'
                      : `Жалобы: ${labels[kind].toLocaleLowerCase('ru')}`}
                  </h1>
                  <p>Проверяйте контекст и фиксируйте основание каждого решения.</p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Обновить жалобы"
                  onClick={() => void loadReports(status)}
                >
                  <Icon name="refresh" />
                </button>
              </div>
              <div className="queue-tabs" role="tablist" aria-label="Статус жалоб">
                {(Object.keys(statusLabels) as ReportStatus[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={status === item}
                    className={status === item ? 'is-active' : ''}
                    onClick={() => {
                      setStatus(item)
                      setMobileDetail(false)
                    }}
                  >
                    {statusLabels[item]}
                  </button>
                ))}
              </div>
              <div className="queue-filters">
                <label htmlFor="target-filter">Тип жалобы</label>
                <select
                  id="target-filter"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as typeof kind)
                    setSelectedId(null)
                  }}
                >
                  <option value="all">Все типы</option>
                  {(Object.keys(labels) as TargetType[]).map((item) => (
                    <option key={item} value={item}>
                      {labels[item]}
                    </option>
                  ))}
                </select>
                <span>
                  {visibleReports.length}
                  {cursor ? '+' : ''} в текущем списке
                </span>
              </div>
              {error && (
                <p className="queue-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="queue-notice" role="status">
                  <Icon name="check" size={17} />
                  {notice}
                </p>
              )}
              <div className="report-table">
                <div className="report-table__head">
                  <span>Тип</span>
                  <span>Содержимое / описание</span>
                  <span>Заявитель</span>
                  <span>Время</span>
                  <span>Статус</span>
                  <span />
                </div>
                {visibleReports.map((report) => (
                  <ReportRow
                    key={report.id}
                    report={report}
                    selected={report.id === selectedId}
                    onSelect={() => void selectReport(report.id)}
                  />
                ))}
                {!loading && !visibleReports.length && (
                  <div className="empty-state">
                    <Icon name="queue" size={31} />
                    <h2>Жалоб нет</h2>
                    <p>
                      {kind === 'all'
                        ? 'В этой категории пока пусто.'
                        : 'Попробуйте выбрать другой тип жалоб.'}
                    </p>
                  </div>
                )}
              </div>
              {loading && <p className="loading-state">Загружаем жалобы…</p>}
              {cursor && !loading && (
                <button
                  className="button button--secondary load-more"
                  type="button"
                  onClick={() => void loadReports(status, cursor)}
                >
                  Показать ещё
                </button>
              )}
            </main>
            {selected ? (
              <ReportDetail
                key={selected.id}
                report={selected}
                role={session.role}
                busy={saving}
                onDecision={decide}
                onBack={() => setMobileDetail(false)}
              />
            ) : (
              <aside className="inspector inspector--empty">
                <Icon name="queue" size={30} />
                <h2>Выберите жалобу</h2>
                <p>Здесь появятся материалы и доступные решения.</p>
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
