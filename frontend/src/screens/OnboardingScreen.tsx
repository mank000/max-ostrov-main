import { DateField } from '../ui/components/DateField'
import { SelectField } from '../ui/components/SelectField'
import { requestLocation } from '../location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AuthSession } from '../api/auth'
import { ApiError } from '../api/http'
import {
  deleteMedia,
  PHOTO_INPUT_ACCEPT,
  preparePhotoFile,
  uploadAvatar,
  uploadProfilePhoto,
} from '../api/media'
import { reverseGeocode, searchCities, type CitySuggestion } from '../api/places'
import { completeOnboarding, setProfileAvatarCrop, type Profile } from '../api/users'
import { profileBirthDateAdult, profileBirthDateRange, profileBirthDateValid } from '../profileBirthDate'
import type { HostAdapter } from '../host'
import { cityDisplayName } from '../ui-utils'
import { AvatarCropper } from '../ui/components/AvatarCropper'
import { Avatar, Button, Icon } from '../ui/components/BasicUI'
import { CheckControl } from '../ui/components/CheckControl'

const popularCities = [
  'Москва',
  'Санкт-Петербург',
  'Новосибирск',
  'Екатеринбург',
  'Казань',
  'Нижний Новгород',
  'Челябинск',
  'Самара',
  'Омск',
  'Ростов-на-Дону',
  'Уфа',
  'Красноярск',
  'Пермь',
  'Воронеж',
  'Волгоград',
  'Краснодар',
  'Саратов',
  'Тюмень',
  'Тольятти',
  'Ижевск',
  'Барнаул',
  'Ульяновск',
  'Иркутск',
  'Хабаровск',
  'Ярославль',
  'Владивосток',
  'Махачкала',
  'Томск',
  'Оренбург',
  'Кемерово',
  'Новокузнецк',
  'Рязань',
  'Набережные Челны',
  'Астрахань',
  'Пенза',
  'Липецк',
  'Киров',
  'Чебоксары',
  'Калининград',
  'Тула',
  'Курск',
  'Сочи',
  'Ставрополь',
  'Улан-Удэ',
]

type Step = 0 | 1 | 2
type GeoStatus = 'idle' | 'requesting' | 'found' | 'unavailable'

function usernameValid(value: string) {
  return /^[a-z][a-z0-9_]{2,31}$/.test(value)
}

function cityValid(value: string) {
  const length = Array.from(value.trim()).length
  return length > 0 && length <= 80
}

export function OnboardingScreen({
  profile,
  providerUser,
  host,
  onComplete,
}: {
  profile: Profile
  providerUser: AuthSession['user'] | null
  host: HostAdapter
  onComplete: (profile: Profile) => void
}) {
  const providerName = [providerUser?.first_name, providerUser?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState(providerName || profile.display_name)
  const [username, setUsername] = useState(profile.username || '')
  const [city, setCity] = useState(profile.city || '')
  const [gender, setGender] = useState<'man' | 'woman' | ''>(profile.gender || '')
  const [birthDate, setBirthDate] = useState(profile.birth_date || '')
  const birthDateRange = profileBirthDateRange()
  const adult = profileBirthDateAdult(birthDate)
  const [showAdultContent, setShowAdultContent] = useState(
    Boolean((profile.age ?? 0) >= 18 && profile.hide_sensitive_language === false),
  )
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')
  const [remoteCities, setRemoteCities] = useState<CitySuggestion[]>([])
  const [searchingCities, setSearchingCities] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarProfile, setAvatarProfile] = useState(profile)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarCandidate, setAvatarCandidate] = useState<File | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const cityTouched = useRef(false)
  const locationRun = useRef(0)
  const geoRequest = useRef<AbortController | null>(null)
  const [geoError, setGeoError] = useState('')

  const providerLabel = host.provider === 'max' ? 'MAX' : 'профиля'
  const avatarURL = avatarProfile.photo_url || providerUser?.photo_url
  const avatarSource = avatarProfile.avatar_media_id
    ? 'Ваше фото в Кутёж'
    : avatarURL
      ? `Фото из ${providerLabel}`
      : `Фото из ${providerLabel} недоступно`
  const localCities = useMemo(() => {
    const query = city.trim().toLocaleLowerCase('ru')
    if (query.length < 2) return []
    return popularCities
      .filter((item) => item.toLocaleLowerCase('ru').includes(query))
      .filter((item) => item.toLocaleLowerCase('ru') !== query)
      .slice(0, 5)
  }, [city])

  const locateCity = useCallback(async () => {
    const run = ++locationRun.current
    geoRequest.current?.abort()
    const controller = new AbortController()
    geoRequest.current = controller
    setGeoError('')
    setGeoStatus('requesting')
    try {
      const position = await requestLocation(controller.signal)
      if (run !== locationRun.current) return
      if (!position) {
        setGeoStatus('unavailable')
        return
      }
      const location = await reverseGeocode(position.latitude, position.longitude, controller.signal)
      if (run !== locationRun.current) return
      if (location.city) {
        if (!cityTouched.current) setCity(location.city)
        setGeoStatus('found')
      } else {
        setGeoStatus('unavailable')
      }
    } catch (error) {
      if (run === locationRun.current && !controller.signal.aborted) {
        setGeoStatus('unavailable')
        setGeoError(error instanceof Error ? error.message : 'Не удалось определить город')
      }
    }
  }, [])

  useEffect(() => () => { locationRun.current += 1; geoRequest.current?.abort() }, [])

  useEffect(() => {
    if (!adult) setShowAdultContent(false)
  }, [adult])

  useEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    const viewport = window.visualViewport
    if (!root || !body || !viewport) return

    const activeField = () => {
      const active = document.activeElement
      if (!(active instanceof HTMLInputElement) || !root.contains(active)) return null
      return active.closest<HTMLElement>('.onboarding__field')
    }

    const prePositionFocusedField = (field: HTMLElement) => {
      const bodyRect = body.getBoundingClientRect()
      const fieldRect = field.getBoundingClientRect()
      const fieldTop = body.scrollTop + fieldRect.top - bodyRect.top
      const safeTop = Math.max(16, Math.min(84, body.clientHeight * 0.22))
      body.scrollTop = Math.max(0, fieldTop - safeTop)
    }

    const keepFocusedFieldVisible = () => {
      const field = activeField()
      if (!field) return
      const viewportBottom = viewport.offsetTop + viewport.height
      const bodyRect = body.getBoundingClientRect()
      const fieldRect = field.getBoundingClientRect()
      const topLimit = Math.max(bodyRect.top, viewport.offsetTop) + 12
      const bottomLimit = Math.min(bodyRect.bottom, viewportBottom) - 12
      if (fieldRect.bottom > bottomLimit) body.scrollTop += fieldRect.bottom - bottomLimit
      else if (fieldRect.top < topLimit) body.scrollTop -= topLimit - fieldRect.top
    }

    const syncViewport = () => {
      root.style.setProperty('--onboarding-viewport-height', `${Math.round(viewport.height)}px`)
      keepFocusedFieldVisible()
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      const field = target.closest<HTMLElement>('.onboarding__field')
      if (field) prePositionFocusedField(field)
      syncViewport()
    }

    syncViewport()
    body.addEventListener('focusin', onFocusIn)
    viewport.addEventListener('resize', syncViewport, { passive: true })
    viewport.addEventListener('scroll', syncViewport, { passive: true })
    return () => {
      body.removeEventListener('focusin', onFocusIn)
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      root.style.removeProperty('--onboarding-viewport-height')
    }
  }, [])

  async function chooseAvatar(file?: File) {
    if (!file || avatarBusy) return
    setError('')
    try {
      const prepared = await preparePhotoFile(file)
      setAvatarCandidate(prepared)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось обработать фотографию')
    }
  }

  async function saveCroppedAvatar(cropFile: File) {
    if (avatarBusy || !avatarCandidate) return
    setAvatarBusy(true)
    setError('')
    let sourceMediaID = 0
    let cropMediaID = 0
    let committed = false
    try {
      const source = await uploadProfilePhoto(avatarCandidate)
      sourceMediaID = source.id
      const crop = await uploadAvatar(cropFile)
      cropMediaID = crop.id
      const updated = await setProfileAvatarCrop(source.id, crop.id)
      committed = true
      setAvatarProfile(updated)
      setAvatarCandidate(null)
      host.hapticImpact('light')
    } catch (cause) {
      if (!committed) {
        await Promise.allSettled([
          cropMediaID ? deleteMedia(cropMediaID) : Promise.resolve(),
          sourceMediaID ? deleteMedia(sourceMediaID) : Promise.resolve(),
        ])
      }
      throw cause instanceof Error ? cause : new Error('Не удалось загрузить фото')
    } finally {
      setAvatarBusy(false)
    }
  }

  function changeUsername(value: string) {
    setUsername(value.replace(/^@/, '').toLowerCase().slice(0, 32))
    setUsernameError('')
    setError('')
  }

  function changeCity(value: string) {
    cityTouched.current = true
    setCity(value.slice(0, 80))
    setRemoteCities([])
    setError('')
  }

  function chooseCity(value: string) {
    cityTouched.current = true
    setCity(cityDisplayName(value))
    setRemoteCities([])
    host.hapticSelection()
  }

  async function findMoreCities() {
    const query = city.trim()
    if (query.length < 2 || searchingCities) return
    setSearchingCities(true)
    setError('')
    try {
      setRemoteCities(await searchCities(query))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось найти город')
    } finally {
      setSearchingCities(false)
    }
  }

  async function finish() {
    const finalName = name.trim()
    const finalCity = city.trim()
    if (!usernameValid(username) || !finalName || !cityValid(finalCity) || !gender || !profileBirthDateValid(birthDate) || saving) return
    setSaving(true)
    setError('')
    try {
      const updated = await completeOnboarding({
        display_name: finalName,
        username,
        city: finalCity,
        gender,
        birth_date: birthDate,
        hide_sensitive_language: !showAdultContent,
      })
      onComplete(updated)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setUsernameError('Этот username уже занят. Придумайте другой.')
        setStep(1)
      } else {
        setError(cause instanceof Error ? cause.message : 'Не удалось завершить регистрацию')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={rootRef} className="onboarding" aria-label="Регистрация в Кутёж">
      <header className="onboarding__header">
        <strong>Кутёж</strong>
        <span>Шаг {step + 1} из 3</span>
        <div className="onboarding__progress" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <i key={item} className={item <= step ? 'is-active' : ''} />
          ))}
        </div>
      </header>

      <div ref={bodyRef} className="onboarding__body">
        {step === 0 && (
          <>
            <div className="onboarding__avatar">
              <div className="onboarding__avatar-photo">
                <div className="onboarding__avatar-frame">
                  <Avatar name={name || providerName || 'Кутёж'} url={avatarURL} size={104} />
                  <label
                    className={`onboarding__avatar-picker ${avatarBusy ? 'is-busy' : ''}`}
                    aria-label={avatarURL ? 'Сменить фото' : 'Добавить фото'}
                    title={avatarURL ? 'Сменить фото' : 'Добавить фото'}
                  >
                    <Icon name="edit" size={18} />
                    <input
                      type="file"
                      accept={PHOTO_INPUT_ACCEPT}
                      disabled={avatarBusy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        void chooseAvatar(file)
                      }}
                    />
                  </label>
                </div>
              </div>
              <span>
                <Icon name={avatarURL ? 'check' : 'info'} size={14} /> {avatarSource}
              </span>
            </div>
            <div className="onboarding__copy">
              <h1>Давайте познакомимся</h1>
              <p>
                {avatarURL
                  ? `Мы подставили доступное фото из ${providerLabel}. Его можно заменить прямо сейчас.`
                  : host.provider === 'browser'
                    ? 'Фото профиля недоступно. Добавьте своё или продолжите с инициалами.'
                    : `${providerLabel} не передал фото — например, из-за настроек приватности. Добавьте своё или продолжите с инициалами.`}{' '}
                Укажите имя, которое будут видеть другие участники.
              </p>
            </div>
            <label className="onboarding__field onboarding__field--name">
              <span>Имя</span>
              <input
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError('')
                }}
                placeholder="Как вас называть?"
              />
            </label>
            <SelectField className="onboarding__field" label="Пол" value={gender}
              onChange={value => { setGender(value as 'man' | 'woman' | ''); setError('') }}
              options={[{ value: '', label: 'Выберите' }, { value: 'man', label: 'Мужчина' }, { value: 'woman', label: 'Женщина' }]} />
            <DateField className="onboarding__field" label="Дата рождения" value={birthDate} min={birthDateRange.min} max={birthDateRange.max} requireSelection
              onChange={value => { setBirthDate(value); setError('') }} />
            {birthDate && !profileBirthDateValid(birthDate) && (
              <p className="onboarding__error">Возраст должен быть от 13 до 100 лет.</p>
            )}
            <div className="onboarding__adult-content">
              <CheckControl
                kind="switch"
                checked={adult && showAdultContent}
                disabled={!adult}
                onChange={setShowAdultContent}
                label={
                  <span>
                    <strong>Показывать разрешённый контент 18+</strong>
                    <small>
                      {!birthDate
                        ? 'Сначала укажите дату рождения.'
                        : adult
                          ? 'Мат и другой разрешённый правилами контент с возрастной маркировкой. Запрещённый контент этот переключатель не открывает.'
                          : 'До 18 лет мат и другой контент 18+ скрываются автоматически и эту защиту нельзя отключить.'}
                    </small>
                  </span>
                }
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboarding__copy">
              <h1>Придумайте username</h1>
              <p>Он уникальный и всегда отображается строчными буквами.</p>
            </div>
            <label
              className={
                'onboarding__field onboarding__username' +
                (usernameError || (username && !usernameValid(username)) ? ' is-error' : '')
              }
            >
              <span>Username</span>
              <div>
                <b>@</b>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={32}
                  value={username}
                  onChange={(event) => changeUsername(event.target.value)}
                  placeholder="your_name"
                />
              </div>
            </label>
            <p className="onboarding__hint">
              3–32 символа. Первый — латинская буква. Дальше можно буквы a–z, цифры и _.
            </p>
            {usernameError && <p className="onboarding__error">{usernameError}</p>}
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding__copy">
              <h1>Ваш город</h1>
              <p>
                Нужен для городской ленты и мероприятий рядом. Точная геопозиция в профиль не
                сохраняется.
              </p>
            </div>
            <div className={'onboarding__geo onboarding__geo--' + geoStatus}>
              <Icon name="location" size={20} />
              <span>
                {geoStatus === 'requesting'
                  ? 'Определяем город…'
                  : geoStatus === 'found'
                    ? 'Город определён по геолокации'
                    : geoStatus === 'idle' ? 'Определить город по геолокации' : 'Не удалось определить город автоматически'}
              </span>
              {geoStatus !== 'requesting' && (
                <button type="button" onClick={() => void locateCity()}>
                  {geoStatus === 'idle' ? 'Определить' : 'Повторить'}
                </button>
              )}
            </div>
            <p className="onboarding__error" role="status">{geoError}</p>
            <label className="onboarding__field">
              <span>Город</span>
              <input
                autoComplete="address-level2"
                maxLength={80}
                value={city}
                onChange={(event) => changeCity(event.target.value)}
                placeholder="Начните вводить город"
              />
            </label>
            {city.trim() && !cityValid(city) && (
              <p className="onboarding__error">Название города не должно превышать 80 символов.</p>
            )}
            {(localCities.length > 0 || remoteCities.length > 0) && (
              <div className="onboarding__suggestions">
                {localCities.map((item) => (
                  <button key={item} type="button" onClick={() => chooseCity(item)}>
                    <Icon name="location" size={18} />
                    <span>{item}</span>
                  </button>
                ))}
                {remoteCities.map((item) => (
                  <button
                    key={item.name + item.latitude + item.longitude}
                    type="button"
                    onClick={() => chooseCity(item.name)}
                  >
                    <Icon name="location" size={18} />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )}
            {city.trim().length >= 2 && (
              <button
                className="onboarding__city-search"
                type="button"
                disabled={searchingCities}
                onClick={() => void findMoreCities()}
              >
                {searchingCities ? 'Ищем…' : 'Не нашли в списке? Найти ещё'}
              </button>
            )}
          </>
        )}

        {error && <p className="onboarding__error">{error}</p>}
      </div>

      <footer className="onboarding__footer">
        {step > 0 && (
          <Button
            variant="secondary"
            onClick={() => {
              setStep((step - 1) as Step)
              setError('')
            }}
          >
            Назад
          </Button>
        )}
        {step === 0 && (
          <Button
            disabled={!name.trim() || name.trim().length > 80 || !gender || !profileBirthDateValid(birthDate)}
            onClick={() => setStep(1)}
          >
            Продолжить
          </Button>
        )}
        {step === 1 && (
          <Button disabled={!usernameValid(username)} onClick={() => setStep(2)}>
            Продолжить
          </Button>
        )}
        {step === 2 && (
          <Button disabled={!cityValid(city) || saving} onClick={() => void finish()}>
            {saving ? 'Создаём профиль…' : 'Готово'}
          </Button>
        )}
      </footer>
      {avatarCandidate && (
        <AvatarCropper
          file={avatarCandidate}
          saving={avatarBusy}
          onCancel={() => {
            if (!avatarBusy) setAvatarCandidate(null)
          }}
          onConfirm={saveCroppedAvatar}
        />
      )}
    </section>
  )
}

export default OnboardingScreen
