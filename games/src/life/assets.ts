const icons = import.meta.glob('../assets/life/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const rooms = import.meta.glob('../assets/life/rooms/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const characters = import.meta.glob('../assets/life/characters/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export function lifeIcon(name: string) {
  return icons[`../assets/life/icons/${name}.svg`]
}

export function roomImage(level: number) {
  return rooms[`../assets/life/rooms/${Math.max(0, Math.min(5, level))}.jpg`]
}

export function characterImage(outfit: string) {
  return characters[`../assets/life/characters/${outfit}.png`]
}
