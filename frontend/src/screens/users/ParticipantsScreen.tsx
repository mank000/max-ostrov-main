import { useEffect, useState } from 'react'
import { loadEventParticipants, type EventParticipant } from '../../participants-api'
import { Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { SocialProps } from '../FriendPages'
import '../social.css'

export function ParticipantsScreen({ id, back, navigate, data }: SocialProps) {
  const [people, setPeople] = useState<EventParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    loadEventParticipants(id, controller.signal)
      .then(setPeople)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить участников')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [id])
  return (
    <>
      <Header title="Участники мероприятия" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : error ? (
          <StatePanel title="Участники недоступны" description={error} />
        ) : people.length ? (
          people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              detail={[person.is_organizer ? 'Организатор' : '', person.city || person.bio]
                .filter(Boolean)
                .join(' · ')}
              onClick={() =>
                navigate(person.id === data.profile?.id ? 'profile' : 'userprofile', person.id)
              }
            />
          ))
        ) : (
          <StatePanel title="Пока нет участников" />
        )}
      </div>
    </>
  )
}
