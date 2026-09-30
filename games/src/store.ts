import type { Level } from './game'

export type Score = { level: Level; moves: number; time: number }
export type Scores = Partial<Record<Level, Score>>
const key = 'mini-games:scores:v1'

export function readScores(account = 'standalone'): Scores {
  try {
    const data = JSON.parse(localStorage.getItem(`${key}:${account}`) || '{}')
    const scores: Scores = {}
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const score = data?.[level]
      const min = level === 'easy' ? 6 : level === 'normal' ? 8 : 10
      if (score?.level === level && Number.isSafeInteger(score.moves) && score.moves >= min &&
          Number.isFinite(score.time) && score.time >= 0) scores[level] = score
    }
    return scores
  } catch { return {} }
}

export function isBetter(score: Score, best?: Score) {
  return !best || score.moves < best.moves || (score.moves === best.moves && score.time < best.time)
}

export function saveScores(scores: Scores, account = 'standalone') {
  try {
    localStorage.setItem(`${key}:${account}`, JSON.stringify(scores))
    return true
  } catch { return false }
}
