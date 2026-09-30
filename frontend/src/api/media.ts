import { ApiError, request } from './http'
import { type PostMedia } from './posts'

export type MediaAsset = {
  id: number
  mime_type: PostMedia['mime_type']
  byte_size: number
  width: number
  height: number
  duration_ms: number
  url: string
  created_at: string
}

export async function deleteMedia(mediaId: number) {
  return request<void>(`/media/${mediaId}`, { method: 'DELETE' })
}

const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024

const MAX_HEIC_OUTPUT_EDGE = 4096

const JPEG_TYPES = new Set(['image/jpeg', 'image/jpg'])

const PNG_TYPES = new Set(['image/png'])

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

export const PHOTO_INPUT_ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.heic,.heif'

function photoExtension(name: string) {
  return name.toLocaleLowerCase('en').match(/\.([a-z0-9]+)$/)?.[1] || ''
}

function photoKind(file: File): 'jpeg' | 'png' | 'heic' | null {
  const extension = photoExtension(file.name)
  if (JPEG_TYPES.has(file.type) || extension === 'jpg' || extension === 'jpeg') {
    return 'jpeg'
  }
  if (PNG_TYPES.has(file.type) || extension === 'png') {
    return 'png'
  }
  if (HEIC_TYPES.has(file.type) || extension === 'heic' || extension === 'heif') {
    return 'heic'
  }
  return null
}

function cleanPhotoFile(file: File, kind: 'jpeg' | 'png') {
  const mimeType = kind === 'png' ? 'image/png' : 'image/jpeg'
  if (file.type === mimeType) {
    return file
  }
  return new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  })
}

export async function preparePhotoFile(file: File) {
  if (file.size === 0) {
    throw new ApiError('Выбранный файл пуст', 400)
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    throw new ApiError('Фото должно быть не больше 10 МБ', 413)
  }
  const kind = photoKind(file)
  if (!kind) {
    throw new ApiError('Выберите фото JPEG, PNG, HEIC или HEIF', 400)
  }
  if (kind !== 'heic') {
    return cleanPhotoFile(file, kind)
  }

  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image()
      value.decoding = 'async'
      value.onload = () => resolve(value)
      value.onerror = () =>
        reject(new ApiError('Не удалось открыть HEIC/HEIF. Попробуйте выбрать другое фото.', 400))
      value.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new ApiError('Не удалось определить размер HEIC/HEIF', 400)
    }

    const scale = Math.min(
      1,
      MAX_HEIC_OUTPUT_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      throw new ApiError('Не удалось подготовить фото к загрузке', 400)
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new ApiError('Не удалось преобразовать HEIC/HEIF в JPEG', 400)),
        'image/jpeg',
        0.92,
      )
    })
    if (blob.size > MAX_PHOTO_UPLOAD_BYTES) {
      throw new ApiError('После обработки фото получилось больше 10 МБ', 413)
    }
    const base = file.name.replace(/\.(heic|heif)$/i, '').trim() || 'photo'
    return new File([blob], `${base}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function uploadPreparedPhoto(
  file: File,
  endpoint:
    | '/media/images'
    | '/media/avatars'
    | '/media/profile-images'
    | '/media/comment-images'
    | '/media/event-images'
    | '/media/attendance-images',
) {
  const prepared = await preparePhotoFile(file)
  const data = new FormData()
  data.append('file', prepared)
  return request<MediaAsset>(endpoint, { method: 'POST', body: data }, 60000)
}

export async function uploadPhoto(file: File) {
  return uploadPreparedPhoto(file, '/media/images')
}

export async function uploadAvatar(file: File) {
  return uploadPreparedPhoto(file, '/media/avatars')
}

export async function uploadProfilePhoto(file: File) {
  return uploadPreparedPhoto(file, '/media/profile-images')
}

export async function uploadCommentPhoto(file: File) {
  return uploadPreparedPhoto(file, '/media/comment-images')
}

export async function uploadEventPhoto(file: File) {
  return uploadPreparedPhoto(file, '/media/event-images')
}

export async function uploadAttendancePhoto(file: File) {
  return uploadPreparedPhoto(file, '/media/attendance-images')
}

async function browserVideoDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const finish = (value: number | null) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 8000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => finish(null)
    video.src = url
  })
}

async function uploadVideoTo(file: File, endpoint: '/media/videos' | '/media/comment-videos') {
  if (file.size === 0) {
    throw new ApiError('Выбранный файл пуст', 400)
  }
  const lowerName = file.name.toLocaleLowerCase('en')
  const supportedType =
    ['video/mp4', 'video/quicktime'].includes(file.type) || /\.(mp4|mov)$/.test(lowerName)
  if (!supportedType) {
    throw new ApiError('Выберите видео MP4 или MOV', 400)
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new ApiError('Видео должно быть не больше 100 МБ', 413)
  }
  const duration = await browserVideoDuration(file)
  if (duration !== null && duration > 300.05) {
    throw new ApiError('Видео должно быть не длиннее 5 минут', 400)
  }
  const data = new FormData()
  data.append('file', file)
  return request<MediaAsset>(
    endpoint,
    { method: 'POST', body: data },
    endpoint === '/media/comment-videos' ? 300000 : 180000,
  )
}

export async function uploadVideo(file: File) {
  return uploadVideoTo(file, '/media/videos')
}

export async function uploadCommentVideo(file: File) {
  return uploadVideoTo(file, '/media/comment-videos')
}
