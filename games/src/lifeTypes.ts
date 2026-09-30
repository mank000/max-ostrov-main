export type Skills = {
  discipline: number
  communication: number
  digital: number
  finance: number
  management: number
}

export type Job = {
  id: string
  title: string
  description: string
  pay: number
  duration_seconds: number
  game_days: number
  hunger_cost: number
  energy_cost: number
  min_education: number
  min_experience: number
  min_reputation: number
  min_skills: Skills
  skill_gain: Skills
  experience_gain: number
}

export type Program = {
  id: string
  title: string
  description: string
  cost: number
  duration_seconds: number
  game_days: number
  level: number
  min_education: number
  min_experience: number
  min_skills: Skills
  skill_gain: Skills
}

export type Training = {
  id: string
  title: string
  description: string
  cost: number
  duration_seconds: number
  game_days: number
  energy_cost: number
  skill_gain: Skills
}

export type Meal = {
  id: string
  title: string
  description: string
  cost: number
  hunger_gain: number
  health_gain: number
  mood_gain: number
  emergency?: boolean
}

export type Home = {
  level: number
  title: string
  description: string
  cost: number
  rest_bonus: number
  mood_bonus: number
}

export type BusinessTier = {
  level: number
  min_level?: number
  title: string
  description: string
  upgrade_cost: number
  base_revenue: number
  min_staff: number
  min_brand: number
  min_management: number
  min_finance: number
  cycle_seconds: number
  upgrade_seconds: number
}

export type CareerOption = {
  id: string
  min_level?: number
  track: string
  title: string
  description: string
  salary: number
  interview_seconds: number
  work_seconds: number
  min_education: number
  min_experience: number
  min_reputation: number
  min_skills: Skills
}

export type AssetOption = {
  id: string
  category: string
  title: string
  description: string
  cost: number
  energy_bonus: number
  mood_bonus: number
  work_bonus: number
  status_bonus: number
}

export type InvestmentOption = {
  id: string
  title: string
  description: string
  risk: number
  return_bps: number
  min_amount: number
  min_finance: number
}

export type HobbyOption = {
  id: string
  title: string
  description: string
  cost: number
  duration_seconds: number
  game_days: number
  stress_change: number
  fitness_change: number
  social_change: number
  mood_change: number
  skill_gain: Skills
}

export type CertificationOption = {
  id: string
  title: string
  description: string
  cost: number
  duration_seconds: number
  game_days: number
  min_education: number
  min_skills: Skills
  skill_gain: Skills
}

export type SocialOption = {
  id: string
  title: string
  description: string
  cost: number
  duration_seconds: number
  game_days: number
  friends: number
  contacts: number
  family: number
  relationship: number
  stress_change: number
  mood_change: number
}

export type IndustryOption = {
  id: string
  title: string
  description: string
  entry_cost: number
  volatility: number
  margin_bonus: number
  tech_weight: number
}

export type DepartmentOption = {
  id: string
  title: string
  description: string
  base_cost: number
}

export type RegionOption = {
  id: string
  title: string
  description: string
  min_tier: number
  cost: number
  brand_need: number
}

export type ProductOption = {
  id: string
  title: string
  description: string
  min_tier: number
  launch_cost: number
  build_seconds: number
  base_revenue: number
  innovation_need: number
}

export type Activity = {
  kind: string
  target: string
  title: string
  started_at: string
  ends_at: string
  game_days: number
}

export type PendingEvent = {
  id: string
  kind?: string
  story_id?: string
  title: string
  text: string
  severity: 'good' | 'warning' | 'danger'
  options: { id: string; title: string; hint: string }[]
}

export type HistoryItem = {
  at: string
  kind: string
  title: string
  text: string
}

export type CareerState = {
  role_id: string
  title: string
  track: string
  employer: string
  salary: number
  performance: number
  stability: number
  months: number
  last_salary: number
}

export type FinanceState = {
  savings: number
  credit_score: number
  portfolio: Record<string, number>
  total_invested: number
  taxes_paid: number
  insurance: number
  last_return: number
}

export type LifestyleState = {
  stress: number
  fitness: number
  social: number
  knowledge: number
  comfort: number
  habit_streak: number
  assets: string[]
  equipped_wardrobe?: string
  credentials: string[]
}

export type NetworkState = {
  friends: number
  professional_contacts: number
  mentors: number
  relationship: number
  family_bond: number
}

export type EconomyState = {
  phase: string
  market_index: number
  inflation: number
  last_day: number
}

export type CompanyProductState = {
  id: string
  title: string
  quality: number
  market_fit: number
  revenue: number
  launches: number
  last_result: string
}

export type CompanyState = {
  tier: number
  staff: number
  brand: number
  cash: number
  dividend_ready: boolean
  last_profit: number
  industry: string
  market_share: number
  innovation: number
  debt: number
  valuation: number
  public: boolean
  ownership: number
  departments: Record<string, number>
  regions: string[]
  products: CompanyProductState[]
  acquisitions: number
}

export type LifeState = {
  version: number
  last_free_meal?: string
  recent_keys?: string[]
  cash: number
  debt: number
  hunger: number
  energy: number
  health: number
  mood: number
  education: number
  experience: number
  reputation: number
  days: number
  home: number
  max_home?: number
  skills: Skills
  career?: CareerState
  finance: FinanceState
  lifestyle: LifestyleState
  network: NetworkState
  economy: EconomyState
  company?: CompanyState
  active?: Activity
  projects?: Activity[]
  pending_event?: PendingEvent
  history: HistoryItem[]
  total_earned: number
}

export type LifeMilestone = {
  id: string
  stage: number
  title: string
  description: string
  current: number
  target: number
  done: boolean
}

export type LifeLevel = {
  level: number
  xp: number
  level_start_xp: number
  next_level_xp: number
  progress: number
  era: number
  era_id: string
  era_title: string
  era_description: string
  unlocked: string[]
  next_unlock: string
  upcoming?: { level: number; kind: string; title: string }[]
}

export type LifeStoryBeat = {
  id: string
  era: number
  title: string
  description: string
}

export type LifeStory = {
  completed: number
  total: number
  last_beat?: LifeStoryBeat
  next_beat?: LifeStoryBeat
  choices: Record<string, string>
}

export type LifeView = {
  server_now: string
  state: LifeState
  level?: LifeLevel
  story?: LifeStory
  milestones: LifeMilestone[]
  catalog: {
    jobs: Job[]
    programs: Program[]
    training: Training[]
    meals: Meal[]
    homes: Home[]
    business_tiers: BusinessTier[]
    expansion: {
      careers: CareerOption[]
      assets: AssetOption[]
      investments: InvestmentOption[]
      hobbies: HobbyOption[]
      certifications: CertificationOption[]
      social: SocialOption[]
      industries: IndustryOption[]
      departments: DepartmentOption[]
      regions: RegionOption[]
      products: ProductOption[]
    }
  }
}
