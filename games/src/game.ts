export const levels = [
  { id: 'easy', name: 'Легко', pairs: 6 },
  { id: 'normal', name: 'Обычно', pairs: 8 },
  { id: 'hard', name: 'Сложно', pairs: 10 },
] as const

export type Level = typeof levels[number]['id']
export const faces = [
  { icon: 'heart', name: 'Сердце' },
  { icon: 'star', name: 'Звезда' },
  { icon: 'sun', name: 'Солнце' },
  { icon: 'gift', name: 'Подарок' },
  { icon: 'music', name: 'Музыка' },
  { icon: 'coffee', name: 'Кофе' },
  { icon: 'camera', name: 'Камера' },
  { icon: 'moon', name: 'Луна' },
  { icon: 'game', name: 'Игра' },
  { icon: 'award', name: 'Награда' },
] as const

export type Game = {
  cards: number[]
  open: number[]
  found: number[]
  moves: number
  time: number
  start: number
  status: 'play' | 'pause' | 'done'
}

type Action =
  | { type: 'flip'; index: number; now: number }
  | { type: 'hide' }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }

export function newGame(level: Level, now: number, random = Math.random): Game {
  const count = levels.find(item => item.id === level)!.pairs
  const cards = Array.from({ length: count * 2 }, (_, i) => i % count)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return { cards, open: [], found: [], moves: 0, time: 0, start: now, status: 'play' }
}

export function gameTime(game: Game, now: number) {
  return game.time + (game.status === 'play' ? Math.max(0, now - game.start) : 0)
}

export function changeGame(game: Game, action: Action): Game {
  if (action.type === 'pause') {
    return game.status === 'play'
      ? { ...game, status: 'pause', time: gameTime(game, action.now) }
      : game
  }
  if (action.type === 'resume') {
    return game.status === 'pause' ? { ...game, status: 'play', start: action.now } : game
  }
  if (game.status !== 'play') return game
  if (action.type === 'hide') return game.open.length === 2 ? { ...game, open: [] } : game
  const index = action.index
  if (!Number.isInteger(index) || index < 0 || index >= game.cards.length ||
      game.open.length === 2 || game.open.includes(index) || game.found.includes(index)) return game
  const open = [...game.open, index]
  if (open.length === 1) return { ...game, open }
  const moves = game.moves + 1
  if (game.cards[open[0]] !== game.cards[open[1]]) return { ...game, open, moves }
  const found = [...game.found, ...open]
  const done = found.length === game.cards.length
  return {
    ...game, open: [], found, moves,
    status: done ? 'done' : 'play',
    time: done ? gameTime(game, action.now) : game.time,
  }
}

export function timeText(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
