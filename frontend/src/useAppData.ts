import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { Event } from './api/events'
import { loadFeedPage, loadMyPostsPage, type FeedCursor, type FeedScope, type Post } from './api/posts'
import { loadProfile, type Friend, type Profile } from './api/users'
import { useActivity } from './data/useActivity'
import { useFriendPages } from './data/useFriendPages'
import { useInbox } from './data/useInbox'
import { usePostPages } from './data/usePostPages'
import { useResource, type LoadStatus } from './data/useResource'
import { useRealtimeRefresh } from './useRealtimeRefresh'

export type AppDataKey = 'profile' | 'friends' | 'feed' | 'profilePosts' | 'recommendations' | 'activity' | 'inbox'
const keys: AppDataKey[] = ['profile', 'friends', 'feed', 'profilePosts', 'recommendations', 'activity', 'inbox']
const loadOwnPosts = (signal: AbortSignal, cursor = 0) => loadMyPostsPage(signal, cursor)

export type AppDataResult = {
  profile: Profile | null
  friends: Friend[]
  birthdayFriends: Friend[]
  friendCount: number
  friendsNextCursor: string | null
  loadingMoreFriends: boolean
  friendsPageError: string
  loadMoreFriends: () => Promise<void>
  refreshFriendPresence: () => Promise<void>
  posts: Post[]
  profilePosts: Post[]
  recommendedEvents: Event[]
  profileEvents: Event[]
  participatingEventIds: Set<number>
  savedEventIds: Set<number>
  eventOverrides: Record<number, Event>
  deletedEventIds: Set<number>
  groupCount: number
  friendRequestCount: number
  unreadNotificationCount: number
  unreadGiftCount: number
  unreadClipCount: number
  unreadClipMessageCount: number
  unreadMatchCount: number
  status: Record<AppDataKey, LoadStatus>
  feedScope: FeedScope
  feedNextCursor: FeedCursor | null
  profilePostsNextCursor: number | null
  loadingMoreFeed: boolean
  loadMoreFeedError: string
  loadingMoreProfilePosts: boolean
  loadMoreProfilePostsError: string
  loadMoreFeed: () => Promise<void>
  loadMoreProfilePosts: () => Promise<void>
  setFeedScope: Dispatch<SetStateAction<FeedScope>>
  refresh: (...domains: AppDataKey[]) => void
  refreshAll: () => void
  clearPrivateData: () => void
  setProfile: Dispatch<SetStateAction<Profile | null>>
  setPosts: Dispatch<SetStateAction<Post[]>>
  setProfilePosts: Dispatch<SetStateAction<Post[]>>
  setParticipatingEventIds: Dispatch<SetStateAction<Set<number>>>
  setSavedEventIds: Dispatch<SetStateAction<Set<number>>>
  applyEventUpdate: (event: Event) => void
  applyEventDelete: (eventId: number) => void
}


export function useAppData(authenticated: boolean, onUnauthorized: () => void, selectedCity: string, socialEnabled = true, clipsEnabled = false): AppDataResult {
  const profile = useResource(authenticated, loadProfile, null as Profile | null, onUnauthorized)
  const socialActive = authenticated && socialEnabled && (profile.value?.onboarding_version ?? 0) >= 1
  const friends = useFriendPages(socialActive, onUnauthorized)
  const [feedScope, setFeedScope] = useState<FeedScope>('all')
  const city = selectedCity.trim() || profile.value?.city || ''
  const feedCity = feedScope === 'city' ? city : ''
  const loadFeed = useCallback((signal: AbortSignal, cursor: FeedCursor = 0, refreshHead = false) =>
    loadFeedPage(signal, refreshHead && feedScope === 'all' ? Number.MAX_SAFE_INTEGER : cursor, feedScope, feedCity), [feedScope, feedCity])
  const feed = usePostPages(socialActive && (feedScope !== 'city' || Boolean(city)), loadFeed, onUnauthorized)
  const ownPosts = usePostPages(socialActive, loadOwnPosts, onUnauthorized)
  const events = useActivity(socialActive, onUnauthorized)
  const platformActive = authenticated && (profile.value?.onboarding_version ?? 0) >= 1
  const inbox = useInbox(platformActive, onUnauthorized)
  const refreshProfile = profile.refresh
  const refreshFriends = friends.refresh
  const refreshFeed = feed.refresh
  const refreshOwnPosts = ownPosts.refresh
  const refreshActivity = events.activity.refresh
  const refreshRecommendations = events.recommendations.refresh
  const refreshInbox = inbox.refresh
  const refresh = useCallback((...domains: AppDataKey[]) => {
    const actions = {
      profile: refreshProfile, friends: refreshFriends, feed: refreshFeed,
      profilePosts: refreshOwnPosts, activity: refreshActivity, recommendations: refreshRecommendations, inbox: refreshInbox
    }
    for (const key of new Set(domains.length ? domains : keys)) actions[key]()
  }, [refreshProfile, refreshFriends, refreshFeed, refreshOwnPosts, refreshActivity, refreshRecommendations, refreshInbox])
  const refreshAll = useCallback(() => refresh(), [refresh])
  const resetProfile = profile.reset
  const resetFriends = friends.reset
  const resetFeed = feed.reset
  const resetOwnPosts = ownPosts.reset
  const resetEvents = events.reset
  const resetInbox = inbox.reset
  const clearPrivateData = useCallback(() => {
    resetProfile(); resetFriends(); resetFeed(); resetOwnPosts(); resetEvents(); resetInbox()
  }, [resetProfile, resetFriends, resetFeed, resetOwnPosts, resetEvents, resetInbox])
  const deleteEvent = events.applyEventDelete
  const setPosts = feed.setPosts
  const setProfilePosts = ownPosts.setPosts
  const applyEventDelete = useCallback((eventId: number) => {
    deleteEvent(eventId)
    const detach = (items: Post[]) => items.map((post) => post.event_id === eventId ? { ...post, event_id: undefined } : post)
    setPosts(detach); setProfilePosts(detach)
  }, [deleteEvent, setPosts, setProfilePosts])
  useRealtimeRefresh(platformActive, refresh, socialActive, clipsEnabled)

  return {
    profile: profile.value, friends: friends.friends, birthdayFriends: friends.birthdaysToday, friendCount: friends.count,
    friendsNextCursor: friends.cursor, loadingMoreFriends: friends.loadingMore,
    friendsPageError: friends.pageError, loadMoreFriends: friends.loadMore,
    refreshFriendPresence: friends.refreshPresence,
    posts: feed.posts, profilePosts: ownPosts.posts,
    recommendedEvents: events.recommendedEvents, profileEvents: events.profileEvents,
    participatingEventIds: events.participatingEventIds, savedEventIds: events.savedEventIds,
    eventOverrides: events.overrides, deletedEventIds: events.deleted, groupCount: events.activity.value.groupCount,
    friendRequestCount: inbox.value.friends,
    unreadNotificationCount: inbox.value.notifications,
    unreadGiftCount: inbox.value.gifts,
    unreadClipCount: inbox.value.clips,
    unreadClipMessageCount: inbox.value.messages,
    unreadMatchCount: inbox.value.matches,
    status: {
      profile: profile.status, friends: friends.status, feed: feed.status, profilePosts: ownPosts.status,
      recommendations: events.recommendations.status, activity: events.activity.status, inbox: inbox.status
    },
    feedScope, feedNextCursor: feed.cursor, profilePostsNextCursor: ownPosts.cursor,
    loadingMoreFeed: feed.loadingMore, loadMoreFeedError: feed.loadMoreError,
    loadingMoreProfilePosts: ownPosts.loadingMore, loadMoreProfilePostsError: ownPosts.loadMoreError,
    loadMoreFeed: feed.loadMore, loadMoreProfilePosts: ownPosts.loadMore, setFeedScope,
    refresh, refreshAll, clearPrivateData, setProfile: profile.setValue, setPosts, setProfilePosts,
    setParticipatingEventIds: events.setParticipatingEventIds, setSavedEventIds: events.setSavedEventIds,
    applyEventUpdate: events.applyEventUpdate, applyEventDelete,
  }
}
