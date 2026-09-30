import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GameRequest } from './Arcade'
import { Icon } from './ui'
import { BusinessExpansionPanel, CareerPanel, CertificationPanel, FinancePanel, LifestylePanel, WorldPanel } from './LifeExpansionPanels'
import './lifeExpansion.css'
import type { Job, LifeView, PendingEvent, Program, Skills } from './lifeTypes'
import { EventIllustration } from './life/LifeArt'
import { LifeOverview, type LifeDetail, type LifeScreen } from './life/LifeOverview'
import { lifeIcon } from './life/assets'

type Tab = 'today' | 'work' | 'study' | 'business' | 'self'
type WorkMode = 'career' | 'gigs'
type StudyMode = 'degrees' | 'qualifications'
type SelfMode = 'daily' | 'finance' | 'social'
type BusinessMode = 'operations' | 'structure' | 'products' | 'markets' | 'finance'


const educationNames = ['Школа', 'Колледж', 'Бакалавриат', 'Магистратура', 'Executive MBA']
const skillNames: Record<keyof Skills, string> = {
  discipline: 'Дисциплина',
  communication: 'Общение',
  digital: 'Digital',
  finance: 'Финансы',
  management: 'Управление',
}

function money(value: number) {
  return Math.round(value).toLocaleString('ru-RU') + ' ₽'
}

function timeLeft(ms: number) {
  if (ms <= 0) return 'завершается'
  const total = Math.ceil(ms / 1000)
  if (total < 60) return total + ' сек'
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return minutes + ':' + String(seconds).padStart(2, '0')
  const hours = Math.floor(minutes / 60)
  return hours + ' ч ' + (minutes % 60) + ' мин'
}

function commandKey() {
  return globalThis.crypto?.randomUUID?.() ?? 'life-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

function skillLock(have: Skills, need: Skills) {
  const missing = (Object.keys(need) as (keyof Skills)[])
    .filter((key) => (need[key] ?? 0) > (have[key] ?? 0))
    .map((key) => skillNames[key] + ' ' + need[key])
  return missing.join(' · ')
}

function needTone(value: number) {
  if (value <= 20) return 'danger'
  if (value <= 45) return 'warning'
  return 'ok'
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="life-stat">
      <div className="life-stat__line">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="life-meter" data-tone={needTone(value)}>
        <i style={{ width: value + '%' }} />
      </div>
    </div>
  )
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="life-section-title">
      <h2>{children}</h2>
      {aside && <span>{aside}</span>}
    </div>
  )
}

function Requirement({ text }: { text: string }) {
  return <span className="life-requirement">{text}</span>
}

function Subnav<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="life-subnav" role="tablist">
      {items.map(([id, label]) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          key={id}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function OptionButton({
  disabled,
  children,
  onClick,
}: {
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button className="life-small-button" type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function LifeEventDialog({ event, busy, error, resolve }: {
  event: PendingEvent
  busy: boolean
  error: string
  resolve: (choice: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={dialogRef} className={`life-event life-event--${event.severity} life-story-modal`} aria-labelledby="life-event-title" onCancel={e => e.preventDefault()}>
    <EventIllustration severity={event.severity} id={event.story_id ?? event.id} />
    <span className="life-event__eyebrow">{event.kind === 'story' ? 'История героя' : 'Событие'}</span>
    <h2 id="life-event-title">{event.title}</h2>
    <p>{event.text}</p>
    {error && <p className="life-event-error" role="alert">{error}</p>}
    <div>{event.options.map(option => <button type="button" disabled={busy} onClick={() => resolve(option.id)} key={option.id}><strong>{option.title}</strong><span>{option.hint}</span></button>)}</div>
  </dialog>
}

export function LifeSim({
  request,
  onBack,
}: {
  request: GameRequest
  onBack: () => void
}) {
  const [view, setView] = useState<LifeView | null>(null)
  const [screen, setScreen] = useState<LifeScreen>('home')
  const [tab, setTab] = useState<Tab>('today')
  const [workMode, setWorkMode] = useState<WorkMode>('career')
  const [studyMode, setStudyMode] = useState<StudyMode>('degrees')
  const [selfMode, setSelfMode] = useState<SelfMode>('daily')
  const [businessMode, setBusinessMode] = useState<BusinessMode>('operations')
  const [journeyOpen, setJourneyOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [clock, setClock] = useState(Date.now())
  const viewRef = useRef<LifeView | null>(null)
  const mutationRef = useRef(false)
  const sequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const uncertainCommands = useRef(new Map<string, string>())

  const acceptView = useCallback((next: LifeView, announce = false) => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    for (const [command, key] of uncertainCommands.current) {
      if (next.state.recent_keys?.includes(key)) uncertainCommands.current.delete(command)
    }
    const latest = next.state.history[0]
    const oldLatest = previous?.state.history[0]
    const changed = latest && (latest.at !== oldLatest?.at || latest.title !== oldLatest?.title || latest.text !== oldLatest?.text)
    if (previous && !next.state.active && changed && (announce || previous.state.active)) {
      setNotice(`${latest.title}. ${latest.text}`)
    }
  }, [])

  const load = useCallback(async (preserveError = false) => {
    if (mutationRef.current) return false
    const sequence = ++sequenceRef.current
    try {
      const next = await request<LifeView>('/games/life')
      if (!mountedRef.current || sequence !== sequenceRef.current) return false
      acceptView(next)
      if (!preserveError) setError('')
      return true
    } catch (value) {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setError(value instanceof Error ? value.message : 'Не удалось загрузить жизнь')
      }
      return false
    }
  }, [request, acceptView])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      sequenceRef.current++
    }
  }, [load])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const serverOffset = useMemo(
    () => (view ? new Date(view.server_now).getTime() - Date.now() : 0),
    [view?.server_now],
  )
  const serverClock = clock + serverOffset
  const remaining = useMemo(() => {
    if (!view?.state.active) return 0
    return new Date(view.state.active.ends_at).getTime() - serverClock
  }, [view?.state.active, serverClock])

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [load])

  const projectDueKey = useMemo(
    () => (view?.state.projects ?? []).map((project) => project.ends_at).join('|'),
    [view?.state.projects],
  )
  const activityDue = Boolean(
    (view?.state.active && remaining <= 0) ||
    (view?.state.projects ?? []).some((project) => new Date(project.ends_at).getTime() <= serverClock),
  )
  useEffect(() => {
    if (!activityDue) return
    let cancelled = false
    let failures = 0
    let retry: number | undefined
    const refresh = async () => {
      const success = await load()
      if (!success && !cancelled) {
        retry = window.setTimeout(() => void refresh(), Math.min(30_000, 5000 * 2 ** failures++))
      }
    }
    void refresh()
    return () => {
      cancelled = true
      window.clearTimeout(retry)
    }
  }, [activityDue, view?.state.active?.ends_at, projectDueKey, load])

  const act = useCallback(
    async (action: string, target = '', onSuccess?: () => void) => {
      if (mutationRef.current) return
      mutationRef.current = true
      sequenceRef.current++
      setBusy(true)
      setError('')
      const command = JSON.stringify([action, target])
      const key = uncertainCommands.current.get(command) ?? commandKey()
      uncertainCommands.current.set(command, key)
      let failed = false
      try {
        const next = await request<LifeView>('/games/life/action', {
          action,
          target,
          request_key: key,
        })
        if (!mountedRef.current) return
        acceptView(next, true)
        uncertainCommands.current.delete(command)
        if (action === 'wardrobe_equip') setNotice('Образ героя изменён.')
        if (action === 'home_select') setNotice('Интерьер выбран.')
        onSuccess?.()
      } catch (value) {
        failed = true
        if (mountedRef.current) setError(value instanceof Error ? value.message : 'Действие не выполнено')
      } finally {
        mutationRef.current = false
        if (mountedRef.current) {
          setBusy(false)
          if (failed) void load(true)
        }
      }
    },
    [request, acceptView, load],
  )

  if (!view) {
    return (
      <div className="life-loading">
        <div className="life-spinner" />
        <strong>Создаём жизнь</strong>
        <span>Первый день начинается с нуля.</span>
        {error && <><p>{error}</p><button type="button" onClick={() => void load()}>Попробовать снова</button></>}
      </div>
    )
  }

  const { state, catalog } = view
  const level = view.level
  const story = view.story
  const currentHome = catalog.homes.find((item) => item.level === state.home) ?? catalog.homes[0]
  const nextHome = catalog.homes.find((item) => item.level === (state.max_home ?? state.home) + 1)
  const currentTier = state.company
    ? catalog.business_tiers.find((item) => item.level === state.company!.tier)
    : undefined
  const nextTier = state.company
    ? catalog.business_tiers.find((item) => item.level === state.company!.tier + 1)
    : catalog.business_tiers[0]
  const blocked = busy || Boolean(state.pending_event)
  const backgroundFull = (state.projects?.length ?? 0) >= 3
  const businessExpandRunning = Boolean(state.projects?.some((item) => item.kind === 'business_expand'))
  const completedMilestones = view.milestones.filter((item) => item.done).length
  const nextMilestones = view.milestones.filter((item) => !item.done).slice(0, 6)
  const milestoneProgress = view.milestones.length
    ? Math.round(completedMilestones * 100 / view.milestones.length)
    : 0

  function jobLock(job: Job) {
    if (state.education < job.min_education) return 'Нужно образование: ' + educationNames[job.min_education]
    if (state.experience < job.min_experience) return 'Опыт ' + job.min_experience
    if (state.reputation < job.min_reputation) return 'Репутация ' + job.min_reputation
    const skills = skillLock(state.skills, job.min_skills)
    return skills || ''
  }

  function programLock(program: Program) {
    if (state.education >= program.level) return 'Уже пройдено'
    if (state.education !== program.min_education) return 'Сначала предыдущая ступень'
    if (state.experience < program.min_experience) return 'Опыт ' + program.min_experience
    const skills = skillLock(state.skills, program.min_skills)
    if (skills) return skills
    if (state.cash < program.cost) return 'Не хватает ' + money(program.cost - state.cash)
    return ''
  }

  function businessLock() {
    if (!nextTier) return ''
    const parts: string[] = []
    const requiredLevel = !state.company && story?.choices?.founder_question === 'career'
      ? Math.max(nextTier.min_level ?? 0, 60)
      : nextTier.min_level ?? 0
    if (level && level.level < requiredLevel) parts.push('Уровень жизни ' + requiredLevel)
    if (!state.company) {
      if (state.skills.management < nextTier.min_management) parts.push('Управление ' + nextTier.min_management)
      if (state.skills.finance < nextTier.min_finance) parts.push('Финансы ' + nextTier.min_finance)
      if (state.cash < nextTier.upgrade_cost) parts.push(money(nextTier.upgrade_cost) + ' капитала')
      return parts.join(' · ')
    }
    if (state.company.cash < nextTier.upgrade_cost) parts.push(money(nextTier.upgrade_cost) + ' в компании')
    if (state.company.staff < nextTier.min_staff) parts.push('Команда ' + nextTier.min_staff)
    if (state.company.brand < nextTier.min_brand) parts.push('Бренд ' + nextTier.min_brand)
    if (state.skills.management < nextTier.min_management) parts.push('Управление ' + nextTier.min_management)
    if (state.skills.finance < nextTier.min_finance) parts.push('Финансы ' + nextTier.min_finance)
    return parts.join(' · ')
  }

  function chapter() {
    if (state.company?.tier === 7) {
      return { title: 'Глава 9 · Глобальный владелец', goal: 'Транснациональная корпорация построена. Теперь задача — удержать масштаб и переживать кризисы.' }
    }
    if (state.company && state.company.tier >= 4) {
      return { title: 'Глава 8 · Большой бизнес', goal: nextTier ? 'Следующая вершина: ' + nextTier.title + '.' : 'Укреплять глобальную компанию.' }
    }
    if (state.company) {
      return { title: 'Глава 7 · Предприниматель', goal: nextTier ? 'Довести компанию до уровня «' + nextTier.title + '».' : 'Масштабировать компанию.' }
    }
    if (state.experience >= 75) {
      return { title: 'Глава 6 · Капитал', goal: 'Вы уже умеете руководить. Соберите стартовый капитал и решите, когда уходить в свой бизнес.' }
    }
    if (state.experience >= 40) {
      return { title: 'Глава 5 · Управление', goal: 'Перейти от личной экспертизы к управлению людьми, бюджетами и ответственностью.' }
    }
    if (state.education >= 2 || state.experience >= 20) {
      return { title: 'Глава 4 · Профессия', goal: 'Стать сильным специалистом, нарастить репутацию и дорогие навыки.' }
    }
    if (state.education >= 1) {
      return { title: 'Глава 3 · Первый рывок', goal: 'Совмещать образование с работой и выйти из случайных подработок.' }
    }
    if (state.experience >= 7 || state.cash >= 4_000) {
      return { title: 'Глава 2 · Опора', goal: 'Накопить на первое образование, не просадив здоровье и базовые потребности.' }
    }
    return { title: 'Глава 1 · С нуля', goal: 'У вас нет денег и профессии. Сначала еда, первая подработка и устойчивый ритм.' }
  }

  const currentChapter = view.level
    ? { title: `Этап ${view.level.era} · ${view.level.era_title}`, goal: view.level.era_description }
    : chapter()
  const activeProgress = state.active
    ? ((serverClock - new Date(state.active.started_at).getTime()) /
      Math.max(1, new Date(state.active.ends_at).getTime() - new Date(state.active.started_at).getTime())) * 100
    : 0
  const openPanel = (nextTab: Tab, mode?: string) => {
    setTab(nextTab)
    setPanelOpen(true)
    setJourneyOpen(false)
    if (nextTab === 'work' && (mode === 'career' || mode === 'gigs')) setWorkMode(mode)
    if (nextTab === 'study' && (mode === 'degrees' || mode === 'qualifications')) setStudyMode(mode)
    if (nextTab === 'business' && (mode === 'operations' || mode === 'structure' || mode === 'products' || mode === 'markets' || mode === 'finance')) setBusinessMode(mode)
    if (nextTab === 'self' && (mode === 'daily' || mode === 'finance' || mode === 'social')) setSelfMode(mode)
  }
  const navigate = (next: LifeScreen) => {
    setScreen(next)
    setPanelOpen(false)
    setJourneyOpen(false)
  }
  const showDetail = (section: LifeDetail) => {
    if (section === 'journey') { setTab('today'); setJourneyOpen(true); setPanelOpen(true) }
    else if (section === 'work' || section === 'gigs') openPanel('work', section === 'gigs' ? 'gigs' : 'career')
    else if (section === 'study' || section === 'qualifications') openPanel('study', section === 'qualifications' ? 'qualifications' : 'degrees')
    else if (section === 'business') openPanel('business', 'operations')
    else openPanel('self', section === 'daily' ? 'daily' : section === 'finance' ? 'finance' : 'social')
  }
  const screenTitle: Record<LifeScreen, string> = { home: 'Жизнь', work: 'Работа', study: 'Учёба', housing: 'Дом', people: 'Люди', shop: 'Магазин', profile: 'Профиль', more: 'Ещё' }

  return (
    <div className="life-screen">
      <header className="life-header">
        <div className="life-v2-heading"><button type="button" className="life-back" onClick={() => panelOpen ? (setPanelOpen(false), setJourneyOpen(false)) : screen === 'home' ? onBack() : navigate('home')} aria-label={panelOpen || screen !== 'home' ? 'Назад к жизни' : 'Назад к играм'}><Icon name="back" size={20} /></button><h1>{panelOpen ? 'Действия' : screenTitle[screen]}</h1></div>
        <strong className="life-v2-balance" title={money(state.cash)}><img src={lifeIcon('coins')} alt="" />{money(state.cash)}</strong>
      </header>

      {error && !state.pending_event && (
        <button className="life-error" type="button" onClick={() => setError('')}>
          {error}
        </button>
      )}
      {notice && <button type="button" className="life-v2-notice" role="status" onClick={() => setNotice('')}>{notice}</button>}

      <main className="life-scroll life-game-layout">
        <LifeOverview view={view} screen={screen} navigate={navigate} detail={showDetail} act={(action, target, onSuccess) => void act(action, target, onSuccess)} blocked={blocked} remaining={timeLeft(remaining)} progress={activeProgress} />
        {panelOpen && <div className="life-panel" role="region" aria-label="Действия и сведения">
          <div className="life-panel-head"><span>{tab === 'today' ? journeyOpen ? 'Путь жизни' : 'Сегодня' : tab === 'work' ? 'Работа' : tab === 'study' ? 'Учёба' : tab === 'business' ? 'Бизнес' : 'Моя жизнь'}</span><button type="button" onClick={() => { setPanelOpen(false); setJourneyOpen(false) }} aria-label="Закрыть действия">✕</button></div>
          <div className="life-panel-body">

        {tab === 'today' && (
          <>
            {journeyOpen ? <section className="life-journey-screen">
              <button className="life-text-back" type="button" onClick={() => setJourneyOpen(false)}>‹ День</button>
              <h2>Путь жизни</h2>
              <p>{completedMilestones} из {view.milestones.length} вех пройдено</p>
              {view.level && <section className="life-journey-unlocks">
                <h3>Скоро откроется</h3>
                {(view.level.upcoming ?? []).map((item) => <div key={`${item.kind}-${item.level}-${item.title}`}><span>Ур. {item.level}</span><strong>{item.title}</strong></div>)}
                {!view.level.upcoming?.length && <p>Все уровни и направления доступны.</p>}
              </section>}
              <div className="life-journey-eras">
                {Array.from(new Set(view.milestones.map((item) => item.stage))).map((stage) => <section key={stage}>
                  <h3>Этап {stage}</h3>
                  {view.milestones.filter((item) => item.stage === stage).map((item) => <div className="life-journey-row" data-state={item.done ? 'done' : 'next'} key={item.id}>
                    <span>{item.done ? '✓' : stage}</span><div><strong>{item.title}</strong><p>{item.description}</p><small>{Math.min(item.current, item.target).toLocaleString('ru-RU')} / {item.target.toLocaleString('ru-RU')}</small></div>
                  </div>)}
                </section>)}
              </div>
            </section> : <div className="life-today">
              <section className="life-chapter-line"><span>{currentChapter.title}</span><p>{currentChapter.goal}</p></section>
              {view.level && <section className="life-card life-progression">
                <div><span>Уровень жизни {view.level.level}/100</span><strong>{view.level.progress}%</strong></div>
                <i><i style={{ width: view.level.progress + '%' }} /></i>
                <small>{view.level.next_level_xp > view.level.xp ? `${(view.level.next_level_xp - view.level.xp).toLocaleString('ru-RU')} XP до следующего уровня` : 'Максимальный уровень'}{view.level.next_unlock ? ` · Далее: ${view.level.next_unlock}` : ''}</small>
              </section>}
              {view.story && <section className="life-card life-story-progress">
                <div><span>История героя</span><strong>{view.story.total.toLocaleString('ru-RU')} сцен</strong></div>
                <p>{view.story.next_beat?.title ?? 'Ключевые главы пройдены — контекстные сцены продолжаются'}</p>
                {view.story.next_beat?.description && <small>{view.story.next_beat.description}</small>}
              </section>}

            <section className="life-card life-roadmap">
              <SectionTitle aside={completedMilestones + '/' + view.milestones.length}>Ближайшие цели</SectionTitle>
              <div className="life-roadmap-progress">
                <i style={{ width: milestoneProgress + '%' }} />
              </div>
              <div className="life-roadmap-summary">
                <strong>{milestoneProgress}% большого пути</strong>
                <span>Следующие цели меняются вместе с вашим сохранением.</span>
              </div>
              <div className="life-roadmap-list">
                {nextMilestones.length ? nextMilestones.slice(0, 3).map((milestone) => {
                  const progress = milestone.target > 0
                    ? Math.min(100, Math.round(milestone.current * 100 / milestone.target))
                    : 0
                  return (
                    <div className="life-roadmap-row" key={milestone.id}>
                      <b>{milestone.stage}</b>
                      <div>
                        <strong>{milestone.title}</strong>
                        <p>{milestone.description}</p>
                        <span>{Math.min(milestone.current, milestone.target).toLocaleString('ru-RU')} / {milestone.target.toLocaleString('ru-RU')}</span>
                        <div><i style={{ width: progress + '%' }} /></div>
                      </div>
                    </div>
                  )
                }) : (
                  <div className="life-roadmap-finished">
                    <strong>Все основные вехи закрыты</strong>
                    <p>Игра продолжается: капитал, продукты, рынки и компания остаются бесконечными системами.</p>
                  </div>
                )}
              </div>
              <button className="life-roadmap-all" type="button" onClick={() => setJourneyOpen(true)}>Весь путь <span>→</span></button>
            </section>
            <button className="life-disclosure" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? 'Скрыть показатели' : 'Показатели и история'} <span>{detailsOpen ? '−' : '+'}</span></button>
            {detailsOpen && <>
            <WorldPanel view={view} />
            <section className="life-card">
              <SectionTitle aside={currentHome?.title}>Состояние</SectionTitle>
              <div className="life-stats-grid">
                <StatBar label="Сытость" value={state.hunger} />
                <StatBar label="Энергия" value={state.energy} />
                <StatBar label="Здоровье" value={state.health} />
                <StatBar label="Настроение" value={state.mood} />
              </div>
            </section>

            <section className="life-card">
              <SectionTitle>Позиция в жизни</SectionTitle>
              <div className="life-facts">
                <div><span>Опыт</span><strong>{state.experience}</strong></div>
                <div><span>Репутация</span><strong>{state.reputation}</strong></div>
                <div><span>Долг</span><strong>{state.debt ? money(state.debt) : 'Нет'}</strong></div>
                <div><span>Заработано всего</span><strong>{money(state.total_earned)}</strong></div>
              </div>
            </section>

            <section className="life-card">
              <SectionTitle>Навыки</SectionTitle>
              <div className="life-skill-list">
                {(Object.keys(skillNames) as (keyof Skills)[]).map((key) => (
                  <div key={key}>
                    <span>{skillNames[key]}</span>
                    <strong>{state.skills[key]}</strong>
                    <div className="life-skill-track"><i style={{ width: state.skills[key] + '%' }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="life-card">
              <SectionTitle>Что делать дальше</SectionTitle>
              <div className="life-next-list">
                <button type="button" onClick={() => setTab('work')}>
                  <span>Заработать</span>
                  <small>Подработки и карьерная лестница</small>
                  <b>›</b>
                </button>
                <button type="button" onClick={() => setTab('study')}>
                  <span>Учиться</span>
                  <small>Большое образование идёт фоном и не блокирует жизнь</small>
                  <b>›</b>
                </button>
                <button type="button" onClick={() => setTab('self')}>
                  <span>Позаботиться о себе</span>
                  <small>Еда, сон, навыки и жильё</small>
                  <b>›</b>
                </button>
                <button type="button" onClick={() => setTab('business')}>
                  <span>Строить бизнес</span>
                  <small>От студии до глобальной корпорации</small>
                  <b>›</b>
                </button>
              </div>
            </section>

            <section className="life-card life-history">
              <SectionTitle>Последние события</SectionTitle>
              {state.history.slice(0, 8).map((item, index) => (
                <div className="life-history-row" key={item.at + index}>
                  <i />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                </div>
              ))}
            </section>
            </>}
            </div>}
          </>
        )}

        {tab === 'work' && (
          <>
            <Subnav<WorkMode>
              value={workMode}
              onChange={setWorkMode}
              items={[[ 'career', 'Карьера' ], [ 'gigs', 'Подработки' ]]}
            />
            {workMode === 'career' ? (
              <CareerPanel view={view} blocked={blocked} act={act} />
            ) : (
              <section className="life-card life-catalog">
            <SectionTitle aside={'Опыт ' + state.experience}>Работа</SectionTitle>
            <p className="life-section-note">Можно возвращаться к простым подработкам, но лучшие роли требуют образования, опыта и навыков.</p>
            {catalog.jobs.map((job) => {
              const lock = jobLock(job)
              return (
                <article className="life-option" key={job.id}>
                  <div className="life-option__copy">
                    <strong>{job.title}</strong>
                    <p>{job.description}</p>
                    <small>Сразу · +{job.experience_gain} опыта · {job.game_days} игровой день</small>
                    {lock && <Requirement text={lock} />}
                  </div>
                  <div className="life-option__action">
                    <b>{money(job.pay)}</b>
                    <OptionButton disabled={blocked || Boolean(lock)} onClick={() => void act('start_job', job.id)}>Смена</OptionButton>
                  </div>
                </article>
              )
            })}
          </section>
            )}
          </>
        )}

        {tab === 'study' && (
          <>
            <Subnav<StudyMode>
              value={studyMode}
              onChange={setStudyMode}
              items={[[ 'degrees', 'Дипломы' ], [ 'qualifications', 'Квалификации' ]]}
            />
            {studyMode === 'degrees'
              ? <section className="life-card life-education-path">
              <SectionTitle aside={educationNames[state.education]}>Образование</SectionTitle>
              <p className="life-section-note">Большое образование идёт отдельным фоновым проектом. Пока оно продолжается, можно работать, отдыхать, общаться и развивать другие части жизни.</p>
              {catalog.programs.map((program) => {
                const lock = programLock(program)
                const done = state.education >= program.level
                const running = Boolean(state.projects?.some((item) => item.kind === 'study' && item.target === program.id))
                return (
                  <article className="life-option" data-state={done ? 'done' : lock ? 'locked' : 'available'} key={program.id}>
                    <span className="life-education-marker" aria-hidden="true">{done ? '✓' : program.level}</span>
                    <div className="life-option__copy">
                      <strong>{program.title}</strong>
                      <p>{program.description}</p>
                      <small>Фоновая учёба · игра остаётся доступна · {program.game_days} игровых дней истории</small>
                      {running ? <Requirement text="Эта ступень уже идёт в фоне" /> : lock ? <Requirement text={lock} /> : backgroundFull && !done ? <Requirement text="Заняты все три фоновых слота" /> : null}
                    </div>
                    <div className="life-option__action">
                      <b>{done ? 'Готово' : money(program.cost)}</b>
                      <OptionButton disabled={blocked || Boolean(lock) || done || running || backgroundFull} onClick={() => void act('start_study', program.id)}>
                        {done ? '✓' : running ? 'Идёт' : 'Поступить'}
                      </OptionButton>
                    </div>
                  </article>
                )
              })}
            </section>
              : <CertificationPanel view={view} blocked={blocked} act={act} />}
          </>
        )}

        {tab === 'self' && (
          <>
            <Subnav<SelfMode>
              value={selfMode}
              onChange={setSelfMode}
              items={[[ 'daily', 'Быт' ], [ 'finance', 'Финансы' ], [ 'social', 'Жизнь' ]]}
            />
            {selfMode === 'finance' ? (
              <FinancePanel view={view} blocked={blocked} act={act} />
            ) : selfMode === 'social' ? (
              <LifestylePanel view={view} blocked={blocked} act={act} />
            ) : (
              <>
                <section className="life-card">
              <SectionTitle>Еда и восстановление</SectionTitle>
              {catalog.meals.map((meal) => {
                const emergencyLocked = meal.emergency && (state.cash >= 1000 || state.hunger > 25)
                return (
                  <article className="life-option life-option--compact" key={meal.id}>
                    <div className="life-option__copy">
                      <strong>{meal.title}</strong>
                      <p>{meal.description}</p>
                      <small>Сытость +{meal.hunger_gain}{meal.health_gain ? ' · здоровье +' + meal.health_gain : ''}</small>
                      {emergencyLocked && <Requirement text="Только когда денег почти нет и вы голодны" />}
                    </div>
                    <div className="life-option__action">
                      <b>{meal.cost ? money(meal.cost) : 'Бесплатно'}</b>
                      <OptionButton disabled={blocked || emergencyLocked || state.cash < meal.cost} onClick={() => void act('eat', meal.id)}>Поесть</OptionButton>
                    </div>
                  </article>
                )
              })}
              <button className="life-wide-action" type="button" disabled={blocked} onClick={() => void act('rest')}>
                <span><strong>Поспать</strong><small>Сразу · сильно восстанавливает энергию</small></span>
                <b>Спать</b>
              </button>
            </section>

            <section className="life-card">
              <SectionTitle>Саморазвитие</SectionTitle>
              {catalog.training.map((training) => (
                <article className="life-option life-option--compact" key={training.id}>
                  <div className="life-option__copy">
                    <strong>{training.title}</strong>
                    <p>{training.description}</p>
                    <small>Сразу · {training.game_days} игровых дней</small>
                  </div>
                  <div className="life-option__action">
                    <b>{training.cost ? money(training.cost) : 'Бесплатно'}</b>
                    <OptionButton disabled={blocked || state.cash < training.cost} onClick={() => void act('train', training.id)}>Учиться</OptionButton>
                  </div>
                </article>
              ))}
            </section>

            <section className="life-card">
              <SectionTitle aside={currentHome?.title}>Жильё</SectionTitle>
              <p className="life-section-note">Хорошее жильё усиливает восстановление после сна и поднимает настроение.</p>
              {nextHome ? (
                <div className="life-purchase">
                  <div>
                    <strong>{nextHome.title}</strong>
                    <p>{nextHome.description}</p>
                    <small>Сон +{nextHome.rest_bonus} · настроение +{nextHome.mood_bonus}</small>
                  </div>
                  <div>
                    <b>{money(nextHome.cost)}</b>
                    <OptionButton disabled={blocked || state.cash < nextHome.cost} onClick={() => void act('buy_home', String(nextHome.level))}>Купить</OptionButton>
                  </div>
                </div>
              ) : (
                <p className="life-complete">Лучшее жильё уже куплено.</p>
              )}
            </section>

            {state.debt > 0 && (
              <section className="life-card life-debt">
                <SectionTitle>Долг</SectionTitle>
                <strong>{money(state.debt)}</strong>
                <p>Долг может появиться из-за серьёзных случайных событий. Погашается только личными деньгами.</p>
                <button type="button" disabled={blocked || state.cash <= 0} onClick={() => void act('repay_debt')}>Погасить доступную сумму</button>
              </section>
            )}
              </>
            )}
          </>
        )}

        {tab === 'business' && (
          <>
            {!state.company ? (
              
              <section className="life-card life-business-start">
                <span className="life-kicker">Свой бизнес</span>
                <h2>От маленькой студии до глобальной корпорации</h2>
                <p>Деньги компании отделены от личных. Сначала вы инвестируете стартовый капитал, затем ведёте месячные циклы, нанимаете людей и масштабируетесь.</p>
                <div className="life-business-requirements">
                  <div><span>Стартовый капитал</span><strong>{money(nextTier?.upgrade_cost ?? 0)}</strong></div>
                  <div><span>Уровень жизни</span><strong>{view.level?.level ?? '—'}/{view.story?.choices?.founder_question === 'career' ? Math.max(nextTier?.min_level ?? 0, 60) : nextTier?.min_level ?? '—'}</strong></div>
                  <div><span>Управление</span><strong>{state.skills.management}/{nextTier?.min_management ?? 0}</strong></div>
                  <div><span>Финансы</span><strong>{state.skills.finance}/{nextTier?.min_finance ?? 0}</strong></div>
                </div>
                {businessLock() && <Requirement text={businessLock()} />}
                <button className="life-primary" type="button" disabled={blocked || Boolean(businessLock())} onClick={() => void act('start_business')}>Открыть компанию</button>
              </section>
            
            ) : (
              <>
                <Subnav<BusinessMode>
                  value={businessMode}
                  onChange={setBusinessMode}
                  items={[[ 'operations', 'Дело' ], [ 'structure', 'Отделы' ], [ 'products', 'Продукты' ], [ 'markets', 'Рынки' ], [ 'finance', 'Финансы' ]]}
                />
                {businessMode === 'operations' ? (
                  <>
                <section className="life-card life-company">
                  <div className="life-company__title">
                    <div>
                      <span>Ваш бизнес · уровень {state.company.tier}/7</span>
                      <h2>{currentTier?.title}</h2>
                    </div>
                    <strong>{money(state.company.cash)}</strong>
                  </div>
                  <p>{currentTier?.description}</p>
                  <div className="life-facts">
                    <div><span>Сотрудники</span><strong>{state.company.staff.toLocaleString('ru-RU')}</strong></div>
                    <div><span>Бренд</span><strong>{state.company.brand}/100</strong></div>
                    <div><span>Последняя прибыль</span><strong>{money(state.company.last_profit)}</strong></div>
                    <div><span>Базовая выручка</span><strong>{money(currentTier?.base_revenue ?? 0)}</strong></div>
                  </div>
                </section>

                <section className="life-card">
                  <SectionTitle aside={'Лично ' + money(state.cash)}>Капитал компании</SectionTitle>
                  <p className="life-section-note">Личные деньги можно инвестировать в компанию. Обратно капитал выводится только через дивиденды после успешного месяца.</p>
                  <div className="life-invest">
                    {[10_000, 100_000, 1_000_000, 10_000_000].map((amount) => (
                      <button
                        type="button"
                        disabled={blocked || state.cash < amount}
                        onClick={() => void act('business_invest', String(amount))}
                        key={amount}
                      >
                        +{amount >= 1_000_000 ? (amount / 1_000_000) + ' млн' : (amount / 1_000) + ' тыс.'}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="life-card">
                  <SectionTitle>Месячный цикл</SectionTitle>
                  <p className="life-section-note">Каждая стратегия меняет темп роста команды, бренда и прибыли.</p>
                  <div className="life-strategies">
                    <button type="button" disabled={blocked} onClick={() => void act('business_cycle', 'steady')}>
                      <strong>Стабильно</strong><span>Выше прибыль, спокойный рост</span>
                    </button>
                    <button type="button" disabled={blocked} onClick={() => void act('business_cycle', 'growth')}>
                      <strong>Рост</strong><span>Меньше прибыли, быстрее команда</span>
                    </button>
                    <button type="button" disabled={blocked} onClick={() => void act('business_cycle', 'quality')}>
                      <strong>Качество</strong><span>Сильнее растёт бренд</span>
                    </button>
                  </div>
                  {state.company.dividend_ready && (
                    <button className="life-wide-action" type="button" disabled={blocked} onClick={() => void act('business_dividend')}>
                      <span><strong>Выплатить дивиденды</strong><small>Перевести часть капитала компании себе</small></span>
                      <b>Получить</b>
                    </button>
                  )}
                </section>

                <section className="life-card">
                  <SectionTitle>Команда</SectionTitle>
                  <div className="life-hire">
                    {[1, 5, 25, 100, 1000].map((count) => (
                      <button type="button" disabled={blocked} onClick={() => void act('business_hire', String(count))} key={count}>
                        +{count}
                      </button>
                    ))}
                  </div>
                  <p className="life-section-note">Чем выше уровень компании, тем дороже найм. Для следующей ступени нужен минимальный штат.</p>
                </section>

                <section className="life-card">
                  <SectionTitle>Масштабирование</SectionTitle>
                  {nextTier ? (
                    <div className="life-expand">
                      <span className="life-kicker">Уровень {nextTier.level}/7</span>
                      <h2>{nextTier.title}</h2>
                      <p>{nextTier.description}</p>
                      <div className="life-business-requirements">
                        <div><span>Капитал</span><strong>{money(nextTier.upgrade_cost)}</strong></div>
                        <div><span>Уровень жизни</span><strong>{view.level?.level ?? '—'}/{nextTier.min_level ?? '—'}</strong></div>
                        <div><span>Команда</span><strong>{state.company.staff}/{nextTier.min_staff}</strong></div>
                        <div><span>Бренд</span><strong>{state.company.brand}/{nextTier.min_brand}</strong></div>
                        <div><span>Процесс</span><strong>Идёт в фоне</strong></div>
                      </div>
                      {businessExpandRunning ? <Requirement text="Масштабирование уже идёт в фоне" /> : businessLock() ? <Requirement text={businessLock()} /> : backgroundFull ? <Requirement text="Заняты все три фоновых слота" /> : null}
                      <button className="life-primary" type="button" disabled={blocked || Boolean(businessLock()) || businessExpandRunning || backgroundFull} onClick={() => void act('business_expand')}>{businessExpandRunning ? 'Масштабирование идёт' : 'Начать масштабирование'}</button>
                    </div>
                  ) : (
                    <div className="life-final">
                      <strong>Транснациональная корпорация построена</strong>
                      <p>Это не экран «победы»: компания продолжает жить, приносить прибыль и попадать в рискованные события.</p>
                    </div>
                  )}
                </section>
                    <section className="life-card">
              <SectionTitle>Лестница бизнеса</SectionTitle>
              <div className="life-ladder">
                {catalog.business_tiers.map((tier) => (
                  <div data-state={state.company && tier.level <= state.company.tier ? 'done' : tier.level === (state.company?.tier ?? 0) + 1 ? 'next' : 'locked'} key={tier.level}>
                    <i>{tier.level}</i>
                    <span><strong>{tier.title}</strong><small>Ур. {tier.min_level ?? '—'} · {money(tier.upgrade_cost)}</small></span>
                  </div>
                ))}
              </div>
            </section>
                  </>
                ) : (
                  <BusinessExpansionPanel view={view} blocked={blocked} act={act} section={businessMode} />
                )}
              </>
            )}
          </>
        )}
          </div>
        </div>}
      </main>

      <nav className="life-v2-nav" aria-label="Разделы жизни">
        {([['home', 'Жизнь', 'home'], ['work', 'Карьера', 'work'], ['profile', 'Профиль', 'profile']] as [LifeScreen, string, string][]).map(([id, label, icon]) => (
          <button type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => navigate(id)} key={id}><img src={lifeIcon(icon)} alt="" /><span>{label}</span></button>
        ))}
      </nav>

      {state.pending_event && <LifeEventDialog event={state.pending_event} busy={busy} error={error} resolve={choice => void act('resolve_event', choice)} />}
    </div>
  )
}
