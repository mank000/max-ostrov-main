import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { changeGame, faces, gameTime, newGame, timeText, type Level } from './game'
import { getHost, tap } from './host'
import type { Score } from './store'
import { Back, Button, Dialog, Icon } from './ui'

export function GameScreen({ level, onExit, onRestart, onDone }: { level: Level; onExit: () => void; onRestart: () => void; onDone: (score: Score) => void }) {
  const [game, send] = useReducer(changeGame, level, value => newGame(value, performance.now()))
  const [now, setNow] = useState(() => performance.now())
  const [menu, setMenu] = useState<'pause' | 'leave' | 'restart' | null>(null)
  const saved = useRef(false)
  const pause = useCallback(() => {
    send({ type: 'pause', now: performance.now() })
    setMenu(old => old || 'pause')
  }, [])
  const askLeave = useCallback(() => {
    send({ type: 'pause', now: performance.now() })
    setMenu('leave')
  }, [])

  useEffect(() => {
    if (game.status !== 'play') return
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [game.status])
  useEffect(() => {
    if (game.open.length !== 2 || game.status !== 'play') return
    const timer = window.setTimeout(() => send({ type: 'hide' }), 800)
    return () => clearTimeout(timer)
  }, [game.open, game.status])
  useEffect(() => {
    const host = getHost()
    const hide = () => { if (document.hidden) pause() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) pause() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('keydown', key)
    host?.onEvent?.('deactivated', pause)
    host?.BackButton?.show()
    host?.BackButton?.onClick(askLeave)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('keydown', key)
      host?.offEvent?.('deactivated', pause)
      host?.BackButton?.offClick(askLeave)
      host?.BackButton?.hide()
    }
  }, [pause, askLeave])
  useEffect(() => {
    if (game.status !== 'done' || saved.current) return
    saved.current = true
    tap(true)
    onDone({ level, moves: game.moves, time: game.time })
  }, [game.status, game.moves, game.time, level, onDone])

  function resume() {
    const time = performance.now()
    setNow(time)
    send({ type: 'resume', now: time })
    setMenu(null)
  }
  return <>
    <header className="header header--game">
      <button className="icon-button" aria-label="Назад к играм" onClick={askLeave}><Icon name="back" /></button>
      <h1>Найди пару</h1>
      <button className="icon-button" aria-label="Пауза" onClick={pause}><span className="pause-icon" aria-hidden="true" /></button>
    </header>
    <main className="scroll game-screen">
      <dl className="stats">
        <div><dt>Пары</dt><dd>{game.found.length / 2} / {game.cards.length / 2}</dd></div>
        <div><dt>Ходы</dt><dd>{game.moves}</dd></div>
        <div><dt>Время</dt><dd>{timeText(gameTime(game, now))}</dd></div>
      </dl>
      <div className="board" aria-label="Игровое поле">
        {game.cards.map((face, index) => {
          const found = game.found.includes(index)
          const open = game.status !== 'pause' && (found || game.open.includes(index))
          return <button key={index} className={`card ${open ? 'card--open' : ''} ${found && open ? 'card--found' : ''}`}
            aria-label={`Карточка ${index + 1}: ${open ? faces[face].name + (found ? ', пара найдена' : '') : 'закрыта'}`}
            aria-disabled={found || open || game.status !== 'play' || game.open.length === 2}
            onClick={() => {
              if (game.status !== 'play' || found || open || game.open.length === 2) return
              tap()
              send({ type: 'flip', index, now: performance.now() })
            }}>
            {open ? <Icon name={faces[face].icon} size={34} /> : <Back />}
            {found && open && <span className="card-check"><Icon name="check" size={12} /></span>}
          </button>
        })}
      </div>
      <p className="game-hint" role="status">{game.found.length ? `Найдено пар: ${game.found.length / 2}. Продолжай!` : 'Найди две одинаковые карточки'}</p>
      <div className="game-bottom"><Button secondary onClick={() => { pause(); setMenu('restart') }}>Начать заново</Button></div>
    </main>
    {menu && <Dialog title={menu === 'leave' ? 'Выйти из игры?' : menu === 'restart' ? 'Начать заново?' : 'Пауза'} onClose={resume}>
      <p>{menu === 'pause' ? 'Можно выдохнуть. Время остановлено, карточки скрыты.' : 'Текущая партия не сохранится. Рекорды останутся.'}</p>
      <Button onClick={resume}>Продолжить игру</Button>
      {menu === 'leave' && <Button secondary onClick={onExit}>Выйти</Button>}
      {menu === 'restart' && <Button secondary onClick={onRestart}>Начать заново</Button>}
    </Dialog>}
  </>
}
