import { listField, operationKey, request } from './http'

export type Group = {
  id: number
  event_id: number
  leader_user_id: number
  title: string
  join_policy: 'open' | 'request' | 'invite_only'
  capacity: number
  member_count: number
  available_places: number
  joined: boolean
  is_leader: boolean
  join_requested: boolean
  invited: boolean
  reinvite_required: boolean
  chat_provider?: 'max'
  chat_url?: string
  created_at: string
  updated_at: string
}

export type GroupMember = {
  id: number
  username?: string
  display_name: string
  photo_url?: string
  is_leader: boolean
  joined_at: string
}

type GroupCandidate = {
  group_id: number
  user_id: number
  display_name: string
  photo_url?: string
  created_at: string
}

export type GroupInvitation = {
  group: Group
  created_at: string
}

type GroupMergeRequest = {
  source_group: Group
  created_at: string
}

export async function loadEventGroups(eventId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/events/${eventId}/groups`, { signal })
  return listField<Group>(body, 'groups')
}

export async function createEventGroup(
  eventId: number,
  input: {
    title: string
    capacity: number
    join_policy: Group['join_policy']
    chat_provider?: Group['chat_provider'] | ''
    chat_url?: string
  },
  key = operationKey(),
) {
  return request<Group>(`/events/${eventId}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(input),
  })
}

export async function loadGroupMembers(groupId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/groups/${groupId}/members`, { signal })
  return listField<GroupMember>(body, 'members')
}

export async function updateGroup(
  groupId: number,
  input: {
    title: string
    capacity: number
    join_policy: Group['join_policy']
    chat_provider?: Group['chat_provider'] | ''
    chat_url?: string
  },
) {
  return request<void>(`/groups/${groupId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function removeGroupMember(groupId: number, userId: number) {
  return request<void>(`/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export async function transferGroupLeadership(groupId: number, userId: number) {
  return request<void>(`/groups/${groupId}/leader`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  })
}

export async function joinGroup(groupId: number) {
  return request<void>(`/groups/${groupId}/membership`, { method: 'PUT' })
}

export async function leaveGroup(groupId: number) {
  return request<void>(`/groups/${groupId}/membership`, { method: 'DELETE' })
}

export async function requestGroupJoin(groupId: number) {
  return request<void>(`/groups/${groupId}/join-requests`, { method: 'POST' })
}

export async function loadGroupJoinRequests(groupId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/groups/${groupId}/join-requests`, {
    signal,
  })
  return listField<GroupCandidate>(body, 'requests')
}

export async function resolveGroupJoinRequest(groupId: number, userId: number, accept: boolean) {
  return request<void>(`/groups/${groupId}/join-requests/${userId}`, {
    method: accept ? 'PUT' : 'DELETE',
  })
}

export async function inviteToGroup(groupId: number, userId: number) {
  return request<void>(`/groups/${groupId}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  })
}

export async function loadGroupInvitations(signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>('/users/me/group-invitations', { signal })
  return listField<GroupInvitation>(body, 'invitations')
}

export async function resolveGroupInvitation(groupId: number, accept: boolean) {
  return request<void>(`/groups/${groupId}/invitations/me`, {
    method: accept ? 'PUT' : 'DELETE',
  })
}

export async function requestGroupMerge(sourceGroupId: number, targetGroupId: number) {
  return request<void>(`/groups/${sourceGroupId}/merge-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_group_id: targetGroupId }),
  })
}

export async function loadGroupMergeRequests(targetGroupId: number, signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>(`/groups/${targetGroupId}/merge-requests`, {
    signal,
  })
  return listField<GroupMergeRequest>(body, 'requests')
}

export async function resolveGroupMerge(
  targetGroupId: number,
  sourceGroupId: number,
  accept: boolean,
) {
  return request<void>(`/groups/${targetGroupId}/merge-requests/${sourceGroupId}`, {
    method: accept ? 'PUT' : 'DELETE',
  })
}
