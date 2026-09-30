import { readTabValue, saveTabValue } from '../../ui-utils'
import { type Group } from '../../api/groups'
const groupEvents = new Map<number, number>()
export function policyLabel(policy: Group['join_policy']) {
  if (policy === 'open') return 'Открытая'
  if (policy === 'request') return 'По заявке'
  return 'По приглашению'
}

export function chatProviderLabel(provider?: Group['chat_provider']) {
  if (provider === 'max') return 'MAX'
  return ''
}

export function maxChatHint() {
  return 'Вставь сюда ссылку-приглашение из MAX — обычно она начинается с max.ru/join/…'
}

export function activeEvent(event: { starts_at: string; ends_at?: string }) {
  const boundary = new Date(event.ends_at || event.starts_at).getTime()
  return Number.isFinite(boundary) && boundary >= Date.now()
}

export function rememberGroup(group: Group) {
  groupEvents.set(group.id, group.event_id)
  try {
    saveTabValue(`kutezh-group-${group.id}`, String(group.event_id))
  } catch {

  }
}

export function rememberedEventId(groupId?: number) {
  if (!groupId) return 0
  const known = groupEvents.get(groupId)
  if (known) return known
  try {
    const value = Number(readTabValue(`kutezh-group-${groupId}`))
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function groupStatus(group: Group) {
  if (group.joined) return group.is_leader ? 'Вы лидер' : 'Вы в группе'
  if (group.join_requested) return 'Заявка отправлена'
  if (group.invited) return 'Вас пригласили'
  if (group.reinvite_required) return 'Повторное вступление только по приглашению'
  return policyLabel(group.join_policy)
}
