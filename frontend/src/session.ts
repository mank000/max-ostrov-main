import { authenticateMAX, loadSession, type AuthSession } from './api/auth'
import { ApiError } from './api/http'
import { getHost } from './host'

let pending: Promise<AuthSession | null> | undefined
let pendingIdentity = ''

export function startSession(): Promise<AuthSession | null> {
  const host = getHost()
  const identity = `${host.provider}:${host.initData}`
  if (!pending || pendingIdentity !== identity) {
    pendingIdentity = identity
    const request: Promise<AuthSession | null> = (async () => {
      if (host.provider === 'max' && host.initData) return authenticateMAX(host.initData)
      try {
        return await loadSession()
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        return null
      }
    })().finally(() => {
      if (pending === request) pending = undefined
    })
    pending = request
  }
  return pending
}
