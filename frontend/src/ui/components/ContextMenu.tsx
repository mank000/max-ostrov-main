import { type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './BasicUI'
import { ControlOverlay, type ControlAnchor } from './ControlOverlay'
import './context-menu.css'

export type MenuAnchor = ControlAnchor

export function menuAnchorFromRect(rect: DOMRect): MenuAnchor {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
}

export function MaxContextMenu({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor?: MenuAnchor
  label: string
  onClose: () => void
  children: ReactNode
}) {
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    items[next]?.focus()
  }
  return (
    <ControlOverlay title={label} anchor={anchor} onClose={onClose} className="action-menu-overlay">
      <div
        className="max-context-menu"
        role="menu"
        aria-label={label}
        onKeyDown={navigate}
      >
        {children}
      </div>
    </ControlOverlay>
  )
}

export function MaxContextMenuItem({
  label,
  icon,
  destructive = false,
  disabled = false,
  loading = false,
  onClick,
}: {
  label: string
  icon?: IconName
  destructive?: boolean
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-busy={loading || undefined}
      className={`max-context-menu__item ${destructive ? 'is-destructive' : ''} ${loading ? 'is-loading' : ''}`}
      disabled={disabled || loading}
      onClick={onClick}
    >
      <span>{label}</span>
      {loading ? (
        <span className="max-context-menu__loading-icon" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={22} />
      )}
    </button>
  )
}
