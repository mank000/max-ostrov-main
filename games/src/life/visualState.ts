import type { Activity, LifeState } from '../lifeTypes'

export type SceneKind = 'home' | 'work' | 'study' | 'interview' | 'rest' | 'social' | 'fitness' | 'company'

export function characterStage(days: number) {
  const age = 18 + Math.floor(days / 365)
  return age < 22 ? 0 : age < 28 ? 1 : age < 36 ? 2 : age < 46 ? 3 : 4
}

export function activityScene(active?: Activity): SceneKind {
  if (!active) return 'home'
  if (active.kind === 'career_interview') return 'interview'
  if (active.kind.includes('study') || active.kind.includes('certification') || active.kind.includes('train')) return 'study'
  if (active.kind.includes('rest')) return 'rest'
  if (active.kind.includes('social') || active.kind.includes('date')) return 'social'
  if (active.kind.includes('hobby')) return 'fitness'
  if (active.kind.includes('business') || active.kind.includes('product')) return 'company'
  return 'work'
}

export function vehicleType(assets: string[]) {
  if (assets.includes('premium_car')) return 'premium'
  if (assets.includes('reliable_car')) return 'reliable'
  if (assets.includes('used_car')) return 'used'
  if (assets.includes('bike')) return 'bike'
  return 'none'
}

export function wardrobeType(state: LifeState) {
  if (state.lifestyle.equipped_wardrobe === 'casual') return 'casual'
  if (state.lifestyle.equipped_wardrobe === 'capsule_wardrobe' && state.lifestyle.assets.includes('capsule_wardrobe')) return 'capsule'
  if (state.lifestyle.equipped_wardrobe === 'business_wardrobe' && state.lifestyle.assets.includes('business_wardrobe')) return 'business'
  if (state.lifestyle.equipped_wardrobe === 'executive_wardrobe' && state.lifestyle.assets.includes('executive_wardrobe')) return 'executive'
  const assets = state.lifestyle.assets
  if (assets.includes('executive_wardrobe')) return 'executive'
  if (assets.includes('business_wardrobe')) return 'business'
  if (assets.includes('capsule_wardrobe')) return 'capsule'
  return 'casual'
}
