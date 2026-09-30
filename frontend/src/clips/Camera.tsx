import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/components/BasicUI'
import { clock } from './media'

export function Camera({
  onFile,
  onClose,
}: {
  onFile: (file: File) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const captureFrame = useRef(0)
  const zoomValue = useRef(1)
  const timer = useRef(0)
  const started = useRef(0)
  const alive = useRef(true)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [delayed, setDelayed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [zoomControl, setZoomControl] = useState<{ max: number; step: number; hardware: boolean } | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    alive.current = true
    return () => {
      dialog.current?.close()
      alive.current = false
      window.clearInterval(timer.current)
      cancelAnimationFrame(captureFrame.current)
      if (recorder.current?.state !== 'inactive') recorder.current?.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError('')
    const open = async () => {
      stream.current?.getTracks().forEach((track) => track.stop())
      try {
        if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
          throw new Error(
            'Камера недоступна в этом браузере. Загрузите видео из галереи.',
          )
        const value = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: true,
        })
        if (cancelled) {
          value.getTracks().forEach((track) => track.stop())
          return
        }
        stream.current = value
        const track = value.getVideoTracks()[0]
        const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }
        const optical = capabilities?.zoom
        const hardware = Boolean(optical && optical.max > 1)
        setZoomControl(hardware
          ? { max: Math.min(3, optical!.max), step: optical!.step || 0.1, hardware: true }
          : typeof HTMLCanvasElement.prototype.captureStream === 'function'
            ? { max: 3, step: 0.1, hardware: false }
            : null)
        zoomValue.current = 1
        setZoom(1)
        if (preview.current) {
          preview.current.srcObject = value
          await preview.current.play()
        }
        setReady(true)
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'Разрешите MAX доступ к камере и микрофону в настройках телефона. Можно также выбрать готовое видео.'
              : err instanceof Error
                ? err.message
                : 'Камера недоступна',
          )
      }
    }
    void open()
    return () => {
      cancelled = true
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [facing])
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        setCountdown(0)
        if (recorder.current?.state === 'recording') recorder.current.stop()
      }
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [])
  useEffect(() => {
    if (!countdown) return
    const timeout = window.setTimeout(() => {
      if (countdown === 1) {
        setCountdown(0)
        start()
      } else setCountdown(countdown - 1)
    }, 1000)
    return () => clearTimeout(timeout)
  }, [countdown])

  function start() {
    if (!stream.current || recording) return
    try {
      const mimeType = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType)
        throw new Error('Запись не поддерживается. Выберите готовое видео.')
      let recordingStream = stream.current
      if (zoomControl && !zoomControl.hardware) {
        const canvas = document.createElement('canvas')
        const camera = preview.current!
        canvas.width = camera.videoWidth || 720
        canvas.height = camera.videoHeight || 1280
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Не удалось подготовить запись')
        const draw = () => {
          const factor = zoomValue.current
          const width = canvas.width / factor
          const height = canvas.height / factor
          context.drawImage(camera, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height)
          captureFrame.current = requestAnimationFrame(draw)
        }
        draw()
        recordingStream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...stream.current.getAudioTracks()])
      }
      const rec = new MediaRecorder(recordingStream, {
        mimeType,
        videoBitsPerSecond: 1_200_000,
        audioBitsPerSecond: 96_000,
      })
      const chunks: Blob[] = []
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      rec.onerror = () => {
        setError('Запись прервалась. Попробуйте ещё раз.')
        if (rec.state !== 'inactive') rec.stop()
      }
      rec.onstop = () => {
        window.clearInterval(timer.current)
        cancelAnimationFrame(captureFrame.current)
        if (recordingStream !== stream.current) recordingStream.getVideoTracks().forEach((track) => track.stop())
        if (!alive.current) return
        setRecording(false)
        const blob = new Blob(chunks, { type: rec.mimeType })
        if (blob.size)
          onFile(
            new File(
              [blob],
              rec.mimeType.includes('mp4') ? 'camera.mp4' : 'camera.webm',
              { type: blob.type },
            ),
          )
      }
      recorder.current = rec
      started.current = performance.now()
      setSeconds(0)
      setRecording(true)
      rec.start(1000)
      timer.current = window.setInterval(() => {
        const elapsed = (performance.now() - started.current) / 1000
        setSeconds(Math.min(180, elapsed))
        if (elapsed >= 180 && rec.state === 'recording') rec.stop()
      }, 100)
    } catch (err) {
      cancelAnimationFrame(captureFrame.current)
      setError(err instanceof Error ? err.message : 'Не удалось начать запись')
      setRecording(false)
    }
  }
  async function changeZoom(value: number) {
    if (!zoomControl) return
    const next = Math.max(1, Math.min(zoomControl.max, value))
    if (zoomControl.hardware) {
      try {
        await stream.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] })
      } catch {
        setError('Камера не смогла изменить масштаб')
        return
      }
    }
    zoomValue.current = next
    setZoom(next)
  }
  return (
    <dialog
      ref={dialog}
      className="clip-camera"
      aria-label="Запись видео"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <video
        ref={preview}
        playsInline
        muted
        className={`${facing === 'user' ? 'is-mirrored' : ''}${zoomControl && !zoomControl.hardware ? ' is-digital-zoom' : ''}`}
        style={zoomControl && !zoomControl.hardware ? { scale: zoom } : undefined}
      />
      <header className="clip-top">
        <button onClick={onClose} aria-label="Закрыть камеру">
          <Icon name="close" />
        </button>
        <span>{recording ? clock(seconds) : 'Камера'} / 3:00</span>
        <button
          disabled={recording || !!countdown}
          onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}
          aria-label="Сменить камеру"
        >
          ↻
        </button>
      </header>
      {countdown > 0 && <strong className="clip-countdown">{countdown}</strong>}
      {zoomControl && <label className="clip-camera-zoom">
        <span>Масштаб {zoom.toFixed(1)}×</span>
        <input type="range" min="1" max={zoomControl.max} step={zoomControl.step} value={zoom}
          aria-label="Масштаб камеры" onChange={(event) => void changeZoom(Number(event.target.value))} />
      </label>}
      {error && (
        <div className="clip-camera-error" role="alert">
          {error}
          <button onClick={onClose}>К загрузке видео</button>
        </div>
      )}
      <footer className="clip-camera-controls">
        <button
          disabled={recording || !!countdown}
          aria-pressed={delayed}
          onClick={() => setDelayed(!delayed)}
        >
          Таймер {delayed ? '3 с' : 'выкл.'}
        </button>
        <button
          className={`clip-record ${recording ? 'is-recording' : ''}`}
          disabled={!ready || !!countdown}
          aria-label={recording ? 'Завершить запись' : 'Начать запись'}
          onClick={() =>
            recording
              ? recorder.current?.stop()
              : delayed
                ? setCountdown(3)
                : start()
          }
        >
          <span />
        </button>
        <span>До 3 мин</span>
      </footer>
    </dialog>
  )
}
