import { useCallback, useEffect, useState } from 'react'
import { GameScreen } from './GameScreen'
import { Home } from './Home'
import { Flappy } from './Flappy'
import { DinoRunner } from './DinoRunner'
import { LifeSim } from './LifeSim'
import './life.css'
import './life/lifeVisual.css'
import './life/lifeOverview.css'
import { MemoryHome } from './MemoryHome'
import { Scores } from './Scores'
import { levels, timeText, type Level } from './game'
import { useTheme } from './host'
import { isBetter, readScores, saveScores, type Score } from './store'
import { Button, Icon } from './ui'

import { Arcade, type Kind, type GameRequest } from './Arcade'

type Page = 'home' | 'memory' | 'scores' | 'game' | 'result'

export function App({
  theme: embeddedTheme,
  account = 'standalone',
  onBack,
  request,
}: {
  request?: GameRequest
  theme?: 'light' | 'dark'
  account?: string
  onBack?: () => void
} = {}) {
  const [arcade, setArcade] = useState<Kind | null>(null)
  const [flappy, setFlappy] = useState(false)
  const [dino, setDino] = useState(false)
  const [life, setLife] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  useEffect(() => {
    if (!request) return
    let active = true
    const refresh = () => {
      if (!document.hidden)
        request<{ balance: number }>('/users/me/wallet')
          .then((wallet) => {
            if (active) setBalance(wallet.balance)
          })
          .catch(() => {})
    }
    refresh()
    window.addEventListener('kutezh:wallet-updated', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.removeEventListener('kutezh:wallet-updated', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [request, arcade, flappy, dino])
  const [page, setPage] = useState<Page>('home')
  const [level, setLevel] = useState<Level>('easy')
  const [round, setRound] = useState(0)
  const [scores, setScores] = useState(() => readScores(account))
  const [result, setResult] = useState<Score | null>(null)
  const [best, setBest] = useState(false)
  const [stored, setStored] = useState(true)
  const { theme, toggle } = useTheme(embeddedTheme)

  function play() {
    setRound((value) => value + 1)
    setPage('game')
  }
  const finish = useCallback(
    (score: Score) => {
      const better = isBetter(score, scores[score.level])
      if (better) {
        const next = { ...scores, [score.level]: score }
        setStored(saveScores(next, account))
        setScores(next)
      }
      if (request) {
        void request<{ ok: boolean }>('/games/score', {
          kind: `memory_${score.level}`,
          value: score.moves,
          detail: Math.round(score.time),
        }).catch(() => {})
      }
      setBest(better)
      setResult(score)
      setPage('result')
    },
    [scores, account, request],
  )

  const title =
    page === 'scores'
      ? 'Топ игроков'
      : page === 'result'
        ? 'Результат'
        : page === 'memory'
          ? 'Найди пару'
          : 'Игры'

  if (life && request)
    return (
      <div className="shell life-shell">
        <LifeSim request={request} onBack={() => setLife(false)} />
      </div>
    )

  if (dino && request)
    return (
      <div className="shell">
        <DinoRunner
          request={request}
          onBalance={setBalance}
          onBack={() => setDino(false)}
        />
      </div>
    )

  if (flappy && request)
    return (
      <div className="shell">
        <Flappy
          request={request}
          onBalance={setBalance}
          onBack={() => setFlappy(false)}
        />
      </div>
    )

  if (arcade && request)
    return (
      <div className="shell">
        <Arcade
          key={arcade}
          kind={arcade}
          request={request}
          onBalance={setBalance}
          onBack={() => setArcade(null)}
        />
      </div>
    )

  return (
    <div className="shell">
      {onBack && page !== 'game' && (
        <div className="service-return-bar">
          <button onClick={onBack}>‹ Разделы</button>
        </div>
      )}
      {page === 'game' ? (
        <GameScreen
          key={round}
          level={level}
          onExit={() => setPage('memory')}
          onRestart={play}
          onDone={finish}
        />
      ) : (
        <>
          <header
            className={`header ${page === 'memory' ? 'header--detail' : ''} ${page === 'scores' ? 'header--scores' : ''}`}
          >
            {(page === 'scores' || page === 'result') && <button className="desktop-scores-back" type="button" onClick={() => setPage('home')}>
              <Icon name="back" /><span>Игры</span>
            </button>}
            {page === 'memory' && (
              <button
                className="icon-button"
                type="button"
                aria-label="Назад к играм"
                onClick={() => setPage('home')}
              >
                <Icon name="back" />
              </button>
            )}
            <h1>{title}</h1>
            {page === 'home' && <button className="desktop-scores-link" type="button" onClick={() => setPage('scores')}>
              <Icon name="award" /><span>Топ‑5</span>
            </button>}
            {!embeddedTheme && (
              <button
                className="icon-button"
                type="button"
                aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
                onClick={toggle}
              >
                <Icon name={theme === 'light' ? 'moon' : 'sun'} />
              </button>
            )}
          </header>
          {page === 'home' && (
            <Home
              onMemory={() => setPage('memory')}
              onFlappy={request ? () => setFlappy(true) : undefined}
              onDino={request ? () => setDino(true) : undefined}
              onLife={request ? () => setLife(true) : undefined}
              onArcade={request ? setArcade : undefined}
              balance={balance}
            />
          )}
          {page === 'memory' && (
            <MemoryHome level={level} onLevel={setLevel} onPlay={play} />
          )}
          {page === 'scores' && <Scores request={request} onPlay={() => setPage('home')} />}
          {page === 'result' && result && (
            <main className="scroll result">
              <span className="award">
                <Icon name="award" size={44} />
              </span>
              <h2>{best ? 'Новый рекорд!' : 'Все пары найдены!'}</h2>
              <p>
                {levels.find((item) => item.id === level)?.name} · Отличная
                разминка для памяти
              </p>
              <dl className="stats">
                <div>
                  <dt>Ходы</dt>
                  <dd>{result.moves}</dd>
                </div>
                <div>
                  <dt>Время</dt>
                  <dd>{timeText(result.time)}</dd>
                </div>
              </dl>
              {!stored && (
                <p className="notice" role="status">
                  Браузер не разрешил сохранить рекорд. Он доступен до закрытия
                  приложения.
                </p>
              )}
              <Button onClick={play}>Сыграть ещё</Button>
              <Button secondary onClick={() => setPage('scores')}>
                Топ игроков
              </Button>
            </main>
          )}
          <nav className="nav" aria-label="Разделы игр">
            <button
              aria-current={page !== 'scores' ? 'page' : undefined}
              onClick={() => setPage('home')}
            >
              <Icon name="game" />
              <span>Игры</span>
            </button>
            <button
              aria-current={page === 'scores' ? 'page' : undefined}
              onClick={() => setPage('scores')}
            >
              <Icon name="award" />
              <span>Топ‑5</span>
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
