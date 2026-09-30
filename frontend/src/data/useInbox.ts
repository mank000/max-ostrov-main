import { loadNotificationCounts } from '../api/notifications'
import { loadFriendRequests } from '../api/users'
import { useResource } from './useResource'

async function loadInbox(signal: AbortSignal) {
  const [friends, notifications] = await Promise.all([
    loadFriendRequests(signal), loadNotificationCounts(signal),
  ])
  return {
    friends: friends.length,
    notifications: notifications.unread,
    gifts: notifications.gifts,
    clips: notifications.clips,
    messages: notifications.messages,
    matches: notifications.matches,
  }
}

export function useInbox(enabled: boolean, onUnauthorized: () => void) {
  return useResource(enabled, loadInbox, {
    friends: 0,
    notifications: 0,
    gifts: 0,
    clips: 0,
    messages: 0,
    matches: 0,
  }, onUnauthorized)
}
