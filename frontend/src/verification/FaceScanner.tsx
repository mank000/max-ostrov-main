import { useEffect, useRef, useState } from 'react'
import { faceReadiness, type Face } from './face-quality'

type Props = { onClose: () => void; onCapture: (file: File) => boolean | Promise<boolean>; onError: (message: string) => void }

const SCAN_ASPECT = .78
const SCAN_ZOOM = 1.12

function dataURLToBlob(dataURL: string) {
  const comma = dataURL.indexOf(',')
  const bytes = atob(dataURL.slice(comma + 1))
  const buffer = new Uint8Array(bytes.length)
  for (let index = 0; index < bytes.length; index++) buffer[index] = bytes.charCodeAt(index)
  return new Blob([buffer], { type: 'image/jpeg' })
}

async function canvasJPEG(canvas: HTMLCanvasElement) {
  let fallbackTimer = 0
  const native = new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        try {
          resolve(blob || dataURLToBlob(canvas.toDataURL('image/jpeg', .92)))
        } catch (error) { reject(error) }
      }, 'image/jpeg', .92)
    } catch (error) { reject(error) }
  })
  const fallback = new Promise<Blob>((resolve, reject) => {
    fallbackTimer = window.setTimeout(() => {
      try { resolve(dataURLToBlob(canvas.toDataURL('image/jpeg', .92))) }
      catch (error) { reject(error) }
    }, 1800)
  })
  try { return await Promise.race([native, fallback]) }
  finally { window.clearTimeout(fallbackTimer) }
}

async function waitForVideo(video: HTMLVideoElement) {
  await video.play()
  if (video.videoWidth > 0 && video.videoHeight > 0) return
  await new Promise<void>((resolve, reject) => {
    const deadline = performance.now() + 5000
    const poll = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) { resolve(); return }
      if (performance.now() >= deadline) { reject(new Error('camera metadata timeout')); return }
      window.setTimeout(poll, 50)
    }
    poll()
  })
}

export function FaceScanner(props: Props) {
  const callbacks = useRef(props)
  callbacks.current = props
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const snapshot = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('Включаем камеру…')
  const [error, setError] = useState('')
  const [captured, setCaptured] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    let disposed = false, failed = false, capturing = false, workerReady = false, cameraReady = false
    let timer = 0, watchdog = 0, hiddenTimer = 0, stream: MediaStream | undefined, worker: Worker | undefined
    let previous: Face['box'], stable = 0
    const stopCamera = () => { stream?.getTracks().forEach((track) => track.stop()) }
    const stop = () => { stopCamera(); worker?.terminate(); window.clearTimeout(timer); window.clearTimeout(watchdog); window.clearTimeout(hiddenTimer) }
    const fail = (message: string) => { if (!disposed) { failed = true; stop(); setError(message) } }
    const crop = (canvas: HTMLCanvasElement, width: number) => {
      const source = video.current
      if (!source?.videoWidth || !source.videoHeight) throw new Error('Камера ещё не готова')
      canvas.width = width; canvas.height = Math.round(width / SCAN_ASPECT)
      const baseWidth = Math.min(source.videoWidth, source.videoHeight * SCAN_ASPECT)
      const sw = baseWidth / SCAN_ZOOM, sh = sw / SCAN_ASPECT
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось получить снимок')
      context.drawImage(source, (source.videoWidth - sw) / 2, (source.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
    }
    const frame = document.createElement('canvas')
    const send = async () => {
      if (disposed || failed || capturing || !workerReady || !cameraReady) return
      if (document.hidden) { stable = 0; timer = window.setTimeout(send, 250); return }
      try {
        crop(frame, 320)
        const image = await createImageBitmap(frame)
        if (disposed || capturing) { image.close(); return }
        worker?.postMessage({ type: 'frame', image, timestamp: performance.now() }, [image])
        watchdog = window.setTimeout(() => fail('Распознавание не отвечает. Попробуйте ещё раз.'), 10000)
      } catch { fail('Не удалось прочитать камеру. Попробуйте ещё раз.') }
    }
    const capture = async () => {
      if (capturing || disposed || !snapshot.current) return
      capturing = true
      try {
        crop(snapshot.current, 960)
        // Freeze the already-drawn frame before releasing the camera. Some
        // Android WebViews briefly paint a stopped <video> black otherwise.
        setCaptured(true)
        setStatus('Снимок готов. Проверяем…')
        const blob = await canvasJPEG(snapshot.current)
        if (disposed) return
        stop()
        const accepted = await callbacks.current.onCapture(new File([blob], 'face-scan.jpg', { type: 'image/jpeg' }))
        if (disposed) return
        if (!accepted) {
          setError('Проверка не завершена. Попробуйте сделать снимок ещё раз.')
          return
        }
        setStatus('Проверка завершена')
        timer = window.setTimeout(() => callbacks.current.onClose(), 700)
      } catch { fail('Не удалось подготовить снимок. Попробуйте ещё раз.') }
    }
    const open = async () => {
      setError(''); setCaptured(false); setStatus('Включаем камеру…')
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera')
        worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' })
        worker.onerror = () => fail('Автоматическое распознавание недоступно. Обновите приложение или попробуйте другой браузер.')
        worker.onmessage = ({ data }: MessageEvent<{ type: string; faces: Face[] }>) => {
          if (disposed || failed || capturing) return
          window.clearTimeout(watchdog)
          if (data.type === 'error') { fail('Не удалось загрузить распознавание лица. Проверьте соединение и повторите.'); return }
          if (data.type === 'ready') { workerReady = true; setStatus('Поднесите лицо к камере'); void send(); return }
          const hint = faceReadiness(data.faces, frame.width, frame.height), box = data.faces[0]?.box
          const moved = previous && box && (Math.abs(previous.originX - box.originX) + Math.abs(previous.originY - box.originY) + Math.abs(previous.width - box.width)) > frame.width * .08
          stable = hint || moved ? 0 : stable + 1
          previous = box
          setStatus(hint || 'Лицо в рамке…')
          if (stable >= 2) void capture()
          else timer = window.setTimeout(send, 160)
        }
        worker.postMessage({ type: 'init' })
        watchdog = window.setTimeout(() => fail('Не удалось загрузить распознавание. Проверьте соединение и повторите.'), 30000)
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } } })
        if (disposed || failed || !video.current) { stopCamera(); return }
        video.current.srcObject = stream
        await waitForVideo(video.current)
        if (disposed) return
        cameraReady = true
        if (!workerReady) setStatus('Готовим распознавание…')
        else void send()
      } catch { fail('Не удалось включить камеру. Разрешите доступ и попробуйте снова.') }
    }
    void open()
    const visibility = () => {
      window.clearTimeout(hiddenTimer)
      if (document.hidden) {
        stable = 0
        window.clearTimeout(timer)
        window.clearTimeout(watchdog)
        if (!capturing) hiddenTimer = window.setTimeout(() => {
          if (document.hidden && !disposed) callbacks.current.onClose()
        }, 15000)
        return
      }
      if (!capturing && workerReady && cameraReady) {
        setStatus('Поднесите лицо к камере')
        void send()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', visibility) }
  }, [attempt])
  return <dialog ref={dialog} className="extra-face-scanner" aria-label="Сканирование лица" onCancel={props.onClose}>
    <button className="extra-face-close" type="button" aria-label="Закрыть" onClick={props.onClose}>×</button>
    <div className="extra-face-copy"><strong>{captured ? 'Снимок готов' : 'Проверка возраста по селфи'}</strong><span>{captured ? 'Кадр заморожен. Проверка продолжается автоматически.' : 'Держите телефон на обычном расстоянии — камера слегка приблизит лицо сама.'}</span></div>
    <div className={`extra-face-preview${captured ? ' is-captured' : ''}`}>
      <video ref={video} autoPlay muted playsInline hidden={captured} />
      <canvas ref={snapshot} hidden={!captured} />
    </div>
    <div className="extra-face-status" role="status"><strong>{status}</strong>{captured && <span className="extra-face-success">✓</span>}</div>
    {error && <div className="extra-face-error" role="alert"><strong>Проверка не завершена</strong><p>{error}</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>Попробовать ещё раз</button><button type="button" onClick={props.onClose}>Закрыть</button></div>}
  </dialog>
}
