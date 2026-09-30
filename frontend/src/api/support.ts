import { mediaURL } from './credentials'
import { ApiError, request } from './http'
import { PHOTO_INPUT_ACCEPT, preparePhotoFile } from './media'

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

export type SupportChat = {
  id: number
  status: 'new' | 'open' | 'closed'
  updated_at: string
  messages: SupportMessage[]
}

export const SUPPORT_FILE_ACCEPT =
  `${PHOTO_INPUT_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`

function extension(file: File) {
  return file.name.toLocaleLowerCase('en').match(/\.([a-z0-9]+)$/)?.[1] || ''
}

async function prepareSupportFile(file: File) {
  const ext = extension(file)
  const looksLikePhoto =
    file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(ext)
  if (looksLikePhoto) return preparePhotoFile(file)

  const looksLikeVideo =
    ['video/mp4', 'video/quicktime'].includes(file.type) || ['mp4', 'mov'].includes(ext)
  if (!looksLikeVideo) throw new ApiError('Прикрепите фото JPEG/PNG/HEIC или видео MP4/MOV', 400)
  if (file.size === 0) throw new ApiError('Выбранный файл пуст', 400)
  if (file.size > 100 * 1024 * 1024)
    throw new ApiError('Видео должно быть не больше 100 МБ', 413)
  return file
}

export function supportAttachmentURL(item: SupportAttachment) {
  return mediaURL(item.url) || item.url
}

export function loadSupportChat(signal?: AbortSignal) {
  return request<SupportChat>('/support', { signal })
}

export async function sendSupportMessage(body: string, file?: File | null) {
  const data = new FormData()
  data.append('body', body.trim())
  if (file) data.append('file', await prepareSupportFile(file))
  return request<{ message: SupportMessage }>(
    '/support/messages',
    { method: 'POST', body: data },
    300000,
  )
}
