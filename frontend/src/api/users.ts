import { collection, request } from './http'

export type VerificationTier = 'none' | 'age' | 'full'

export type ProfileAvatar = {
  media_id: number
  url: string
  crop_media_id?: number
  crop_url?: string
  position: number
  is_primary: boolean
}

export type Profile = {
  hide_sensitive_language?: boolean
  show_online?: boolean
  private_profile?: boolean
  show_birth_date?: boolean
  moderation_role?: 'moderator' | 'administrator'
  id: number
  username?: string
  first_name: string
  last_name?: string
  display_name: string
  bio: string
  city: string
  gender?: 'man' | 'woman'
  birth_date?: string
  age?: number
  face_verified: boolean
  verification_tier?: VerificationTier
  face_verification_available?: boolean
  photo_url?: string
  avatar_media_id?: number
  avatars?: ProfileAvatar[]
  interests: string[]
  participant_visibility?: 'participants' | 'hidden'
  equipped_decoration_code?: string
  onboarding_version?: number
}

export type Friend = {
  user: {
    id: number
    username?: string
    display_name: string
    city: string
    birth_date?: string
    photo_url?: string
    last_seen_at?: string
    is_online?: boolean
    max_user_id?: number
    max_chat_id?: string
  }
  created_at: string
}

type DirectMessageTarget = {
  max_chat_id?: string
  max_user_id?: number
}

export type UserSearchResult = {
  id: number
  username?: string
  display_name: string
  bio: string
  city: string
  birth_date?: string
  age?: number
  face_verified?: boolean
  verification_tier?: VerificationTier
  photo_url?: string
  interests: string[]
  equipped_decoration_code?: string
  friend_request_status?: 'friend' | 'outgoing' | 'incoming' | ''
}

export type UserSuggestion = UserSearchResult & {
  reason_code: 'shared_event' | 'mutual_friend' | 'shared_interest' | 'same_city' | 'new_member'
  reason: string
}

export type RelationshipState = 'self' | 'stranger' | 'outgoing' | 'incoming' | 'friend' | 'blocked'

export type PublicUserProfile = Omit<UserSearchResult, 'friend_request_status'> & {
  avatars?: ProfileAvatar[]
  private_profile: boolean
  restricted: boolean
  last_seen_at?: string
  is_online: boolean
  relationship_state: RelationshipState
  mutual_interests: string[]
  common_event_count: number
  friend_count: number
  post_count: number
  event_count: number
}

export async function loadProfile(signal?: AbortSignal) {
  return request<Profile>('/users/me', { signal })
}

export async function loadUserProfile(userId: number, signal?: AbortSignal) {
  return request<PublicUserProfile>(`/users/${userId}`, { signal })
}

export async function loadUserFriendsPage(userId: number, signal?: AbortSignal, cursor = '') {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const body = await request<{ friends: Friend[]; next_cursor?: string }>(
    `/users/${userId}/friends${suffix}`,
    { signal },
  )
  return {
    friends: collection(body.friends),
    nextCursor: typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null,
  }
}

export async function loadUserFriends(userId: number, signal?: AbortSignal) {
  return (await loadUserFriendsPage(userId, signal)).friends
}

export async function loadFriendsPage(signal?: AbortSignal, cursor = '') {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const body = await request<{ friends: Friend[]; birthdays_today?: Friend[]; next_cursor?: string; total_count: number }>(
    `/users/me/friends${suffix}`, { signal },
  )
  return {
    friends: collection(body.friends),
    birthdaysToday: collection(body.birthdays_today ?? null),
    nextCursor: typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null,
    totalCount: typeof body.total_count === 'number' ? body.total_count : collection(body.friends).length,
  }
}

export async function loadAllFriends(signal?: AbortSignal) {
  const friends: Friend[] = []
  const seen = new Set<number>()
  const cursors = new Set<string>()
  let cursor = ''
  do {
    const page = await loadFriendsPage(signal, cursor)
    for (const friend of page.friends) {
      if (seen.has(friend.user.id)) continue
      seen.add(friend.user.id)
      friends.push(friend)
    }
    if (!page.nextCursor) break
    if (cursors.has(page.nextCursor)) throw new Error('Не удалось продолжить загрузку друзей')
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (!signal?.aborted)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return friends
}

export async function loadFriendDirectMessageTarget(userId: number, signal?: AbortSignal) {
  return request<DirectMessageTarget>(`/users/me/friends/${userId}/direct-message`, { signal })
}

export async function searchUsers(query: string, signal?: AbortSignal) {
  const value = query.trim()
  return collection(
    (
      await request<{ users: UserSearchResult[] }>(`/users/search?q=${encodeURIComponent(value)}`, {
        signal,
      })
    ).users,
  )
}

export async function loadUserSuggestions(signal?: AbortSignal) {
  return collection(
    (
      await request<{ users: UserSuggestion[] }>('/users/me/suggestions', {
        signal,
      })
    ).users,
  )
}

export async function loadFriendRequests(
  signal?: AbortSignal,
  direction: 'incoming' | 'outgoing' = 'incoming',
) {
  const path =
    direction === 'outgoing'
      ? '/users/me/friend-requests?direction=outgoing'
      : '/users/me/friend-requests'
  return collection((await request<{ requests: Friend[] }>(path, { signal })).requests)
}

export async function resolveFriendRequest(userId: number, accept: boolean) {
  return request<void>(`/users/me/friend-requests/${userId}`, {
    method: accept ? 'PUT' : 'DELETE',
  })
}

type BlockedUser = {
  user: Friend['user']
  created_at: string
}

export async function loadBlockedUsers(signal?: AbortSignal) {
  return collection((await request<{ users: BlockedUser[] }>('/users/me/blocks', { signal })).users)
}

export async function setBlocked(userId: number, blocked: boolean) {
  return request<void>(`/users/${userId}/block`, {
    method: blocked ? 'PUT' : 'DELETE',
  })
}

export async function removeFriend(userId: number) {
  return request<void>(`/users/me/friends/${userId}`, { method: 'DELETE' })
}

export async function updateProfile(
  update: Partial<Pick<
    Profile,
    | 'display_name'
    | 'username'
    | 'bio'
    | 'city'
    | 'gender'
    | 'participant_visibility'
    | 'show_online'
    | 'private_profile'
    | 'show_birth_date'
  >> & { birth_date?: string },
) {
  return request<Profile>('/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
}

export async function completeOnboarding(update: {
  display_name: string
  username: string
  city: string
  gender: 'man' | 'woman'
  birth_date: string
  hide_sensitive_language: boolean
}) {
  return request<Profile>('/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...update, onboarding_complete: true }),
  })
}

export async function setProfileAvatarCrop(sourceMediaId: number, cropMediaId: number) {
  return request<Profile>('/users/me/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_media_id: sourceMediaId,
      crop_media_id: cropMediaId,
    }),
  })
}

export async function addProfileAvatar(mediaId: number) {
  return request<Profile>('/users/me/avatars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
  })
}

export async function removeProfileAvatarById(mediaId: number) {
  return request<Profile>(`/users/me/avatars/${mediaId}`, { method: 'DELETE' })
}

export async function reorderProfileAvatars(mediaIds: number[]) {
  return request<Profile>('/users/me/avatars', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_ids: mediaIds }),
  })
}

export type FaceVerificationResponse = {
  profile: Profile
  verification: {
    estimated_age: number
    profile_age: number
    age_delta: number
    face_score: number
    verification_tier: VerificationTier
    verified_at: string
  }
}

export async function verifyFace(file: File) {
  return request<FaceVerificationResponse>(
    '/users/me/face-verification',
    {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    },
    45000,
  )
}

export async function setLanguageFilter(hidden: boolean) {
 return request<Profile>('/users/me', { method: 'PATCH', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({hide_sensitive_language:hidden}) })
}

export type FollowState = { following: boolean; followers: number; following_count: number }
export const loadFollowing = (id: number, signal?: AbortSignal) => request<FollowState>(`/users/${id}/follow`, { signal })
export const setFollowing = (id: number, following: boolean) => request<void>(`/users/${id}/follow`, { method: following ? 'PUT' : 'DELETE' })
