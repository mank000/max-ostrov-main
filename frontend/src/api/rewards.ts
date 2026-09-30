import { collection, listField, operationKey, readCursor, request } from './http'

export type Achievement = {
  code: string
  title: string
  description: string
  progress: number
  target: number
  reward_coins: number
  unlocked_at?: string
}

export type Wallet = { balance: number; unlimited: boolean }

export function loadWallet(signal?: AbortSignal) {
  return request<Wallet>('/users/me/wallet', { signal })
}

export async function loadRewards(signal?: AbortSignal) {

  const achievementList = await request<{ achievements: Achievement[] }>('/users/me/achievements', {
    signal,
  })
  const wallet = await loadWallet(signal)
  return {
    balance: wallet.balance,
    unlimited: wallet.unlimited,
    achievements: collection(achievementList.achievements),
  }
}

export type StoreItem = {
  code: string
  kind: 'profile_decoration' | 'profile_boost' | 'event_boost' | 'gift'
  title: string
  description: string
  coin_price: number
  duration_hours?: number
}

export async function loadStoreItems(signal?: AbortSignal) {
  const body = await request<Record<string, unknown>>('/store/items', {
    signal,
  })
  return listField<StoreItem>(body, 'items')
}

export async function purchaseStoreItem(
  itemCode: string,
  targetEventId?: number,
  idempotencyKey = operationKey(),
) {
  return request<{
    id: number
    item_code: string
    target_event_id?: number
    expires_at?: string
    created_at: string
  }>('/store/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_code: itemCode,
      idempotency_key: idempotencyKey,
      ...(targetEventId ? { target_event_id: targetEventId } : {}),
    }),
  })
}

export type CoinTransaction = {
  complimentary?: boolean
  id: number
  amount: number
  kind:
  | 'attendance_reward'
  | 'achievement_reward'
  | 'game_reward'
  | 'referral_reward'
  | 'store_purchase'
  | 'gift_purchase'
  | 'adjustment'
  description: string
  reference_type?: string
  reference_id?: string
  created_at: string
}

export async function loadCoinTransactions(beforeId?: number, signal?: AbortSignal) {
  const suffix = beforeId ? `?before_id=${beforeId}` : ''
  const body = await request<Record<string, unknown>>(`/users/me/coin-transactions${suffix}`, {
    signal,
  })
  return {
    transactions: listField<CoinTransaction>(body, 'transactions'),
    nextCursor: readCursor(body.next_cursor),
  }
}

export type Gift = {
  id: number
  sender_user_id: number
  recipient_user_id: number
  item_code: string
  title: string
  message: string
  created_at: string
  sender?: {
    id: number
    username?: string
    display_name: string
    photo_url?: string
  }
}

export async function loadReceivedGifts(beforeId?: number, signal?: AbortSignal) {
  const suffix = beforeId ? `?before_id=${beforeId}` : ''
  const body = await request<Record<string, unknown>>(`/users/me/gifts${suffix}`, { signal })
  return {
    gifts: listField<Gift>(body, 'gifts'),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function loadUserGifts(userId: number, beforeId?: number, signal?: AbortSignal) {
  const suffix = beforeId ? `?before_id=${beforeId}` : ''
  const body = await request<Record<string, unknown>>(`/users/${userId}/gifts${suffix}`, { signal })
  return {
    gifts: listField<Gift>(body, 'gifts'),
    nextCursor: readCursor(body.next_cursor),
  }
}

export async function sendGift(
  userId: number,
  itemCode: string,
  message: string,
  idempotencyKey = operationKey(),
) {
  return request<Gift>(`/users/${userId}/gifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_code: itemCode,
      message,
      idempotency_key: idempotencyKey,
    }),
  })
}
