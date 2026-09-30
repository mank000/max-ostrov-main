import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../api/auth'
import { startSession } from '../session'
import { clearCredentials, saveCredentials } from '../api/credentials'

type Status = 'loading' | 'guest' | 'authenticated'

export function useSession() {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthSession['user'] | null>(null)
  const [error, setError] = useState('')
  const requestNumber = useRef(0)
  const mounted = useRef(false)

  const accept = useCallback((session: AuthSession | null) => {
    ++requestNumber.current
    // Сохраняем токены здесь, после проверки актуальности запроса, а не внутри fetch.
    if (session) saveCredentials(session)
    else clearCredentials()
    setUser(session?.user ?? null)
    setStatus(session ? 'authenticated' : 'guest')
    setError('')
  }, [])

  const retry = useCallback(() => {
    const request = ++requestNumber.current
    setStatus('loading')
    setError('')
    void startSession().then(
      (session) => {
        // Старый ответ не должен снова залогинить пользователя после выхода.
        if (mounted.current && request === requestNumber.current) accept(session)
      },
      (cause: unknown) => {
        if (!mounted.current || request !== requestNumber.current) return
        setUser(null)
        setStatus('guest')
        setError(cause instanceof Error ? cause.message : 'Не удалось войти')
      },
    )
  }, [accept])

  useEffect(() => {
    mounted.current = true
    retry()
    return () => {
      mounted.current = false
      ++requestNumber.current
    }
  }, [retry])

  return { status, user, error, retry, accept }
}
