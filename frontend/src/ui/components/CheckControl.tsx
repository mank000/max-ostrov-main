import type { ReactNode } from 'react'
import './controls.css'

export function CheckControl({
  label,
  checked,
  onChange,
  disabled,
  kind = 'checkbox',
  markPosition = 'start',
  className = '',
}: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  kind?: 'checkbox' | 'switch'
  markPosition?: 'start' | 'end'
  className?: string
}) {
  return (
    <label className={`check-control check-control--${kind} check-control--mark-${markPosition} ${className}`}>
      <input
        type="checkbox"
        role={kind === 'switch' ? 'switch' : undefined}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-control__mark" aria-hidden="true" />
      <span className="check-control__label">{label}</span>
    </label>
  )
}
