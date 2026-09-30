import { useState, type CSSProperties } from 'react'
import type { CareerOption, Job, LifeView, Program, Skills } from '../lifeTypes'
import { wardrobeType } from './visualState'
import { characterImage, lifeIcon, roomImage } from './assets'

export type LifeScreen = 'home' | 'work' | 'study' | 'housing' | 'people' | 'shop' | 'profile' | 'more'
export type LifeDetail = 'work' | 'gigs' | 'study' | 'qualifications' | 'daily' | 'social' | 'journey' | 'business' | 'finance'

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`
const skillLabels: Record<keyof Skills, string> = {
  discipline: 'Дисциплина', communication: 'Общение', digital: 'Digital', finance: 'Финансы', management: 'Управление',
}

function missingSkills(have: Skills, need: Skills) {
  return (Object.keys(skillLabels) as (keyof Skills)[])
    .filter(key => (need[key] ?? 0) > (have[key] ?? 0))
    .map(key => `${skillLabels[key]} ${need[key]}`)
}

function gigLock(view: LifeView, job: Job) {
  const { state } = view
  if (state.education < job.min_education) return `Нужно образование ${job.min_education}`
  if (state.experience < job.min_experience) return `Нужен опыт ${job.min_experience}`
  if (state.reputation < job.min_reputation) return `Нужна репутация ${job.min_reputation}`
  const skills = missingSkills(state.skills, job.min_skills)
  if (skills.length) return skills.join(' · ')
  if (state.hunger < 12 || state.energy < job.energy_cost + 5 || state.health < 20) return 'Сначала восстановите силы и сытость'
  return ''
}

function careerLock(view: LifeView, role: CareerOption) {
  const { state } = view
  if (view.level && view.level.level < (role.min_level ?? 0)) return `Нужен уровень жизни ${role.min_level}`
  if (state.education < role.min_education) return `Нужно образование ${role.min_education}`
  if (state.experience < role.min_experience) return `Нужен опыт ${role.min_experience}`
  if (state.reputation < role.min_reputation) return `Нужна репутация ${role.min_reputation}`
  const skills = missingSkills(state.skills, role.min_skills)
  if (skills.length) return skills.join(' · ')
  if (state.energy < 18 || state.hunger < 14) return 'Сначала восстановите силы и сытость'
  return ''
}

function programLock(view: LifeView, program: Program) {
  const { state } = view
  if (state.education !== program.min_education) return 'Сначала предыдущая ступень'
  if (state.experience < program.min_experience) return `Нужен опыт ${program.min_experience}`
  const skills = missingSkills(state.skills, program.min_skills)
  if (skills.length) return skills.join(' · ')
  if (state.cash < program.cost) return `Не хватает ${money(program.cost - state.cash)}`
  if (state.hunger < 18 || state.energy < 25 || state.health < 25) return 'Сначала восстановите силы и сытость'
  return ''
}

function Icon({ name }: { name: string }) {
  return <img className="life-v2-icon" src={lifeIcon(name)} alt="" aria-hidden="true" />
}

function Segments<T extends string>({ value, choices, onChange }: { value: T; choices: [T, string][]; onChange: (value: T) => void }) {
  return <div className="life-v2-segments" role="tablist">{choices.map(([key, label]) => <button type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)} key={key}>{label}</button>)}</div>
}

function Section({ title, aside }: { title: string; aside?: string }) {
  return <div className="life-v2-section"><h2>{title}</h2>{aside && <span>{aside}</span>}</div>
}

function GameOption({ title, description, meta, hint, button, disabled, onClick }: {
  title: string
  description: string
  meta: string
  hint?: string
  button: string
  disabled: boolean
  onClick: () => void
}) {
  return <article className="life-v2-row life-v2-game-row">
    <div><strong>{title}</strong><p>{description}</p><b>{meta}</b>{hint && <small className="life-v2-requirement">{hint}</small>}</div>
    <button type="button" disabled={disabled} onClick={onClick}>{button}</button>
  </article>
}

function ActionTile({ icon, title, subtitle, onClick, disabled = false }: { icon: string; title: string; subtitle: string; onClick: () => void; disabled?: boolean }) {
  return <button className="life-v2-action" type="button" disabled={disabled} onClick={onClick}><span><Icon name={icon} /><strong>{title}</strong></span><small>{subtitle}</small></button>
}

function Room({ view, label = false }: { view: LifeView; label?: boolean }) {
  const { state, level } = view
  const age = 18 + Math.floor(state.days / 365)
  const wardrobe = wardrobeType(state)
  return <div className="life-v2-room">
    <img className="life-v2-room-bg" src={roomImage(state.home)} alt="" />
    <img className="life-v2-room-character" src={characterImage(wardrobe)} alt={`Нарисованный герой в одежде: ${wardrobe === 'casual' ? 'повседневной' : wardrobe === 'capsule' ? 'аккуратной' : wardrobe === 'business' ? 'деловой' : 'руководителя'}`} />
    {label && <><div className="life-v2-player"><strong>Ваш герой, {age} лет</strong><span>{state.career?.title ?? 'Безработный'} · {view.catalog.homes.find(home => home.level === state.home)?.title ?? 'Комната'}</span></div><span className="life-v2-level">Ур. {level?.level ?? 1}</span></>}
  </div>
}

function Need({ title, value, tone }: { title: string; value: number; tone: string }) {
  return <div className="life-v2-need" style={{ '--need-color': tone } as CSSProperties}><strong><i />{value}</strong><span>{title}</span><div><i style={{ width: `${value}%` }} /></div></div>
}

function ActivityStatus({ view, remaining, progress }: { view: LifeView; remaining: string; progress: number }) {
  const activity = view.state.active
  const projects = view.state.projects ?? []
  if (activity) {
    return <div className="life-v2-activity" role="status"><span>ЗАВЕРШАЕМ СТАРОЕ ДЕЙСТВИЕ</span><strong>{activity.title}</strong><small>{remaining}</small><div className="life-v2-track"><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div></div>
  }
  if (!projects.length) return null
  return <div className="life-v2-activity" role="status"><span>В ФОНЕ · {projects.length}</span><strong>{projects[0].title}</strong><small>{projects.length > 1 ? `Ещё ${projects.length - 1} проекта. Можно продолжать играть.` : 'Проект идёт сам. Можно продолжать работать, отдыхать и общаться.'}</small></div>
}

export function LifeOverview({ view, screen, navigate, detail, act, blocked, remaining, progress }: {
  view: LifeView
  screen: LifeScreen
  navigate: (screen: LifeScreen) => void
  detail: (section: LifeDetail) => void
  act: (action: string, target?: string, onSuccess?: () => void) => void
  blocked: boolean
  remaining: string
  progress: number
}) {
  const { state, catalog, level } = view
  const [workKind, setWorkKind] = useState<'career' | 'gigs'>('gigs')
  const [studyKind, setStudyKind] = useState<'degrees' | 'skills'>('degrees')
  const [peopleKind, setPeopleKind] = useState<'close' | 'contacts'>('close')
  const [shopKind, setShopKind] = useState<'device' | 'wardrobe' | 'transport'>('device')
  const nextGoal = view.milestones.find(item => !item.done)
  const maxHome = state.max_home ?? state.home
  const nextHome = catalog.homes.find(item => item.level === maxHome + 1)
  const home = catalog.homes.find(item => item.level === state.home)
  const program = catalog.programs.find(item => item.level === state.education + 1)
  const programRunning = Boolean(program && state.projects?.some(item => item.kind === 'study' && item.target === program.id))
  const backgroundFull = (state.projects?.length ?? 0) >= 3
  const programHint = program
    ? programRunning
      ? 'Эта ступень уже идёт в фоне'
      : backgroundFull
        ? 'Сначала завершите один из трёх фоновых проектов'
        : programLock(view, program)
    : ''
  const age = 18 + Math.floor(state.days / 365)
  const status = <ActivityStatus view={view} remaining={remaining} progress={progress} />

  if (screen === 'home') return <div className="life-v2-page life-v2-home">
    <Room view={view} label />
    <div className="life-v2-needs"><Need title="Здоровье" value={state.health} tone="#34c759" /><Need title="Энергия" value={state.energy} tone="#ffcc00" /><Need title="Настроение" value={state.mood} tone="#af52de" /><Need title="Сытость" value={state.hunger} tone="#ff9500" /></div>
    {(state.projects?.length ?? 0) > 0 ? <button type="button" className="life-v2-goal" onClick={() => navigate('study')}><span>В ФОНЕ · {state.projects?.length}</span><h2>{state.projects?.[0]?.title}</h2><p>Ждать на этом экране не нужно — любые обычные действия доступны параллельно.</p><div className="life-v2-track"><i style={{ width: '100%' }} /></div></button>
      : <button type="button" className="life-v2-goal" onClick={() => nextGoal ? detail('journey') : detail('work')}><span>СЕГОДНЯ</span><h2>{nextGoal?.title ?? 'Продолжайте свой путь'}</h2><p>{nextGoal?.description ?? 'Все главные цели достигнуты'}</p><div className="life-v2-track"><i style={{ width: `${nextGoal ? Math.min(100, Math.round(nextGoal.current / Math.max(1, nextGoal.target) * 100)) : 100}%` }} /></div></button>}
    {!state.active && state.total_earned === 0 && <div className="life-v2-note"><strong>Первый день начинается с малого</strong><p>Подработка приносит первые деньги и опыт. Следите за сытостью и энергией, чтобы продолжать путь.</p><button type="button" onClick={() => navigate('work')}>Найти подработку</button></div>}
    {!state.active && (state.hunger < 18 || state.energy < 25) && <button className="life-v2-secondary" type="button" onClick={() => navigate('housing')}>Восстановить сытость и энергию</button>}
    <div className="life-v2-actions"><ActionTile icon="work" title="Работа" subtitle="Вакансии и подработки" onClick={() => navigate('work')} /><ActionTile icon="study" title="Учёба" subtitle="Дипломы и навыки" onClick={() => navigate('study')} /><ActionTile icon="house" title="Дом" subtitle="Еда, сон, жильё" onClick={() => navigate('housing')} /><ActionTile icon="people" title="Люди" subtitle="Друзья и отношения" onClick={() => navigate('people')} /><ActionTile icon="shop" title="Магазин" subtitle="Вещи и техника" onClick={() => navigate('shop')} /><ActionTile icon="more" title="Ещё" subtitle="Финансы, бизнес, путь" onClick={() => navigate('more')} /></div>
    {state.history.length > 0 && <><Section title="Последние события" /><div className="life-v2-journal">{state.history.slice(0, 3).map((item, index) => <div key={`${item.at}-${index}`}><strong>{item.title}</strong><p>{item.text}</p></div>)}</div></>}
  </div>

  if (screen === 'work') {
    const career = workKind === 'career'
    const availableCareers = catalog.expansion.careers.filter(role => !careerLock(view, role))
    const careers = availableCareers.length ? availableCareers.slice(0, 4) : catalog.expansion.careers.slice(0, 2)
    const gigs = [...catalog.jobs].sort((a, b) => Number(Boolean(gigLock(view, a))) - Number(Boolean(gigLock(view, b)))).slice(0, 5)
    const workNeeds = state.energy < 25 || state.hunger < 18 || state.health < 24
    return <div className="life-v2-page">
      {status}
      <Segments value={workKind} onChange={setWorkKind} choices={[[ 'career', 'Карьера' ], [ 'gigs', 'Подработки' ]]} />
      <div className="life-v2-summary"><span>{state.career?.employer ?? 'Начало пути'}</span><h2>{state.career?.title ?? 'Найдите первую работу'}</h2><p>Опыт {state.experience} · Репутация {state.reputation}</p></div>
      {career && state.career && <GameOption title="Рабочий месяц" description={`Результативность ${state.career.performance}/100 · стабильность ${state.career.stability}/100`} meta={`${money(state.career.salary)} до игрового налога`} hint={workNeeds ? 'Сначала восстановите силы и сытость' : undefined} button="Работать" disabled={blocked || workNeeds} onClick={() => act('career_work', '', () => navigate('home'))} />}
      <Section title={career ? 'Постоянная работа' : 'Подработки'} aside={career ? `${availableCareers.length} доступно` : 'Оплата за смену'} />
      {career ? <>
        {!availableCareers.length && <div className="life-v2-note"><strong>Наберите первый опыт</strong><p>Подработки развивают навыки и открывают постоянные должности.</p><button type="button" onClick={() => setWorkKind('gigs')}>К подработкам</button></div>}
        {careers.map(role => {
          const lock = careerLock(view, role)
          const current = state.career?.role_id === role.id
          return <GameOption key={role.id} title={role.title} description={role.description} meta={`${money(role.salary)} / мес · решение сразу`} hint={lock || undefined} button={current ? 'Работаете' : 'Отклик'} disabled={blocked || Boolean(lock) || current} onClick={() => act('career_apply', role.id, () => navigate('home'))} />
        })}
      </> : gigs.map(job => {
        const lock = gigLock(view, job)
        return <GameOption key={job.id} title={job.title} description={job.description} meta={`${money(job.pay)} · ${job.game_days} игровой день · опыт +${job.experience_gain}`} hint={lock || `Энергия −${job.energy_cost} · сытость −${job.hunger_cost}`} button="Начать" disabled={blocked || Boolean(lock)} onClick={() => act('start_job', job.id, () => navigate('home'))} />
      })}
      <button type="button" className="life-v2-secondary" onClick={() => detail(career ? 'work' : 'gigs')}>Открыть все вакансии</button>
    </div>
  }

  if (screen === 'study') return <div className="life-v2-page">
    {status}
    <div className="life-v2-summary life-v2-summary--accent"><span>ТЕКУЩИЙ УРОВЕНЬ</span><h2>{['Школа', 'Колледж', 'Бакалавриат', 'Магистратура', 'Executive MBA'][state.education] ?? 'Образование'}</h2><p>Следующий шаг открывает новые профессии</p></div>
    <Segments value={studyKind} onChange={setStudyKind} choices={[[ 'degrees', 'Дипломы' ], [ 'skills', 'Навыки' ]]} />
    {studyKind === 'degrees' ? <>
      <Section title="Путь образования" aside={`${state.education + 1} / 5`} />
      <div className="life-v2-path">{['Школа', ...catalog.programs.map(item => item.title)].map((title, index) => <div key={`${title}-${index}`}><span data-done={index <= state.education}>{index <= state.education ? '✓' : index + 1}</span><div><strong>{title}</strong><small>{index <= state.education ? 'Завершено' : catalog.programs[index - 1] ? `${money(catalog.programs[index - 1].cost)} · фоновая учёба` : 'Поздняя игра'}</small></div></div>)}</div>
      {program ? <GameOption title={program.title} description={program.description} meta={`${money(program.cost)} · фоновая учёба, игра остаётся доступна`} hint={programHint || undefined} button={programRunning ? 'Идёт' : 'Поступить'} disabled={blocked || programRunning || backgroundFull || Boolean(programLock(view, program))} onClick={() => act('start_study', program.id, () => navigate('home'))} /> : <div className="life-v2-note"><strong>Все дипломы получены</strong><p>Развивайте прикладные навыки и квалификации для следующих карьерных ступеней.</p></div>}
    </> : <>
      <Section title="Навыки" />
      <div className="life-v2-skill-card">{(Object.keys(skillLabels) as (keyof Skills)[]).map(key => <div key={key}><span>{skillLabels[key]}</span><strong>{state.skills[key]}</strong><div className="life-v2-track"><i style={{ width: `${state.skills[key]}%` }} /></div></div>)}</div>
      <Section title="Короткие курсы" />
      {catalog.training.map(course => {
        const lock = state.cash < course.cost ? `Не хватает ${money(course.cost - state.cash)}` : state.energy < course.energy_cost + 8 || state.hunger < 14 ? 'Сначала восстановите силы и сытость' : ''
        const gain = (Object.keys(skillLabels) as (keyof Skills)[]).filter(key => course.skill_gain[key] > 0).map(key => `${skillLabels[key]} +${course.skill_gain[key]}`).join(' · ')
        return <GameOption key={course.id} title={course.title} description={gain} meta={`${course.cost ? money(course.cost) : 'Бесплатно'} · сразу`} hint={lock || undefined} button="Учиться" disabled={blocked || Boolean(lock)} onClick={() => act('train', course.id, () => navigate('home'))} />
      })}
    </>}
    <button type="button" className="life-v2-secondary" onClick={() => detail('qualifications')}>Прикладные квалификации</button>
  </div>

  if (screen === 'housing') return <div className="life-v2-page">
    {status}
    <Room view={view} />
    <Section title={home?.title ?? 'Моя комната'} aside={`Уровень ${state.home}`} />
    <div className="life-v2-facts"><div><span>Восстановление</span><strong>+{home?.rest_bonus ?? 0}</strong></div><div><span>Настроение</span><strong>+{home?.mood_bonus ?? 0}</strong></div><div><span>Стоимость следующего</span><strong>{nextHome ? money(nextHome.cost) : 'Всё куплено'}</strong></div></div>
    {maxHome > 0 && <><Section title="Ваши интерьеры" /><div className="life-v2-homes">{catalog.homes.filter(item => item.level <= maxHome).map(item => <button type="button" key={item.level} aria-pressed={state.home === item.level} disabled={blocked || state.home === item.level} onClick={() => act('home_select', String(item.level))}><img src={roomImage(item.level)} alt="" /><span>{item.title}</span><small>{state.home === item.level ? 'Выбрано' : 'Сменить'}</small></button>)}</div></>}
    <button type="button" className="life-v2-primary" disabled={blocked} onClick={() => act('rest', '', () => navigate('home'))}>Поспать · сразу</button>
    <Section title="Еда и восстановление" aside={`Сытость ${state.hunger}/100`} />
    {catalog.meals.map(meal => {
      const emergencyLocked = meal.emergency && (state.cash >= 1000 || state.hunger > 25)
      const lock = emergencyLocked ? 'Помощь доступна только когда денег почти нет и сытость упала до критического уровня' : state.cash < meal.cost ? `Не хватает ${money(meal.cost - state.cash)}` : ''
      return <GameOption key={meal.id} title={meal.title} description={meal.description} meta={`${meal.cost ? money(meal.cost) : 'Бесплатно'} · сытость +${meal.hunger_gain}`} hint={lock || undefined} button="Поесть" disabled={blocked || Boolean(lock)} onClick={() => act('eat', meal.id)} />
    })}
    {nextHome && <>
      <Section title="Следующее жильё" />
      <img className="life-v2-next-room" src={roomImage(nextHome.level)} alt={nextHome.title} loading="lazy" />
      <GameOption title={nextHome.title} description={nextHome.description} meta={`${money(nextHome.cost)} · сон +${nextHome.rest_bonus}`} hint={state.cash < nextHome.cost ? `Нужно ещё ${money(nextHome.cost - state.cash)}` : undefined} button="Купить" disabled={blocked || state.cash < nextHome.cost} onClick={() => act('buy_home', String(nextHome.level))} />
    </>}
  </div>

  if (screen === 'people') return <div className="life-v2-page">
    {status}
    <div className="life-v2-summary life-v2-summary--accent"><span>Социальность</span><h2>{state.network.friends + state.network.mentors + state.network.professional_contacts} человек рядом</h2><p>Отношения требуют времени и внимания</p></div>
    <Segments value={peopleKind} onChange={setPeopleKind} choices={[[ 'close', 'Близкие' ], [ 'contacts', 'Контакты' ]]} />
    <Section title="Ваш круг" />
    {(peopleKind === 'close' ? [['Друзья', state.network.friends], ['Семья', state.network.family_bond], ['Отношения', state.network.relationship]] : [['Знакомые', state.network.professional_contacts], ['Наставники', state.network.mentors], ['Социальность', state.lifestyle.social]]).map(([title, value]) => <div className="life-v2-person" key={title}><span>{String(title).slice(0, 1)}</span><div><strong>{title}</strong><small>Ваши связи</small><div className="life-v2-track"><i style={{ width: `${Math.min(100, Number(value) * (['Семья', 'Отношения', 'Социальность'].includes(String(title)) ? 1 : 10))}%` }} /></div></div><b>{value}</b></div>)}
    <div className="life-v2-note"><strong>Не теряй связи</strong><p>Долгое отсутствие общения постепенно снижает близость.</p></div>
    <Section title="Найти время" />
    {catalog.expansion.social.filter(item => peopleKind === 'contacts' ? item.contacts > 0 : item.family > 0 || item.friends > 0 || item.relationship > 0).map(item => {
      const romanceLocked = item.id === 'date' && state.lifestyle.social < 20 || item.id === 'weekend_together' && (state.lifestyle.social < 20 || state.network.relationship < 15)
      const lock = romanceLocked ? 'Развивайте социальность и близость' : state.cash < item.cost ? `Не хватает ${money(item.cost - state.cash)}` : state.energy < 10 || state.hunger < 10 ? 'Сначала восстановите силы и сытость' : ''
      return <GameOption key={item.id} title={item.title} description={item.description} meta={`${item.cost ? money(item.cost) : 'Бесплатно'} · сразу`} hint={lock || undefined} button="Начать" disabled={blocked || Boolean(lock)} onClick={() => act('social', item.id, () => navigate('home'))} />
    })}
  </div>

  if (screen === 'shop') {
    const assets = catalog.expansion.assets.filter(item => item.category === shopKind)
    return <div className="life-v2-page">
      {status}
      <Segments value={shopKind} onChange={setShopKind} choices={[[ 'device', 'Техника' ], [ 'wardrobe', 'Одежда' ], [ 'transport', 'Транспорт' ]]} />
      <div className="life-v2-summary life-v2-summary--balance"><span>Доступно</span><h2>{money(state.cash)}</h2><Icon name="coins" /></div>
      <Section title={shopKind === 'device' ? 'Техника' : shopKind === 'wardrobe' ? 'Одежда' : 'Транспорт'} />
      {shopKind === 'wardrobe' && <div className="life-v2-shop-row"><span className="life-v2-skin"><img src={characterImage('casual')} alt="Повседневная одежда" /></span><div><strong>Повседневный образ</strong><small>Базовая одежда героя</small><b>Бесплатно</b></div><button type="button" disabled={blocked || wardrobeType(state) === 'casual'} onClick={() => act('wardrobe_equip', 'casual')}>{wardrobeType(state) === 'casual' ? 'Надето' : 'Надеть'}</button></div>}
      {assets.map(item => {
        const owned = state.lifestyle.assets.includes(item.id)
        const wardrobe = shopKind === 'wardrobe'
        const outfit = item.id === 'capsule_wardrobe' ? 'capsule' : item.id === 'business_wardrobe' ? 'business' : 'executive'
        const equipped = wardrobe && wardrobeType(state) === outfit
        const affordable = state.cash >= item.cost
        return <div className="life-v2-shop-row" key={item.id}>
          <span className={wardrobe ? 'life-v2-skin' : undefined}>{wardrobe ? <img src={characterImage(outfit)} alt={item.title} loading="lazy" /> : <Icon name="shop" />}</span>
          <div><strong>{item.title}</strong><small>{item.description}</small><b>{owned ? wardrobe ? 'В вашем гардеробе' : 'Куплено' : money(item.cost)}</b></div>
          <button type="button" disabled={blocked || (owned && !wardrobe) || equipped || (!owned && !affordable)} onClick={() => act(owned ? 'wardrobe_equip' : 'asset_buy', item.id)}>{equipped ? 'Надето' : owned ? wardrobe ? 'Надеть' : 'Куплено' : affordable ? 'Купить' : 'Не хватает'}</button>
        </div>
      })}
      {!assets.length && <div className="life-v2-note">В этой категории пока нет предметов.</div>}
      <button type="button" className="life-v2-secondary" onClick={() => detail('social')}>Смотреть все предметы</button>
    </div>
  }

  if (screen === 'more') return <div className="life-v2-page">
    {status}
    <div className="life-v2-summary life-v2-summary--accent"><span>ЭТАП {level?.era ?? 1}</span><h2>{level?.era_title ?? 'Начало пути'}</h2><p>{level?.era_description ?? 'Постройте свою жизнь с нуля'}</p></div>
    <div className="life-v2-actions">
      <ActionTile icon="coins" title="Финансы" subtitle="Резерв, кредит, инвестиции" onClick={() => detail('finance')} />
      <ActionTile icon="work" title="Бизнес" subtitle="Компания, продукты, рынки" onClick={() => detail('business')} />
      <ActionTile icon="people" title="Увлечения" subtitle="Форма, стресс, занятия" onClick={() => detail('social')} />
      <ActionTile icon="profile" title="Путь жизни" subtitle="Цели, сюжет, открытия" onClick={() => detail('journey')} />
    </div>
    <Section title="Личный капитал" />
    <div className="life-v2-facts"><div><span>Наличные</span><strong>{money(state.cash)}</strong></div><div><span>Резерв</span><strong>{money(state.finance.savings)}</strong></div><div><span>Инвестиции</span><strong>{money(Object.values(state.finance.portfolio).reduce((sum, value) => sum + value, 0))}</strong></div><div><span>Долг</span><strong>{money(state.debt)}</strong></div><div><span>Всего заработано</span><strong>{money(state.total_earned)}</strong></div></div>
    {state.company && <div className="life-v2-summary"><span>ВАША КОМПАНИЯ</span><h2>{catalog.business_tiers.find(tier => tier.level === state.company?.tier)?.title ?? 'Компания'}</h2><p>{state.company.staff.toLocaleString('ru-RU')} сотрудников · капитал {money(state.company.cash)}</p></div>}
    <div className="life-v2-note"><strong>Ждать ради прогресса больше не нужно</strong><p>Обычные действия двигают игровой календарь сразу. Учёба и крупные проекты идут фоном и ускоряются, пока вы продолжаете играть.</p></div>
  </div>

  return <div className="life-v2-page">
    {status}
    <div className="life-v2-profile"><div className="life-v2-avatar"><img src={characterImage(wardrobeType(state))} alt="Портрет героя" /></div><div><h2>Ваш герой</h2><p>{age} лет · {state.career?.title ?? 'Безработный'}</p><span>Уровень жизни {level?.level ?? 1}</span></div><div className="life-v2-track"><i style={{ width: `${level?.progress ?? 0}%` }} /></div><small>{level?.xp.toLocaleString('ru-RU') ?? 0} / {level?.next_level_xp.toLocaleString('ru-RU') ?? '—'} XP</small></div>
    <Section title="Характеристики" />
    <div className="life-v2-skill-card">{(Object.keys(skillLabels) as (keyof Skills)[]).map(key => <div key={key}><span>{skillLabels[key]}</span><strong>{state.skills[key]}</strong><div className="life-v2-track"><i style={{ width: `${state.skills[key]}%` }} /></div></div>)}</div>
    <Section title="Карьерный путь" />
    <div className="life-v2-summary"><span>{state.career?.title ?? 'Старт'}</span><h2>{state.career ? 'Следующая карьерная ступень' : 'Специалист → Руководитель → CEO'}</h2><p>Следующая ступень зависит от опыта, образования и навыков.</p><div className="life-v2-track"><i style={{ width: `${Math.min(100, state.experience)}%` }} /></div></div>
    <button type="button" className="life-v2-secondary" onClick={() => detail('journey')}>Открыть весь путь</button>
    <Section title="Достижения" aside={`${view.milestones.filter(item => item.done).length} / ${view.milestones.length}`} />
    <div className="life-v2-journal">{view.milestones.filter(item => item.done).slice(-5).map(item => <div key={item.id}><strong>✓ {item.title}</strong><p>{item.description}</p></div>)}{!view.milestones.some(item => item.done) && <div><strong>Ваши достижения впереди</strong><p>Первый заработок, образование и новые знакомства постепенно откроют следующие этапы.</p></div>}</div>
    <button type="button" className="life-v2-secondary" onClick={() => navigate('more')}>Финансы, бизнес и увлечения</button>
  </div>
}
