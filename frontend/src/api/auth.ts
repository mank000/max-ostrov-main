import { request } from './http'
import { clearCredentials } from './credentials'

export type AuthSession = {
  user: {
    id: number
    first_name: string
    last_name?: string
    language_code?: string
    photo_url?: string
  }
  expires_at: string
  access_token?: string
  media_token?: string
  realtime_token?: string
}

export function authenticateMAX(initData: string) {
  return request<AuthSession>('/auth/max', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kutezh-Session-Transport': 'bearer' },
    body: JSON.stringify({ init_data: initData }),
  })
}

export function loadSession(signal?: AbortSignal) {
  return request<AuthSession>('/auth/session', {
    signal,
    headers: { 'X-Kutezh-Session-Transport': 'bearer' },
  })
}

export async function sendPresenceHeartbeat(signal?: AbortSignal) {
  return request<void>('/users/me/presence', { method: 'POST', signal }, 5000)
}

export async function loadAppInfo(signal?: AbortSignal) {
  return request<{ max_bot_username?: string; demo_mode?: boolean; moderation_url?: string }>('/app-info', { signal })
}

export async function logout() {
  await request<void>('/auth/logout', { method: 'POST' })
  clearCredentials()
}
