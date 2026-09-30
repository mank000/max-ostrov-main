import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { moderationApi, type Role, type TeamMember } from './api'
import './team.css'

export function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [maxId, setMAXId] = useState('')
  const [role, setRole] = useState<Role>('moderator')
  const [operation, setOperation] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await moderationApi.roles(controller.signal)
      if (!controller.signal.aborted) setMembers(result.members || [])
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить команду')
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    const id = Number(maxId)
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError('Введите числовой MAX ID')
      return
    }
    if (reason.trim().length < 8) {
      setError('Укажите основание не короче 8 символов')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await moderationApi.changeRole(id, role, operation, reason)
      setNotice(
        operation === 'grant'
          ? 'Роль выдана и записана в журнал'
          : 'Роль отозвана и записана в журнал',
      )
      setMAXId('')
      setReason('')
      setOperation('grant')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить роль')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="team-view">
      <div className="view-heading">
        <div>
          <h1>Команда модерации</h1>
          <p>Доступ связан с подтверждённым MAX ID. Изменения сохраняются в журнале.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Обновить команду"
          onClick={() => void load()}
        >
          ↻
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="queue-notice" role="status">
          ✓ {notice}
        </p>
      )}
      <div className="team-grid">
        <section className="team-card">
          <h2>Участники</h2>
          {loading && <p className="loading-state">Загружаем команду…</p>}
          {!loading && !members.length && <p className="team-muted">Участников пока нет.</p>}
          <div className="team-members">
            {members.map((member) => (
              <article className="team-member" key={member.user_id}>
                <span className="team-member__avatar">
                  {member.display_name?.slice(0, 1).toLocaleUpperCase('ru') || 'М'}
                </span>
                <div>
                  <strong>{member.display_name || `Пользователь #${member.user_id}`}</strong>
                  <small>MAX ID {member.max_user_id}</small>
                  <div className="team-member__roles">
                    {member.roles.map((item) => (
                      <span key={item}>
                        {item === 'administrator' ? 'Администратор' : 'Модератор'}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="team-member__select"
                  type="button"
                  onClick={() => {
                    setMAXId(String(member.max_user_id))
                    setRole(member.roles.includes('moderator') ? 'moderator' : 'administrator')
                    setOperation('revoke')
                    setReason('')
                    setError('')
                    setNotice('')
                  }}
                >
                  Изменить
                </button>
              </article>
            ))}
          </div>
        </section>
        <section className="team-card">
          <h2>{operation === 'grant' ? 'Выдать роль' : 'Отозвать роль'}</h2>
          <p className="team-muted">
            Пользователь должен войти в приложение через подтверждённый MAX аккаунт.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label" htmlFor="role-user">
              MAX ID
            </label>
            <input
              id="role-user"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={maxId}
              onChange={(event) => setMAXId(event.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="Числовой ID"
              required
            />
            <div className="team-form-row">
              <div>
                <label className="field-label" htmlFor="team-role">
                  Роль
                </label>
                <select
                  id="team-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                >
                  <option value="moderator">Модератор</option>
                  <option value="administrator">Администратор</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="team-operation">
                  Действие
                </label>
                <select
                  id="team-operation"
                  value={operation}
                  onChange={(event) => setOperation(event.target.value as 'grant' | 'revoke')}
                >
                  <option value="grant">Выдать</option>
                  <option value="revoke">Отозвать</option>
                </select>
              </div>
            </div>
            <label className="field-label" htmlFor="team-reason">
              Основание
            </label>
            <textarea
              id="team-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, 500))}
              rows={4}
              placeholder="Почему меняется доступ?"
              required
            />
            <button
              className={`button ${operation === 'grant' ? 'button--primary' : 'button--danger'}`}
              type="submit"
              disabled={saving || !maxId || reason.trim().length < 8}
            >
              {saving ? 'Сохраняем…' : operation === 'grant' ? 'Выдать доступ' : 'Отозвать доступ'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
