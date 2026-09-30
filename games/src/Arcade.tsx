import { useEffect, useRef, useState } from 'react'
import { getHost } from './host'

export type Kind = 'rhythm' | 'color' | 'math'
export type GameRequest = <T>(path: string, body?: unknown) => Promise<T>
type Run = {
  id: string
  kind: Kind
  step: number
  total: number
  score: number
  status: string
  reward: number
  balance: number
  wait_ms: number
  last_correct?: boolean
  challenge: {
    prompt: string
    color?: string
    options: string[]
    sequence?: number[]
  }
}
export const arcadeGames: {
  kind: Kind
  title: string
  description: string
  symbol: string
}[] = [
  {
    kind: 'rhythm',
    title: 'Повтори ритм',
    description: 'Запоминай огни и повторяй последовательность',
    symbol: '◈',
  },
  {
    kind: 'color',
    title: 'Цвет не слово',
    description: 'Выбирай цвет букв, не читая слово',
    symbol: 'Aa',
  },
  {
    kind: 'math',
    title: 'Быстрый счёт',
    description: 'Сложение, вычитание и умножение',
    symbol: '×',
  },
]
const key = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function Arcade({
  kind,
  request,
  onBack,
  onBalance,
}: {
  kind: Kind
  request: GameRequest
  onBack: () => void
  onBalance: (n: number) => void
}) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [lit, setLit] = useState(-1)
  const [entered, setEntered] = useState<number[]>([])
  const startKey = useRef(key())
  const pending = useRef<{ id: string; step: number; answer: number[] } | null>(
    null,
  )
  const locked = useRef(false)
  const alive = useRef(true)
  const game = arcadeGames.find((g) => g.kind === kind)!
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const back = getHost()?.BackButton
    back?.show()
    back?.onClick(onBack)
    return () => { back?.offClick(onBack); back?.hide() }
  }, [onBack])
  const apply = (next: Run) => {
    setRun(next)
    onBalance(next.balance)
    setEntered([])
    setReady(false)
  }
  async function start() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const next = await request<Run>('/games/start', {
        kind,
        request_key: startKey.current,
      })
      if (alive.current) apply(next)
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    void start()
  }, []) // One idempotent run per mounted game.
  useEffect(() => {
    if (!run || run.status !== 'playing') return
    setReady(false)
    setLit(-1)
    const timers: ReturnType<typeof setTimeout>[] = []
    const seq = run.challenge.sequence
    if (seq) {
      seq.forEach((value, i) => {
        timers.push(setTimeout(() => setLit(value), 350 + i * 650))
        timers.push(setTimeout(() => setLit(-1), 850 + i * 650))
      })
    }
    timers.push(
      setTimeout(
        () => setReady(true),
        Math.max(run.wait_ms + 120, seq ? seq.length * 650 + 700 : 350),
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [run])
  async function submit(answer: number[]) {
    if (!run || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    const input = pending.current || { id: run.id, step: run.step, answer }
    pending.current = input
    try {
      const next = await request<Run>('/games/answer', input)
      pending.current = null
      if (alive.current) apply(next)
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }
  function choose(value: number) {
    if (!ready || busy || pending.current) return
    if (kind === 'rhythm') {
      const next = [...entered, value]
      setEntered(next)
      if (next.length === run?.challenge.sequence?.length) void submit(next)
    } else void submit([value])
  }
  const finished = run && run.status !== 'playing'
  return (
    <main className="scroll arcade">
      <div className="arcade-top">
        <button
          className="arcade-back"
          onClick={onBack}
          aria-label="Назад к играм"
        >
          ‹
        </button>
        <h2>{game.title}</h2>
        {run && <span className="arcade-coins">{run.balance} ◉</span>}
      </div>
      {!run && !error && <p role="status">Готовим игру…</p>}
      {finished ? (
        <div className="arcade-result">
          <div className="arcade-symbol">
            {run.status === 'finished' && run.score >= 6 ? '✦' : '↻'}
          </div>
          <h2>
            {run.status === 'finished'
              ? run.score >= 6
                ? 'Отличная игра!'
                : 'Ещё немного практики'
              : 'Раунд завершён'}
          </h2>
          <p>
            {run.score} из {run.total} правильно
          </p>
          <strong className="arcade-prize">
            {run.reward > 0
              ? `+${run.reward} монеты`
              : run.status === 'finished' && run.score >= 6
                ? 'На сегодня все монеты уже собраны'
                : 'Попробуй ещё раз'}
          </strong>
          <p>
            {run.reward > 0
              ? 'Монеты уже в твоём балансе'
              : run.status === 'expired'
                ? 'Не успел — начни новый раунд.'
                : '6 правильных ответов из 8 — и получишь награду.'}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              startKey.current = key()
              setRun(null)
              void start()
            }}
          >
            Сыграть ещё
          </button>
          <button className="button button--secondary" onClick={onBack}>
            Все игры
          </button>
        </div>
      ) : (
        run && (
          <>
            <div className="arcade-progress">
              <span>
                Раунд {run.step + 1} / {run.total}
              </span>
              <span>{run.score} верно</span>
            </div>
            <progress value={run.step} max={run.total} />
            <p className="arcade-rule">
              {kind === 'color'
                ? 'Какого цвета буквы?'
                : kind === 'rhythm'
                  ? ready
                    ? 'Твоя очередь — повтори порядок'
                    : 'Запомни порядок огней'
                  : 'Выбери правильный ответ'}
            </p>
            {kind !== 'rhythm' && (
              <div
                className="arcade-question"
                style={{ color: run.challenge.color }}
              >
                {run.challenge.prompt}
                {kind === 'math' ? ' = ?' : ''}
              </div>
            )}
            <div
              className={`arcade-options ${kind === 'rhythm' ? 'arcade-pads' : ''}`}
            >
              {run.challenge.options.map((option, i) => (
                <button
                  key={i}
                  className={lit === i ? 'is-lit' : ''}
                  disabled={!ready || busy || !!pending.current}
                  onClick={() => choose(i)}
                  aria-label={kind === 'rhythm' ? `Кнопка ${i + 1}` : option}
                >
                  {option}
                </button>
              ))}
            </div>
            {kind === 'rhythm' && (
              <div
                className="arcade-sequence"
                aria-label={`Введено ${entered.length} из ${run.challenge.sequence?.length}`}
              >
                {run.challenge.sequence?.map((_, i) => (
                  <span
                    className={i < entered.length ? 'filled' : ''}
                    key={i}
                  />
                ))}
              </div>
            )}
            <p className="arcade-feedback" aria-live="polite">
              {busy
                ? 'Проверяем…'
                : run.last_correct === undefined
                  ? ''
                  : run.last_correct
                    ? 'Верно! Следующее задание'
                    : 'Не угадал. Попробуем следующее'}
            </p>
          </>
        )
      )}
      {error && (
        <div className="arcade-error" role="alert">
          <p>{error}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              pending.current
                ? void submit(pending.current.answer)
                : void start()
            }
          >
            Повторить запрос
          </button>
        </div>
      )}
    </main>
  )
}
