import { accessToken, clearCredentials } from './credentials'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  let timedOut = false
  if (init.signal?.aborted) {
    controller.abort()
  }
  init.signal?.addEventListener('abort', cancel, { once: true })
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const headers = new Headers(init.headers)
    const token = accessToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    headers.set('Accept', 'application/json')
    const response = await fetch(`/api/v1${path}`, {
      cache: 'no-store',
      ...init,
      credentials: 'include',
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      let message = 'Не удалось выполнить запрос'
      try {
        const body = (await response.json()) as {
          error?: {
            message?: unknown
            code?: unknown
          }
          message?: unknown
          detail?: unknown
        } | null
        if (body?.error?.code === 'maintenance') {
          window.dispatchEvent(new globalThis.Event('kutezh:maintenance'))
        }
        const candidate = body?.error?.message || body?.message || body?.detail
        if (typeof candidate === 'string' && candidate.trim()) {
          message = candidate
        }
      } catch {}
      if (response.status === 401 && !path.startsWith('/auth/') && token === accessToken()) {
        clearCredentials()
        window.dispatchEvent(new globalThis.Event('kutezh:session-expired'))
      }
      throw new ApiError(message, response.status)
    }
    if (response.status === 204) {
      return undefined as T
    }
    try {
      return (await response.json()) as T
    } catch (error) {
      if (controller.signal.aborted) {
        throw error
      }
      throw new ApiError('Сервер вернул некорректные данные. Попробуйте снова.', 502)
    }
  } catch (error) {
    if (init.signal?.aborted) {
      throw new DOMException('Запрос отменён', 'AbortError')
    }
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(
      timedOut
        ? 'Сервер не ответил вовремя. Попробуйте снова.'
        : 'Нет связи с сервером. Проверьте подключение.',
      0,
    )
  } finally {
    window.clearTimeout(timer)
    init.signal?.removeEventListener('abort', cancel)
  }
}

export function collection<T>(items: T[] | null): T[] {
  if (items === null) {
    return []
  }
  if (!Array.isArray(items)) {
    throw new ApiError('Сервер вернул некорректный список', 502)
  }
  return items
}

export function operationKey(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function listField<T>(body: Record<string, unknown>, field: string): T[] {
  const value = body?.[field]
  if (value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new ApiError('Сервер вернул некорректный список', 502)
  }
  return value as T[]
}

export function readCursor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }
  return value
}

export function readFeedCursor(body: { next_cursor?: unknown; next_rank_cursor?: unknown }) {
  const cursor = body.next_rank_cursor
  if (typeof cursor === 'string' && /^[0-9a-f]{32}:\d+$/.test(cursor)) {
    return cursor
  }
  return readCursor(body.next_cursor)
}
