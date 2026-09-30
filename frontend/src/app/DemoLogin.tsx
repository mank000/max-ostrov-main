import { useEffect, useState } from 'react'
import { type AuthSession } from '../api/auth'
import { request } from '../api/http'
import './demo.css'

type Account = { id: number; name: string; role: string }

export function DemoLogin({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void request<Account[]>('/demo/accounts', { signal: controller.signal }).then((items) => {
      if (!controller.signal.aborted) setAccounts(items)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить профили')
    })
    return () => controller.abort()
  }, [])

  async function signIn(userID: number) {
    if (busy !== null) return
    setBusy(userID)
    setError('')
    try {
      const session = await request<AuthSession>('/demo/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kutezh-Session-Transport': 'bearer' },
        body: JSON.stringify({ user_id: userID }),
      })
      onSignedIn(session)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти')
      setBusy(null)
    }
  }

  return <main className="demo-login">
    <span className="demo-label">Локальная демоверсия</span>
    <h1>Остров</h1>
    <p>Выберите тестовый профиль. MAX и регистрация не нужны.</p>
    <div className="demo-accounts">
      {accounts.map((account) => <button key={account.id} type="button" disabled={busy !== null}
        onClick={() => void signIn(account.id)}>
        <strong>{account.name}</strong>
        <span>{busy === account.id ? 'Входим…' : account.role}</span>
      </button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="demo-explanation">Профили, встречи и монеты вымышлены. Изменения сохраняются в локальной базе. Не используйте здесь личные данные.</p>
  </main>
}
