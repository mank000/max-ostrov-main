const giftAliases: Record<string, string> = {
  gift_star: 'gift_comet',
  gift_coffee: 'gift_matcha',
  gift_heart: 'gift_cloud_hug',
  gift_teddy: 'gift_bunny',
  gift_flowers: 'gift_tulips',
  gift_cake: 'gift_pancakes',
  gift_camera: 'gift_polaroid',
  gift_rocket: 'gift_comet',
  gift_crown: 'gift_lantern',
  gift_cat: 'gift_little_fox',
  gift_sushi: 'gift_bento',
  gift_sunflower: 'gift_daisy',
  gift_moon: 'gift_planet',
  gift_gamepad: 'gift_record',
  gift_balloon: 'gift_blue_whale',
  gift_donut: 'gift_mochi',
  gift_clover: 'gift_lucky_frog',
  gift_sneakers: 'gift_skate',
  gift_headphones: 'gift_record',
  gift_party_car: 'gift_picnic',
}

const giftImages: Record<string, string> = {
  "gift_little_fox": "gift_little_fox.webp",
  "gift_blue_whale": "gift_blue_whale.svg",
  "gift_cherry_pair": "gift_cherry_pair.svg",
  "gift_cloud_hug": "gift_cloud_hug.svg",
  "gift_lucky_frog": "gift_lucky_frog.svg",
  "gift_capybara": "gift_capybara.svg",
  "gift_pancakes": "gift_pancakes.svg",
  "gift_matcha": "gift_matcha.webp",
  "gift_croissant": "gift_croissant.svg",
  "gift_strawberry_milk": "gift_strawberry_milk.svg",
  "gift_tulips": "gift_tulips.webp",
  "gift_daisy": "gift_daisy.svg",
  "gift_lavender": "gift_lavender.svg",
  "gift_letter": "gift_letter.webp",
  "gift_polaroid": "gift_polaroid.svg",
  "gift_ticket": "gift_ticket.svg",
  "gift_skate": "gift_skate.svg",
  "gift_record": "gift_record.svg",
  "gift_book": "gift_book.svg",
  "gift_candle": "gift_candle.svg",
  "gift_mochi": "gift_mochi.svg",
  "gift_bento": "gift_bento.svg",
  "gift_duck": "gift_duck.svg",
  "gift_otter": "gift_otter.svg",
  "gift_bunny": "gift_bunny.svg",
  "gift_puppy": "gift_puppy.svg",
  "gift_planet": "gift_planet.webp",
  "gift_comet": "gift_comet.svg",
  "gift_lantern": "gift_lantern.svg",
  "gift_picnic": "gift_picnic.webp"
}

export function GiftArtwork({ code, size = 82, className = '' }: { code: string; size?: number; className?: string }) {
  const name = giftAliases[code] || code
  return <img className={`gift-artwork ${className}`} src={`/assets/gifts/${giftImages[name] || 'default.svg'}`}
    width={size} height={size} alt="" loading="lazy" decoding="async" />
}
