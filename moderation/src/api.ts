export type Role = 'moderator' | 'administrator'
export type TargetType = 'user' | 'post' | 'event' | 'comment'
export type ReportStatus = 'open' | 'reviewed' | 'dismissed'
export type Decision = 'dismiss' | 'hide' | 'restore' | 'suspend' | 'unsuspend'

export type ManagedUser = { id: number; max_user_id: number; display_name: string; username: string; city: string; role: string; suspended: boolean }
export type ManagedContent = { id: number; target_type: TargetType; author_id: number; author_name: string; text: string; hidden: boolean }
export type Session = { user_id: number; role: Role }
type Challenge = { challenge_id: string; expires_in_seconds: number }
export type Report = {
  media?: Array<{ id: number; mime_type: string }>
  id: number
  target_type: TargetType
  target_id: number
  reason: string
  target_snapshot: Record<string, unknown> | null
  status: ReportStatus
  version: number
  reporter_user_id: number | null
  reviewed_by_user_id?: number | null
  created_at: string
  reviewed_at?: string | null
}
export type AuditAction = {
  id: number
  actor_user_id: number
  report_id?: number | null
  target_type?: TargetType
  target_id?: number
  action: string
  reason: string
  created_at: string
}
export type TeamMember = {
  user_id: number
  max_user_id: number
  display_name: string
  roles: Role[]
}

export type SupportStatus = 'open' | 'closed' | 'all'
export type SupportAttachment = {
  id: number
  mime_type: string
  width: number
  height: number
  duration_ms: number
  url: string
}
export type SupportMessage = {
  id: number
  sender: 'user' | 'staff'
  body: string
  created_at: string
  media: SupportAttachment[]
}
export type SupportUser = {
  id: number
  provider_user_id: number
  display_name: string
  username: string
}
export type SupportChat = {
  id: number
  status: 'new' | 'open' | 'closed'
  updated_at: string
  user?: SupportUser
  messages: SupportMessage[]
}
export type SupportThread = {
  id: number
  provider_user_id: number
  user_id: number
  display_name: string
  username: string
  status: 'open' | 'closed'
  updated_at: string
  latest_body: string
  latest_sender: string
  latest_at?: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    })
    if (response.status === 204) return undefined as T
    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      if (controller.signal.aborted) throw error
      if (response.ok) throw new ApiError('Сервер вернул некорректные данные', 502)
    }
    if (!response.ok) {
      const detail =
        payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
      const message =
        detail &&
          typeof detail === 'object' &&
          'message' in detail &&
          typeof detail.message === 'string' &&
          detail.message.trim()
          ? detail.message
          : `Не удалось выполнить запрос (${response.status})`
      throw new ApiError(message, response.status)
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ApiError('Сервер вернул некорректные данные', 502)
    }
    return payload as T
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError')
    if (error instanceof ApiError) throw error
    throw new ApiError(
      timedOut ? 'Сервер не ответил вовремя. Попробуйте снова.' : 'Нет связи с сервером',
      0,
    )
  } finally {
    window.clearTimeout(timer)
    init.signal?.removeEventListener('abort', cancel)
  }
}

const base = '/api/v1/moderation'

export const moderationApi = {
  users(q: string, status: string, beforeId?: number, signal?: AbortSignal) {
    const params = new URLSearchParams({q, status, limit: '30'}); if(beforeId) params.set('before_id', String(beforeId))
    return request<{users: ManagedUser[]; next_cursor: number | null}>(`${base}/users?${params}`, {signal})
  },
  content(kind: TargetType, q: string, status: string, beforeId?: number, signal?: AbortSignal) {
    const params = new URLSearchParams({q, status, target_type: kind, limit: '30'}); if(beforeId) params.set('before_id', String(beforeId))
    return request<{content: ManagedContent[]; next_cursor: number | null}>(`${base}/content?${params}`, {signal})
  },
  manage(target_type: TargetType, target_id: number, action: Decision, reason: string) {
    return request<void>(`${base}/actions`, {method:'POST', body:JSON.stringify({target_type,target_id,action,reason})})
  },
  session(signal?: AbortSignal) {
    return request<Session>(`${base}/auth/session`, { signal })
  },
  challenge(maxUserId: number) {
    return request<Challenge>(`${base}/auth/challenge`, {
      method: 'POST',
      body: JSON.stringify({ max_user_id: maxUserId }),
    })
  },
  verify(challengeId: string, code: string) {
    return request<Session>(`${base}/auth/verify`, {
      method: 'POST',
      body: JSON.stringify({ challenge_id: challengeId, code }),
    })
  },
  logout() {
    return request<void>(`${base}/auth/logout`, { method: 'POST' })
  },
  reports(status: ReportStatus, kind: TargetType | 'all', beforeId?: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ status, limit: '30' })
    if (kind !== 'all') query.set('target_type', kind)
    if (beforeId) query.set('before_id', String(beforeId))
    return request<{ reports: Report[]; next_cursor?: number }>(`${base}/reports?${query}`, {
      signal,
    })
  },
  report(id: number, signal?: AbortSignal) {
    return request<Report>(`${base}/reports/${id}`, { signal })
  },
  decide(id: number, action: Decision, reason: string, version: number) {
    return request<Report>(`${base}/reports/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ action, reason: reason.trim(), version }),
    })
  },
  audit(beforeId?: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '30' })
    if (beforeId) query.set('before_id', String(beforeId))
    return request<{ actions: AuditAction[]; next_cursor?: number }>(`${base}/audit?${query}`, {
      signal,
    })
  },
  roles(signal?: AbortSignal) {
    return request<{ members: TeamMember[] }>(`${base}/roles`, { signal })
  },
  changeRole(maxUserId: number, role: Role, operation: 'grant' | 'revoke', reason: string) {
    return request<{ user_id: number }>(`${base}/roles`, {
      method: 'POST',
      body: JSON.stringify({
        max_user_id: maxUserId,
        role,
        operation,
        reason: reason.trim(),
      }),
    })
  },
  reportMediaURL(reportId: number, mediaId: number) {
    return `${base}/reports/${reportId}/media/${mediaId}`
  },
  support(status: SupportStatus, signal?: AbortSignal) {
    return request<{ threads: SupportThread[] }>(
      `${base}/support?status=${encodeURIComponent(status)}`,
      { signal },
    )
  },
  supportThread(id: number, signal?: AbortSignal) {
    return request<SupportChat>(`${base}/support/${id}`, { signal })
  },
  supportReply(id: number, body: string, file?: File | null) {
    const data = new FormData()
    data.append('body', body.trim())
    if (file) data.append('file', file)
    return request<{ message: SupportMessage }>(
      `${base}/support/${id}/messages`,
      { method: 'POST', body: data },
      300000,
    )
  },
  supportClose(id: number) {
    return request<void>(`${base}/support/${id}/close`, { method: 'POST' })
  },
  supportReopen(id: number) {
    return request<void>(`${base}/support/${id}/reopen`, { method: 'POST' })
  },
  supportMediaURL(threadId: number, mediaId: number) {
    return `${base}/support/${threadId}/media/${mediaId}`
  },
}
