import { arcadeGames, type Kind } from './Arcade'

type TileKind = 'life' | 'dino' | 'flappy' | Kind | 'memory'

const tileBackground: Record<TileKind, string> = {
  life: '#DCEEFF',
  dino: '#FFE8C7',
  flappy: '#DDF3FF',
  rhythm: '#EAE2FF',
  color: '#DDF4EA',
  math: '#FFF0D8',
  memory: '#DDEAFF',
}

function FlatGameIcon({ kind }: { kind: TileKind }) {
  if (kind === 'life') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M8 37c0-6 4-10 10-10s10 4 10 10H8Z" fill="#65C58B" />
        <path d="M17.5 28V20" stroke="#24885A" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M17.5 23c-4.5 0-7-2.5-7.5-6.5 4.4 0 7.2 2 7.5 6.5Z" fill="#45B874" />
        <path d="M17.5 21.5c.5-4.1 3.2-6.2 7.6-6.4-.4 4.1-3 6.4-7.6 6.4Z" fill="#2EA965" />
        <rect x="26" y="13" width="10" height="24" rx="2.5" fill="#3D8DDB" />
        <rect x="29" y="17" width="2" height="3" rx="1" fill="#DCEEFF" />
        <rect x="33" y="17" width="2" height="3" rx="1" fill="#DCEEFF" />
        <rect x="29" y="23" width="2" height="3" rx="1" fill="#DCEEFF" />
        <rect x="33" y="23" width="2" height="3" rx="1" fill="#DCEEFF" />
        <path d="M39 31V18m0 0-4 4m4-4 4 4" stroke="#1A73C7" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (kind === 'dino') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M8 31c5-1 8-4 10-8l5 2c2-6 5-9 11-9 4 0 7 2 8 5-2 2-5 3-9 3v7c0 3-2 5-5 5h-9c-5 0-9-2-11-5Z" fill="#E87832" />
        <circle cx="36" cy="20" r="1.6" fill="#4B3428" />
        <path d="M20 34v5M29 34v5" stroke="#9A4B22" strokeWidth="3" strokeLinecap="round" />
        <path d="M11 31 5 34" stroke="#9A4B22" strokeWidth="3" strokeLinecap="round" />
        <path d="M39 34h4m-2-4v8" stroke="#9E733C" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M7 40h34" stroke="#C18A4C" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  }

  if (kind === 'flappy') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="35" y="5" width="8" height="13" rx="1.5" fill="#37A86E" />
        <rect x="33" y="16" width="12" height="4" rx="1.5" fill="#2F955F" />
        <rect x="35" y="31" width="8" height="12" rx="1.5" fill="#37A86E" />
        <rect x="33" y="28" width="12" height="4" rx="1.5" fill="#2F955F" />
        <circle cx="19" cy="24" r="9" fill="#F4B93F" />
        <path d="M12 24c-4 0-6 2-7 5 5 1 8 0 11-3l-4-2Z" fill="#FFFFFF" />
        <path d="m25 23 6 2-6 3" fill="#E47732" />
        <circle cx="21.5" cy="21.5" r="1.5" fill="#263A4D" />
        <path d="M15 28c2 2 5 2 7 0" stroke="#D58A1E" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  if (kind === 'rhythm') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="7" y="8" width="14" height="14" rx="4" fill="#4A9FF0" />
        <rect x="27" y="8" width="14" height="14" rx="4" fill="#F16DAF" />
        <rect x="7" y="28" width="14" height="14" rx="4" fill="#8D61E8" />
        <rect x="27" y="28" width="14" height="14" rx="4" fill="#5DB7EE" />
        <circle cx="14" cy="15" r="2" fill="#DDF3FF" />
        <circle cx="34" cy="15" r="2" fill="#FFE3F0" />
        <circle cx="14" cy="35" r="2" fill="#EFE8FF" />
        <circle cx="34" cy="35" r="2" fill="#DDF3FF" />
      </svg>
    )
  }

  if (kind === 'color') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <g transform="rotate(-8 17 22)">
          <rect x="7" y="10" width="19" height="22" rx="4" fill="#EA6268" />
          <text x="16.5" y="25.5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#FFFFFF" fontFamily="system-ui, sans-serif">A</text>
        </g>
        <g transform="rotate(7 31 29)">
          <rect x="21" y="19" width="20" height="22" rx="4" fill="#55BE78" />
          <text x="31" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="#163D2C" fontFamily="system-ui, sans-serif">Aa</text>
        </g>
        <path d="M39 10v5M36.5 12.5h5" stroke="#259666" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  if (kind === 'math') {
    return (
      <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="6" y="8" width="17" height="17" rx="4" fill="#E9A72B" />
        <path d="M14.5 12.5v8m-4-4h8" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="27" y="8" width="15" height="17" rx="4" fill="#4F8DDD" />
        <path d="M31 16.5h7" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="17" y="28" width="18" height="15" rx="4" fill="#8060D8" />
        <path d="m22.5 32.5 7 6m0-6-7 6" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M6 33h5M5 38h8" stroke="#D1841E" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g transform="rotate(-8 18 25)">
        <rect x="7" y="12" width="23" height="28" rx="5" fill="#4C8FE6" />
        <path d="m18.5 18 2.1 4.2 4.6.7-3.3 3.2.8 4.5-4.2-2.2-4.1 2.2.8-4.5-3.3-3.2 4.6-.7 2-4.2Z" fill="#DDEAFF" />
      </g>
      <g transform="rotate(7 31 25)">
        <rect x="21" y="10" width="21" height="29" rx="5" fill="#9CC1F2" />
        <path d="m31.5 17 1.9 3.9 4.3.6-3.1 3 .7 4.2-3.8-2-3.9 2 .8-4.2-3.1-3 4.3-.6 1.8-3.9Z" fill="#2F72C8" />
      </g>
    </svg>
  )
}

function GameTile({ kind }: { kind: TileKind }) {
  return (
    <span
      className="game-row__icon"
      style={{ background: tileBackground[kind], overflow: 'hidden' }}
      aria-hidden="true"
    >
      <FlatGameIcon kind={kind} />
    </span>
  )
}

export function Home({
  onMemory,
  onArcade,
  onFlappy,
  onDino,
  onLife,
  balance,
}: {
  onMemory: () => void
  onArcade?: (kind: Kind) => void
  onFlappy?: () => void
  onDino?: () => void
  onLife?: () => void
  balance: number | null
}) {
  return (
    <main className="scroll games-home">
      {onArcade && (
        <div className="arcade-wallet">
          <span>
            Твои монеты<strong>{balance === null ? '…' : balance} ◉</strong>
          </span>
          <p>
            Хорошо сыграл — получишь монеты
            <br />
            <b>+3 за 6 правильных ответов из 8</b>
          </p>
        </div>
      )}
      <p className="intro">Есть несколько минут? Выбирай игру.</p>
      <div className="game-list">
        {onLife && (
          <button className="game-row" type="button" onClick={onLife}>
            <GameTile kind="life" />
            <span className="game-row__copy">
              <strong>Жизнь</strong>
              <small>С нуля до транснациональной корпорации</small>
            </span>
            <span className="game-row__action">Долгая игра</span>
          </button>
        )}
        {onDino && (
          <button className="game-row" type="button" onClick={onDino}>
            <GameTile kind="dino" />
            <span className="game-row__copy">
              <strong>Дино-рывок</strong>
              <small>Беги, прыгай, меняй биомы и побеждай события</small>
            </span>
            <span className="game-row__action">◉ в забеге</span>
          </button>
        )}
        {onFlappy && (
          <button className="game-row" type="button" onClick={onFlappy}>
            <GameTile kind="flappy" />
            <span className="game-row__copy">
              <strong>Птичка</strong>
              <small>Пролетай между трубами и собирай монеты</small>
            </span>
            <span className="game-row__action">◉ в игре</span>
          </button>
        )}
        {onArcade &&
          arcadeGames.map((game) => (
            <button
              className="game-row"
              key={game.kind}
              onClick={() => onArcade(game.kind)}
            >
              <GameTile kind={game.kind} />
              <span className="game-row__copy">
                <strong>{game.title}</strong>
                <small>{game.description}</small>
              </span>
              <span className="game-row__action">+3 ◉</span>
            </button>
          ))}
        <button className="game-row" type="button" onClick={onMemory}>
          <GameTile kind="memory" />
          <span className="game-row__copy">
            <strong>Найди пару</strong>
            <small>Тренировка памяти · таблица лидеров</small>
          </span>
          <span className="game-row__arrow" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
      {onArcade && (
        <p className="note">
          За новые игры можно заработать до 30 монет за сутки. Набрал максимум —
          просто возвращайся позже. Монеты сразу появляются в профиле.
        </p>
      )}
    </main>
  )
}
