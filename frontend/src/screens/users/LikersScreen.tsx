import { useEffect, useState } from 'react'
import { loadPostLikes, type PostLiker } from '../../api/posts'
import { Header, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import type { SocialProps } from '../FriendPages'
import '../social.css'

export function LikersScreen({ id, back, navigate, onError }: SocialProps) {
  const [people, setPeople] = useState<PostLiker[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    loadPostLikes(id, controller.signal)
      .then(setPeople)
      .catch((error) => onError(String(error)))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [id, onError])
  return (
    <>
      <Header title="Понравилось" back={back} />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : people.length ? (
          people.map((person) => (
            <PersonRow
              key={person.id}
              person={{ ...person, city: '' }}
              onClick={() => navigate('userprofile', person.id)}
            />
          ))
        ) : (
          <StatePanel title="Пока нет отметок" />
        )}
      </div>
    </>
  )
}
