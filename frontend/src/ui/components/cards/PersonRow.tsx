import type { ReactNode } from 'react'
import { type UserSearchResult } from '../../../api/users'
import { compactLastSeen } from '../../../presence'
import { Avatar, Icon } from '../BasicUI'
import '../cards.css'

export function PersonRow({
  person,
  detail,
  onClick,
  trailing,
  showChevron = true,
  presence,
}: {
  person: Pick<UserSearchResult, 'id' | 'display_name' | 'photo_url'> & {
    city?: string
  }
  detail?: string
  onClick: () => void
  trailing?: ReactNode
  showChevron?: boolean
  presence?: { online?: boolean; lastSeenAt?: string }
}) {
  const lastSeen = presence && !presence.online ? compactLastSeen(presence.lastSeenAt) : ''
  return (
    <button className="person-row" type="button" onClick={onClick}>
      <span className="person-row__avatar">
        <Avatar name={person.display_name} url={person.photo_url} size={44} />
        {presence?.online ? (
          <span
            className="person-row__presence person-row__presence--online"
            role="img"
            aria-label="В сети"
          />
        ) : lastSeen ? (
          <span
            className="person-row__presence person-row__presence--away"
            role="img"
            aria-label={`Был(а) в сети ${lastSeen} назад`}
          >
            {lastSeen}
          </span>
        ) : null}
      </span>
      <span className="person-row__text">
        <strong>{person.display_name}</strong>
        <small>{detail ?? person.city}</small>
      </span>
      {trailing ||
        (showChevron ? <Icon name="chevron" size={20} className="person-row__chevron" /> : null)}
    </button>
  )
}
