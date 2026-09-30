import { useMemo, useState } from 'react'
import type {
  AssetOption,
  CareerOption,
  LifeView,
  Skills,
} from './lifeTypes'
import { LifeGlyph, MarketMap, VehicleIllustration } from './life/LifeArt'

type Act = (action: string, target?: string) => void | Promise<void>

function money(value: number) {
  return Math.round(value).toLocaleString('ru-RU') + ' ₽'
}

const educationNames = ['Школа', 'Колледж', 'Бакалавриат', 'Магистратура', 'Executive MBA']
const skillNames: Record<keyof Skills, string> = {
  discipline: 'Дисциплина',
  communication: 'Общение',
  digital: 'Digital',
  finance: 'Финансы',
  management: 'Управление',
}
const trackNames: Record<string, string> = {
  operations: 'Операции',
  tech: 'IT',
  data: 'Аналитика',
  sales: 'Продажи',
  finance: 'Финансы',
  management: 'Менеджмент',
}
const economyNames: Record<string, string> = {
  normal: 'Нормальный рынок',
  growth: 'Рост',
  boom: 'Бум',
  slowdown: 'Замедление',
  recession: 'Рецессия',
}

function missingSkills(have: Skills, need: Skills) {
  return (Object.keys(need) as (keyof Skills)[])
    .filter((key) => (need[key] ?? 0) > (have[key] ?? 0))
    .map((key) => skillNames[key] + ' ' + need[key])
}

function careerLock(view: LifeView, role: CareerOption) {
  const state = view.state
  const missing: string[] = []
  if (view.level && view.level.level < (role.min_level ?? 0)) missing.push('уровень жизни ' + role.min_level)
  if (state.education < role.min_education) missing.push(educationNames[role.min_education] ?? 'образование')
  if (state.experience < role.min_experience) missing.push('опыт ' + role.min_experience)
  if (state.reputation < role.min_reputation) missing.push('репутация ' + role.min_reputation)
  missing.push(...missingSkills(state.skills, role.min_skills))
  return missing.join(' · ')
}

function SectionHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="life-section-title">
      <h2>{title}</h2>
      {aside && <span>{aside}</span>}
    </div>
  )
}

function Meter({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const tone = inverse ? (value >= 80 ? 'danger' : value >= 55 ? 'warning' : 'ok') : value <= 20 ? 'danger' : value <= 45 ? 'warning' : 'ok'
  return (
    <div className="life-stat">
      <div className="life-stat__line"><span>{label}</span><strong>{value}</strong></div>
      <div className="life-meter" data-tone={tone}><i style={{ width: value + '%' }} /></div>
    </div>
  )
}

export function CareerPanel({
  view,
  blocked,
  act,
}: {
  view: LifeView
  blocked: boolean
  act: Act
}) {
  const [track, setTrack] = useState('all')
  const { state } = view
  const careers = view.catalog.expansion.careers
  const visible = track === 'all' ? careers : careers.filter((role) => role.track === track)

  return (
    <>
      {state.career && (
        <section className="life-card life-career-current">
          <SectionHead title="Постоянная работа" aside={state.career.employer} />
          <div className="life-career-current__main">
            <div>
              <span>{trackNames[state.career.track] ?? state.career.track}</span>
              <h3>{state.career.title}</h3>
              <p>{money(state.career.salary)} до игрового налога · {state.career.months} мес. в должности</p>
            </div>
            <strong>{state.career.performance}/100</strong>
          </div>
          <div className="life-stats-grid">
            <Meter label="Результативность" value={state.career.performance} />
            <Meter label="Стабильность" value={state.career.stability} />
          </div>
          <div className="life-inline-actions">
            <button type="button" disabled={blocked} onClick={() => void act('career_work')}>
              Отработать месяц
            </button>
            <button type="button" className="is-muted" disabled={blocked} onClick={() => void act('career_quit')}>
              Уволиться
            </button>
          </div>
        </section>
      )}

      <section className="life-card">
        <SectionHead title="Карьерный рынок" aside={state.career ? 'Можно сменить работу' : 'Найдите первую должность'} />
        <p className="life-section-note">
          Собеседование не гарантирует оффер. Шансы растут от опыта, репутации, связей, состояния и подходящего имущества.
        </p>
        <div className="life-filter-row">
          <button type="button" aria-pressed={track === 'all'} onClick={() => setTrack('all')}>Все</button>
          {Object.entries(trackNames).map(([id, label]) => (
            <button type="button" aria-pressed={track === id} onClick={() => setTrack(id)} key={id}>{label}</button>
          ))}
        </div>
        <div className="life-career-list">
          {visible.length === 0 && <div className="life-empty-track">Пока нет доступных должностей. Попробуйте подработки и учёбу или выберите карьерное направление.</div>}
          {visible.map((role) => {
            const lock = careerLock(view, role)
            const current = state.career?.role_id === role.id
            return (
              <article className="life-market-row life-career-step" data-state={current ? 'current' : lock ? 'locked' : 'available'} key={role.id}>
                <span className="life-career-step__mark" aria-hidden="true">{current ? '✓' : role.track === 'tech' ? '⌘' : '•'}</span>
                <div>
                  <span>{trackNames[role.track] ?? role.track}</span>
                  <strong>{role.title}</strong>
                  <p>{role.description}</p>
                  <small>{money(role.salary)}/мес · собеседование решается сразу</small>
                  {lock && <em>{lock}</em>}
                </div>
                <button
                  type="button"
                  disabled={blocked || Boolean(lock) || current}
                  onClick={() => void act('career_apply', role.id)}
                >
                  {current ? 'Работаете' : 'Откликнуться'}
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}

export function FinancePanel({
  view,
  blocked,
  act,
}: {
  view: LifeView
  blocked: boolean
  act: Act
}) {
  const { state } = view
  const portfolioTotal = Object.values(state.finance.portfolio).reduce((sum, value) => sum + value, 0)
  const founderEquity = state.company
    ? state.company.valuation * Math.max(0, state.company.ownership || 100) / 100
    : 0
  const net = state.cash + state.finance.savings + portfolioTotal + founderEquity - state.debt

  return (
    <>
      <section className="life-card">
        <SectionHead title="Личные финансы" aside={'Капитал ' + money(net)} />
        <div className="life-facts">
          <div><span>Наличные</span><strong>{money(state.cash)}</strong></div>
          <div><span>Резерв</span><strong>{money(state.finance.savings)}</strong></div>
          <div><span>Портфель</span><strong>{money(portfolioTotal)}</strong></div>
          <div><span>Кредитный рейтинг</span><strong>{state.finance.credit_score}</strong></div>
        </div>
        <p className="life-section-note life-finance-note">
          Последний результат портфеля: {state.finance.last_return >= 0 ? '+' : ''}{money(state.finance.last_return)} · уплачено игровых налогов {money(state.finance.taxes_paid)}.
        </p>
        <div className="life-money-actions">
          {[1000, 10000, 100000, 1000000].map((amount) => (
            <button type="button" disabled={blocked || state.cash < amount} onClick={() => void act('finance_save', String(amount))} key={'s'+amount}>
              В резерв {amount >= 1_000_000 ? '1 млн' : amount / 1000 + ' тыс.'}
            </button>
          ))}
          {[1000, 10000, 100000].map((amount) => (
            <button type="button" className="is-muted" disabled={blocked || state.finance.savings < amount} onClick={() => void act('finance_withdraw', String(amount))} key={'w'+amount}>
              Снять {amount / 1000} тыс.
            </button>
          ))}
        </div>
      </section>

      <section className="life-card">
        <SectionHead title="Инвестиционный портфель" aside={'Финансы ' + state.skills.finance} />
        <p className="life-section-note">
          Доходность не гарантирована: чем выше риск, тем сильнее колебания при прохождении игровых дней.
        </p>
        {view.catalog.expansion.investments.map((item) => {
          const holding = state.finance.portfolio[item.id] ?? 0
          const locked = state.skills.finance < item.min_finance
          return (
            <article className="life-market-row life-investment-row" key={item.id}>
              <div>
                <span>Риск {item.risk}/10 · ориентир {(item.return_bps / 100).toFixed(1)}%/год</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                {holding > 0 && <small>В портфеле: {money(holding)}</small>}
                {locked && <em>Нужны финансы {item.min_finance}</em>}
              </div>
              <div className="life-stack-actions">
                <button
                  type="button"
                  disabled={blocked || locked || state.cash < item.min_amount}
                  onClick={() => void act('finance_invest', item.id + ':' + item.min_amount)}
                >
                  +{money(item.min_amount)}
                </button>
                {holding > 0 && (
                  <button type="button" className="is-muted" disabled={blocked} onClick={() => void act('finance_sell', item.id)}>
                    Продать
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>

      <section className="life-card">
        <SectionHead title="Кредит и защита" aside={'Долг ' + money(state.debt)} />
        <div className="life-credit-grid">
          <div>
            <strong>Личный кредит</strong>
            <p>Лимит зависит от кредитного рейтинга и опыта. Непогашенный долг растёт по игровым месяцам.</p>
            <div className="life-money-actions">
              {[20000, 100000, 500000, 2000000].map((amount) => (
                <button type="button" disabled={blocked} onClick={() => void act('finance_loan', String(amount))} key={amount}>
                  {money(amount)}
                </button>
              ))}
              {state.debt > 0 && (
                <button type="button" className="is-muted" disabled={blocked || state.cash <= 0} onClick={() => void act('repay_debt')}>
                  Погасить доступное
                </button>
              )}
            </div>
          </div>
          <div>
            <strong>Страхование</strong>
            <p>Снижает часть личных финансовых потерь от неприятных случайных событий.</p>
            <div className="life-money-actions">
              {[1,2,3].map((level) => (
                <button type="button" disabled={blocked || state.finance.insurance >= level} onClick={() => void act('insurance_buy', String(level))} key={level}>
                  {state.finance.insurance >= level ? '✓ ' : ''}Уровень {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

export function CertificationPanel({
  view,
  blocked,
  act,
}: {
  view: LifeView
  blocked: boolean
  act: Act
}) {
  const { state } = view
  const [selectedId, setSelectedId] = useState(view.catalog.expansion.certifications[0]?.id ?? '')
  const selected = view.catalog.expansion.certifications.find((item) => item.id === selectedId) ?? view.catalog.expansion.certifications[0]
  const done = selected ? state.lifestyle.credentials.includes(selected.id) : false
  const running = Boolean(selected && state.projects?.some((item) => item.kind === 'certification' && item.target === selected.id))
  const backgroundFull = (state.projects?.length ?? 0) >= 3
  const skills = selected ? missingSkills(state.skills, selected.min_skills) : []
  const locked = selected ? state.education < selected.min_education || skills.length > 0 : true
  return (
    <section className="life-card life-cert-board">
      <SectionHead title="Профессиональные квалификации" aside={state.lifestyle.credentials.length + ' получено'} />
      <p className="life-section-note">
        Это короткие прикладные траектории между большими ступенями образования. Они усиливают навыки и немного повышают шансы на оффер.
      </p>
      <div className="life-cert-grid">
        {view.catalog.expansion.certifications.map((item) => {
          const owned = state.lifestyle.credentials.includes(item.id)
          const inProgress = Boolean(state.projects?.some((project) => project.kind === 'certification' && project.target === item.id))
          const unavailable = state.education < item.min_education || missingSkills(state.skills, item.min_skills).length > 0
          return <button key={item.id} type="button" aria-pressed={selected?.id === item.id} data-state={owned ? 'done' : inProgress ? 'running' : unavailable ? 'locked' : 'available'} onClick={() => setSelectedId(item.id)}>
            <LifeGlyph name={item.id} size={23}/><strong>{item.title}</strong><span>{owned ? '✓ Получено' : inProgress ? 'В фоне' : unavailable ? 'Закрыто' : 'Доступно'}</span>
          </button>
        })}
      </div>
      {selected && <div className="life-cert-detail">
        <h3>{selected.title}</h3><p>{selected.description}</p><small>Идёт в фоне · {selected.game_days} игровых дней истории</small>
        {running ? <em>Квалификация уже изучается в фоне — остальные действия доступны.</em> : locked ? <em>{state.education < selected.min_education ? 'Нужно образование: ' + educationNames[selected.min_education] : skills.join(' · ')}</em> : backgroundFull && !done ? <em>Заняты все три фоновых слота.</em> : null}
        <div><b>{done ? 'Получено' : money(selected.cost)}</b><button type="button" disabled={blocked || done || running || backgroundFull || locked || state.cash < selected.cost} onClick={() => void act('certification', selected.id)}>{done ? '✓' : running ? 'Идёт' : 'Начать'}</button></div>
      </div>}
    </section>
  )
}

function ownedAsset(view: LifeView, asset: AssetOption) {
  return view.state.lifestyle.assets.includes(asset.id)
}

export function LifestylePanel({
  view,
  blocked,
  act,
}: {
  view: LifeView
  blocked: boolean
  act: Act
}) {
  const { state } = view
  const groupedAssets = useMemo(() => {
    const groups: Record<string, AssetOption[]> = {}
    for (const asset of view.catalog.expansion.assets) {
      ;(groups[asset.category] ??= []).push(asset)
    }
    return groups
  }, [view.catalog.expansion.assets])

  return (
    <>
      <section className="life-card">
        <SectionHead title="Баланс жизни" aside={'Серия привычек ' + state.lifestyle.habit_streak} />
        <div className="life-social-portrait" aria-hidden="true"><span>Близкие</span><div><i /><i /><i /></div><strong>{state.network.friends} друзей · {state.network.mentors} наставников</strong></div>
        <div className="life-stats-grid">
          <Meter label="Стресс" value={state.lifestyle.stress} inverse />
          <Meter label="Форма" value={state.lifestyle.fitness} />
          <Meter label="Социальность" value={state.lifestyle.social} />
          <Meter label="Комфорт" value={state.lifestyle.comfort} />
        </div>
        <div className="life-network-grid">
          <div><span>Друзья</span><strong>{state.network.friends}</strong></div>
          <div><span>Деловые контакты</span><strong>{state.network.professional_contacts}</strong></div>
          <div><span>Наставники</span><strong>{state.network.mentors}</strong></div>
          <div><span>Связь с близкими</span><strong>{state.network.family_bond}/100</strong></div>
        </div>
      </section>

      <section className="life-card">
        <SectionHead title="Жизнь вне работы" aside="Не всё решается деньгами" />
        {view.catalog.expansion.hobbies.map((hobby) => (
          <article className="life-market-row" key={hobby.id}>
            <LifeGlyph name="health" />
            <div>
              <strong>{hobby.title}</strong>
              <p>{hobby.description}</p>
              <small>
                Сразу · стресс {hobby.stress_change > 0 ? '+' : ''}{hobby.stress_change}
                {hobby.fitness_change ? ' · форма +' + hobby.fitness_change : ''}
                {hobby.social_change ? ' · общение +' + hobby.social_change : ''}
              </small>
            </div>
            <div className="life-stack-actions">
              <b>{hobby.cost ? money(hobby.cost) : 'Бесплатно'}</b>
              <button type="button" disabled={blocked || state.cash < hobby.cost} onClick={() => void act('hobby', hobby.id)}>
                Заняться
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="life-card">
        <SectionHead title="Социальная жизнь" aside={'Отношения ' + state.network.relationship + '/100'} />
        <p className="life-section-note">
          Друзья, близкие, свидания и профессиональные связи занимают время. Игнорировать этот слой выгодно только на очень короткой дистанции.
        </p>
        {view.catalog.expansion.social.map((item) => {
          const romanceLocked =
            item.id === 'date'
              ? state.lifestyle.social < 20
              : item.id === 'weekend_together'
                ? state.lifestyle.social < 20 || state.network.relationship < 15
                : false
          return (
            <article className="life-market-row" key={item.id}>
              <LifeGlyph name="people" />
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <small>
                  Сразу
                  {item.friends ? ' · друзья +' + item.friends : ''}
                  {item.contacts ? ' · контакты +' + item.contacts : ''}
                  {item.family ? ' · близкие +' + item.family : ''}
                  {item.relationship ? ' · отношения +' + item.relationship : ''}
                </small>
                {romanceLocked && <em>{item.id === 'weekend_together' ? 'Нужна социальность 20 и отношения 15' : 'Нужна социальность 20'}</em>}
              </div>
              <div className="life-stack-actions">
                <b>{item.cost ? money(item.cost) : 'Бесплатно'}</b>
                <button type="button" disabled={blocked || romanceLocked || state.cash < item.cost} onClick={() => void act('social', item.id)}>
                  Выбрать
                </button>
              </div>
            </article>
          )
        })}
      </section>

      {Object.entries(groupedAssets).map(([category, assets]) => (
        <section className="life-card" key={category}>
          <SectionHead
            title={category === 'device' ? 'Техника' : category === 'transport' ? 'Транспорт' : 'Гардероб'}
            aside={assets.filter((asset) => ownedAsset(view, asset)).length + '/' + assets.length}
          />
          {category === 'transport' && <VehicleIllustration assets={state.lifestyle.assets} size="wide" />}
          {assets.map((asset) => {
            const owned = ownedAsset(view, asset)
            return (
              <article className="life-market-row" data-state={owned ? 'done' : 'available'} key={asset.id}>
                <LifeGlyph name={category} />
                <div>
                  <strong>{asset.title}</strong>
                  <p>{asset.description}</p>
                  <small>
                    {asset.energy_bonus ? 'энергия +' + asset.energy_bonus + ' · ' : ''}
                    {asset.work_bonus ? 'карьера +' + asset.work_bonus + ' · ' : ''}
                    {asset.status_bonus ? 'статус +' + asset.status_bonus : ''}
                  </small>
                </div>
                <div className="life-stack-actions">
                  <b>{money(asset.cost)}</b>
                  <button type="button" disabled={blocked || (owned && category !== 'wardrobe') || (owned && category === 'wardrobe' && state.lifestyle.equipped_wardrobe === asset.id) || (!owned && state.cash < asset.cost)} onClick={() => void act(owned ? 'wardrobe_equip' : 'asset_buy', asset.id)}>
                    {owned ? category === 'wardrobe' ? state.lifestyle.equipped_wardrobe === asset.id ? 'Надето' : 'Надеть' : 'Куплено' : 'Купить'}
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      ))}
    </>
  )
}

export function WorldPanel({ view }: { view: LifeView }) {
  const { economy } = view.state
  return (
    <section className="life-card life-world">
      <SectionHead title="Экономика мира" aside={economyNames[economy.phase] ?? economy.phase} />
      <div className="life-facts">
        <div><span>Рыночный индекс</span><strong>{economy.market_index}</strong></div>
        <div><span>Игровая инфляция</span><strong>{economy.inflation}%</strong></div>
        <div><span>Фаза цикла</span><strong>{economyNames[economy.phase] ?? economy.phase}</strong></div>
        <div><span>Следующий пересмотр</span><strong>{Math.max(0, 90 - (view.state.days - economy.last_day))} дн.</strong></div>
      </div>
    </section>
  )
}

export function BusinessExpansionPanel({
  view,
  blocked,
  act,
  section,
}: {
  view: LifeView
  blocked: boolean
  act: Act
  section: 'structure' | 'products' | 'markets' | 'finance'
}) {
  const company = view.state.company
  if (!company) return null

  const projects = view.state.projects ?? []
  const backgroundFull = projects.length >= 3
  const industry = view.catalog.expansion.industries.find((item) => item.id === company.industry)
  const launched = new Map(company.products.map((item) => [item.id, item]))
  const ipoLevel = view.story?.choices?.ipo_question === 'private' ? 96 : 90
  const ipoRequirements = [
    view.level && view.level.level < ipoLevel ? `уровень жизни ${ipoLevel}` : '',
    company.tier < 6 ? 'ступень компании 6' : '',
    company.brand < 72 ? 'бренд 72' : '',
    (company.departments.finance ?? 0) < 5 ? 'отдел финансов 5' : '',
    (company.departments.legal ?? 0) < 4 ? 'юридический отдел 4' : '',
  ].filter(Boolean).join(' · ')

  return (
    <>
      {section === 'structure' && <>
      <section className="life-card">
        <SectionHead title="Корпоративная система" aside={industry?.title ?? 'Отрасль не выбрана'} />
        <div className="life-facts">
          <div><span>Стоимость</span><strong>{money(company.valuation)}</strong></div>
          <div><span>Доля рынка</span><strong>{company.market_share}/100</strong></div>
          <div><span>Инновации</span><strong>{company.innovation}/100</strong></div>
          <div><span>Долг</span><strong>{money(company.debt)}</strong></div>
        </div>
        <p className="life-section-note life-finance-note">
          {company.public ? 'Публичная компания' : 'Частная компания'} · доля основателя {company.ownership}% · рынков {company.regions.length}.
        </p>
      </section>

      <section className="life-card">
        <SectionHead title="Отрасль" aside="В начале её ещё можно поменять" />
        <div className="life-industry-grid">
          {view.catalog.expansion.industries.map((item) => (
            <button
              type="button"
              aria-pressed={company.industry === item.id}
              disabled={blocked || company.industry === item.id || company.tier > 2 || company.cash < item.entry_cost}
              onClick={() => void act('business_industry', item.id)}
              key={item.id}
            >
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              <small>{item.entry_cost ? money(item.entry_cost) : 'Без доплаты'} · риск {item.volatility}/10</small>
            </button>
          ))}
        </div>
      </section>

      <section className="life-card">
        <SectionHead title="Отделы компании" aside="Уровни 0–10" />
        <p className="life-section-note">Отделы напрямую меняют риск, бренд, инновации, продукты, международное развитие и доступ к финансированию.</p>
        <div className="life-department-list">
          {view.catalog.expansion.departments.map((item) => {
            const level = company.departments[item.id] ?? 0
            const cost = item.base_cost * (level + 1) * (level + 1) * Math.max(1, company.tier)
            return (
              <article key={item.id}>
                <LifeGlyph name={item.id} />
                <div>
                  <span>Уровень {level}/10</span>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <button type="button" disabled={blocked || level >= 10 || company.cash < cost} onClick={() => void act('business_department', item.id)}>
                  {level >= 10 ? 'MAX' : money(cost)}
                </button>
              </article>
            )
          })}
        </div>
      </section>
      </>}

      {section === 'products' &&
      <section className="life-card">
        <SectionHead title="Продукты" aside={company.products.length + ' запущено'} />
        {view.catalog.expansion.products.map((item) => {
          const existing = launched.get(item.id)
          const running = projects.some((project) => project.kind === 'business_product' && project.target === item.id)
          const locked = company.tier < item.min_tier || company.innovation < item.innovation_need
          return (
            <article className="life-market-row" data-state={existing ? 'done' : locked ? 'locked' : 'available'} key={item.id}>
              <LifeGlyph name={item.id} />
              <div>
                <span>Уровень компании {item.min_tier}+ · инновации {item.innovation_need}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <small>Разработка идёт в фоне · потенциал {money(item.base_revenue)}</small>
                {existing && <em>Запущен: {existing.last_result} · {money(existing.revenue)}/цикл · качество {existing.quality} · fit {existing.market_fit}</em>}
              </div>
              <div className="life-stack-actions">
                <b>{money(item.launch_cost)}</b>
                <button type="button" disabled={blocked || running || backgroundFull || locked || company.cash < item.launch_cost || (existing?.launches ?? 0) >= 5} onClick={() => void act('business_product', item.id)}>
                  {(existing?.launches ?? 0) >= 5 ? 'Лимит версий' : running ? 'Разработка идёт' : existing ? 'Новая версия' : 'Запустить'}
                </button>
              </div>
            </article>
          )
        })}
      </section>
      }

      {section === 'markets' &&
      <section className="life-card">
        <SectionHead title="География" aside={company.regions.length + ' рынков'} />
        <MarketMap regions={company.regions} catalog={view.catalog.expansion.regions} activeRegion={projects.find((project) => project.kind === 'business_region')?.target} />
        <div className="life-region-grid">
          {view.catalog.expansion.regions.map((region) => {
            const open = company.regions.includes(region.id)
            const running = projects.some((project) => project.kind === 'business_region' && project.target === region.id)
            const internationalNeed = Math.max(1, region.min_tier - 3)
            const locked =
              company.tier < region.min_tier ||
              company.brand < region.brand_need ||
              (company.departments.international ?? 0) < internationalNeed
            return (
              <button
                type="button"
                aria-pressed={open}
                disabled={blocked || open || running || backgroundFull || locked || company.cash < region.cost}
                onClick={() => void act('business_region', region.id)}
                key={region.id}
              >
                <strong>{region.title}</strong>
                <span>{region.description}</span>
                <small>{open ? 'Работаем' : running ? 'Выход идёт в фоне' : money(region.cost)} · бренд {region.brand_need}</small>
              </button>
            )
          })}
        </div>
      </section>
      }

      {section === 'finance' &&
      <section className="life-card">
        <SectionHead title="Корпоративные финансы" aside={money(company.debt)} />
        <div className="life-facts life-corporate-facts">
          <div><span>Стоимость</span><strong>{money(company.valuation)}</strong></div>
          <div><span>Доля основателя</span><strong>{company.ownership}%</strong></div>
          <div><span>Рынок</span><strong>{company.public ? 'Публичная' : 'Частная'}</strong></div>
          <div><span>В казне</span><strong>{money(company.cash)}</strong></div>
        </div>
        <div className="life-credit-grid">
          <div>
            <strong>Долговое финансирование</strong>
            <p>Доступно после создания финансового отдела. Лимит привязан к стоимости бизнеса.</p>
            <div className="life-money-actions">
              {[500000, 5000000, 50000000, 500000000].map((amount) => (
                <button type="button" disabled={blocked} onClick={() => void act('business_loan', String(amount))} key={amount}>
                  +{money(amount)}
                </button>
              ))}
              {company.debt > 0 && (
                <button
                  type="button"
                  className="is-muted"
                  disabled={blocked || company.cash <= 0}
                  onClick={() => void act('business_repay_loan', String(Math.min(company.debt, company.cash)))}
                >
                  Погасить долг
                </button>
              )}
            </div>
          </div>
          <div>
            <strong>Большие сделки</strong>
            <p>Поздняя игра: поглощения и публичный рынок капитала.</p>
            <div className="life-money-actions">
              <button type="button" disabled={blocked || company.tier < 5 || company.acquisitions >= 8} onClick={() => void act('business_acquire')}>
                {company.acquisitions >= 8 ? 'Лимит поглощений' : 'Купить компанию'}
              </button>
              <button type="button" disabled={blocked || company.public || Boolean(ipoRequirements)} onClick={() => void act('business_ipo')}>
                {company.public ? 'IPO завершено' : 'Подготовить IPO'}
              </button>
            </div>
            {!company.public && ipoRequirements && <p className="life-section-note">Для IPO: {ipoRequirements}</p>}
          </div>
        </div>
      </section>
      }
    </>
  )
}
