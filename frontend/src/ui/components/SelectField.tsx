import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ControlIcon, ControlOverlay, type ControlAnchor } from './ControlOverlay'

export type SelectOption = { value: string; label: string; disabled?: boolean }

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Выберите',
  className = 'field',
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<ControlAnchor | null>(null)
  const [search, setSearch] = useState('')
  const typeahead = useRef({ text: '', time: 0 })
  const selected = options.find((option) => option.value === value)
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')),
  )
  const close = () => {
    setAnchor(null)
    setSearch('')
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'),
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey) {
      const now = Date.now()
      const text =
        (now - typeahead.current.time > 600 ? '' : typeahead.current.text) +
        event.key.toLocaleLowerCase('ru')
      typeahead.current = { text, time: now }
      next = items.findIndex((item) => item.textContent?.toLocaleLowerCase('ru').startsWith(text))
    } else return
    event.preventDefault()
    items[next]?.focus()
  }
  return (
    <div className={className}>
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <button
        type="button"
        id={id}
        className="control-trigger"
        disabled={disabled || options.length === 0}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? `${id}-popup` : undefined}
        onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      >
        <span className={selected ? '' : 'control-placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <ControlIcon name="chevron" />
      </button>
      {anchor && (
        <ControlOverlay title={label} id={`${id}-popup`} anchor={anchor} onClose={close}>
          {options.length > 10 && (
            <input
              className="control-search"
              type="search"
              aria-label={`Поиск: ${label}`}
              placeholder="Поиск"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
                    ?.focus()
                }
              }}
            />
          )}
          <div className="control-options" role="listbox" aria-label={label} onKeyDown={navigate}>
            {visible.map((option) => (
              <button
                type="button"
                role="option"
                key={option.value}
                aria-selected={option.value === value}
                tabIndex={
                  option.value === value ||
                  (!visible.some((item) => item.value === value) &&
                    option === visible.find((item) => !item.disabled))
                    ? 0
                    : -1
                }
                className="control-option"
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  close()
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <ControlIcon name="check" />}
              </button>
            ))}
          </div>
          {!visible.length && (
            <p className="control-empty" role="status">
              Ничего не найдено
            </p>
          )}
        </ControlOverlay>
      )}
    </div>
  )
}
