import { ApiError, listField, request } from './http'

export type AttendanceConfirmation = {
  event_id: number
  user_id: number
  status: 'pending' | 'confirmed' | 'rejected'
  location_matched: boolean
  evidence_submitted_at: string
  reviewed_by_user_id?: number
  reviewed_at?: string
  media_ids: number[]
}

export async function loadAttendance(eventId: number, signal?: AbortSignal) {
  try {
    return await request<AttendanceConfirmation>(`/events/${eventId}/attendance`, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function loadAttendanceReviews(eventId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/events/${eventId}/attendance/reviews`, {
    signal,
  })
  return listField<AttendanceConfirmation>(body, 'confirmations')
}

export async function submitAttendance(
  eventId: number,
  input: { latitude?: number; longitude?: number; media_ids: number[] },
) {
  return request<AttendanceConfirmation>(`/events/${eventId}/attendance`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function reviewAttendance(
  eventId: number,
  userId: number,
  status: 'confirmed' | 'rejected',
) {
  return request<AttendanceConfirmation>(`/events/${eventId}/attendance/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}
