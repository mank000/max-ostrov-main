export type VerificationTier = 'none' | 'age' | 'full'

export type Profile = {
  user_id: number
  name: string
  age: number
  gender: 'man' | 'woman' | ''
  city: string
  bio: string
  goal: 'chat' | 'date' | 'relationship'
  photos?: string[]
  photo: string
  religion?: 'orthodox' | 'catholic' | 'islam' | 'buddhism' | 'judaism' | 'atheism' | 'agnostic' | 'other' | ''
  smoking?: 'no' | 'sometimes' | 'yes' | ''
  drinking?: 'no' | 'sometimes' | 'yes' | ''
  worldview?: 'traditional' | 'modern' | 'balanced' | 'spiritual' | 'rational' | 'no_label' | ''
  interests?: string[]
  show_gender?: 'all' | 'man' | 'woman'
  min_age?: number
  max_age?: number
  same_city_only?: boolean
  verified_only?: boolean
  verification_tier?: VerificationTier
  is_paused?: boolean
}

export type Match = Profile & { match_id: number }
export type WeeklyStats = {
  matches: number
  liked_by_me: number
  liked_me: number
}
export type ChatTarget = { max_chat_id: string }
export type Session = { user_id: number; name: string; source: Profile | null; profile: Profile | null }

const base = import.meta.env.VITE_API_URL || '/api'
export function readStorage(key: string, session = false): string | null {
  try { return (session ? sessionStorage : localStorage).getItem(key) } catch { return null }
}
export function writeStorage(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* Storage is optional in embedded clients. */ }
}
let userId = Number(readStorage('dating-user-id') || 0)

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  const saved = readStorage('kutezh:session:v1', true)
  if (saved) {
    try {
      const token = JSON.parse(saved)?.access_token
      if (typeof token === 'string') headers['X-Kutezh-Session'] = token
    } catch { /* Main Mini App session is unavailable. */ }
  }
  if (!headers['X-Kutezh-Session'] && userId) headers['X-User-Id'] = String(userId)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(base + path, {
    method,
    signal,
    headers,
    credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Dating API недоступен. Перезапусти локальный preview.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Ошибка ${response.status}`)
  }
  return response.json()
}

export function saveUserId(id: number) {
  userId = id
  writeStorage('dating-user-id', String(id))
}

export function clearUserId() {
  userId = 0
  writeStorage('dating-user-id', null)
}

export function profilePhotoUrl(source: string) {
  try {
    const appUrl = import.meta.env.VITE_KUTEZH_APP_URL || window.location.origin
    const url = new URL(source, appUrl)
    const appOrigin = new URL(appUrl).origin
    if (url.origin === appOrigin && /^\/api\/v1\/media\/[1-9]\d*\/content$/.test(url.pathname)) {
      const saved = JSON.parse(readStorage('kutezh:session:v1', true) || 'null')
      if (typeof saved?.media_token === 'string') url.searchParams.set('resource_token', saved.media_token)
    }
    return url.href
  } catch {
    return source
  }
}

