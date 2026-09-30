import { useEffect, useRef, useState } from 'react'
import { request } from '../api/http'
import { sessionHeaders } from '../api/credentials'
import type { PostMedia } from '../api/posts'
import type { HostAdapter } from '../host'

type DownloadLink = { id: number; url: string; expires: number }

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Загрузка отменена', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function useMediaDownload(item: PostMedia | undefined, enabled: boolean, host: HostAdapter, showError: (message: string) => void) {
  const [link, setLink] = useState<DownloadLink | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [revision, setRevision] = useState(0)
  const activeRequest = useRef<AbortController | null>(null)
  const id = item?.id || 0
  const nativeDownload = host.downloadFile

  useEffect(() => {
    setLink(null)
    setPrepareError('')
    setPreparing(false)
    if (!enabled || !nativeDownload || id <= 0) return
    const controller = new AbortController()
    let timer = 0
    const prepare = async () => {
      setPreparing(true)
      try {
        const result = await request<{ url: string; expires_at: string }>(`/media/${id}/download`, { method: 'POST', signal: controller.signal })
        if (controller.signal.aborted) return
        const url = new URL(result.url, window.location.origin)
        const expires = Date.parse(result.expires_at)
        if (url.origin !== window.location.origin || url.pathname !== `/api/v1/media/${id}/download` || !Number.isFinite(expires) || expires <= Date.now())
          throw new Error('Сервер вернул некорректную ссылку на файл')
        setLink({ id, url: url.href, expires })
        setPrepareError('')
        timer = window.setTimeout(() => void prepare(), Math.max(1000, expires - Date.now() - 15000))
      } catch (cause) {
        if (!controller.signal.aborted)
          setPrepareError(cause instanceof Error ? cause.message : 'Не удалось подготовить файл')
      } finally {
        if (!controller.signal.aborted) setPreparing(false)
      }
    }
    void prepare()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [id, enabled, nativeDownload, revision])

  useEffect(() => () => { activeRequest.current?.abort() }, [enabled, id])

  async function downloadMedia(selected: PostMedia) {
    if (!enabled || activeRequest.current) return
    const extension = selected.mime_type === 'video/mp4' ? 'mp4'
      : selected.mime_type === 'video/quicktime' ? 'mov'
      : selected.mime_type === 'image/png' ? 'png' : 'jpg'
    const name = `kutezh-media-${selected.id || 1}.${extension}`
    const controller = new AbortController()
    activeRequest.current = controller
    setDownloading(true)
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 60000)
    try {
      if (nativeDownload) {
        if (selected.id > 0) {
          if (!link || link.id !== selected.id || link.expires <= Date.now()) {
            setRevision((value) => value + 1)
            throw new Error(prepareError || 'Обновляется ссылка на файл. Нажмите скачать ещё раз.')
          }
          await abortable(nativeDownload(link.url, name), controller.signal)
        } else await abortable(nativeDownload(selected.url, name), controller.signal)
        return
      }
      const url = new URL(selected.url, window.location.origin)
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
        throw new Error('Некорректная ссылка на файл')
      const response = await fetch(url, {
        credentials: 'same-origin', signal: controller.signal,
        headers: url.origin === window.location.origin ? sessionHeaders() : undefined,
      })
      if (!response.ok) throw new Error('Не удалось скачать медиафайл')
      const blob = await response.blob()
      if (controller.signal.aborted) return
      const objectUrl = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = name
        document.body.append(anchor)
        try { anchor.click() } finally { anchor.remove() }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
      }
    } catch (cause) {
      if (timedOut) showError('Не удалось скачать файл за минуту. Попробуйте ещё раз.')
      else if (!controller.signal.aborted)
        showError(cause instanceof Error ? cause.message : 'Не удалось скачать медиафайл')
    } finally {
      window.clearTimeout(timer)
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setDownloading(false)
      }
    }
  }
  const downloadBusy = downloading || (Boolean(nativeDownload) && id > 0 && enabled &&
    (preparing || ((!link || link.id !== id) && !prepareError)))
  return { downloadMedia, downloadBusy }
}
