import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameRequest } from './Arcade'
import { getHost } from './host'

type Pipe = { gap: number; coin: boolean }
type FlappyRun = {
  id: string
  status: string
  pipes: Pipe[]
  collected: number[]
  reward: number
  balance: number
}
type Phase = 'loading' | 'ready' | 'playing' | 'over'
type Sim = {
  y: number
  velocity: number
  elapsed: number
  passed: Set<number>
  collected: Set<number>
  pending: Set<number>
}

const requestKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

function freshSim(): Sim {
  return {
    y: 230,
    velocity: 0,
    elapsed: 0,
    passed: new Set<number>(),
    collected: new Set<number>(),
    pending: new Set<number>(),
  }
}

function pipeGeometry(width: number, height: number, elapsed: number, index: number, pipe: Pipe) {
  const ground = 40
  const playHeight = height - ground
  const speed = clamp(width * 0.46, 138, 184)
  const spacing = clamp(width * 0.58, 188, 224)
  const pipeWidth = clamp(width * 0.16, 54, 68)
  const gapHeight = clamp(height * 0.29, 138, 174)
  const x = width + 70 + index * spacing - elapsed * speed
  const center = clamp(
    (pipe.gap / 100) * playHeight,
    gapHeight / 2 + 24,
    playHeight - gapHeight / 2 - 24,
  )
  return {
    x,
    pipeWidth,
    gapTop: center - gapHeight / 2,
    gapBottom: center + gapHeight / 2,
    coinX: x + pipeWidth / 2,
    coinY: center,
    playHeight,
  }
}

function drawScene(canvas: HTMLCanvasElement, run: FlappyRun, sim: Sim) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const css = getComputedStyle(canvas)
  const accent = css.getPropertyValue('--accent-text').trim() || '#0070e5'
  const soft = css.getPropertyValue('--accent-soft').trim() || '#e8f2ff'
  const primary = css.getPropertyValue('--primary').trim() || '#fff'
  const secondary = css.getPropertyValue('--secondary').trim() || '#f5f7fa'
  const text = css.getPropertyValue('--text').trim() || '#060708'

  ctx.fillStyle = soft
  ctx.fillRect(0, 0, width, height)

  const birdX = clamp(width * 0.27, 78, 104)
  for (let i = 0; i < run.pipes.length; i += 1) {
    const pipe = run.pipes[i]
    const g = pipeGeometry(width, height, sim.elapsed, i, pipe)
    if (g.x > width + 80 || g.x + g.pipeWidth < -80) continue

    ctx.fillStyle = accent
    ctx.fillRect(g.x, 0, g.pipeWidth, g.gapTop)
    ctx.fillRect(g.x, g.gapBottom, g.pipeWidth, g.playHeight - g.gapBottom)

    ctx.fillStyle = primary
    ctx.globalAlpha = 0.18
    ctx.fillRect(g.x + 7, 0, 7, g.gapTop)
    ctx.fillRect(g.x + 7, g.gapBottom, 7, g.playHeight - g.gapBottom)
    ctx.globalAlpha = 1

    if (pipe.coin && !sim.collected.has(i)) {
      ctx.beginPath()
      ctx.arc(g.coinX, g.coinY, 13, 0, Math.PI * 2)
      ctx.fillStyle = '#f4b400'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#d28b00'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(g.coinX, g.coinY, 5, 0, Math.PI * 2)
      ctx.strokeStyle = '#fff3b0'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  ctx.fillStyle = secondary
  ctx.fillRect(0, height - 40, width, 40)
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.18
  ctx.fillRect(0, height - 40, width, 4)
  ctx.globalAlpha = 1

  const angle = clamp(sim.velocity / 850, -0.38, 0.62)
  ctx.save()
  ctx.translate(birdX, sim.y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(-7, 6, 10, 6, -0.35, 0, Math.PI * 2)
  ctx.fillStyle = primary
  ctx.globalAlpha = 0.85
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(7, -4, 4, 0, Math.PI * 2)
  ctx.fillStyle = primary
  ctx.fill()
  ctx.beginPath()
  ctx.arc(8, -4, 1.6, 0, Math.PI * 2)
  ctx.fillStyle = text
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(16, 0)
  ctx.lineTo(26, 4)
  ctx.lineTo(16, 7)
  ctx.closePath()
  ctx.fillStyle = '#f4b400'
  ctx.fill()
  ctx.restore()
}

export function Flappy({
  request,
  onBack,
  onBalance,
}: {
  request: GameRequest
  onBack: () => void
  onBalance: (value: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Sim>(freshSim())
  const alive = useRef(true)
  const key = useRef(requestKey())
  const [run, setRun] = useState<FlappyRun | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [score, setScore] = useState(0)
  const [coins, setCoins] = useState(0)
  const [balance, setBalance] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    return () => {
      back?.offClick(onBack)
      back?.hide()
    }
  }, [onBack])

  const resetSim = useCallback(() => {
    const next = freshSim()
    const h = canvasRef.current?.clientHeight || 500
    next.y = h * 0.45
    sim.current = next
    setScore(0)
    setCoins(0)
    setNotice('')
    setError('')
  }, [])

  const startRun = useCallback(async () => {
    setPhase('loading')
    setRun(null)
    resetSim()
    try {
      const next = await request<FlappyRun>('/games/flappy/start', {
        request_key: key.current,
      })
      if (!alive.current) return
      setRun(next)
      setBalance(next.balance)
      onBalance(next.balance)
      setPhase('ready')
    } catch (e) {
      if (!alive.current) return
      setError((e as Error).message)
      setPhase('over')
    }
  }, [onBalance, request, resetSim])

  useEffect(() => {
    void startRun()
  }, [startRun])

  const claimCoin = useCallback(
    async (pipe: number) => {
      if (!run || sim.current.pending.has(pipe)) return
      sim.current.pending.add(pipe)
      let attempt = 0
      while (attempt < 3 && alive.current) {
        try {
          const next = await request<FlappyRun>('/games/flappy/coin', {
            id: run.id,
            pipe,
          })
          if (!alive.current) return
          setBalance(next.balance)
          onBalance(next.balance)
          window.dispatchEvent(new Event('kutezh:wallet-updated'))
          setNotice(next.reward > 0 ? '+1 монета на аккаунт' : 'Монета собрана · дневной лимит наград достигнут')
          window.setTimeout(() => {
            if (alive.current) setNotice('')
          }, 1400)
          sim.current.pending.delete(pipe)
          return
        } catch (e) {
          attempt += 1
          if (attempt >= 3) {
            sim.current.pending.delete(pipe)
            if (alive.current)
              setError(`Монета собрана, но не удалось зачислить её: ${(e as Error).message}`)
            return
          }
          await new Promise((resolve) => window.setTimeout(resolve, 700 * attempt))
        }
      }
    },
    [onBalance, request, run],
  )

  const flap = useCallback(() => {
    if (!run || phase === 'loading' || phase === 'over') return
    sim.current.velocity = -405
    if (phase === 'ready') setPhase('playing')
  }, [phase, run])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'ArrowUp') return
      event.preventDefault()
      flap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flap])

  useEffect(() => {
    if (!run) return
    const canvas = canvasRef.current
    if (!canvas) return

    if (phase !== 'playing') {
      if (phase === 'ready') {
        sim.current.y = canvas.clientHeight * 0.45
        sim.current.velocity = 0
      }
      drawScene(canvas, run, sim.current)
      return
    }

    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.034, Math.max(0, (now - last) / 1000))
      last = now
      const current = sim.current
      current.elapsed += dt
      current.velocity += 1120 * dt
      current.y += current.velocity * dt

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const birdX = clamp(width * 0.27, 78, 104)
      const birdRadius = 13
      let crashed = current.y - birdRadius <= 0 || current.y + birdRadius >= height - 40

      for (let i = 0; i < run.pipes.length && !crashed; i += 1) {
        const pipe = run.pipes[i]
        const g = pipeGeometry(width, height, current.elapsed, i, pipe)
        if (
          g.x < birdX + birdRadius &&
          g.x + g.pipeWidth > birdX - birdRadius &&
          (current.y - birdRadius < g.gapTop || current.y + birdRadius > g.gapBottom)
        ) {
          crashed = true
          break
        }
        if (g.x + g.pipeWidth < birdX && !current.passed.has(i)) {
          current.passed.add(i)
          setScore(current.passed.size)
        }
        if (
          pipe.coin &&
          !current.collected.has(i) &&
          !current.pending.has(i) &&
          Math.hypot(birdX - g.coinX, current.y - g.coinY) < 27
        ) {
          current.collected.add(i)
          setCoins(current.collected.size)
          void claimCoin(i)
        }
      }

      drawScene(canvas, run, current)
      if (crashed || current.passed.size >= run.pipes.length) {
        setPhase('over')
        return
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [claimCoin, phase, run])

  useEffect(() => {
    if (phase !== 'over' || !run) return
    void request<{ ok: boolean }>('/games/score', {
      kind: 'flappy',
      run_id: run.id,
      value: score,
      detail: 0,
    }).catch(() => {})
  }, [phase, request, run, score])

  function restart() {
    key.current = requestKey()
    void startRun()
  }

  return (
    <main className="flappy">
      <div className="arcade-top flappy-top">
        <button className="arcade-back" onClick={onBack} aria-label="Назад к играм">‹</button>
        <h2>Птичка</h2>
        <span className="arcade-coins">{balance === null ? '…' : balance} ◉</span>
      </div>

      <div className="flappy-stats" aria-live="polite">
        <span>Счёт <strong>{score}</strong></span>
        <span>Собрано <strong>{coins} ◉</strong></span>
      </div>

      <div className="flappy-stage">
        <canvas
          ref={canvasRef}
          onPointerDown={flap}
          aria-label="Игровое поле. Нажимайте, чтобы птица взлетала."
        />
        {phase === 'loading' && <div className="flappy-overlay"><strong>Готовим полёт…</strong></div>}
        {phase === 'over' && run && (
          <div className="flappy-overlay flappy-result">
            <strong>Полёт окончен</strong>
            <span>{score} труб · {coins} монет</span>
            <button className="button" type="button" onClick={restart}>Сыграть ещё</button>
            <button className="button button--secondary" type="button" onClick={onBack}>Все игры</button>
          </div>
        )}
        <p className={`flappy-toast ${notice ? 'is-visible' : ''}`} role="status" aria-live="polite">{notice}</p>
      </div>

      {error && <p className="flappy-error" role="alert">{error}</p>}
    </main>
  )
}
