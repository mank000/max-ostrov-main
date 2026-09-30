import { mediaURL } from '../../api/credentials'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useId } from 'react'
import { DateField } from './DateField'
import { ControlOverlay } from './ControlOverlay'
import '../tokens.css'
import './primitives.css'

export type IconName =
  | 'home'
  | 'search'
  | 'map'
  | 'users'
  | 'user'
  | 'plus'
  | 'bell'
  | 'back'
  | 'chevron'
  | 'close'
  | 'heart'
  | 'comment'
  | 'share'
  | 'bookmark'
  | 'pin'
  | 'calendar'
  | 'time'
  | 'more'
  | 'settings'
  | 'edit'
  | 'photo'
  | 'send'
  | 'message'
  | 'check'
  | 'filter'
  | 'globe'
  | 'location'
  | 'gift'
  | 'award'
  | 'coins'
  | 'lock'
  | 'download'
  | 'trash'
  | 'external'
  | 'info'
  | 'star'
  | 'link'
  | 'paperclip'
  | 'music'
  | 'film'
  | 'sport'
  | 'game'
  | 'palette'
  | 'coffee'
  | 'code'
  | 'camera'
  | 'sun'
  | 'moon'

export function Icon({
  name,
  size = 24,
  className = '',
}: {
  name: IconName
  size?: number
  className?: string
}) {
  const mask = `url("/assets/figma/final/icons/${name}.svg")`
  return (
    <span
      className={`ui-icon ${className}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  )
}

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="count-badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  size = 24,
  badge = 0,
}: {
  icon: IconName
  label: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  size?: number
  badge?: number
}) {
  return (
    <button
      className={`icon-button ${active ? 'is-active' : ''}`}
      type="button"
      aria-label={badge > 0 ? `${label}: ${badge} новых` : label}
      onClick={onClick}
    >
      <span className="icon-button__icon">
        <Icon name={icon} size={size} />
        <CountBadge count={badge} />
      </span>
    </button>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'destructive'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      className={`ui-button ui-button--${variant} ${className}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function Avatar({ name, url, size = 44 }: { name: string; url?: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('ru'))
    .join('')
  return (
    <span
      className="avatar"
      style={
        {
          width: size,
          height: size,
          fontSize: size >= 80 ? 24 : 14,
        } as CSSProperties
      }
    >
      {url ? <img src={mediaURL(url)} alt="" /> : initials}
    </span>
  )
}

export function Header({
  title,
  back,
  actions,
  centered = false,
  emphasized = false,
}: {
  title: string
  back?: () => void
  actions?: ReactNode
  centered?: boolean
  emphasized?: boolean
}) {
  return (
    <header
      className={`app-header ${back ? 'app-header--nested' : ''} ${centered ? 'app-header--centered' : ''} ${emphasized ? 'app-header--emphasized' : ''}`}
    >
      {back && <IconButton icon="back" label="Назад" onClick={back} />}
      <h1>{title}</h1>
      {actions && <div className="app-header__actions">{actions}</div>}
    </header>
  )
}

const navigation: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'feed', label: 'Лента', icon: 'home' },
  { id: 'events', label: 'Мероприятия', icon: 'search' },
  { id: 'map', label: 'Карта', icon: 'map' },
  { id: 'friends', label: 'Друзья', icon: 'users' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
]

export function BottomNavigation({
  current,
  onSelect,
  badges = {},
}: {
  current: string
  onSelect: (id: string) => void
  badges?: Partial<Record<string, number>>
}) {
  return (
    <nav className="bottom-navigation" aria-label="Основная навигация">
      {navigation.map((item) => {
        const badge = badges[item.id] || 0
        return (
          <button
            key={item.id}
            type="button"
            aria-label={badge > 0 ? `${item.label}: ${badge} новых` : item.label}
            className={`bottom-navigation__item ${current === item.id ? 'is-active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <span className="bottom-navigation__icon">
              <Icon name={item.icon} size={24} />
              <CountBadge count={badge} />
            </span>
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={`tabs__item ${value === item.id ? 'is-active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  onFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  onFocus?: () => void
}) {
  return (
    <div className="search-field">
      <Icon name="search" size={24} />
      <input
        type="search"
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
      />
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  type = 'text',
  min, max, clearable, maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  type?: string
  min?: string
  max?: string
  clearable?: boolean
  maxLength?: number
}) {
  const id = useId()
  if (type === 'date' || type === 'datetime-local') return <DateField label={label} value={value} onChange={onChange} withTime={type === 'datetime-local'} min={min} max={max} clearable={clearable} />
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

export function Cell({
  icon,
  title,
  detail,
  onClick,
  trailing,
}: {
  icon?: IconName
  title: string
  detail?: string
  onClick?: () => void
  trailing?: ReactNode
}) {
  return (
    <button className="cell" type="button" onClick={onClick}>
      {icon && <Icon name={icon} size={24} className="cell__icon" />}
      <span className="cell__copy">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      {trailing || <Icon name="chevron" size={20} className="cell__chevron" />}
    </button>
  )
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button className={`chip ${active ? 'is-active' : ''}`} type="button" aria-pressed={Boolean(active)} onClick={onClick}>
      {children}
    </button>
  )
}

export function StatePanel({
  title,
  description,
  action,
  onAction,
  loading,
}: {
  title: string
  description?: string
  action?: string
  onAction?: () => void
  loading?: boolean
}) {
  if (loading)
    return (
      <div className="state-panel state-panel--loading" role="status" aria-label="Загрузка">
        <div />
        <div />
        <div />
      </div>
    )
  return (
    <div className="state-panel">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && onAction && <Button onClick={onAction}>{action}</Button>}
    </div>
  )
}

export function Dialog({
  title,
  description,
  confirm,
  cancel = 'Отмена',
  destructive,
  onConfirm,
  onClose,
}: {
  title: string
  description?: string
  confirm: string
  cancel?: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <ControlOverlay title={title} onClose={onClose} className="confirmation-overlay">
      {description && <p className="confirmation-overlay__description">{description}</p>}
      <div className="confirmation-overlay__actions">
        <Button variant="secondary" onClick={onClose}>{cancel}</Button>
        <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>{confirm}</Button>
      </div>
    </ControlOverlay>
  )
}
