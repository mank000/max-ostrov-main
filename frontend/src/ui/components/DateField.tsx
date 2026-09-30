import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ControlIcon, ControlOverlay, type ControlAnchor } from './ControlOverlay'
import { SelectField } from './SelectField'
import { dateInRange, localDateValue, parseDateValue } from './dateValues'

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Date(2000, month, 1).toLocaleDateString('ru', { month: 'long' }),
)
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const hours = Array.from({ length: 24 }, (_, i) => ({
  value: String(i).padStart(2, '0'),
  label: String(i).padStart(2, '0'),
}))
const minutes = Array.from({ length: 60 }, (_, i) => ({
  value: String(i).padStart(2, '0'),
  label: String(i).padStart(2, '0'),
}))

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  withTime?: boolean
  min?: string
  max?: string
  disabled?: boolean
  clearable?: boolean
  requireSelection?: boolean
  className?: string
}
export function DateField({
  label,
  value,
  onChange,
  withTime,
  min,
  max,
  disabled,
  clearable = false,
  requireSelection = false,
  className = 'field',
}: Props) {
  const id = useId()
  const [anchor, setAnchor] = useState<ControlAnchor | null>(null)
  const date = parseDateValue(value.slice(0, 10))
  const formatted = date?.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (
    <div className={className}>
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <button
        type="button"
        id={id}
        disabled={disabled}
        className="control-trigger"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? `${id}-popup` : undefined}
        onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      >
        <span className={date ? '' : 'control-placeholder'}>
          {formatted
            ? `${formatted}${withTime ? ` · ${value.slice(11, 16)}` : ''}`
            : withTime
              ? 'Выберите дату и время'
              : 'Выберите дату'}
        </span>
        <ControlIcon name="calendar" />
      </button>
      {anchor && (
        <ControlOverlay
          id={`${id}-popup`}
          title={label}
          anchor={anchor}
          className="date-overlay"
          onClose={() => setAnchor(null)}
        >
          <DatePicker
            value={value}
            withTime={withTime}
            min={min}
            max={max}
            clearable={clearable}
            requireSelection={requireSelection}
            onApply={(next) => {
              onChange(next)
              setAnchor(null)
            }}
          />
        </ControlOverlay>
      )}
    </div>
  )
}

function DatePicker({
  value,
  withTime,
  min,
  max,
  clearable,
  requireSelection,
  onApply,
}: Pick<Props, 'value' | 'withTime' | 'min' | 'max' | 'clearable' | 'requireSelection'> & {
  onApply: (value: string) => void
}) {
  const today = localDateValue(new Date())
  const existingDate = value.slice(0, 10)
  const existingDateValid = dateInRange(existingDate, min?.slice(0, 10), max?.slice(0, 10))
  const initial = existingDateValid
    ? value.slice(0, 10)
    : max && today > max.slice(0, 10)
      ? max.slice(0, 10)
      : min && today < min.slice(0, 10)
        ? min.slice(0, 10)
        : today
  const [selected, setSelected] = useState(initial)
  const [selectedByUser, setSelectedByUser] = useState(false)
  const [month, setMonth] = useState(() => parseDateValue(initial)!)
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')
  const [time, setTime] = useState(value.slice(11, 16) || '12:00')
  const grid = useRef<HTMLDivElement>(null)
  const choices = useRef<HTMLDivElement>(null)
  const pendingDayFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!pendingDayFocus.current) return
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${pendingDayFocus.current}"]`)?.focus()
    pendingDayFocus.current = null
  }, [month])
  useLayoutEffect(() => {
    const target =
      view === 'days'
        ? grid.current?.querySelector<HTMLElement>('[data-initial-focus]')
        : choices.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    target?.focus({ preventScroll: true })
    if (view !== 'days') target?.scrollIntoView({ block: 'center' })
  }, [view])
  function choiceKeys(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key]
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : offset === undefined
            ? undefined
            : Math.max(0, Math.min(items.length - 1, index + offset))
    if (next === undefined) return
    event.preventDefault()
    items[next]?.focus()
  }
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstYear = Number(min?.slice(0, 4) || 1900)
  const lastYear = Number(max?.slice(0, 4) || new Date().getFullYear() + 100)
  const result = withTime ? `${selected}T${time}` : selected
  const selectionMade = existingDateValid || selectedByUser
  const valid = dateInRange(result, min, max) && (!requireSelection || selectionMade)
  const allowed = (day: string) => dateInRange(day, min?.slice(0, 10), max?.slice(0, 10))
  const monthAllowed = (y: number, m: number) =>
    (!min || localDateValue(new Date(y, m + 1, 0)) >= min.slice(0, 10)) &&
    (!max || localDateValue(new Date(y, m, 1)) <= max.slice(0, 10))
  function moveMonth(delta: number) {
    setMonth(new Date(year, monthIndex + delta, 1, 12))
  }
  function dayKeys(event: KeyboardEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-day]')
    if (!button) return
    const date = parseDateValue(button.dataset.day!)!
    const day = (date.getDay() + 6) % 7
    const offset = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -day,
      End: 6 - day,
    }[event.key]
    if (offset !== undefined) date.setDate(date.getDate() + offset)
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const wantedDay = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1))
      date.setDate(
        Math.min(wantedDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()),
      )
    } else return
    event.preventDefault()
    const next = localDateValue(date)
    if (!allowed(next)) return
    pendingDayFocus.current = next
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))

  }
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const focusDay = selected.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`)
    ? selected
    : Array.from({ length: days }, (_, i) =>
        localDateValue(new Date(year, monthIndex, i + 1)),
      ).find(allowed)
  return (
    <div className="date-picker">
      <div className="date-picker__nav">
        <button
          type="button"
          className="control-icon-button"
          aria-label="Предыдущий месяц"
          disabled={!monthAllowed(year, monthIndex - 1)}
          onClick={() => {
            moveMonth(-1)
            setView('days')
          }}
        >
          <ControlIcon name="back" />
        </button>
        <button
          type="button"
          className="date-picker__heading"
          aria-label="Выбрать месяц"
          aria-expanded={view === 'months'}
          onClick={() => setView(view === 'months' ? 'days' : 'months')}
        >
          {monthNames[monthIndex]}
        </button>
        <button
          type="button"
          className="date-picker__heading"
          aria-label="Выбрать год"
          aria-expanded={view === 'years'}
          onClick={() => setView(view === 'years' ? 'days' : 'years')}
        >
          {year}
        </button>
        <button
          type="button"
          className="control-icon-button"
          aria-label="Следующий месяц"
          disabled={!monthAllowed(year, monthIndex + 1)}
          onClick={() => {
            moveMonth(1)
            setView('days')
          }}
        >
          <ControlIcon name="chevron" />
        </button>
      </div>
      <div className="date-picker__announcement" aria-live="polite">
        {monthNames[monthIndex]} {year}
      </div>
      {view === 'years' ? (
        <div ref={choices} className="date-picker__choices" aria-label="Год" onKeyDown={choiceKeys}>
          {Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).map((y) => (
            <button
              type="button"
              key={y}
              aria-pressed={y === year}
              tabIndex={y === year ? 0 : -1}
              onClick={() => {
                setMonth(
                  new Date(
                    y,
                    monthAllowed(y, monthIndex)
                      ? monthIndex
                      : min && y === firstYear
                        ? Number(min.slice(5, 7)) - 1
                        : Number(max?.slice(5, 7) || 12) - 1,
                    1,
                  ),
                )
                setView('months')
              }}
            >
              {y}
            </button>
          ))}
        </div>
      ) : view === 'months' ? (
        <div
          ref={choices}
          className="date-picker__choices"
          aria-label="Месяц"
          onKeyDown={choiceKeys}
        >
          {monthNames.map((name, i) => (
            <button
              type="button"
              key={name}
              aria-pressed={i === monthIndex}
              tabIndex={i === monthIndex ? 0 : -1}
              disabled={!monthAllowed(year, i)}
              onClick={() => {
                setMonth(new Date(year, i, 1))
                setView('days')
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : (
        <div
          ref={grid}
          className="date-picker__calendar"
          role="group"
          aria-label="Дни месяца"
          onKeyDown={dayKeys}
        >
          {weekdays.map((day) => (
            <span className="date-picker__weekday" key={day} aria-hidden="true">
              {day}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = new Date(year, monthIndex, i + 1, 12)
            const day = localDateValue(date)
            return (
              <button
                type="button"
                key={day}
                data-day={day}
                data-initial-focus={day === focusDay ? '' : undefined}
                tabIndex={day === focusDay ? 0 : -1}
                disabled={!allowed(day)}
                aria-pressed={selected === day && (!requireSelection || selectionMade)}
                aria-current={day === today ? 'date' : undefined}
                aria-label={date.toLocaleDateString('ru', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                onClick={() => {
                  setSelected(day)
                  setSelectedByUser(true)
                }}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      )}
      {withTime && (
        <div className="date-picker__time">
          <span>Время</span>
          <SelectField
            label="Часы"
            className="date-picker__time-field"
            value={time.slice(0, 2)}
            options={hours}
            onChange={(hour) => setTime(`${hour}:${time.slice(3, 5)}`)}
          />
          <span aria-hidden="true">:</span>
          <SelectField
            label="Минуты"
            className="date-picker__time-field"
            value={time.slice(3, 5)}
            options={minutes}
            onChange={(minute) => setTime(`${time.slice(0, 2)}:${minute}`)}
          />
        </div>
      )}
      <p className="date-picker__summary" aria-live="polite">
        {requireSelection && !selectionMade
          ? 'Выберите день в календаре'
          : parseDateValue(selected)?.toLocaleDateString('ru', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
        {withTime && (!requireSelection || selectionMade) ? ` · ${time}` : ''}
      </p>
      {!dateInRange(result, min, max) && (
        <p className="control-error" role="alert">
          Выберите дату и время в допустимом диапазоне.
        </p>
      )}
      <div className="date-picker__actions">
        {clearable && (
          <button type="button" className="control-secondary" onClick={() => onApply('')}>
            Очистить
          </button>
        )}
        <button
          type="button"
          className="control-primary"
          disabled={!valid}
          onClick={() => onApply(result)}
        >
          Готово
        </button>
      </div>
    </div>
  )
}
