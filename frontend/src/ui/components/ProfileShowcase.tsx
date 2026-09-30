import { compactLastSeen } from '../../presence'
import { Avatar, Button, Icon, type IconName } from './BasicUI'
import { GiftArtwork } from './GiftArtwork'
import './profile-showcase.css'
import { useExpandableSheet } from './useExpandableSheet'

export type ProfileShowcaseAction = {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
  icon?: IconName
  disabled?: boolean
}

export type ProfileShowcaseStat = {
  id: string
  value: number | string
  label: string
  onClick?: () => void
}

type VerificationTier = 'none' | 'age' | 'full'

function verificationCopy(tier?: VerificationTier) {
  if (tier === 'full') {
    return {
      short: 'Синяя галочка',
      label: 'Синяя галочка: селфи совпало с актуальным фото профиля',
      detail: 'Селфи совпало с актуальным фото профиля',
    }
  }
  if (tier === 'age') {
    return {
      short: 'Жёлтая галочка',
      label: 'Жёлтая галочка: возраст оценён по селфи; фото профиля не подтверждено',
      detail: 'Возраст оценён по селфи; фото профиля не подтверждено',
    }
  }
  return null
}

export function ProfileShowcase({
  name,
  photoUrl,
  username,
  city,
  decorationCode,
  verificationTier,
  stats = [],
  actions,
  context = [],
  onInfo,
  onAvatarClick,
  presence,
  avatarSize = 96,
}: {
  name: string
  photoUrl?: string
  username?: string
  city?: string
  decorationCode?: string
  verificationTier?: VerificationTier
  stats?: ProfileShowcaseStat[]
  actions: ProfileShowcaseAction[]
  context?: string[]
  onInfo?: () => void
  onAvatarClick?: () => void
  presence?: { online: boolean; lastSeenAt?: string }
  avatarSize?: number
}) {
  const verification = verificationCopy(verificationTier)
  const meta = [username ? `@${username}` : '', city || ''].filter(Boolean)
  const lastSeen = presence && !presence.online ? compactLastSeen(presence.lastSeenAt) : ''
  return (
    <section className={`profile-showcase ${decorationCode ? 'profile-showcase--decorated' : ''}`}>
      <div className="profile-showcase__identity">
        <button
          className="profile-showcase__avatar"
          style={{ width: avatarSize, height: avatarSize }}
          type="button"
          onClick={onAvatarClick}
          disabled={!onAvatarClick}
          aria-label={onAvatarClick ? `Открыть фотографии профиля ${name}` : undefined}
        >
          <Avatar name={name} url={photoUrl} size={avatarSize} />
          {decorationCode && <span className="profile-showcase__avatar-ring" aria-hidden="true" />}
          {presence?.online ? (
            <span
              className="profile-showcase__presence profile-showcase__presence--online"
              role="img"
              aria-label="В сети"
              title="В сети"
            />
          ) : lastSeen ? (
            <span
              className="profile-showcase__presence profile-showcase__presence--away"
              role="img"
              aria-label={`Был(а) в сети ${lastSeen} назад`}
              title={`Был(а) в сети ${lastSeen} назад`}
            >
              {lastSeen}
            </span>
          ) : null}
        </button>
        <button
          className="profile-showcase__identity-hit"
          type="button"
          onClick={onInfo}
          disabled={!onInfo}
          aria-label={onInfo ? `Подробнее о ${name}` : undefined}
        >
          <div className="profile-showcase__name">
            <h2>{name}</h2>
            {verification && (
              <span
                className={`profile-showcase__verification-check profile-showcase__verification-check--${verificationTier}`}
                role="img"
                aria-label={verification.label}
                title={verification.label}
              >
                <Icon name="check" size={13} />
              </span>
            )}
          </div>
          {meta.length > 0 && <p className="profile-showcase__meta">{meta.join(' · ')}</p>}
          {context.length > 0 && (
            <div className="profile-showcase__context">
              {context.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          )}
          {onInfo && <span className="profile-showcase__more">Подробнее</span>}
        </button>
      </div>
      {actions.length > 0 && (
        <div className="profile-showcase__actions">
          {actions.map((action) => (
            <Button
              key={action.label}
              className="profile-showcase__action"
              variant={action.variant || 'secondary'}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.icon && <Icon name={action.icon} size={18} />}
              <span>{action.label}</span>
            </Button>
          ))}
        </div>
      )}
      {stats.length > 0 && (
        <div className="profile-showcase__stats">
          {stats.map((stat) =>
            stat.onClick ? (
              <button key={stat.id} type="button" onClick={stat.onClick}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </button>
            ) : (
              <div key={stat.id}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}

export type ProfileFriendPreview = {
  id: number
  display_name: string
  photo_url?: string
}

function friendCountLabel(count: number) {
  const value = Math.max(0, count)
  const mod100 = value % 100
  const mod10 = value % 10
  if (mod100 >= 11 && mod100 <= 14) return `${value} друзей`
  if (mod10 === 1) return `${value} друг`
  if (mod10 >= 2 && mod10 <= 4) return `${value} друга`
  return `${value} друзей`
}

export function ProfileSocialPreview({
  friendCount,
  friends,
  onFriends,
}: {
  friendCount: number
  friends: ProfileFriendPreview[]
  onFriends: () => void
}) {
  const visibleFriends = friends.slice(0, 3)
  const firstName = visibleFriends[0]?.display_name.trim().split(/\s+/)[0] || ''
  const remaining = Math.max(0, friendCount - (firstName ? 1 : 0))
  const detail =
    friendCount <= 0
      ? 'Пока нет друзей'
      : firstName
        ? remaining > 0
          ? `В друзьях ${firstName} и ещё ${remaining}`
          : `В друзьях ${firstName}`
        : 'Посмотреть список друзей'

  return (
    <section className="profile-social-preview">
      <button className="profile-social-preview__main" type="button" onClick={onFriends}>
        <span className="profile-social-preview__copy">
          <strong>{friendCountLabel(friendCount)}</strong>
          <small>{detail}</small>
        </span>
        {visibleFriends.length > 0 && (
          <span className="profile-social-preview__avatars" aria-hidden="true">
            {visibleFriends.map((friend) => (
              <Avatar key={friend.id} name={friend.display_name} url={friend.photo_url} size={40} />
            ))}
          </span>
        )}
        <Icon name="chevron" size={18} />
      </button>
    </section>
  )
}

export type ProfileGiftPreview = {
  id: number
  item_code: string
  title: string
  message?: string
}

export function ProfileGiftShelf({
  gifts,
  loading,
  error,
  hideDetails = false,
  onOpenAll,
  onRetry,
}: {
  gifts: ProfileGiftPreview[]
  loading?: boolean
  error?: boolean
  hideDetails?: boolean
  onOpenAll: () => void
  onRetry?: () => void
}) {
  return (
    <section className="profile-gifts">
      <div className="profile-gifts__head">
        <h3>Подарки</h3>
        <button type="button" onClick={onOpenAll}>
          Все
        </button>
      </div>
      {loading ? (
        <div className="profile-gifts__loading" role="status" aria-label="Загрузка подарков">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : error ? (
        <button className="profile-gifts__status" type="button" onClick={onRetry || onOpenAll}>
          <Icon name="gift" size={22} />
          <span>
            <strong>Не удалось загрузить подарки</strong>
            <small>Нажмите, чтобы попробовать снова</small>
          </span>
        </button>
      ) : gifts.length ? (
        <div className="profile-gifts__rail">
          {gifts.slice(0, 8).map((gift) => (
            <button
              className="profile-gift-preview"
              type="button"
              key={gift.id}
              onClick={onOpenAll}
              aria-label={hideDetails ? 'Открыть подарки' : gift.title}
              title={hideDetails ? undefined : gift.message || gift.title}
            >
              <span>
                <GiftArtwork code={gift.item_code} size={68} />
              </span>
              {!hideDetails && <strong>{gift.title}</strong>}
            </button>
          ))}
        </div>
      ) : (
        <button className="profile-gifts__status" type="button" onClick={onOpenAll}>
          <Icon name="gift" size={22} />
          <span>
            <strong>Подарков пока нет</strong>
            <small>Когда друзья что-нибудь подарят, это появится здесь</small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
    </section>
  )
}

export type ProfileInfoAction = {
  icon: IconName
  title: string
  detail?: string
  onClick: () => void
}

function formattedBirthDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function ProfileInfoSheet({
  name,
  username,
  city,
  birthDate,
  age,
  verificationTier,
  bio,
  context = [],
  actions = [],
  onClose,
  onEdit,
}: {
  name: string
  username?: string
  city?: string
  birthDate?: string
  age?: number
  verificationTier?: VerificationTier
  bio?: string
  context?: string[]
  actions?: ProfileInfoAction[]
  onClose: () => void
  onEdit?: () => void
}) {
  const verification = verificationCopy(verificationTier)
  const visibleBirthDate = formattedBirthDate(birthDate)
  const hasInfo = username || city || visibleBirthDate || age !== undefined || verification || bio || context.length || actions.length
  const { sheetRef, handleProps, expanded } = useExpandableSheet<HTMLElement>({
    onClose,
  })
  return (
    <div className="profile-info-backdrop" role="presentation">
      <button
        className="sheet-backdrop-dismiss"
        type="button"
        tabIndex={-1}
        aria-label="Закрыть сведения о профиле"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className="profile-info-sheet"
        data-sheet-expanded={expanded}
        role="dialog"
        aria-modal="true"
        aria-label={`Подробнее о ${name}`}
      >
        <button {...handleProps} />
        <header>
          <div>
            <strong>Подробнее</strong>
            <span>{name}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={22} />
          </button>
        </header>
        <div className="profile-info-sheet__body" data-sheet-scroll>
          {username && (
            <div className="profile-info-row">
              <Icon name="user" size={21} />
              <span>
                <small>Имя пользователя</small>
                <strong>@{username}</strong>
              </span>
            </div>
          )}
          {city && (
            <div className="profile-info-row">
              <Icon name="pin" size={21} />
              <span>
                <small>Город</small>
                <strong>{city}</strong>
              </span>
            </div>
          )}
          {visibleBirthDate && (
            <div className="profile-info-row">
              <Icon name="calendar" size={21} />
              <span>
                <small>Дата рождения</small>
                <strong>{visibleBirthDate}</strong>
              </span>
            </div>
          )}
          {age !== undefined && (
            <div className="profile-info-row">
              <Icon name="calendar" size={21} />
              <span>
                <small>Возраст</small>
                <strong>{age}</strong>
              </span>
            </div>
          )}
          {verification && (
            <div className="profile-info-row">
              <Icon
                name="check"
                size={21}
                className={`profile-info-row__verification-check profile-info-row__verification-check--${verificationTier}`}
              />
              <span>
                <small>{verification.short}</small>
                <strong>{verification.detail}</strong>
              </span>
            </div>
          )}
          {bio && (
            <div className="profile-info-row profile-info-row--multiline">
              <Icon name="info" size={21} />
              <span>
                <small>О себе</small>
                <strong>{bio}</strong>
              </span>
            </div>
          )}
          {context.length > 0 && (
            <div className="profile-info-section">
              <small>Общее</small>
              <div>
                {context.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          )}
          {actions.length > 0 && (
            <div className="profile-info-actions">
              {actions.map((action) => (
                <button key={action.title} type="button" onClick={action.onClick}>
                  <Icon name={action.icon} size={21} />
                  <span>
                    <strong>{action.title}</strong>
                    {action.detail && <small>{action.detail}</small>}
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              ))}
            </div>
          )}
          {!hasInfo && (
            <p className="profile-info-sheet__empty">Пользователь пока ничего о себе не добавил.</p>
          )}
        </div>
        {onEdit && (
          <div className="profile-info-sheet__action">
            <Button onClick={onEdit} variant="secondary">
              <Icon name="edit" size={18} />
              Изменить информацию
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
