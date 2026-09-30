import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GameRequest } from './Arcade'
import { getHost } from './host'
import './runners.css'

type EventKind = 'meteor' | 'birds' | 'collapse' | 'boss'
type ServerEvent = { meter: number; kind: EventKind }
type DinoRun = {
  id: string
  status: string
  coins: number[]
  events: ServerEvent[]
  collected: number[]
  bonuses: number[]
  reward: number
  balance: number
}
type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'over'
type Biome = 'desert' | 'rain' | 'snow' | 'volcano' | 'space'
type ObstacleKind =
  | 'smallCactus'
  | 'bigCactus'
  | 'cactusGroup'
  | 'pteroLow'
  | 'pteroHigh'
  | 'pit'
  | 'rockfall'
  | 'snake'
  | 'movingCactus'
  | 'bossRock'
type PowerKind = 'shield' | 'magnet' | 'slow' | 'doubleScore' | 'jet' | 'helper'
type Obstacle = { id: number; meter: number; kind: ObstacleKind; variant: number; passed: boolean; dead: boolean }
type Pickup = { id: number; meter: number; kind: PowerKind; variant: number; taken: boolean }
type ActiveEvent = {
  index: number
  kind: EventKind
  elapsed: number
  duration: number
  nextSpawn: number
  bossHealth: number
  bossHitCycle: number
}
type Powers = {
  shield: boolean
  magnet: number
  slow: number
  doubleScore: number
  jet: number
  helper: boolean
}
type Sim = {
  distance: number
  score: number
  combo: number
  multiplier: number
  localCoins: number
  playerY: number
  velocityY: number
  jumps: number
  slideHeld: boolean
  slideGrace: number
  gliding: boolean
  dashTime: number
  dashCooldown: number
  obstacles: Obstacle[]
  pickups: Pickup[]
  nextObstacle: number
  nextPower: number
  nextId: number
  biome: Biome
  previousBiome: Biome
  nextBiome: number
  biomeFade: number
  sandstorm: number
  powers: Powers
  eventSeen: Set<number>
  activeEvent: ActiveEvent | null
  claimPending: Set<number>
  claimedCoins: Set<number>
  bonusPending: Set<number>
  claimedBonuses: Set<number>
  noHitMark: number
  flash: number
  toast: string
  toastTime: number
  hudClock: number
}

type Hud = {
  distance: number
  score: number
  combo: number
  multiplier: number
  coins: number
  speed: number
  dashCooldown: number
  biome: Biome
  event: string
  bossHealth: number
  powers: string[]
}

const BIOMES: Biome[] = ['desert', 'rain', 'snow', 'volcano', 'space']
const POWER_KINDS: PowerKind[] = ['shield', 'magnet', 'slow', 'doubleScore', 'jet', 'helper']

const requestKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

const biomeName: Record<Biome, string> = {
  desert: 'Пустыня',
  rain: 'Дождь',
  snow: 'Снег',
  volcano: 'Вулкан',
  space: 'Космос',
}
const eventName: Record<EventKind, string> = {
  meteor: 'Метеоритный дождь',
  birds: 'Стая птеродактилей',
  collapse: 'Обвал',
  boss: 'Птеродактиль-босс',
}
const powerName: Record<PowerKind, string> = {
  shield: 'Щит',
  magnet: 'Магнит',
  slow: 'Замедление',
  doubleScore: 'x2 очки',
  jet: 'Реактивный ранец',
  helper: 'Помощник',
}

function freshSim(): Sim {
  return {
    distance: 0,
    score: 0,
    combo: 0,
    multiplier: 1,
    localCoins: 0,
    playerY: 0,
    velocityY: 0,
    jumps: 0,
    slideHeld: false,
    slideGrace: 0,
    gliding: false,
    dashTime: 0,
    dashCooldown: 0,
    obstacles: [],
    pickups: [],
    nextObstacle: 36,
    nextPower: 620 + rand(0, 420),
    nextId: 1,
    biome: 'desert',
    previousBiome: 'desert',
    nextBiome: 560 + rand(0, 420),
    biomeFade: 0,
    sandstorm: 0,
    powers: {
      shield: false,
      magnet: 0,
      slow: 0,
      doubleScore: 0,
      jet: 0,
      helper: false,
    },
    eventSeen: new Set<number>(),
    activeEvent: null,
    claimPending: new Set<number>(),
    claimedCoins: new Set<number>(),
    bonusPending: new Set<number>(),
    claimedBonuses: new Set<number>(),
    noHitMark: 0,
    flash: 0,
    toast: '',
    toastTime: 0,
    hudClock: 0,
  }
}

function meterX(distance: number, meter: number) {
  return 82 + (meter - distance) * 20
}

function playerRect(sim: Sim) {
  const sliding = sim.slideHeld || sim.slideGrace > 0
  const h = sliding ? 25 : 52
  const x = 72 + (sim.dashTime > 0 ? 40 : 0)
  return { x, y: sim.playerY - h, w: sliding ? 54 : 38, h }
}

function obstacleRect(obstacle: Obstacle, sim: Sim, ground: number) {
  let x = meterX(sim.distance, obstacle.meter)
  let y = ground - 46
  let w = 30
  let h = 46
  if (obstacle.kind === 'smallCactus') { w = 24; h = 38; y = ground - h }
  if (obstacle.kind === 'bigCactus') { w = 38; h = 66; y = ground - h }
  if (obstacle.kind === 'cactusGroup') { w = 72; h = 50; y = ground - h }
  if (obstacle.kind === 'snake') { w = 38; h = 20; y = ground - h }
  if (obstacle.kind === 'pit') { w = 70; h = 12; y = ground - 5 }
  if (obstacle.kind === 'pteroLow') { w = 54; h = 24; y = ground - 67 + Math.sin(sim.distance * .22 + obstacle.variant) * 7 }
  if (obstacle.kind === 'pteroHigh') { w = 54; h = 24; y = ground - 132 + Math.sin(sim.distance * .2 + obstacle.variant) * 10 }
  if (obstacle.kind === 'movingCactus') {
    x += Math.sin(sim.distance * .35 + obstacle.variant) * 18
    w = 32; h = 52; y = ground - h
  }
  if (obstacle.kind === 'rockfall' || obstacle.kind === 'bossRock') {
    const fall = clamp(1 - (obstacle.meter - sim.distance) / 16, 0, 1)
    w = obstacle.kind === 'bossRock' ? 34 : 42
    h = w
    y = 18 + fall * (ground - h - 18)
  }
  return { x, y, w, h }
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function obstacleChoice(biome: Biome): ObstacleKind | 'sandstorm' {
  if (biome === 'desert') return pick<ObstacleKind | 'sandstorm'>(['smallCactus', 'bigCactus', 'cactusGroup', 'pteroLow', 'pit', 'snake', 'movingCactus', 'sandstorm'])
  if (biome === 'rain') return pick<ObstacleKind | 'sandstorm'>(['smallCactus', 'pteroLow', 'pteroHigh', 'pit', 'snake', 'movingCactus', 'rockfall'])
  if (biome === 'snow') return pick<ObstacleKind | 'sandstorm'>(['smallCactus', 'bigCactus', 'pit', 'rockfall', 'movingCactus'])
  if (biome === 'volcano') return pick<ObstacleKind | 'sandstorm'>(['bigCactus', 'cactusGroup', 'pit', 'rockfall', 'rockfall', 'movingCactus'])
  return pick<ObstacleKind | 'sandstorm'>(['pteroHigh', 'pteroLow', 'pit', 'movingCactus', 'rockfall'])
}

function powerText(powers: Powers) {
  const result: string[] = []
  if (powers.shield) result.push('Щит')
  if (powers.magnet > 0) result.push(`Магнит ${Math.ceil(powers.magnet)}с`)
  if (powers.slow > 0) result.push(`Slow ${Math.ceil(powers.slow)}с`)
  if (powers.doubleScore > 0) result.push(`x2 ${Math.ceil(powers.doubleScore)}с`)
  if (powers.jet > 0) result.push(`Ранец ${Math.ceil(powers.jet)}с`)
  if (powers.helper) result.push('Помощник')
  return result
}

function paintBiome(ctx: CanvasRenderingContext2D, w: number, h: number, biome: Biome, distance: number, alpha: number) {
  const palettes: Record<Biome, [string, string, string, string]> = {
    desert: ['#f6dfb0', '#e8c678', '#bd8447', '#795630'],
    rain: ['#9eb9c7', '#7396a8', '#4e7476', '#345253'],
    snow: ['#e9f4fb', '#cedfeb', '#aac3d2', '#688492'],
    volcano: ['#39272a', '#5c3430', '#9b4938', '#ff7849'],
    space: ['#11172e', '#1f294c', '#343e68', '#8ea4ff'],
  }
  const [sky, far, ground, accent] = palettes[biome]
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  const shift = (distance * 2.4) % 180
  ctx.fillStyle = far
  for (let x = -220 - shift; x < w + 220; x += 180) {
    ctx.beginPath()
    ctx.moveTo(x, h - 54)
    ctx.lineTo(x + 90, h - 150 - (biome === 'space' ? 35 : 0))
    ctx.lineTo(x + 180, h - 54)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = ground
  ctx.fillRect(0, h - 54, w, 54)
  ctx.fillStyle = accent
  ctx.globalAlpha = alpha * .28
  ctx.fillRect(0, h - 54, w, 4)
  ctx.restore()
}

function drawWeather(ctx: CanvasRenderingContext2D, w: number, h: number, sim: Sim) {
  const t = sim.distance
  ctx.save()
  if (sim.biome === 'rain') {
    ctx.strokeStyle = 'rgba(220,240,255,.55)'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 36; i += 1) {
      const x = (i * 43 + t * 19) % (w + 80) - 40
      const y = (i * 71 + t * 31) % h
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 10, y + 24); ctx.stroke()
    }
  }
  if (sim.biome === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,.75)'
    for (let i = 0; i < 34; i += 1) {
      const x = (i * 57 + t * 8) % w
      const y = (i * 83 + t * 17) % h
      ctx.beginPath(); ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2); ctx.fill()
    }
  }
  if (sim.biome === 'volcano') {
    ctx.fillStyle = 'rgba(255,112,60,.65)'
    for (let i = 0; i < 24; i += 1) {
      const x = (i * 73 + t * 11) % w
      const y = h - ((i * 61 + t * 20) % (h * .8))
      ctx.fillRect(x, y, 2, 5)
    }
  }
  if (sim.biome === 'space') {
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    for (let i = 0; i < 42; i += 1) {
      const x = (i * 97 - t * (2 + i % 3)) % w
      const y = 20 + ((i * 47) % Math.max(40, h - 110))
      ctx.fillRect(x < 0 ? x + w : x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1)
    }
  }
  if (sim.sandstorm > 0) {
    ctx.fillStyle = `rgba(214,168,96,${.2 + .22 * Math.min(1, sim.sandstorm / 2)})`
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(255,230,180,.35)'
    for (let i = 0; i < 18; i += 1) {
      const y = (i * 41 + t * 9) % h
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y - 35); ctx.stroke()
    }
  }
  const night = Math.floor(sim.distance / 700) % 2 === 1
  if (night && sim.biome !== 'space') {
    ctx.fillStyle = 'rgba(17,25,52,.26)'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}

function drawDino(ctx: CanvasRenderingContext2D, sim: Sim, ground: number) {
  const r = playerRect(sim)
  const sliding = sim.slideHeld || sim.slideGrace > 0
  ctx.save()
  if (sim.dashTime > 0) {
    ctx.fillStyle = 'rgba(0,112,229,.18)'
    ctx.fillRect(r.x - 56, r.y + 10, 70, r.h - 18)
  }
  if (sim.powers.shield) {
    ctx.strokeStyle = '#4ca5ff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * .68, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = '#121820'
  if (sliding) {
    ctx.fillRect(r.x + 6, r.y + 7, 38, 16)
    ctx.fillRect(r.x + 38, r.y + 2, 16, 16)
    ctx.fillRect(r.x, r.y + 12, 12, 7)
  } else {
    ctx.fillRect(r.x + 8, r.y + 16, 24, 27)
    ctx.fillRect(r.x + 25, r.y + 3, 20, 23)
    ctx.fillRect(r.x + 37, r.y + 10, 10, 5)
    ctx.fillRect(r.x, r.y + 22, 13, 9)
    ctx.fillRect(r.x + 11, r.y + 41, 7, 11)
    ctx.fillRect(r.x + 28, r.y + 41, 7, 11)
    ctx.fillStyle = '#fff'
    ctx.fillRect(r.x + 38, r.y + 8, 3, 3)
  }
  if (sim.powers.jet > 0) {
    ctx.fillStyle = '#ff8a32'
    ctx.beginPath()
    ctx.moveTo(r.x + 4, r.y + 28)
    ctx.lineTo(r.x - 13, r.y + 33)
    ctx.lineTo(r.x + 4, r.y + 38)
    ctx.closePath()
    ctx.fill()
  }
  if (sim.powers.helper) {
    ctx.fillStyle = '#5c7d98'
    ctx.fillRect(r.x - 38, ground - 24, 20, 18)
    ctx.fillRect(r.x - 24, ground - 29, 11, 12)
  }
  ctx.restore()
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: Obstacle, sim: Sim, ground: number) {
  if (obstacle.dead) return
  const r = obstacleRect(obstacle, sim, ground)
  ctx.save()
  if (obstacle.kind === 'pit') {
    ctx.fillStyle = '#201914'
    ctx.fillRect(r.x, ground - 3, r.w, 57)
    ctx.restore()
    return
  }
  if (obstacle.kind === 'pteroLow' || obstacle.kind === 'pteroHigh') {
    ctx.fillStyle = '#664d70'
    ctx.fillRect(r.x + 10, r.y + 8, 34, 11)
    ctx.beginPath()
    ctx.moveTo(r.x + 18, r.y + 12)
    ctx.lineTo(r.x, r.y)
    ctx.lineTo(r.x + 8, r.y + 17)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(r.x + 34, r.y + 12)
    ctx.lineTo(r.x + 52, r.y + 1)
    ctx.lineTo(r.x + 45, r.y + 18)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    return
  }
  if (obstacle.kind === 'rockfall' || obstacle.kind === 'bossRock') {
    ctx.fillStyle = obstacle.kind === 'bossRock' ? '#704d3a' : '#55565a'
    ctx.beginPath()
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  if (obstacle.kind === 'snake') {
    ctx.strokeStyle = '#8a6232'
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(r.x, r.y + 12)
    ctx.bezierCurveTo(r.x + 10, r.y, r.x + 22, r.y + 22, r.x + 36, r.y + 8)
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.fillStyle = obstacle.kind === 'movingCactus' ? '#1a936f' : '#23845f'
  ctx.fillRect(r.x + r.w * .35, r.y, r.w * .32, r.h)
  ctx.fillRect(r.x, r.y + r.h * .38, r.w * .45, 9)
  ctx.fillRect(r.x + r.w * .55, r.y + r.h * .55, r.w * .45, 9)
  if (obstacle.kind === 'cactusGroup') {
    ctx.fillRect(r.x + 6, r.y + 13, 15, r.h - 13)
    ctx.fillRect(r.x + r.w - 20, r.y + 6, 15, r.h - 6)
  }
  ctx.restore()
}

function drawPickup(ctx: CanvasRenderingContext2D, pickup: Pickup, sim: Sim, ground: number) {
  if (pickup.taken) return
  const x = meterX(sim.distance, pickup.meter)
  const y = ground - (55 + (pickup.variant % 3) * 24)
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, 15, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#0070e5'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#0070e5'
  ctx.font = 'bold 11px system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const icon: Record<PowerKind, string> = { shield: 'S', magnet: 'M', slow: 'T', doubleScore: '×2', jet: 'J', helper: 'D' }
  ctx.fillText(icon[pickup.kind], x, y + 1)
  ctx.restore()
}

function drawCoin(ctx: CanvasRenderingContext2D, index: number, meter: number, sim: Sim, ground: number) {
  if (sim.claimedCoins.has(index)) return
  const x = meterX(sim.distance, meter)
  const y = ground - [50, 78, 110, 70][index % 4]
  ctx.save()
  ctx.fillStyle = '#f3b51b'
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#c48200'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = '#fff0aa'
  ctx.fillRect(x - 2, y - 6, 4, 12)
  ctx.restore()
}

function drawBoss(ctx: CanvasRenderingContext2D, active: ActiveEvent, w: number, ground: number) {
  const cycle = active.elapsed % 4
  const swoop = cycle >= 1.2 && cycle <= 2.8
  const p = swoop ? (cycle - 1.2) / 1.6 : 0
  const wave = swoop ? Math.sin(p * Math.PI) : 0
  const x = w - 74 - wave * Math.max(0, w - 240)
  const y = ground - 115 + wave * 62
  ctx.save()
  ctx.fillStyle = '#6a456e'
  ctx.fillRect(x - 34, y - 13, 68, 25)
  ctx.beginPath()
  ctx.moveTo(x - 17, y)
  ctx.lineTo(x - 62, y - 30)
  ctx.lineTo(x - 38, y + 10)
  ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + 10, y)
  ctx.lineTo(x + 56, y - 27)
  ctx.lineTo(x + 38, y + 11)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillRect(x + 20, y - 6, 4, 4)
  ctx.restore()
}

function drawScene(canvas: HTMLCanvasElement, run: DinoRun, sim: Sim) {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  paintBiome(ctx, w, h, sim.biome, sim.distance, 1)
  if (sim.biomeFade > 0) paintBiome(ctx, w, h, sim.previousBiome, sim.distance, sim.biomeFade)
  drawWeather(ctx, w, h, sim)
  const ground = h - 54

  for (const obstacle of sim.obstacles) drawObstacle(ctx, obstacle, sim, ground)
  for (let i = 0; i < run.coins.length; i += 1) {
    const x = meterX(sim.distance, run.coins[i])
    if (x > -30 && x < w + 30) drawCoin(ctx, i, run.coins[i], sim, ground)
  }
  for (const pickup of sim.pickups) {
    const x = meterX(sim.distance, pickup.meter)
    if (x > -40 && x < w + 40) drawPickup(ctx, pickup, sim, ground)
  }
  if (sim.activeEvent?.kind === 'boss') drawBoss(ctx, sim.activeEvent, w, ground)
  drawDino(ctx, sim, ground)

  if (sim.flash > 0) {
    ctx.fillStyle = `rgba(255,70,70,${Math.min(.28, sim.flash)})`
    ctx.fillRect(0, 0, w, h)
  }
}

export function DinoRunner({
  request,
  onBack,
  onBalance,
}: {
  request: GameRequest
  onBack: () => void
  onBalance: (value: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerGesture = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    action: false,
    holdTimer: null as number | null,
  })
  const sim = useRef<Sim>(freshSim())
  const key = useRef(requestKey())
  const alive = useRef(true)
  const [run, setRun] = useState<DinoRun | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [balance, setBalance] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [hud, setHud] = useState<Hud>({
    distance: 0, score: 0, combo: 0, multiplier: 1, coins: 0,
    speed: 0, dashCooldown: 0, biome: 'desert', event: '', bossHealth: 0, powers: [],
  })

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    const back = getHost()?.BackButton
    back?.show()
    back?.onClick(onBack)
    return () => { back?.offClick(onBack); back?.hide() }
  }, [onBack])

  const toast = useCallback((message: string, seconds = 1.8) => {
    sim.current.toast = message
    sim.current.toastTime = seconds
  }, [])

  const startRun = useCallback(async () => {
    setPhase('loading')
    setError('')
    const nextSim = freshSim()
    sim.current = nextSim
    try {
      const next = await request<DinoRun>('/games/dino/start', { request_key: key.current })
      if (!alive.current) return
      next.collected.forEach((index) => nextSim.claimedCoins.add(index))
      next.bonuses.forEach((index) => nextSim.claimedBonuses.add(index))
      setRun(next)
      setBalance(next.balance)
      onBalance(next.balance)
      setPhase('ready')
    } catch (e) {
      if (!alive.current) return
      setError((e as Error).message)
      setPhase('over')
    }
  }, [onBalance, request])

  useEffect(() => { void startRun() }, [startRun])

  const claimCoin = useCallback(async (index: number) => {
    if (!run || sim.current.claimPending.has(index)) return
    sim.current.claimPending.add(index)
    let attempt = 0
    while (attempt < 3 && alive.current) {
      try {
        const next = await request<DinoRun>('/games/dino/coin', { id: run.id, coin: index })
        sim.current.claimPending.delete(index)
        if (!alive.current) return
        setBalance(next.balance)
        onBalance(next.balance)
        window.dispatchEvent(new Event('kutezh:wallet-updated'))
        toast(next.reward > 0 ? '+1 монета на аккаунт' : 'Монета собрана · дневной лимит достигнут')
        return
      } catch (e) {
        attempt += 1
        if (attempt >= 3) {
          sim.current.claimPending.delete(index)
          if (alive.current) setError(`Не удалось зачислить монету: ${(e as Error).message}`)
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 650 * attempt))
      }
    }
  }, [onBalance, request, run, toast])

  const claimBoss = useCallback(async (index: number) => {
    if (!run || sim.current.bonusPending.has(index) || sim.current.claimedBonuses.has(index)) return
    sim.current.bonusPending.add(index)
    try {
      const next = await request<DinoRun>('/games/dino/boss', { id: run.id, event: index })
      sim.current.bonusPending.delete(index)
      sim.current.claimedBonuses.add(index)
      if (!alive.current) return
      setBalance(next.balance)
      onBalance(next.balance)
      window.dispatchEvent(new Event('kutezh:wallet-updated'))
      toast(next.reward > 0 ? `Босс побеждён · +${next.reward} монеты` : 'Босс побеждён · дневной лимит монет достигнут', 2.4)
    } catch (e) {
      sim.current.bonusPending.delete(index)
      if (alive.current) setError(`Босс побеждён, но награда не зачислена: ${(e as Error).message}`)
    }
  }, [onBalance, request, run, toast])

  const jump = useCallback(() => {
    const s = sim.current
    if (phase === 'ready') {
      setPhase('playing')
      s.velocityY = s.biome === 'space' ? -430 : -570
      s.jumps = 1
      return
    }
    if (phase !== 'playing') return
    if (s.powers.jet > 0) {
      s.velocityY = -310
      return
    }
    if (s.jumps < 2) {
      s.velocityY = s.biome === 'space' ? -430 : -570
      s.jumps += 1
    }
  }, [phase])

  const dash = useCallback(() => {
    const s = sim.current
    if (phase === 'ready') setPhase('playing')
    if ((phase === 'playing' || phase === 'ready') && s.dashCooldown <= 0) {
      s.dashTime = .45
      s.dashCooldown = 5.5
    }
  }, [phase])

  const setSlide = useCallback((value: boolean) => {
    if (value && phase === 'ready') setPhase('playing')
    sim.current.slideHeld = value
    if (!value && sim.current.biome === 'snow') sim.current.slideGrace = .32
  }, [phase])

  const setGlide = useCallback((value: boolean) => {
    if (value && phase === 'ready') setPhase('playing')
    sim.current.gliding = value
  }, [phase])

  const clearGestureTimer = useCallback(() => {
    const gesture = pointerGesture.current
    if (gesture.holdTimer !== null) {
      window.clearTimeout(gesture.holdTimer)
      gesture.holdTimer = null
    }
  }, [])

  const onGamePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (phase === 'loading' || phase === 'paused' || phase === 'over') return
    event.preventDefault()
    clearGestureTimer()
    const gesture = pointerGesture.current
    gesture.pointerId = event.pointerId
    gesture.startX = event.clientX
    gesture.startY = event.clientY
    gesture.action = false
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    const pointerId = event.pointerId
    gesture.holdTimer = window.setTimeout(() => {
      const current = pointerGesture.current
      if (current.pointerId !== pointerId || current.action) return
      current.action = true
      current.holdTimer = null
      setGlide(true)
    }, 260)
  }, [clearGestureTimer, phase, setGlide])

  const onGamePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = pointerGesture.current
    if (gesture.pointerId !== event.pointerId || gesture.action) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)

    if (ay > 34 && ay > ax * 1.15) {
      event.preventDefault()
      clearGestureTimer()
      gesture.action = true
      if (dy < 0) jump()
      else setSlide(true)
      return
    }

    if (ax > 48 && ax > ay * 1.2) {
      event.preventDefault()
      clearGestureTimer()
      gesture.action = true
      dash()
    }
  }, [clearGestureTimer, dash, jump, setSlide])

  const onGamePointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = pointerGesture.current
    if (gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    const shouldJump = !gesture.action
    clearGestureTimer()
    setSlide(false)
    setGlide(false)
    gesture.pointerId = -1
    gesture.action = false
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (shouldJump) jump()
  }, [clearGestureTimer, jump, setGlide, setSlide])

  const onGamePointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = pointerGesture.current
    if (gesture.pointerId !== event.pointerId) return
    clearGestureTimer()
    setSlide(false)
    setGlide(false)
    gesture.pointerId = -1
    gesture.action = false
  }, [clearGestureTimer, setGlide, setSlide])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        if (!event.repeat) jump()
        event.preventDefault()
      }
      if (event.code === 'ArrowDown') { setSlide(true); event.preventDefault() }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        if (!event.repeat) dash()
        event.preventDefault()
      }
      if (event.code === 'KeyG') { setGlide(true); event.preventDefault() }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'ArrowDown') setSlide(false)
      if (event.code === 'KeyG') setGlide(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [dash, jump, setGlide, setSlide])

  useEffect(() => {
    const hidden = () => {
      if (document.hidden && phase === 'playing') setPhase('paused')
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [phase])

  useEffect(() => {
    if (!run) return
    const canvas = canvasRef.current
    if (!canvas) return

    if (phase !== 'playing') {
      const ground = canvas.clientHeight - 54
      if (phase === 'ready') {
        sim.current.playerY = ground
        sim.current.velocityY = 0
      }
      drawScene(canvas, run, sim.current)
      return
    }

    let frame = 0
    let last = performance.now()

    const loop = (now: number) => {
      const dt = Math.min(.034, Math.max(0, (now - last) / 1000))
      last = now
      const s = sim.current
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const ground = h - 54
      if (!s.playerY) s.playerY = ground

      s.dashTime = Math.max(0, s.dashTime - dt)
      s.dashCooldown = Math.max(0, s.dashCooldown - dt)
      s.slideGrace = Math.max(0, s.slideGrace - dt)
      s.biomeFade = Math.max(0, s.biomeFade - dt / 2.2)
      s.sandstorm = Math.max(0, s.sandstorm - dt)
      s.flash = Math.max(0, s.flash - dt)
      s.toastTime = Math.max(0, s.toastTime - dt)
      if (s.toastTime <= 0) s.toast = ''

      s.powers.magnet = Math.max(0, s.powers.magnet - dt)
      s.powers.slow = Math.max(0, s.powers.slow - dt)
      s.powers.doubleScore = Math.max(0, s.powers.doubleScore - dt)
      s.powers.jet = Math.max(0, s.powers.jet - dt)

      const baseSpeed = Math.min(500, 230 + s.distance * .035)
      const speed = baseSpeed * (s.powers.slow > 0 ? .68 : 1)
      const metersPerSecond = speed / 20
      s.distance += metersPerSecond * dt
      const scoreFactor = (s.powers.doubleScore > 0 ? 2 : 1) * s.multiplier
      s.score += metersPerSecond * dt * 10 * scoreFactor

      if (s.distance >= s.nextBiome) {
        const index = (BIOMES.indexOf(s.biome) + 1) % BIOMES.length
        s.previousBiome = s.biome
        s.biome = BIOMES[index]
        s.biomeFade = 1
        s.nextBiome += 500 + rand(0, 500)
        toast(`${biomeName[s.biome]} · физика изменилась`, 2.2)
      }

      const gravityScale = s.biome === 'space' ? .58 : s.biome === 'volcano' ? 1.08 : s.biome === 'snow' ? .92 : 1
      let gravity = 1600 * gravityScale
      if (s.gliding && s.playerY < ground - 4 && s.velocityY > -40) gravity *= .28
      if (s.powers.jet > 0) gravity *= .22
      if (s.biome === 'rain') s.velocityY += Math.sin(s.distance * .14) * 4 * dt
      s.velocityY += gravity * dt
      if (s.gliding && s.velocityY > 155) s.velocityY = 155
      if (s.powers.jet > 0 && s.velocityY > 115) s.velocityY = 115
      s.playerY += s.velocityY * dt
      if (s.playerY >= ground) {
        s.playerY = ground
        s.velocityY = 0
        s.jumps = 0
      }
      s.playerY = Math.max(45, s.playerY)

      if (!s.activeEvent) {
        while (s.nextObstacle < s.distance + 58) {
          const kind = obstacleChoice(s.biome)
          const gap = 20 + speed * .06 + rand(0, 11)
          if (kind === 'sandstorm') {
            s.sandstorm = 6.5
            s.nextObstacle += gap + 8
          } else {
            s.obstacles.push({ id: s.nextId++, meter: s.nextObstacle, kind, variant: rand(0, 10), passed: false, dead: false })
            s.nextObstacle += gap
          }
        }
      }

      while (s.nextPower < s.distance + 80) {
        s.pickups.push({ id: s.nextId++, meter: s.nextPower, kind: pick(POWER_KINDS), variant: Math.floor(rand(0, 3)), taken: false })
        s.nextPower += 650 + rand(0, 620)
      }

      const nextEvent = run.events.find((event, index) => !s.eventSeen.has(index) && event.meter <= s.distance)
      if (!s.activeEvent && nextEvent) {
        const index = run.events.indexOf(nextEvent)
        s.eventSeen.add(index)
        s.activeEvent = {
          index,
          kind: nextEvent.kind,
          elapsed: 0,
          duration: nextEvent.kind === 'boss' ? 35 : 10,
          nextSpawn: .6,
          bossHealth: nextEvent.kind === 'boss' ? 5 : 0,
          bossHitCycle: -1,
        }
        s.nextObstacle = Math.max(s.nextObstacle, s.distance + 42)
        toast(eventName[nextEvent.kind], 2.2)
      }

      if (s.activeEvent) {
        const event = s.activeEvent
        event.elapsed += dt
        if (event.elapsed >= event.nextSpawn) {
          let kind: ObstacleKind = 'rockfall'
          if (event.kind === 'birds') kind = Math.floor(event.elapsed / 2) % 2 ? 'pteroLow' : 'pteroHigh'
          if (event.kind === 'collapse') kind = Math.floor(event.elapsed / 2) % 2 ? 'pit' : 'rockfall'
          if (event.kind === 'boss') kind = 'bossRock'
          s.obstacles.push({
            id: s.nextId++,
            meter: s.distance + (event.kind === 'boss' ? 22 : 26) + rand(0, 5),
            kind,
            variant: rand(0, 10),
            passed: false,
            dead: false,
          })
          event.nextSpawn += event.kind === 'boss' ? 2.35 : event.kind === 'birds' ? 1.9 : 2.15
        }

        if (event.kind === 'boss') {
          const cycle = event.elapsed % 4
          const cycleIndex = Math.floor(event.elapsed / 4)
          const swoop = cycle >= 1.2 && cycle <= 2.8
          if (swoop && s.dashTime > 0 && event.bossHitCycle !== cycleIndex) {
            const p = (cycle - 1.2) / 1.6
            const wave = Math.sin(p * Math.PI)
            const bossX = w - 74 - wave * Math.max(0, w - 240)
            const bossY = ground - 115 + wave * 62
            const pr = playerRect(s)
            const br = { x: bossX - 42, y: bossY - 24, w: 84, h: 48 }
            if (overlaps(pr, br)) {
              event.bossHitCycle = cycleIndex
              event.bossHealth -= 1
              s.score += 350 * s.multiplier
              s.combo += 2
              s.multiplier = Math.min(5, 1 + Math.floor(s.combo / 3) * .25)
              toast(`Попадание! У босса ${event.bossHealth}/5`, 1.1)
            }
          }
          if (event.bossHealth <= 0) {
            s.score += 2500 * s.multiplier
            void claimBoss(event.index)
            s.activeEvent = null
            s.nextObstacle = s.distance + 34
          } else if (event.elapsed >= event.duration) {
            toast('Босс улетел', 1.8)
            s.activeEvent = null
            s.nextObstacle = s.distance + 34
          }
        } else if (event.elapsed >= event.duration) {
          s.activeEvent = null
          s.nextObstacle = s.distance + 32
        }
      }

      const pr = playerRect(s)

      for (const obstacle of s.obstacles) {
        if (obstacle.dead) continue
        const r = obstacleRect(obstacle, s, ground)
        if (s.powers.helper && r.x < pr.x + 155 && r.x > pr.x + 40) {
          obstacle.dead = true
          s.powers.helper = false
          s.score += 220 * s.multiplier
          toast('Помощник сбил препятствие')
          continue
        }
        if (overlaps(pr, r)) {
          if (s.dashTime > 0) {
            obstacle.dead = true
            s.combo += 2
            s.multiplier = Math.min(5, 1 + Math.floor(s.combo / 3) * .25)
            s.score += 180 * s.multiplier
            continue
          }
          if (s.powers.shield) {
            s.powers.shield = false
            obstacle.dead = true
            s.combo = 0
            s.multiplier = 1
            s.noHitMark = s.distance
            s.flash = .3
            toast('Щит спас от удара')
            continue
          }
          s.combo = 0
          s.multiplier = 1
          s.flash = .35
          setHud({
            distance: Math.floor(s.distance),
            score: Math.floor(s.score),
            combo: s.combo,
            multiplier: s.multiplier,
            coins: s.localCoins,
            speed: metersPerSecond,
            dashCooldown: s.dashCooldown,
            biome: s.biome,
            event: s.activeEvent ? eventName[s.activeEvent.kind] : '',
            bossHealth: s.activeEvent?.kind === 'boss' ? s.activeEvent.bossHealth : 0,
            powers: powerText(s.powers),
          })
          setPhase('over')
          drawScene(canvas, run, s)
          return
        }

        if (!obstacle.passed && r.x + r.w < pr.x) {
          obstacle.passed = true
          const airborne = s.playerY < ground - 18
          const sliding = s.slideHeld || s.slideGrace > 0
          const perfect =
            ((obstacle.kind === 'smallCactus' || obstacle.kind === 'bigCactus' || obstacle.kind === 'cactusGroup' || obstacle.kind === 'pit' || obstacle.kind === 'snake' || obstacle.kind === 'movingCactus') && airborne) ||
            (obstacle.kind === 'pteroLow' && sliding)
          const verticalGap = Math.max(0, Math.max(r.y - (pr.y + pr.h), pr.y - (r.y + r.h)))
          if (perfect || verticalGap < 25) {
            s.combo += 1
            s.multiplier = Math.min(5, 1 + Math.floor(s.combo / 3) * .25)
            s.score += (perfect ? 90 : 60) * s.multiplier
          }
        }
      }

      for (let i = 0; i < run.coins.length; i += 1) {
        if (s.claimedCoins.has(i)) continue
        const x = meterX(s.distance, run.coins[i])
        const y = ground - [50, 78, 110, 70][i % 4]
        const centerX = pr.x + pr.w / 2
        const centerY = pr.y + pr.h / 2
        const magnet = s.powers.magnet > 0 && Math.abs(x - centerX) < 170
        if (magnet || Math.hypot(x - centerX, y - centerY) < 29) {
          s.claimedCoins.add(i)
          s.localCoins += 1
          s.score += 140 * s.multiplier
          void claimCoin(i)
        }
      }

      for (const pickup of s.pickups) {
        if (pickup.taken) continue
        const x = meterX(s.distance, pickup.meter)
        const y = ground - (55 + (pickup.variant % 3) * 24)
        const centerX = pr.x + pr.w / 2
        const centerY = pr.y + pr.h / 2
        if (Math.hypot(x - centerX, y - centerY) < 32) {
          pickup.taken = true
          const power = pickup.kind
          if (power === 'shield') s.powers.shield = true
          if (power === 'magnet') s.powers.magnet = 12
          if (power === 'slow') s.powers.slow = 8
          if (power === 'doubleScore') s.powers.doubleScore = 10
          if (power === 'jet') s.powers.jet = 8
          if (power === 'helper') s.powers.helper = true
          toast(`${powerName[power]} активирован`, 1.8)
        }
      }

      if (s.distance - s.noHitMark >= 500) {
        s.noHitMark += 500
        s.score += 750 * s.multiplier
        toast('500 м без удара · бонус!', 1.5)
      }

      s.obstacles = s.obstacles.filter((item) => item.meter > s.distance - 22)
      s.pickups = s.pickups.filter((item) => !item.taken && item.meter > s.distance - 15)

      s.hudClock += dt
      if (s.hudClock >= .1) {
        s.hudClock = 0
        setHud({
          distance: Math.floor(s.distance),
          score: Math.floor(s.score),
          combo: s.combo,
          multiplier: s.multiplier,
          coins: s.localCoins,
          speed: metersPerSecond,
          dashCooldown: s.dashCooldown,
          biome: s.biome,
          event: s.activeEvent ? eventName[s.activeEvent.kind] : '',
          bossHealth: s.activeEvent?.kind === 'boss' ? s.activeEvent.bossHealth : 0,
          powers: powerText(s.powers),
        })
      }

      drawScene(canvas, run, s)
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [claimBoss, claimCoin, phase, run, toast])

  useEffect(() => {
    if (phase !== 'over' || !run) return
    void request<{ ok: boolean }>('/games/score', {
      kind: 'dino',
      run_id: run.id,
      value: hud.score,
      detail: hud.distance,
    }).catch(() => {})
  }, [hud.distance, hud.score, phase, request, run])

  function restart() {
    key.current = requestKey()
    void startRun()
  }

  const togglePause = () => {
    if (phase === 'playing') setPhase('paused')
    else if (phase === 'paused') setPhase('playing')
  }

  return (
    <main className="dino-runner">
      <div className="arcade-top dino-top">
        <button className="arcade-back" onClick={onBack} aria-label="Назад к играм">‹</button>
        <h2>Дино-рывок</h2>
        <button className="dino-pause" type="button" onClick={togglePause} disabled={phase === 'loading' || phase === 'over'}>
          {phase === 'paused' ? '▶' : 'Ⅱ'}
        </button>
        <span className="arcade-coins">{balance === null ? '…' : balance} ◉</span>
      </div>

      <div className="dino-hud">
        <span><b>{hud.distance}</b> м</span>
        <span><b>{hud.score}</b> очков</span>
        <span><b>x{hud.multiplier.toFixed(2)}</b> · комбо {hud.combo}</span>
        <span>{hud.coins} ◉</span>
      </div>

      <div className="dino-subhud">
        <span>{biomeName[hud.biome]} · {hud.speed.toFixed(1)} м/с</span>
        <span>{hud.event || (hud.powers.length ? hud.powers.join(' · ') : 'Без усилений')}</span>
      </div>

      {hud.bossHealth > 0 && (
        <div className="dino-bossbar" aria-label={`Здоровье босса ${hud.bossHealth} из 5`}>
          <span style={{ width: `${hud.bossHealth * 20}%` }} />
        </div>
      )}

      <div className="dino-stage">
        <canvas
          ref={canvasRef}
          aria-label="Игровое поле динозаврика. Тап — прыжок, свайп вверх — прыжок, свайп вниз — подкат, свайп в сторону — рывок, удержание — планирование."
          onPointerDown={onGamePointerDown}
          onPointerMove={onGamePointerMove}
          onPointerUp={onGamePointerUp}
          onPointerCancel={onGamePointerCancel}
        />
        {phase === 'loading' && <div className="dino-overlay"><strong>Готовим забег…</strong></div>}
        {phase === 'paused' && (
          <button className="dino-overlay dino-overlay--button" type="button" onClick={() => setPhase('playing')}>
            <strong>Пауза</strong>
            <span>Нажми, чтобы продолжить</span>
          </button>
        )}
        {phase === 'over' && run && (
          <div className="dino-overlay dino-result">
            <strong>Забег окончен</strong>
            <span>{hud.distance} м · {hud.score} очков · {hud.coins} монет</span>
            <button className="button" type="button" onClick={restart}>Ещё забег</button>
            <button className="button button--secondary" type="button" onClick={onBack}>Все игры</button>
          </div>
        )}
        <div className={`runner-toast ${sim.current.toast ? 'is-visible' : ''}`} role="status" aria-live="polite">
          {sim.current.toast}
        </div>
      </div>

      {error && <p className="dino-error" role="alert">{error}</p>}
    </main>
  )
}
