import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/http'

export type LoadStatus = {
  loading: boolean
  refreshing: boolean
  loaded: boolean
  stale: boolean
  error: string
}
export const idleStatus = (): LoadStatus => ({
  loading: false, refreshing: false, loaded: false, stale: false, error: '',
})
export const loadedStatus = (): LoadStatus => ({ ...idleStatus(), loaded: true })

export function useResource<T>(
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>,
  empty: T,
  onUnauthorized: () => void,
) {
  const [value, setValue] = useState(empty)
  const [status, setStatus] = useState(idleStatus)
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | null>(null)
  const initial = useRef(empty)
  const refresh = useCallback(() => setRevision((current) => current + 1), [])
  const reset = useCallback(() => {
    request.current?.abort()
    setValue(initial.current)
    setStatus(idleStatus())
  }, [])

  useEffect(() => {
    if (!enabled) {
      reset()
      return
    }
    const controller = new AbortController()
    request.current = controller
    setStatus((current) => ({ ...current, loading: !current.loaded, refreshing: current.loaded, error: '' }))
    void load(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setValue(result)
      setStatus(loadedStatus())
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      setStatus((current) => ({
        ...current, loading: false, refreshing: false, stale: current.loaded,
        error: error instanceof Error ? error.message : 'Не удалось загрузить данные',
      }))
    })
    return () => { controller.abort() }
  }, [enabled, load, revision, onUnauthorized, reset])

  return { value, setValue, status, refresh, reset }
}
