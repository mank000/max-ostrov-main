import { mediaURL } from '../../api/credentials'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Icon } from './BasicUI'
import './avatar-cropper.css'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const DEFAULT_OUTPUT_SIZE = 512

type Point = { x: number; y: number }
type ImageSize = { width: number; height: number }
type CropBox = { width: number; height: number }
type Gesture = {
  mode: 'none' | 'drag' | 'pinch'
  startPoint: Point
  startOffset: Point
  startDistance: number
  startZoom: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function croppedFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'image'
  return `${base}-cropped.png`
}

export async function createCenteredAvatarCrop(src: string, filename = 'avatar.jpg') {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image()
    value.decoding = 'async'
    value.onload = () => resolve(value)
    value.onerror = () => reject(new Error('Не удалось открыть фотографию'))
    value.src = mediaURL(src) || src
  })
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error('Не удалось определить размер фотографии')

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
  const sourceX = (image.naturalWidth - sourceSize) / 2
  const sourceY = (image.naturalHeight - sourceSize) / 2
  const canvas = document.createElement('canvas')
  canvas.width = DEFAULT_OUTPUT_SIZE
  canvas.height = DEFAULT_OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить изображение')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    DEFAULT_OUTPUT_SIZE,
    DEFAULT_OUTPUT_SIZE,
  )
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('Не удалось обработать изображение'))),
      'image/png',
    )
  })
  return new File([blob], croppedFileName(filename), {
    type: 'image/png',
    lastModified: Date.now(),
  })
}

export function AvatarCropper({
  file,
  src,
  filename = 'avatar.jpg',
  saving,
  onCancel,
  onConfirm,
  aspectRatio = 1,
  shape = 'circle',
  title = 'Фото профиля',
  subtitle = 'Перемещайте и масштабируйте',
  footerHint,
  outputWidth = DEFAULT_OUTPUT_SIZE,
  ariaLabel = 'Выбрать область изображения',
}: {
  file?: File
  src?: string
  filename?: string
  saving: boolean
  onCancel: () => void
  onConfirm: (file: File) => Promise<void>
  aspectRatio?: number
  shape?: 'circle' | 'square' | 'rounded'
  title?: string
  subtitle?: string
  footerHint?: string
  outputWidth?: number
  ariaLabel?: string
}) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const [source, setSource] = useState('')
  const [imageSize, setImageSize] = useState<ImageSize>({
    width: 0,
    height: 0,
  })
  const [cropBox, setCropBox] = useState<CropBox>({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const cropRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const zoomRef = useRef(1)
  const offsetRef = useRef<Point>({ x: 0, y: 0 })
  const gesture = useRef<Gesture>({
    mode: 'none',
    startPoint: { x: 0, y: 0 },
    startOffset: { x: 0, y: 0 },
    startDistance: 0,
    startZoom: 1,
  })

  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : src || ''
    setSource(url)
    setImageSize({ width: 0, height: 0 })
    setZoom(1)
    zoomRef.current = 1
    setOffset({ x: 0, y: 0 })
    offsetRef.current = { x: 0, y: 0 }
    setError('')
    return () => {
      if (file && url) URL.revokeObjectURL(url)
    }
  }, [file, src])

  useEffect(() => {
    const crop = cropRef.current
    if (!crop) return
    const measure = () => {
      const rect = crop.getBoundingClientRect()
      setCropBox({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(crop)
    return () => observer.disconnect()
  }, [safeAspectRatio, shape])

  function baseScale() {
    if (!cropBox.width || !cropBox.height || !imageSize.width || !imageSize.height) return 1
    return Math.max(cropBox.width / imageSize.width, cropBox.height / imageSize.height)
  }

  function clampOffset(next: Point, zoomValue = zoomRef.current): Point {
    if (!cropBox.width || !cropBox.height || !imageSize.width || !imageSize.height)
      return { x: 0, y: 0 }
    const scale = baseScale() * zoomValue
    const maxX = Math.max(0, (imageSize.width * scale - cropBox.width) / 2)
    const maxY = Math.max(0, (imageSize.height * scale - cropBox.height) / 2)
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    }
  }

  function commitOffset(next: Point, zoomValue = zoomRef.current) {
    const value = clampOffset(next, zoomValue)
    offsetRef.current = value
    setOffset(value)
  }

  function commitZoom(next: number) {
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM)
    zoomRef.current = value
    setZoom(value)
    commitOffset(offsetRef.current, value)
  }

  function points() {
    return [...pointers.current.values()]
  }

  function beginDrag(point: Point) {
    gesture.current = {
      mode: 'drag',
      startPoint: point,
      startOffset: offsetRef.current,
      startDistance: 0,
      startZoom: zoomRef.current,
    }
  }

  function beginPinch(first: Point, second: Point) {
    gesture.current = {
      mode: 'pinch',
      startPoint: { x: 0, y: 0 },
      startOffset: offsetRef.current,
      startDistance: Math.max(1, distance(first, second)),
      startZoom: zoomRef.current,
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (saving) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch { }
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    const current = points()
    if (current.length === 1) beginDrag(current[0])
    else if (current.length >= 2) beginPinch(current[0], current[1])
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || saving) return
    event.preventDefault()
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    const current = points()
    if (current.length >= 2) {
      if (gesture.current.mode !== 'pinch') beginPinch(current[0], current[1])
      const nextZoom =
        (gesture.current.startZoom * distance(current[0], current[1])) /
        Math.max(1, gesture.current.startDistance)
      commitZoom(nextZoom)
      return
    }
    if (current.length === 1) {
      if (gesture.current.mode !== 'drag') beginDrag(current[0])
      const dx = current[0].x - gesture.current.startPoint.x
      const dy = current[0].y - gesture.current.startPoint.y
      commitOffset({
        x: gesture.current.startOffset.x + dx,
        y: gesture.current.startOffset.y + dy,
      })
    }
  }

  function releasePointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    const current = points()
    if (current.length === 1) beginDrag(current[0])
    else if (current.length >= 2) beginPinch(current[0], current[1])
    else gesture.current.mode = 'none'
  }

  async function confirm() {
    const image = imageRef.current
    if (
      !image ||
      !cropBox.width ||
      !cropBox.height ||
      !imageSize.width ||
      !imageSize.height ||
      saving
    )
      return
    setError('')
    try {
      const scale = baseScale() * zoomRef.current
      const sourceWidth = cropBox.width / scale
      const sourceHeight = cropBox.height / scale
      const sourceX = clamp(
        imageSize.width / 2 + (-cropBox.width / 2 - offsetRef.current.x) / scale,
        0,
        Math.max(0, imageSize.width - sourceWidth),
      )
      const sourceY = clamp(
        imageSize.height / 2 + (-cropBox.height / 2 - offsetRef.current.y) / scale,
        0,
        Math.max(0, imageSize.height - sourceHeight),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(outputWidth))
      canvas.height = Math.max(1, Math.round(outputWidth / safeAspectRatio))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось подготовить изображение')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('Не удалось обработать изображение')),
          'image/png',
        )
      })
      await onConfirm(
        new File([blob], croppedFileName(file?.name || filename), {
          type: 'image/png',
          lastModified: Date.now(),
        }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изображение')
    }
  }

  const scale = baseScale() * zoom
  const imageStyle =
    imageSize.width && imageSize.height
      ? ({
        width: imageSize.width * scale,
        height: imageSize.height * scale,
        transform: `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0)`,
      } as CSSProperties)
      : undefined
  const frameStyle = {
    '--crop-aspect': String(safeAspectRatio),
  } as CSSProperties
  const resolvedHint =
    footerHint ||
    (shape === 'circle'
      ? 'В круге останется именно эта область фотографии.'
      : 'В рамке останется именно эта область фотографии.')

  return (
    <section className="avatar-cropper" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <header className="avatar-cropper__header">
        <button type="button" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <button type="button" onClick={() => void confirm()} disabled={saving || !imageSize.width}>
          {saving ? '…' : 'Готово'}
        </button>
      </header>

      <div className="avatar-cropper__stage">
        <div
          className="avatar-cropper__gesture"
          data-content-zoom
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        >
          {source && (
            <img
              ref={imageRef}
              src={mediaURL(source)}
              alt=""
              draggable={false}
              style={imageStyle}
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
                commitZoom(1)
              }}
              onError={() =>
                setError('Не удалось открыть фотографию. Выберите другое изображение.')
              }
            />
          )}
          <div
            ref={cropRef}
            className={`avatar-cropper__frame avatar-cropper__frame--${shape}`}
            style={frameStyle}
            aria-hidden="true"
          />
        </div>
      </div>

      <footer className="avatar-cropper__footer">
        <div className="avatar-cropper__zoom">
          <Icon name="photo" size={17} />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            onChange={(event) => commitZoom(Number(event.target.value))}
            aria-label="Масштаб фотографии"
            disabled={saving || !imageSize.width}
          />
          <Icon name="photo" size={24} />
        </div>
        <p>{resolvedHint}</p>
        {error && <span className="avatar-cropper__error">{error}</span>}
      </footer>
    </section>
  )
}
