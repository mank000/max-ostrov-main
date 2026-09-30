import { CheckControl } from '../ui/components/CheckControl'
import { useEffect, useState } from 'react'
import { syncPosts } from '../data/postSync'
import { logout } from '../api/auth'
import { FaceScanner } from '../verification/FaceScanner'
import { runFaceVerification, useVerificationBusy } from '../verification/job'
import { loadBlockedUsers, setBlocked, updateProfile, setLanguageFilter } from '../api/users'
import {
  Cell,
  CountBadge,
  Header,
  Icon,
  StatePanel,
} from '../ui/components/BasicUI'
import { PersonRow } from '../ui/components/ContentCards'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function SettingsScreen({
  back,
  navigate,
  data,
  theme,
  themeMode,
  onError,
  confirm,
}: ScreenProps) {
  const profile = data.profile
  const [languageBusy, setLanguageBusy] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const verificationBusy = useVerificationBusy(profile?.id)
  if (!profile) return <StatePanel title="Профиль недоступен" />
  const verificationTier = profile.verification_tier || (profile.face_verified ? 'age' : 'none')

  async function toggleLanguageFilter() {
    if (!profile || languageBusy || (profile.age ?? 0) < 18) return
    setLanguageBusy(true)
    try {
      const updated = await setLanguageFilter(!(profile.hide_sensitive_language ?? true))
      data.setProfile(updated)
      data.refresh('feed', 'profilePosts')
      syncPosts()
      window.dispatchEvent(new Event('kutezh:clips-updated'))
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally { setLanguageBusy(false) }
  }


  return (
    <>
      <Header title="Настройки" back={back} />
      <div className="screen-scroll">
        <div className="extra-section">
          {profile.moderation_role && (
            <Cell
              icon="settings"
              title={profile.moderation_role === 'administrator' ? 'Админ-доступ' : 'Модерация'}
              detail={
                profile.moderation_role === 'administrator'
                  ? 'Поддержка, пользователи, контент и журнал действий'
                  : 'Обращения пользователей и инструменты модерации'
              }
              onClick={() => navigate('admin')}
            />
          )}
          <Cell
            icon="sun"
            title="Оформление"
            detail={
              themeMode === 'auto'
                ? `Авто · сейчас ${theme === 'dark' ? 'тёмная' : 'светлая'}`
                : themeMode === 'dark'
                  ? 'Тёмная'
                  : 'Светлая'
            }
            onClick={() => navigate('appearance')}
          />
          <Cell
            icon="lock"
            title="Приватность"
            detail={`${profile.private_profile ? 'Закрытый профиль' : 'Открытый профиль'} · ${profile.show_online === false ? 'онлайн скрыт' : 'онлайн виден'}`}
            onClick={() => navigate('privacy')}
          />
          <Cell
            icon="message"
            title="Поддержка"
            detail="Вопросы, ошибки и помощь по приложению"
            onClick={() => navigate('support')}
          />
          <div className="language-filter-row">
            <div>
              <strong>Безопасный контент</strong>
              <p>{(profile.age ?? 0) < 18
                ? 'Мат, спорные и непроверенные публикации скрыты. До 18 лет этот режим обязателен.'
                : 'Скрывает мат, контент на модерации и ещё не проверенные публикации, включая видео. Правила сообщества действуют при любом выборе.'}</p>
            </div>
            <CheckControl kind="switch" className="language-filter-switch" label="Безопасный контент"
              checked={(profile.age ?? 0) < 18 || (profile.hide_sensitive_language ?? true)}
              disabled={languageBusy || (profile.age ?? 0) < 18}
              onChange={() => { void toggleLanguageFilter() }} />
          </div>
          <Cell
            icon="users"
            title="Заблокированные"
            onClick={() => navigate('blocked')}
          />
          {profile.face_verification_available && (
            <div className={`settings-verification-group${verificationTier !== 'none' ? ' settings-verification-group--noted' : ''}`}>
              <Cell
                icon="camera"
                title="Проверка по селфи"
                detail={
                  verificationTier === 'full'
                    ? 'Синяя галочка · селфи совпало с фото профиля'
                    : verificationTier === 'age'
                      ? 'Жёлтая галочка · возраст прошёл проверку, фото не подтверждено'
                      : verificationBusy
                        ? 'Проверяем лицо…'
                        : profile.birth_date
                          ? 'Проверим возраст и попробуем сверить актуальные фото профиля'
                          : 'Сначала укажите дату рождения'
                }
                trailing={
                  verificationTier !== 'none'
                    ? <Icon name="check" size={20} className={`settings-verification-check settings-verification-check--${verificationTier}`} />
                    : undefined
                }
                onClick={() => {
                  if (verificationBusy) return
                  if (!profile.birth_date) {
                    onError('Сначала укажите дату рождения в профиле')
                    return
                  }
                  setScannerOpen(true)
                }}
              />
              {verificationTier !== 'none' && (
                <div className={`settings-verification-note settings-verification-note--${verificationTier}`}>
                  <strong>{verificationTier === 'full' ? 'Преимущества синей галочки' : 'Преимущества жёлтой галочки'}</strong>
                  <p>
                    {verificationTier === 'full'
                      ? 'В знакомствах анкета получает больший приоритет и может показываться тем, кто включил фильтр «Только с синей галочкой».'
                      : 'В знакомствах анкета получает небольшой приоритет. Фильтр «Только с синей галочкой» учитывает только подтверждённое совпадение фото.'}
                  </p>
                  {verificationTier === 'age' && (
                    <p className="settings-verification-help">
                      Если фото не совпало или синяя галочка не появилась, напишите в разделе «Поддержка» или <code>/help</code> в общем MAX-боте и отправьте актуальное фото. После успешной проверки возраста модератор сможет провести ручную сверку. Документы не нужны.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="extra-section">
          <Cell
            icon="coins"
            title="Монеты и достижения"
            onClick={() => navigate('rewards')}
          />
          <Cell
            icon="gift"
            title="Подарки"
            trailing={
              data.unreadGiftCount > 0 ? (
                <CountBadge count={data.unreadGiftCount} />
              ) : undefined
            }
            onClick={() => navigate('gifts')}
          />
        </div>
        <button
          className="extra-signout"
          type="button"
          onClick={() =>
            confirm({
              title: 'Выйти из аккаунта?',
              description:
                'Для продолжения нужно будет снова открыть приложение в MAX.',
              confirm: 'Выйти',
              destructive: true,
              onConfirm: () => {
                void logout()
                  .then(() => window.location.reload())
                  .catch((error) => onError(String(error)))
              },
            })
          }
        >
          Выйти
        </button>
      </div>
      {scannerOpen && (
        <FaceScanner
          onClose={() => setScannerOpen(false)}
          onCapture={(file) => runFaceVerification(profile.id, file, data.setProfile, onError)}
          onError={onError}
        />
      )}
    </>
  )
}

export function Appearance({ back, theme, themeMode, setTheme }: ScreenProps) {
  return (
    <>
      <Header title="Оформление" back={back} />
      <div className="screen-scroll">
        <Cell
          icon="settings"
          title="Авто"
          detail={`Как в системе · сейчас ${theme === 'dark' ? 'тёмная' : 'светлая'}`}
          trailing={
            themeMode === 'auto' ? <Icon name="check" size={20} /> : undefined
          }
          onClick={() => setTheme('auto')}
        />
        <Cell
          icon="sun"
          title="Светлая"
          trailing={
            themeMode === 'light' ? <Icon name="check" size={20} /> : undefined
          }
          onClick={() => setTheme('light')}
        />
        <Cell
          icon="moon"
          title="Тёмная"
          trailing={
            themeMode === 'dark' ? <Icon name="check" size={20} /> : undefined
          }
          onClick={() => setTheme('dark')}
        />
      </div>
    </>
  )
}

export function Privacy({ back, data, onError }: ScreenProps) {
  const profile = data.profile
  const [busy, setBusy] = useState<'profile' | 'birthday' | 'online' | 'participants' | null>(null)
  if (!profile) return <StatePanel title="Профиль недоступен" />

  const participantVisibility = profile.participant_visibility || 'participants'
  const privateProfile = profile.private_profile ?? false
  const showOnline = profile.show_online ?? true
  const showBirthDate = profile.show_birth_date ?? true

  async function saveProfilePrivacy(
    update: { private_profile?: boolean; show_birth_date?: boolean; show_online?: boolean },
    key: 'profile' | 'birthday' | 'online',
  ) {
    if (busy) return
    setBusy(key)
    try {
      data.setProfile(await updateProfile(update))
      if (update.show_birth_date !== undefined) data.refresh('friends', 'inbox')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function saveParticipantVisibility(value: 'participants' | 'hidden') {
    if (busy || value === participantVisibility) return
    setBusy('participants')
    try {
      data.setProfile(await updateProfile({ participant_visibility: value }))
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Header title="Приватность" back={back} />
      <div className="screen-scroll">
        <p className="extra-hint">Профиль</p>
        <div className="privacy-switch-row">
          <div>
            <strong>Закрытый профиль</strong>
            <p>
              Только друзья увидят публикации, медиа, друзей, интересы, возраст,
              подарки и мероприятия. Остальным остаются имя, город и круглая
              аватарка — открыть её нельзя.
            </p>
          </div>
          <CheckControl
            kind="switch"
            className="privacy-inline-switch"
            label="Закрытый профиль"
            checked={privateProfile}
            disabled={busy !== null}
            onChange={() => {
              void saveProfilePrivacy({ private_profile: !privateProfile }, 'profile')
            }}
          />
        </div>

        <div className="privacy-switch-row">
          <div>
            <strong>Показывать дату рождения</strong>
            <p>
              {showBirthDate
                ? 'Дата видна в профиле. В день рождения друзья увидят напоминание и получат сообщение от бота.'
                : 'Дата скрыта. Друзьям не показываются и не отправляются напоминания о вашем дне рождения.'}
            </p>
          </div>
          <CheckControl
            kind="switch"
            className="privacy-inline-switch"
            label="Показывать дату рождения"
            checked={showBirthDate}
            disabled={busy !== null}
            onChange={() => {
              void saveProfilePrivacy({ show_birth_date: !showBirthDate }, 'birthday')
            }}
          />
        </div>

        <p className="extra-hint">Активность</p>
        <div className="privacy-switch-row">
          <div>
            <strong>Показывать статус онлайн</strong>
            <p>
              {showOnline
                ? 'Другие видят, когда вы в сети и когда заходили в последний раз.'
                : 'Никто не видит ваш онлайн и время посещения. Пока статус скрыт, вы тоже не видите чужой онлайн и время посещения.'}
            </p>
          </div>
          <CheckControl
            kind="switch"
            className="privacy-inline-switch"
            label="Показывать статус онлайн"
            checked={showOnline}
            disabled={busy !== null}
            onChange={() => {
              void saveProfilePrivacy({ show_online: !showOnline }, 'online')
            }}
          />
        </div>

        <p className="extra-hint">Мероприятия</p>
        <p className="privacy-section-note">
          Кто может видеть вас в списке участников мероприятия.
        </p>
        <Cell
          icon="users"
          title="Участникам мероприятия"
          trailing={
            participantVisibility === 'participants' ? <Icon name="check" size={20} /> : undefined
          }
          onClick={() => void saveParticipantVisibility('participants')}
        />
        <Cell
          icon="lock"
          title="Не показывать"
          trailing={
            participantVisibility === 'hidden' ? <Icon name="check" size={20} /> : undefined
          }
          onClick={() => void saveParticipantVisibility('hidden')}
        />

      </div>
    </>
  )
}

export function Blocked({ back, navigate, onError }: ScreenProps) {
  const [users, setUsers] = useState<
    Awaited<ReturnType<typeof loadBlockedUsers>>
  >([])
  useEffect(() => {
    const controller = new AbortController()
    loadBlockedUsers(controller.signal)
      .then(setUsers)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [onError])
  return (
    <>
      <Header title="Заблокированные" back={back} />
      <div className="screen-scroll">
        {users.length ? (
          users.map((item) => (
            <div className="extra-person-action" key={item.user.id}>
              <PersonRow
                person={item.user}
                onClick={() => navigate('userprofile', item.user.id)}
              />
              <button
                type="button"
                onClick={() =>
                  void setBlocked(item.user.id, false)
                    .then(() =>
                      setUsers((current) =>
                        current.filter(
                          (value) => value.user.id !== item.user.id,
                        ),
                      ),
                    )
                    .catch((error) => onError(String(error)))
                }
              >
                Разблокировать
              </button>
            </div>
          ))
        ) : (
          <StatePanel
            title="Список пуст"
            description="Здесь появятся заблокированные пользователи."
          />
        )}
      </div>
    </>
  )
}
