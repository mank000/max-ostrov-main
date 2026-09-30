import { type FormEvent, useEffect, useState } from 'react'
import { moderationApi, type Session } from './api'
import { Brand, Icon } from './ui'

export function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [demo, setDemo] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/v1/app-info', { signal: controller.signal }).then((response) => response.json()).then((info) => {
      if (!controller.signal.aborted) setDemo(info.demo_mode === true)
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  const [maxId, setMAXId] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (seconds <= 0) {
      return
    }
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    const id = Number(maxId)
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError('Введите ваш числовой MAX ID')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await moderationApi.challenge(id)
      setChallengeId(result.challenge_id)
      setCode('')
      setSeconds(result.expires_in_seconds || 300)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить код')
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (!challengeId || !/^\d{10}$/.test(code)) {
      setError('Введите код из сообщения бота')
      return
    }
    setBusy(true)
    setError('')
    try {
      onSignedIn(await moderationApi.verify(challengeId, code))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Код не подошёл или истёк')
    } finally {
      setBusy(false)
    }
  }

  async function enterDemo() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/v1/demo/moderation-session', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Не удалось войти в демоверсию')
      onSignedIn(await response.json() as Session)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  if (demo) return <main className="login-shell"><div className="login-card">
    <Brand /><h1>Демо модерации</h1>
    <p>Локальная база с вымышленными пользователями. Код из MAX не нужен.</p>
    {error && <p role="alert">{error}</p>}
    <button className="button button--primary login-button" type="button" disabled={busy} onClick={() => void enterDemo()}>
      {busy ? 'Входим…' : 'Войти администратором'}
    </button>
  </div></main>

  return (
    <div className="login-shell">
      <div className="login-card">
        <Brand />
        {!challengeId ? (
          <form onSubmit={(event) => void requestCode(event)}>
            <h1>Вход для команды</h1>
            <p className="login-intro">Одноразовый код придёт в личный чат с ботом MAX.</p>
            <label
              className="field-label"
              htmlFor="max-id"
            >
              Ваш MAX ID
            </label>
            <input
              id="max-id"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="username"
              value={maxId}
              onChange={(event) => setMAXId(event.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="Числовой ID аккаунта"
              required
            />
            <p className="field-help">
              Откройте чат с ботом и отправьте /id, чтобы узнать свой ID.
            </p>
            {error && (
              <p
                className="form-error"
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              className="button button--primary login-button"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Отправляем…' : 'Получить код'}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void verify(event)}>
            <button
              className="login-back"
              type="button"
              onClick={() => {
                setChallengeId('')
                setCode('')
                setError('')
              }}
            >
              <Icon
                name="arrow"
                size={18}
              />{' '}
              Изменить ID
            </button>
            <h1>Введите код</h1>
            <p className="login-intro">Мы отправили код в ваш личный чат с ботом в MAX.</p>
            <label
              className="field-label"
              htmlFor="one-time-code"
            >
              Одноразовый код
            </label>
            <input
              id="one-time-code"
              className="code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="Код из сообщения"
              required
            />
            <p className="field-help">Код действует {Math.ceil(seconds / 60)} мин.</p>
            {error && (
              <p
                className="form-error"
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              className="button button--primary login-button"
              type="submit"
              disabled={busy || code.length !== 10}
            >
              {busy ? 'Проверяем…' : 'Войти'}
            </button>
            <button
              className="login-resend"
              type="button"
              disabled={seconds > 0 || busy}
              onClick={() => void requestCode()}
            >
              {seconds > 0
                ? `Новый код через ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
                : 'Отправить новый код'}
            </button>
          </form>
        )}
        <p className="login-security">
          <Icon
            name="lock"
            size={17}
          />{' '}
          Доступ только для администраторов и модераторов.
        </p>
      </div>
    </div>
  )
}
