type PlayerGlyph =
  'play' | 'pause' | 'volume' | 'muted' | 'fullscreen' | 'fullscreen-exit' | 'pip' | 'replay'

export function PlayerIcon({ name, size = 22 }: { name: PlayerGlyph; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'play') {
    return (
      <svg {...common}>
        <path
          d="M9 7.2v9.6c0 .86.94 1.39 1.68.95l7.21-4.8a1.12 1.12 0 0 0 0-1.9l-7.21-4.8A1.11 1.11 0 0 0 9 7.2Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  }
  if (name === 'pause') {
    return (
      <svg {...common}>
        <path
          d="M9 7v10M15 7v10"
          strokeWidth="2.6"
        />
      </svg>
    )
  }
  if (name === 'volume') {
    return (
      <svg {...common}>
        <path d="M5 10v4h3l4 3V7L8 10H5Z" />
        <path d="M15.2 9.2a4 4 0 0 1 0 5.6M17.7 6.8a7.4 7.4 0 0 1 0 10.4" />
      </svg>
    )
  }
  if (name === 'muted') {
    return (
      <svg {...common}>
        <path d="M5 10v4h3l4 3V7L8 10H5Z" />
        <path d="m16 10 4 4M20 10l-4 4" />
      </svg>
    )
  }
  if (name === 'pip') {
    return (
      <svg {...common}>
        <rect
          x="3.5"
          y="5"
          width="17"
          height="14"
          rx="2.2"
        />
        <rect
          x="12.5"
          y="11.5"
          width="6"
          height="4.5"
          rx="1"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  }
  if (name === 'fullscreen-exit') {
    return (
      <svg {...common}>
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      </svg>
    )
  }
  if (name === 'replay') {
    return (
      <svg {...common}>
        <path d="M5 8V4m0 0h4M5 4l3.1 3.1A7 7 0 1 1 5.7 15" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
    </svg>
  )
}
