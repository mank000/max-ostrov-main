import { type ReactNode } from 'react'

export function Icon({
  name,
  size = 20,
}: {
  name:
  | 'queue'
  | 'person'
  | 'post'
  | 'event'
  | 'comment'
  | 'journal'
  | 'team'
  | 'arrow'
  | 'close'
  | 'menu'
  | 'check'
  | 'lock'
  | 'logout'
  | 'refresh'
  size?: number
}) {
  const paths: Record<typeof name, ReactNode> = {
    queue: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 14h7" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6" />
      </>
    ),
    post: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    event: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    comment: <path d="M20 11a8 8 0 0 1-8 8H5l1.8-3.2A8 8 0 1 1 20 11Z" />,
    journal: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M2.5 20c.4-3.7 2.5-5.5 6.5-5.5s6.1 1.8 6.5 5.5M17 5a3 3 0 0 1 0 6M17.5 15c2.4.4 3.7 2 4 5" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    close: <path d="M5 5 19 19M19 5 5 19" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    check: <path d="m4 12 5 5L20 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2" />
      </>
    ),
  }
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand__mark" aria-hidden="true">
        M
      </div>
      <div>
        <strong>Кутёж</strong>
        <span>Модерация</span>
      </div>
    </div>
  )
}

export function dateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ru', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
}
