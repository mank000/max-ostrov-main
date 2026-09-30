import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadAllFriends, type UserSearchResult } from '../api/users'
import { loadEventParticipants } from '../participants-api'
import { Header, Icon, SearchField, StatePanel } from '../ui/components/BasicUI'
import { PersonRow } from '../ui/components/ContentCards'

const POST_TAG_LIMIT = 20

function filterTagCandidates(people: UserSearchResult[], viewerId: number, query: string) {
  const needle = query.trim().replace(/^@/, '').toLocaleLowerCase('ru')
  return [
    ...new Map(
      people.filter((person) => person.id !== viewerId).map((person) => [person.id, person]),
    ).values(),
  ].filter(
    (person) =>
      !needle ||
      `${person.display_name} ${person.username || ''}`.toLocaleLowerCase('ru').includes(needle),
  )
}

export function TagPeoplePicker({
  eventId,
  viewerId,
  selected,
  onChange,
  onClose,
}: {
  eventId?: number
  viewerId: number
  selected: UserSearchResult[]
  onChange: (people: UserSearchResult[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<UserSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const currentAttempt = useRef(attempt)
  useLayoutEffect(() => {
    currentAttempt.current = attempt
  }, [attempt])
  useEffect(() => {
    const requestedAttempt = attempt
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setPeople([])
    const load = async () => {
      const candidates: UserSearchResult[] = eventId
        ? await loadEventParticipants(eventId, controller.signal)
        : (await loadAllFriends(controller.signal)).map((friend) => ({
          ...friend.user,
          bio: '',
          interests: [],
        }))
      if (!controller.signal.aborted && currentAttempt.current === requestedAttempt)
        setPeople(candidates)
    }
    void load()
      .catch((cause) => {
        if (!controller.signal.aborted && currentAttempt.current === requestedAttempt)
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить людей')
      })
      .finally(() => {
        if (!controller.signal.aborted && currentAttempt.current === requestedAttempt)
          setLoading(false)
      })
    return () => controller.abort()
  }, [eventId, attempt])
  const visible = useMemo(
    () => filterTagCandidates(people, viewerId, query),
    [people, viewerId, query],
  )
  function toggle(person: UserSearchResult) {
    if (selected.some((item) => item.id === person.id)) {
      onChange(selected.filter((item) => item.id !== person.id))
    } else if (selected.length < POST_TAG_LIMIT) {
      onChange([...selected, person])
    }
  }
  return (
    <>
      <Header title="Отметить участников" back={onClose} />
      <div className="screen-scroll">
        <div className="extra-pad">
          <SearchField value={query} onChange={setQuery} placeholder="Найти человека" />
        </div>
        <p className="tag-picker-summary">
          {eventId ? 'Участники мероприятия' : 'Ваши друзья'} · выбрано {selected.length}/
          {POST_TAG_LIMIT}
        </p>
        {loading ? (
          <StatePanel title="" loading />
        ) : error ? (
          <StatePanel
            title="Не удалось загрузить людей"
            description={error}
            action="Повторить"
            onAction={() => setAttempt((value) => value + 1)}
          />
        ) : visible.length ? (
          visible.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              onClick={() => toggle(person)}
              trailing={
                selected.some((item) => item.id === person.id) ? (
                  <Icon name="check" size={20} />
                ) : undefined
              }
            />
          ))
        ) : (
          <StatePanel
            title={
              query.trim() ? 'Никого не нашли' : eventId ? 'Некого отметить' : 'Пока нет друзей'
            }
            description={
              query.trim()
                ? 'Попробуйте другое имя или имя пользователя.'
                : eventId
                  ? 'Здесь появятся участники мероприятия, которых можно отметить.'
                  : 'Добавьте друзей, чтобы отмечать их в публикациях.'
            }
          />
        )}
        {selected.length >= POST_TAG_LIMIT && (
          <p className="tag-picker-summary" role="status">
            Можно отметить до {POST_TAG_LIMIT} человек. Снимите отметку, чтобы выбрать другого.
          </p>
        )}
      </div>
    </>
  )
}
