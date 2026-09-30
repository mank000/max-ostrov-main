export type EditSettings = {
  start: number
  end: number
  muted: boolean
  rotation: 0 | 90 | 180 | 270
  portrait: boolean
  cover: number
}
export const MAX_CLIP_SECONDS = 180
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function exportClip(
  file: File,
  edit: EditSettings,
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  return new Promise<File>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Отменено', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), {
      type: 'module',
    })
    const cleanup = () => {
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Отменено', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      cleanup()
      reject(
        new Error(
          'Обработка недоступна в этом браузере. Попробуйте обновить MAX или выбрать другой файл.',
        ),
      )
    }
    worker.onmessage = (
      event: MessageEvent<{
        progress?: number
        buffer?: ArrayBuffer
        error?: string
      }>,
    ) => {
      if (event.data.error) {
        cleanup()
        reject(new Error(event.data.error))
        return
      }
      if (event.data.buffer) {
        cleanup()
        resolve(
          new File([event.data.buffer], 'clip.mp4', { type: 'video/mp4' }),
        )
        return
      }
      if (event.data.progress !== undefined) onProgress(event.data.progress)
    }
    worker.postMessage({ file, edit })
  })
}

export async function inspectFile(file: File) {
  if (!file.size || file.size > 2 * 1024 ** 3)
    throw new Error('Выберите видео размером до 2 ГБ')
  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny')
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('В файле нет видео')
    const duration = await input.computeDuration()
    if (!Number.isFinite(duration) || duration < 0.25)
      throw new Error('Не удалось определить длительность видео')
    return { duration, width: track.displayWidth, height: track.displayHeight }
  } finally {
    input.dispose()
  }
}
