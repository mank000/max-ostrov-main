import { useEffect, useState } from 'react'
import type { GameRequest } from './Arcade'
import { timeText } from './game'
import { Button, Icon } from './ui'

type LeaderboardEntry = {
  user_id: number
  display_name: string
  photo_url: string
  value: number
  detail: number
}

type LeaderboardResponse = {
  leaderboards: Record<string, LeaderboardEntry[]>
}

type Board = {
  kind: string
  title: string
  subtitle: string
  format: (entry: LeaderboardEntry) => { main: string; extra?: string }
}

function number(value: number) {
  return Math.round(value).toLocaleString('ru-RU')
}

function money(value: number) {
  return number(value) + ' ₽'
}

const boards: Board[] = [
  {
    kind: 'life',
    title: 'Жизнь',
    subtitle: 'Максимальный капитал за всё время',
    format: (entry) => ({ main: money(entry.value), extra: `Заработано: ${money(entry.detail)}` }),
  },
  {
    kind: 'dino',
    title: 'Дино-рывок',
    subtitle: 'Лучшие очки за один забег',
    format: (entry) => ({ main: `${number(entry.value)} очков`, extra: `${number(entry.detail)} м` }),
  },
  {
    kind: 'flappy',
    title: 'Птичка',
    subtitle: 'Больше всего пройденных труб',
    format: (entry) => ({ main: `${number(entry.value)} труб` }),
  },
  {
    kind: 'rhythm',
    title: 'Повтори ритм',
    subtitle: 'Лучший результат из 8 заданий',
    format: (entry) => ({ main: `${entry.value} из ${entry.detail}` }),
  },
  {
    kind: 'color',
    title: 'Цвет не слово',
    subtitle: 'Лучший результат из 8 заданий',
    format: (entry) => ({ main: `${entry.value} из ${entry.detail}` }),
  },
  {
    kind: 'math',
    title: 'Быстрый счёт',
    subtitle: 'Лучший результат из 8 заданий',
    format: (entry) => ({ main: `${entry.value} из ${entry.detail}` }),
  },
  {
    kind: 'memory_easy',
    title: 'Найди пару · Легко',
    subtitle: 'Меньше ходов — выше место',
    format: (entry) => ({ main: `${entry.value} ходов`, extra: timeText(entry.detail) }),
  },
  {
    kind: 'memory_normal',
    title: 'Найди пару · Обычно',
    subtitle: 'Меньше ходов — выше место',
    format: (entry) => ({ main: `${entry.value} ходов`, extra: timeText(entry.detail) }),
  },
  {
    kind: 'memory_hard',
    title: 'Найди пару · Сложно',
    subtitle: 'Меньше ходов — выше место',
    format: (entry) => ({ main: `${entry.value} ходов`, extra: timeText(entry.detail) }),
  },
]

export function Scores({
  request,
  onPlay,
}: {
  request?: GameRequest
  onPlay: () => void
}) {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!request) return
    let active = true
    request<LeaderboardResponse>('/games/leaderboard')
      .then((next) => {
        if (!active) return
        setData(next)
        setError('')
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить таблицу лидеров')
      })
    return () => {
      active = false
    }
  }, [request])

  if (!request) {
    return (
      <main className="scroll scores">
        <div className="empty">
          <span className="award"><Icon name="award" size={40} /></span>
          <h2>Топ игроков</h2>
          <p>Общий рейтинг доступен после входа в приложение.</p>
          <Button onClick={onPlay}>К играм</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="scroll scores">
      <p className="intro">Топ‑5 игроков отдельно в каждой игре.</p>
      {!data && !error && <p className="note">Загружаем лучшие результаты…</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {data && boards.map((board) => {
        const entries = data.leaderboards[board.kind] ?? []
        return (
          <section key={board.kind} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18 }}>{board.title}</h2>
            <p className="note" style={{ marginTop: 4 }}>{board.subtitle}</p>
            {entries.length === 0 ? (
              <p className="note" style={{ marginTop: 12 }}>Пока никто не установил рекорд.</p>
            ) : (
              <div className="score-list">
                {entries.map((entry, index) => {
                  const value = board.format(entry)
                  return (
                    <div className="score-row" key={entry.user_id}>
                      <span className="score-icon" aria-label={`Место ${index + 1}`}>
                        <strong>{index + 1}</strong>
                      </span>
                      <div>
                        <h2>{entry.display_name}</h2>
                        <p>Игрок #{entry.user_id}</p>
                      </div>
                      <div className="score-value">
                        <strong>{value.main}</strong>
                        {value.extra && <span>{value.extra}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </main>
  )
}
