import { request } from './http'

type ReportTargetType = 'user' | 'post' | 'event' | 'comment'

export async function reportContent(
  targetType: ReportTargetType,
  targetId: number,
  reason: string,
) {
  return request<void>('/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_type: targetType,
      target_id: targetId,
      reason: reason.trim(),
    }),
  })
}

export async function reportUser(userId: number, reason: string) {
  return reportContent('user', userId, reason)
}
