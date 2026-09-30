import { CheckControl } from '../../../frontend/src/ui/components/CheckControl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button as MaxButton, IconButton as MaxIconButton } from '@maxhub/max-ui'
import type { ReactNode } from 'react'
import { Discovery } from './Discovery'
import { Choice } from './Choice'
import { Dialog } from './Dialog'
import {
  api,
  readStorage,
  writeStorage,
  clearUserId,
  profilePhotoUrl,
  saveUserId,
  type ChatTarget,
  type Match,
  type Profile,
  type Session,
  type WeeklyStats,
} from './api'

type View = 'discover' | 'matches'
const datingResume = {
  view: 'discover' as View,
  matches: [] as Match[],
  matchesScrollTop: 0,
}
type Form = {
  goal: Profile['goal']
  religion: NonNullable<Profile['religion']>
  smoking: NonNullable<Profile['smoking']>
  drinking: NonNullable<Profile['drinking']>
  worldview: NonNullable<Profile['worldview']>
  interests: string[]
  show_gender: NonNullable<Profile['show_gender']>
  min_age: number
  max_age: number
  same_city_only: boolean
  verified_only: boolean
  is_paused: boolean
  adult_confirmed: boolean
}

const startForm: Form = {
  goal: 'date',
  religion: '',
  smoking: '',
  drinking: '',
  worldview: '',
  interests: [],
  show_gender: 'all',
  min_age: 18,
  max_age: 35,
  same_city_only: false,
  verified_only: false,
  is_paused: false,
  adult_confirmed: false,
}

function datingAgeBounds(age?: number) {
  const teen = typeof age === 'number' && age >= 16 && age < 18
  return {
    min: teen ? 16 : 18,
    max: teen ? 17 : 100,
    defaultMax: teen ? 17 : 35,
    teen,
  }
}

function formForAge(age?: number): Form {
  const bounds = datingAgeBounds(age)
  return {
    ...startForm,
    min_age: bounds.min,
    max_age: bounds.defaultMax,
  }
}

function fitAgeRange(form: Form, age?: number): Form {
  const bounds = datingAgeBounds(age)
  const minAge = Math.min(bounds.max, Math.max(bounds.min, form.min_age))
  const maxAge = Math.min(bounds.max, Math.max(minAge, form.max_age))
  return {
    ...form,
    min_age: minAge,
    max_age: maxAge,
    adult_confirmed: bounds.teen ? false : form.adult_confirmed,
  }
}

function formFromProfile(profile: Profile): Form {
  const bounds = datingAgeBounds(profile.age)
  return {
    goal: profile.goal,
    religion: profile.religion || '',
    smoking: profile.smoking || '',
    drinking: profile.drinking || '',
    worldview: profile.worldview || '',
    interests: profile.interests || [],
    show_gender: profile.show_gender || 'all',
    min_age: profile.min_age || bounds.min,
    max_age: profile.max_age || bounds.defaultMax,
    same_city_only: Boolean(profile.same_city_only),
    verified_only: Boolean(profile.verified_only),
    is_paused: Boolean(profile.is_paused),
    adult_confirmed: profile.age >= 18,
  }
}

const goals = {
  chat: 'Общение',
  date: 'Свидания',
  relationship: 'Отношения',
}
const genders: Record<string, string> = { man: 'Мужчина', woman: 'Женщина' }
const religions: Record<string, string> = {
  '': 'Не указано',
  orthodox: 'Православие',
  catholic: 'Католицизм',
  islam: 'Ислам',
  buddhism: 'Буддизм',
  judaism: 'Иудаизм',
  atheism: 'Атеизм',
  agnostic: 'Агностицизм',
  other: 'Другое',
}
const habits: Record<string, string> = {
  '': 'Не указано',
  no: 'Нет',
  sometimes: 'Иногда',
  yes: 'Да',
}
const worldviews: Record<string, string> = {
  '': 'Не указано',
  traditional: 'Традиционные',
  modern: 'Современные',
  balanced: 'Баланс',
  spiritual: 'Духовные',
  rational: 'Рациональные',
  no_label: 'Без ярлыков',
}
const interestPool = [
  'Музыка',
  'Кино',
  'Сериалы',
  'Игры',
  'Книги',
  'Путешествия',
  'Спорт',
  'Зал',
  'Бег',
  'Плавание',
  'Велосипед',
  'Прогулки',
  'Кофе',
  'Готовка',
  'Рестораны',
  'Фотография',
  'Искусство',
  'Театр',
  'Концерты',
  'Технологии',
  'Психология',
  'Животные',
  'Мемы',
  'Настолки',
]

const icons = import.meta.glob('./icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        maskImage: `url("${icons[`./icons/${name}.svg`]}")`,
        WebkitMaskImage: `url("${icons[`./icons/${name}.svg`]}")`,
      }}
      aria-hidden="true"
    />
  )
}

function Photo({
  profile,
  small = false,
  photoURL,
}: {
  profile: Profile
  small?: boolean
  photoURL: typeof profilePhotoUrl
}) {
  return profile.photo ? (
    <img
      className={small ? 'photo-small' : 'photo-large'}
      src={photoURL(profile.photo)}
      alt=""
    />
  ) : (
    <div className={small ? 'photo-small photo-empty' : 'photo-large photo-empty'}>
      {profile.name.slice(0, 1).toUpperCase()}
    </div>
  )
}

type Props = {
  request?: typeof api
  photoURL?: typeof profilePhotoUrl
  onBack?: () => void
  onProfile?: () => void
  onOpenChat?: (chatId: string) => void
  onMatchedProfile?: (profile: Match) => void
  sharedProfile?: ReactNode
  profileRevision?: string
  colorScheme?: 'light' | 'dark'
  unreadMatches?: number
  onMatchesRead?: () => void
}
export function App({
  request = api,
  photoURL = profilePhotoUrl,
  onBack,
  onProfile,
  onOpenChat,
  onMatchedProfile,
  colorScheme,
  sharedProfile,
  profileRevision,
  unreadMatches = 0,
  onMatchesRead,
}: Props = {}) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Form>(startForm)
  const [edit, setEdit] = useState(false)
  const [view, setView] = useState<View>(() => datingResume.view)
  const [cards, setCards] = useState<Profile[]>([])
  const [matches, setMatches] = useState<Match[]>(() => datingResume.matches)
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null)
  const [match, setMatch] = useState<Profile | null>(null)
  const [matchActions, setMatchActions] = useState<Match | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    action: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [report, setReport] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [theme] = useState(() => readStorage('dating-theme') || 'auto')
  const [history, setHistory] = useState<Profile[]>([])
  const [refresh, setRefresh] = useState(0)
  const [loadingCards, setLoadingCards] = useState(true)
  const [loadingMatches, setLoadingMatches] = useState(
    () => datingResume.view === 'matches' && datingResume.matches.length === 0,
  )
  const [authRetry, setAuthRetry] = useState(0)
  const previousRevision = useRef(profileRevision)
  const matchesScrollRef = useRef<HTMLDivElement>(null)
  const loadSession = useCallback(
    async (signal?: AbortSignal, preserveForm = false) => {
      const data = await request<Session>('/auth', 'POST', undefined, signal)
      if (signal?.aborted) {
        return
      }
      if (!onBack) {
        saveUserId(data.user_id)
      }
      setSession(data)
      setProfile(data.profile)
      if (preserveForm) {
        setForm((current) => fitAgeRange(current, data.source?.age))
      } else {
        setForm(data.profile ? formFromProfile(data.profile) : formForAge(data.source?.age))
      }
    },
    [request, onBack],
  )

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    const preserveForm = previousRevision.current !== profileRevision
    previousRevision.current = profileRevision
    void loadSession(controller.signal, preserveForm).catch((e) => {
      if (!controller.signal.aborted) {
        setError(e.message)
      }
    })
    return () => controller.abort()
  }, [loadSession, onBack, authRetry, profileRevision])

  useEffect(() => {
    if (colorScheme) {
      return
    }
    const dark =
      theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    writeStorage('dating-theme', theme)
    window.dispatchEvent(new Event('dating-theme-change'))
  }, [theme, colorScheme])

  useEffect(() => {
    if (!profile || profile.is_paused || view !== 'discover') {
      return
    }
    const controller = new AbortController()

    setLoadingCards(cards.length === 0)
    request<Profile[]>('/discover', 'GET', undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) {
          return
        }
        const next = value
        setCards((current) => {
          const active = next.find((item) => item.user_id === current[0]?.user_id)
          return active ? [active, ...next.filter((item) => item.user_id !== active.user_id)] : next
        })
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingCards(false)
        }
      })
    return () => controller.abort()
  }, [profile, view, refresh, request])

  useEffect(() => {
    if (!profile || view !== 'matches') {
      return
    }
    const controller = new AbortController()
    setLoadingMatches(datingResume.matches.length === 0)
    request<Match[]>('/matches', 'GET', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setMatches(value)
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingMatches(false)
        }
      })
    return () => controller.abort()
  }, [profile, view, refresh, request])

  useEffect(() => {
    datingResume.view = view
  }, [view])

  useEffect(() => {
    datingResume.matches = matches
  }, [matches])

  useEffect(() => {
    if (view !== 'matches' || loadingMatches) {
      return
    }
    const element = matchesScrollRef.current
    if (!element) {
      return
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTop = datingResume.matchesScrollTop
    })
    return () => cancelAnimationFrame(frame)
  }, [view, loadingMatches, matches.length])

  useEffect(() => {
    if (!profile) {
      setWeeklyStats(null)
      return
    }
    const controller = new AbortController()
    request<WeeklyStats>('/stats', 'GET', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setWeeklyStats(value)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWeeklyStats(null)
        }
      })
    return () => controller.abort()
  }, [profile, refresh, request])

  useEffect(() => {
    if (view === 'matches' && unreadMatches > 0) {
      onMatchesRead?.()
    }
  }, [view, unreadMatches, onMatchesRead])

  useEffect(() => {
    const resume = () => {
      if (!document.hidden) {
        setRefresh((value) => value + 1)
      }
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('kutezh:dating-updated', resume)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('kutezh:dating-updated', resume)
    }
  }, [])

  function field<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((old) => ({ ...old, [key]: value }))
  }

  function toggleInterest(value: string) {
    setForm((old) => {
      const exists = old.interests.includes(value)
      if (exists) {
        return { ...old, interests: old.interests.filter((x) => x !== value) }
      }
      if (old.interests.length >= 8) {
        return old
      }
      return { ...old, interests: [...old.interests, value] }
    })
  }

  async function saveProfile() {
    setError('')
    setBusy(true)
    try {
      const data = await request<Profile>('/me', 'PUT', form)
      setProfile(data)
      setForm(formFromProfile(data))
      setEdit(false)
      setView('discover')
      setCards([])
      setHistory([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function swipe(kind: 'like' | 'pass') {
    const card = cards[0]
    if (!card || busy) {
      return false
    }
    const animate = new Promise<void>((resolve) =>
      setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240),
    )
    setBusy(true)
    setError('')
    try {
      const [result] = await Promise.all([
        request<{
          match: boolean
          match_id?: number
          friends_ready: boolean
        }>('/swipe', 'POST', { user_id: card.user_id, kind }),
        animate,
      ])
      setHistory((old) => (result.match || result.match_id ? [] : [...old.slice(-49), card]))
      setCards((old) => old.filter((item) => item.user_id !== card.user_id))
      if (cards.length === 1) {
        setRefresh((value) => value + 1)
      }
      if (result.match) {
        setMatch(card)
        if (!result.friends_ready) {
          setError(
            'Симпатия сохранена, но общую дружбу создать не удалось. Добавьте человека в друзья в социальной сети.',
          )
        }
      }
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    const previous = history.at(-1)
    if (!previous || busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const restored = await request<Profile>('/swipe/undo', 'POST', { user_id: previous.user_id })
      setCards((old) => [restored, ...old.filter((x) => x.user_id !== restored.user_id)])
      setHistory((old) => old.slice(0, -1))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function block(person: Profile) {
    await request(`/block/${person.user_id}`, 'POST')
    setCards((old) => old.filter((x) => x.user_id !== person.user_id))
    setMatches((old) => old.filter((x) => x.user_id !== person.user_id))
    setReport(null)
    setRefresh((value) => value + 1)
  }

  async function sendReport(reason: string) {
    if (!report) {
      return
    }
    try {
      await request('/report', 'POST', { user_id: report.user_id, reason })
      setCards((old) => old.filter((x) => x.user_id !== report.user_id))
      setMatches((old) => old.filter((x) => x.user_id !== report.user_id))
      setReport(null)
      setRefresh((value) => value + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function openMatchChat(person: Match) {
    setError('')
    try {
      const target = await request<ChatTarget>(`/matches/${person.match_id}/chat`)
      const chatId = target.max_chat_id
      if (!/^[1-9]\d{0,18}$/.test(chatId)) {
        throw new Error('MAX чат пока недоступен')
      }
      if (onOpenChat) {
        onOpenChat(chatId)
        return
      }
      const max = (
        window as unknown as {
          WebApp?: {
            platform?: string
            openLink?: (url: string) => void
            close?: () => void
            openMaxLink?: (url: string) => void
          }
        }
      ).WebApp
      if (max?.platform !== 'web' && max?.openLink) {
        max.openLink(`max://chat/id/${chatId}`)
        max.close?.()
        return
      }
      if (max?.openMaxLink) {
        max.openMaxLink(`https://max.ru/${chatId}`)
        return
      }
      window.open(`https://web.max.ru/${chatId}`, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function unmatch(person: Match) {
    await request<{ ok: boolean }>(`/matches/${person.match_id}`, 'DELETE')
    setMatches((current) => current.filter((item) => item.match_id !== person.match_id))
    setMatchActions(null)
    setRefresh((value) => value + 1)
  }

  async function removeAccount() {
    await request('/me', 'DELETE')
    if (!onBack) {
      clearUserId()
    }
    setCards([])
    setMatches([])
    setMatch(null)
    setReport(null)
    setEdit(false)
    setView('discover')
    await loadSession()
  }

  if (!session) {
    return (
      <main className="app-shell">
        <div className="center-state">
          {onBack && (
            <button
              className="text-button"
              onClick={onBack}
            >
              К выбору раздела
            </button>
          )}
          <h1>Знакомства</h1>
          <p>{error || 'Открываем приложение…'}</p>
          {error && (
            <MaxButton
              size="large"
              variant="secondary"
              stretched
              className="max-action"
              onClick={() => setAuthRetry((value) => value + 1)}
            >
              Повторить
            </MaxButton>
          )}
        </div>
      </main>
    )
  }

  const editing = !profile || edit
  const card = cards[0]
  const source = session.source
  const ageBounds = datingAgeBounds(source?.age)
  return (
    <main className="app-shell">
      {onBack && (
        <div className="service-return">
          <button
            className="text-button"
            onClick={onBack}
          >
            ‹ Разделы
          </button>
        </div>
      )}
      {editing ? (
        <>
          {!profile && (
            <header className="app-header">
              <h1>Анкета знакомств</h1>
            </header>
          )}
          <div className="screen-scroll form-screen">
            <div className="dating-form-layout">
              <div className="dating-form-intro">
                {!profile && (
                  <div className="intro">
                    <h2>Знакомства в Кутёже</h2>
                    <p>
                      Имя, возраст, город и фото уже возьмём из твоего профиля. Здесь решаешь только, показываться ли в знакомствах.
                    </p>
                  </div>
                )}
                {sharedProfile}
                {!sharedProfile && source && (
                  <div className="source-profile">
                    <Photo
                      photoURL={photoURL}
                      profile={source}
                      small
                    />
                    <div>
                      <strong>
                        {source.name}
                        {source.age >= 16 ? `, ${source.age}` : ''}
                      </strong>
                      <span>{source.city || 'Город не указан'}</span>
                    </div>
                  </div>
                )}
                <p className="source-note">
                  {sharedProfile ? (
                    'Фото, город и данные здесь те же, что в основном профиле.'
                  ) : (
                    <>
                      Имя, возраст, город, описание и фото меняются в основном профиле.
                      {onProfile ? (
                        <button
                          className="text-button"
                          onClick={onProfile}
                        >
                          Открыть профиль
                        </button>
                      ) : (
                        import.meta.env.VITE_KUTEZH_APP_URL && (
                          <a href={import.meta.env.VITE_KUTEZH_APP_URL}> Открыть профиль</a>
                        )
                      )}
                    </>
                  )}
                </p>
                {profile && weeklyStats && (
                  <section
                    className="dating-weekly-stats"
                    aria-label="Статистика за неделю"
                  >
                    <h2>За последние 7 дней</h2>
                    <div>
                      <span>
                        <strong>{weeklyStats.matches}</strong>
                        <small>метчей</small>
                      </span>
                      <span>
                        <strong>{weeklyStats.liked_by_me}</strong>
                        <small>лайков от меня</small>
                      </span>
                      <span>
                        <strong>{weeklyStats.liked_me}</strong>
                        <small>лайков мне</small>
                      </span>
                    </div>
                  </section>
                )}
                {source && source.age < 16 && (
                  <p className="error-text page-error">Знакомства доступны с 16 лет.</p>
                )}
                {source && source.age >= 16 && source.age < 18 && (
                  <p className="section-note">
                    Тебе будут попадаться только анкеты 16–17 лет. Взрослые не увидят твою анкету, а
                    ты — их.
                  </p>
                )}
                <div className="read-field">
                  <span>Пол</span>
                  <strong>{source?.gender ? genders[source.gender] : 'Не указан'}</strong>
                </div>
                {source && !source.gender && (
                  <p className="error-text page-error">
                    Укажи пол в основном профиле Кутёжа. В знакомствах он отдельно не меняется.
                  </p>
                )}
                <Choice
                  label="Цель знакомства"
                  value={form.goal}
                  options={goals}
                  onChange={(value) => field('goal', value as Form['goal'])}
                />
              </div>
              <div className="dating-form-preferences">
                <div className="section-label">О тебе</div>
                <Choice
                  label="Вероисповедание"
                  value={form.religion}
                  options={religions}
                  onChange={(value) => field('religion', value as Form['religion'])}
                />
                <div className="field-row">
                  <Choice
                    label="Куришь"
                    value={form.smoking}
                    options={habits}
                    onChange={(value) => field('smoking', value as Form['smoking'])}
                  />
                  <Choice
                    label="Алкоголь"
                    value={form.drinking}
                    options={habits}
                    onChange={(value) => field('drinking', value as Form['drinking'])}
                  />
                </div>
                <Choice
                  label="Взгляды на мир"
                  value={form.worldview}
                  options={worldviews}
                  onChange={(value) => field('worldview', value as Form['worldview'])}
                />

                <div className="section-label">Интересы</div>
                <p className="section-note">
                  Можно выбрать до 8 интересов. Общие интересы подсветим в анкетах. Выбрано:{' '}
                  {form.interests.length}/8.
                </p>
                <div className="interest-picker">
                  {interestPool.map((x) => (
                    <button
                      type="button"
                      key={x}
                      aria-pressed={form.interests.includes(x)}
                      className={
                        form.interests.includes(x) ? 'interest-chip selected' : 'interest-chip'
                      }
                      onClick={() => toggleInterest(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>

                <div className="section-label">Кого показывать</div>
                <Choice
                  label="Пол"
                  value={form.show_gender}
                  options={{ all: 'Всех', ...genders }}
                  onChange={(value) => field('show_gender', value as Form['show_gender'])}
                />
                <div className="field-row">
                  <Choice
                    label="Возраст от"
                    value={String(form.min_age)}
                    options={Object.fromEntries(
                      Array.from({ length: form.max_age - ageBounds.min + 1 }, (_, i) => [
                        String(i + ageBounds.min),
                        String(i + ageBounds.min),
                      ]),
                    )}
                    onChange={(value) => field('min_age', Number(value))}
                  />
                  <Choice
                    label="Возраст до"
                    value={String(form.max_age)}
                    options={Object.fromEntries(
                      Array.from({ length: ageBounds.max - form.min_age + 1 }, (_, i) => [
                        String(i + form.min_age),
                        String(i + form.min_age),
                      ]),
                    )}
                    onChange={(value) => field('max_age', Number(value))}
                  />
                </div>
                <Choice
                  label="Где искать"
                  value={form.same_city_only ? 'same' : 'all'}
                  options={
                    source?.city
                      ? { all: 'Во всех городах', same: `Только ${source.city}` }
                      : { all: 'Во всех городах' }
                  }
                  onChange={(value) => field('same_city_only', value === 'same')}
                />
                <CheckControl
                  className="check-row dating-verified-only"
                  markPosition="end"
                  label="Только с синей галочкой"
                  checked={form.verified_only}
                  onChange={(checked) => field('verified_only', checked)}
                />
                <p className="verification-filter-note">
                  Покажем только тех, у кого селфи совпало с фото профиля. Жёлтая галочка сюда не
                  подходит.
                </p>
                {profile && (
                  <>
                    <div className="section-label">Управление анкетой</div>
                    <CheckControl
                      className="check-row settings-switch"
                      kind="switch"
                      label="Скрыть анкету"
                      checked={form.is_paused}
                      onChange={(checked) => field('is_paused', checked)}
                    />
                    <button
                      type="button"
                      className="dating-delete-data"
                      onClick={() => {
                        setConfirmError('')
                        setConfirmation({
                          title: 'Удалить данные знакомств?',
                          description:
                            'Анкета, свайпы и совпадения знакомств будут удалены. Основной профиль Кутёжа останется.',
                          action: removeAccount,
                        })
                      }}
                    >
                      <Icon
                        name="trash"
                        size={20}
                      />
                      Удалить данные знакомств
                    </button>
                  </>
                )}
                {!profile && source && source.age >= 18 && (
                  <CheckControl
                    className="check-row"
                    label="Мне уже исполнилось 18 лет"
                    checked={form.adult_confirmed}
                    onChange={(checked) => field('adult_confirmed', checked)}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="bottom-action">
            {error && <p className="error-text">{error}</p>}
            <MaxButton
              size="large"
              variant="primary"
              stretched
              className="max-action"
              disabled={
                busy ||
                !source ||
                source.age < 16 ||
                !source.gender ||
                (source.age >= 18 && !form.adult_confirmed)
              }
              loading={busy}
              onClick={saveProfile}
            >
              Сохранить
            </MaxButton>
          </div>
        </>
      ) : (
        <>
          <>
            {view === 'matches' && (
              <header className="app-header dating-view-header">
                <h1>Симпатии</h1>
              </header>
            )}
            {view === 'discover' &&
              (profile.is_paused ? (
                <div className="center-state">
                  <Icon
                    name="lock"
                    size={32}
                  />
                  <h2>Анкета скрыта</h2>
                  <p>Включи показ в настройках, чтобы снова знакомиться.</p>
                  <MaxButton
                    size="large"
                    variant="secondary"
                    stretched
                    className="max-action"
                    onClick={() => setEdit(true)}
                  >
                    Настройки
                  </MaxButton>
                </div>
              ) : loadingCards ? (
                <div
                  className="center-state"
                  role="status"
                >
                  Загружаем анкеты…
                </div>
              ) : card ? (
                <Discovery
                  key={card.user_id}
                  card={card}
                  nextCard={cards[1]}
                  suspended={!!report}
                  me={profile}
                  photoURL={photoURL}
                  busy={busy}
                  canUndo={history.length > 0}
                  onUndo={() => void undo()}
                  onSwipe={swipe}
                  onReport={() => setReport(card)}
                  goal={goals[card.goal]}
                  details={[
                    card.religion ? religions[card.religion] : '',
                    card.smoking ? `Курение: ${habits[card.smoking]}` : '',
                    card.drinking ? `Алкоголь: ${habits[card.drinking]}` : '',
                    card.worldview ? worldviews[card.worldview] : '',
                  ].filter(Boolean)}
                />
              ) : (
                <div className="center-state">
                  <Icon
                    name="heart"
                    size={32}
                  />
                  <h2>Пока больше никого</h2>
                  {history.length > 0 && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void undo()}
                    >
                      Вернуть предыдущую анкету
                    </button>
                  )}
                  <p>Пока всё. Новые анкеты появятся позже — или попробуй изменить фильтры.</p>
                  <MaxButton
                    size="large"
                    variant="secondary"
                    stretched
                    className="max-action"
                    onClick={() => setEdit(true)}
                  >
                    Изменить фильтры
                  </MaxButton>

                </div>
              ))}
            {view === 'matches' && (
              <div
                ref={matchesScrollRef}
                className="screen-scroll"
                onScroll={(event) => {
                  datingResume.matchesScrollTop = event.currentTarget.scrollTop
                }}
              >
                {loadingMatches ? (
                  <div
                    className="center-state"
                    role="status"
                  >
                    Загружаем симпатии…
                  </div>
                ) : matches.length ? (
                  matches.map((x) => (
                    <div
                      key={x.match_id}
                      className="match-row"
                      onClick={() => onMatchedProfile?.(x)}
                    >
                      <Photo
                        photoURL={photoURL}
                        profile={x}
                        small
                      />
                      <span>
                        <strong>{x.name}</strong>
                        <small>Взаимная симпатия</small>
                      </span>
                      <div className="match-actions">
                        <MaxIconButton
                          size="medium"
                          variant="secondary"
                          className="match-message"
                          aria-label={`Написать ${x.name} в MAX`}
                          onClick={(event) => {
                            event.stopPropagation()
                            void openMatchChat(x)
                          }}
                        >
                          <Icon
                            name="message"
                            size={20}
                          />
                        </MaxIconButton>
                        <MaxIconButton
                          size="medium"
                          variant="ghost"
                          className="match-more"
                          aria-label={`Действия с симпатией ${x.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setMatchActions(x)
                          }}
                        >
                          <Icon
                            name="more"
                            size={20}
                          />
                        </MaxIconButton>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="center-state">
                    <Icon
                      name="message"
                      size={32}
                    />
                    <h2>Пока нет симпатий</h2>
                    <p>Когда симпатия окажется взаимной, человек появится здесь.</p>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p
                className="toast"
                role="alert"
                onClick={() => setError('')}
              >
                {error}
              </p>
            )}
          </>
        </>
      )}
      {profile && (
        <nav
          className="bottom-navigation"
          aria-label="Навигация знакомств"
        >
          <button
            className={!editing && view === 'discover' ? 'active' : ''}
            onClick={() => {
              setEdit(false)
              setView('discover')
            }}
          >
            <Icon name="heart" />
            <span>Анкеты</span>
          </button>
          <button
            className={!editing && view === 'matches' ? 'active' : ''}
            onClick={() => {
              setEdit(false)
              setView('matches')
            }}
          >
            <Icon name="message" />
            <span className="dating-nav-label">
              Симпатии
              {unreadMatches > 0 && (
                <b className="dating-nav-badge">{unreadMatches > 99 ? '99+' : unreadMatches}</b>
              )}
            </span>
          </button>
          <button
            className={editing ? 'active' : ''}
            onClick={() => setEdit(true)}
          >
            <Icon name="user" />
            <span>Моя анкета</span>
          </button>
        </nav>
      )}
      {match && (
        <Dialog
          label="Взаимная симпатия"
          onClose={() => setMatch(null)}
        >
          <Icon
            name="heart"
            size={34}
          />
          <h2>Это взаимно!</h2>
          <p>Вы понравились друг другу. Теперь можно начать разговор.</p>
          <MaxButton
            size="large"
            variant="primary"
            stretched
            className="max-action"
            onClick={() => {
              setMatch(null)
              setView('matches')
            }}
          >
            Открыть симпатии
          </MaxButton>
          <MaxButton
            size="large"
            variant="secondary"
            stretched
            className="max-action"
            onClick={() => setMatch(null)}
          >
            Продолжить смотреть
          </MaxButton>
        </Dialog>
      )}
      {matchActions && (
        <Dialog
          label={`Симпатия с ${matchActions.name}`}
          onClose={() => setMatchActions(null)}
        >
          <h2>{matchActions.name}</h2>
          <p>Что сделать с этой взаимной симпатией?</p>
          <button
            className="sheet-option"
            onClick={() => {
              void openMatchChat(matchActions)
              setMatchActions(null)
            }}
          >
            Написать в MAX
          </button>
          <button
            className="sheet-option"
            onClick={() => {
              const person = matchActions
              setMatchActions(null)
              setConfirmError('')
              setConfirmation({
                title: `Удалить симпатию с ${person.name}?`,
                description: 'Совпадение исчезнет из списка. Общая дружба в Кутёже останется.',
                action: () => unmatch(person),
              })
            }}
          >
            Удалить симпатию
          </button>
          <button
            className="sheet-option danger"
            onClick={() => {
              const person = matchActions
              setMatchActions(null)
              setReport(person)
            }}
          >
            Пожаловаться
          </button>
          <button
            className="sheet-option danger"
            onClick={() => {
              const person = matchActions
              setMatchActions(null)
              setConfirmError('')
              setConfirmation({
                title: `Заблокировать ${person.name}?`,
                description: 'Вы больше не будете показываться друг другу.',
                action: () => block(person),
              })
            }}
          >
            Заблокировать
          </button>
          <MaxButton
            size="large"
            variant="secondary"
            stretched
            className="max-action"
            onClick={() => setMatchActions(null)}
          >
            Отмена
          </MaxButton>
        </Dialog>
      )}
      {report && (
        <Dialog
          label={`Анкета ${report.name}`}
          onClose={() => setReport(null)}
        >
          <h2>Анкета {report.name}</h2>
          <p>
            Что случилось? После жалобы мы скроем эту анкету для тебя и отправим жалобу модерации.
          </p>
          {[
            'Спам или реклама',
            'Чужие фото или обман',
            'Оскорбления',
            'Неподходящий контент',
            'Другое',
          ].map((x) => (
            <button
              key={x}
              className="sheet-option"
              onClick={() => sendReport(x)}
            >
              {x}
            </button>
          ))}
          <button
            className="sheet-option danger"
            onClick={() => {
              setConfirmError('')
              setConfirmation({
                title: `Скрыть анкету ${report.name}?`,
                description: 'Вы больше не будете показываться друг другу.',
                action: () => block(report),
              })
            }}
          >
            Только скрыть анкету
          </button>
          <MaxButton
            size="large"
            variant="secondary"
            stretched
            className="max-action"
            onClick={() => setReport(null)}
          >
            Отмена
          </MaxButton>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          label={confirmation.title}
          onClose={() => {
            if (!confirmBusy) {
              setConfirmation(null)
            }
          }}
        >
          <p>{confirmation.description}</p>
          {confirmError && (
            <p
              role="alert"
              className="control-error"
            >
              {confirmError}
            </p>
          )}
          <button
            type="button"
            className="control-primary dating-confirm-danger"
            disabled={confirmBusy}
            onClick={async () => {
              setConfirmBusy(true)
              setConfirmError('')
              try {
                await confirmation.action()
                setConfirmation(null)
              } catch (error) {
                setConfirmError((error as Error).message)
              } finally {
                setConfirmBusy(false)
              }
            }}
          >
            {confirmBusy ? 'Выполняем…' : 'Подтвердить'}
          </button>
          <button
            type="button"
            className="control-secondary"
            disabled={confirmBusy}
            onClick={() => setConfirmation(null)}
          >
            Отмена
          </button>
        </Dialog>
      )}
    </main>
  )
}
