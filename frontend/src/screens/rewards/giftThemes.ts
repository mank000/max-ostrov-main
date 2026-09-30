
export const GIFT_THEMES = [
  { id: 'all', label: 'Все' },
  { id: 'friends', label: 'Зверята' },
  { id: 'treats', label: 'Вкусное' },
  { id: 'flowers', label: 'Цветы' },
  { id: 'moments', label: 'Вместе' },
  { id: 'sky', label: 'Космос' },
] as const

export type GiftTheme = (typeof GIFT_THEMES)[number]['id']

export const ILLUSTRATED_GIFT_CODES = new Set([
  'gift_little_fox',
  'gift_matcha',
  'gift_tulips',
  'gift_letter',
  'gift_planet',
  'gift_picnic',
])

export function giftTheme(code: string): Exclude<GiftTheme, 'all'> {
  if (
    [
      'gift_little_fox',
      'gift_blue_whale',
      'gift_lucky_frog',
      'gift_capybara',
      'gift_duck',
      'gift_otter',
      'gift_bunny',
      'gift_puppy',
    ].includes(code)
  )
    return 'friends'
  if (
    [
      'gift_pancakes',
      'gift_matcha',
      'gift_croissant',
      'gift_strawberry_milk',
      'gift_mochi',
      'gift_bento',
      'gift_cherry_pair',
    ].includes(code)
  )
    return 'treats'
  if (['gift_tulips', 'gift_daisy', 'gift_lavender'].includes(code)) return 'flowers'
  if (['gift_planet', 'gift_comet', 'gift_lantern'].includes(code)) return 'sky'
  return 'moments'
}
