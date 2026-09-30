// MAX Web embeds the app cross-site. Some browsers deny all iframe cookies,
// including partitioned cookies, so keep a tab-scoped session as well.
type Credentials = {
  access_token: string
  media_token: string
  realtime_token: string
  expires_at: string
}

const storageKey = 'kutezh:session:v1'
let credentials: Credentials | null = null

function valid(value: Partial<Credentials> | null): value is Credentials {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value.access_token || '') &&
    /^[A-Za-z0-9_-]{99}$/.test(value.media_token || '') &&
    /^[A-Za-z0-9_-]{99}$/.test(value.realtime_token || '') &&
    Date.parse(value.expires_at || '') > Date.now())
}

try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null') as Partial<Credentials> | null
  if (valid(saved)) credentials = saved
  else sessionStorage.removeItem(storageKey)
} catch { /* Restricted WebViews may also deny storage; memory still works. */ }

export function saveCredentials(value: Partial<Credentials>) {
  credentials = valid(value) ? {
    access_token: value.access_token,
    media_token: value.media_token,
    realtime_token: value.realtime_token,
    expires_at: value.expires_at,
  } : null
  try {
    if (credentials) sessionStorage.setItem(storageKey, JSON.stringify(credentials))
    else sessionStorage.removeItem(storageKey)
  } catch { /* Keep the live session even if persistence is unavailable. */ }
}

export function clearCredentials() {
  credentials = null
  try { sessionStorage.removeItem(storageKey) } catch { /* Storage can be blocked. */ }
}

export function accessToken() { return credentials?.access_token || '' }

export function sessionHeaders(): Record<string, string> {
  const token = accessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Full session tokens never go into URLs. Read tickets are accepted only by
// their designated endpoint, whose normal visibility checks still apply.
export function mediaURL(source: string): string
export function mediaURL(source: string | undefined): string | undefined
export function mediaURL(source: string | undefined): string | undefined {
  if (!source || !credentials) return source
  try {
    const url = new URL(source, window.location.origin)
    if (url.origin !== window.location.origin || !/^\/api\/v1\/media\/[1-9]\d*\/content$/.test(url.pathname)) return source
    url.searchParams.set('resource_token', credentials.media_token)
    return url.href
  } catch { return source }
}

export function realtimeURL() {
  return credentials
    ? `/api/v1/realtime?resource_token=${encodeURIComponent(credentials.realtime_token)}`
    : '/api/v1/realtime'
}
