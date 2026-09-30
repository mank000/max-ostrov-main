import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { loadNotificationsPage, markNotificationRead } from '../api/notifications'
import type { Modal } from './useFeedback'

// Uses the existing inbox refresh (SSE + reconnect + fallback polling), without
// a second polling loop. Unread notices also surface after reopening MAX.
export function useModerationNotice(userId: number | undefined, unread: number, modal: Modal | null, setModal: Dispatch<SetStateAction<Modal | null>>) {
  const shown = useRef(new Set<string>())
  useEffect(() => {
    if (!userId || !unread || modal) return
    const controller = new AbortController()
    void loadNotificationsPage(true, controller.signal).then(({ notifications }) => {
      if (controller.signal.aborted) return
      const notice = notifications.find(item => item.kind === 'post_moderated' && !shown.current.has(`${userId}:${item.id}`))
      if (!notice) return
      const key = `${userId}:${notice.id}`
      shown.current.add(key)
      setModal({
        title: notice.title,
        description: notice.body,
        confirm: 'Понятно',
        cancel: 'Позже',
        onConfirm: () => {
          setModal(null)
          void markNotificationRead(notice.id).catch(() => { shown.current.delete(key) })
        },
      })
    }).catch(() => { /* A later inbox refresh/reopen retries; the notice is durable. */ })
    return () => controller.abort()
  }, [userId, unread, modal, setModal])
}
