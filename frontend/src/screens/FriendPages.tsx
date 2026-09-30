import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadEventInvitations, resolveEventInvitation, type EventInvitation } from '../api/events'
import { type Post, type PostMedia } from '../api/posts'
import {
  loadFriendRequests,
  loadUserSuggestions,
  resolveFriendRequest,
  searchUsers,
  type Friend,
  type UserSearchResult,
  type UserSuggestion,
} from '../api/users'
import type { HostAdapter } from '../host'
import { cancelFriendRequest } from '../participants-api'
import { Button, Cell, Header, SearchField, StatePanel, Tabs } from '../ui/components/BasicUI'
import { PersonRow } from '../ui/components/ContentCards'
import { type MenuAnchor } from '../ui/components/ContextMenu'
import type { AppDataResult } from '../useAppData'
import './social.css'

export type SocialProps = {
  id?: number
  initialTab?: 'posts' | 'photos' | 'tagged'
  anchor?: MenuAnchor
  back: () => void
  navigate: (view: string, id?: number, anchor?: MenuAnchor) => void
  data: AppDataResult
  onLike: (post: Post) => Promise<boolean>
  onError: (message: string) => void
  confirm: (config: {
    title: string
    description?: string
    confirm: string
    onConfirm: () => void
    destructive?: boolean
  }) => void
  host: HostAdapter
  openMedia: (media: PostMedia | string, items?: PostMedia[]) => void
}

function peopleQuery(query: string): string | null {
  const value = query.trim().replace(/^@/, '')
  return value.length >= 2 && value.length <= 80 ? value : null
}

export function FriendRequestsScreen({ back, navigate, data, onError }: SocialProps) {
  const [requests, setRequests] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [outgoing, setOutgoing] = useState<Friend[]>([])
  const [outgoingLoading, setOutgoingLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('incoming')
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const [incomingResult, outgoingResult] = await Promise.allSettled([
        loadFriendRequests(controller.signal),
        loadFriendRequests(controller.signal, 'outgoing'),
      ])
      if (controller.signal.aborted) return
      if (incomingResult.status === 'fulfilled') setRequests(incomingResult.value)
      if (outgoingResult.status === 'fulfilled') setOutgoing(outgoingResult.value)
      if (incomingResult.status === 'rejected' || outgoingResult.status === 'rejected')
        setError('Не удалось загрузить все заявки. Откройте экран ещё раз.')
      setLoading(false)
      setOutgoingLoading(false)
    }
    void load()
    return () => controller.abort()
  }, [])
  async function resolve(id: number, accept: boolean) {
    try {
      await resolveFriendRequest(id, accept)
      setRequests((current) => current.filter((item) => item.user.id !== id))
      data.refresh('friends', 'inbox')
    } catch {
      setError('Не удалось обработать заявку. Попробуйте ещё раз.')
    }
  }
  async function cancelOutgoing(id: number) {
    try {
      await cancelFriendRequest(id)
      setOutgoing((current) => current.filter((item) => item.user.id !== id))
      data.refresh('friends', 'inbox')
    } catch {
      setError('Не удалось отменить заявку. Попробуйте ещё раз.')
    }
  }
  return (
    <>
      <Header title="Заявки в друзья" back={back} />
      <Tabs
        items={[
          { id: 'incoming', label: 'Входящие' },
          { id: 'outgoing', label: 'Исходящие' },
          { id: 'invitations', label: 'Приглашения' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen-scroll">
        {error && (
          <p className="error-text social-request-error" role="alert">
            {error}
          </p>
        )}
        {tab === 'incoming' &&
          (loading ? (
            <StatePanel title="" loading />
          ) : requests.length ? (
            requests.map((item) => (
              <div className="request-row" key={item.user.id}>
                <PersonRow
                  person={item.user}
                  onClick={() => navigate('userprofile', item.user.id)}
                />
                <div>
                  <Button onClick={() => void resolve(item.user.id, true)}>Принять</Button>
                  <Button variant="secondary" onClick={() => void resolve(item.user.id, false)}>
                    Отклонить
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <StatePanel title="Пока нет заявок" />
          ))}
        {tab === 'outgoing' &&
          (outgoingLoading ? (
            <StatePanel title="" loading />
          ) : outgoing.length ? (
            outgoing.map((item) => (
              <div className="request-row" key={item.user.id}>
                <PersonRow
                  person={item.user}
                  detail="Заявка отправлена"
                  onClick={() => navigate('userprofile', item.user.id)}
                />
                <div>
                  <Button variant="secondary" onClick={() => void cancelOutgoing(item.user.id)}>
                    Отменить заявку
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <StatePanel
              title="Нет отправленных заявок"
              description="Здесь появятся заявки, ожидающие ответа."
              action="Найти людей"
              onAction={() => navigate('friendsearch')}
            />
          ))}
        {tab === 'invitations' && (
          <InvitationsPreview navigate={navigate} onError={onError} data={data} />
        )}
      </div>
    </>
  )
}

function InvitationsPreview({
  navigate,
  onError,
  data,
}: {
  navigate: (view: string, id?: number) => void
  onError: (message: string) => void
  data: AppDataResult
}) {
  const [items, setItems] = useState<EventInvitation[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    loadEventInvitations(controller.signal)
      .then(setItems)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [onError])

  async function resolve(item: EventInvitation, accept: boolean) {
    const key = `${item.event_id}:${item.sender.id}`
    if (busy) return
    setBusy(key)
    try {
      await resolveEventInvitation(item.event_id, item.sender.id, accept)
      setItems((current) =>
        current.filter(
          (value) => value.event_id !== item.event_id || value.sender.id !== item.sender.id,
        ),
      )
      if (accept) data.setParticipatingEventIds((current) => new Set(current).add(item.event_id))
      data.refresh('activity', 'recommendations', 'inbox')
      if (accept) navigate('event', item.event_id)
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {items.map((item) => {
        const key = `${item.event_id}:${item.sender.id}`
        return (
          <div className="request-row" key={key}>
            <Cell
              icon="calendar"
              title={item.event_title}
              detail={`От ${item.sender.display_name}`}
              onClick={() => navigate('event', item.event_id)}
            />
            <div>
              <Button disabled={busy !== null} onClick={() => void resolve(item, true)}>
                {busy === key ? 'Подождите…' : 'Пойти'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void resolve(item, false)}
              >
                Отклонить
              </Button>
            </div>
          </div>
        )
      })}
      <Cell icon="users" title="Приглашения в группы" onClick={() => navigate('groupincoming')} />
      {!items.length && <StatePanel title="Других приглашений пока нет" />}
    </>
  )
}

export function FriendSearchScreen({ back, navigate }: SocialProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [suggestionsError, setSuggestionsError] = useState(false)
  const [suggestionsRevision, setSuggestionsRevision] = useState(0)
  const currentSuggestionsRevision = useRef(suggestionsRevision)
  useLayoutEffect(() => {
    currentSuggestionsRevision.current = suggestionsRevision
  }, [suggestionsRevision])
  useEffect(() => {
    const requestedRevision = suggestionsRevision
    const controller = new AbortController()
    setSuggestionsLoading(true)
    setSuggestionsError(false)
    loadUserSuggestions(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted && currentSuggestionsRevision.current === requestedRevision)
          setSuggestions(items)
      })
      .catch(() => {
        if (!controller.signal.aborted && currentSuggestionsRevision.current === requestedRevision)
          setSuggestionsError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted && currentSuggestionsRevision.current === requestedRevision)
          setSuggestionsLoading(false)
      })
    return () => controller.abort()
  }, [suggestionsRevision])
  useEffect(() => {
    const searchQuery = peopleQuery(query)
    setResults([])
    setSearchError(false)
    if (!searchQuery) return
    setLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchUsers(searchQuery, controller.signal)
        .then(setResults)
        .catch(() => {
          if (!controller.signal.aborted) setSearchError(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 260)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])
  const effectiveLength = query.trim().replace(/^@/, '').length
  return (
    <>
      <Header title="Поиск людей" back={back} />
      <div className="screen-scroll">
        <div className="social-search">
          <SearchField value={query} onChange={setQuery} placeholder="Имя или @username" />
        </div>
        {effectiveLength > 80 ? (
          <StatePanel title="Слишком длинный запрос" description="Введите не больше 80 символов." />
        ) : effectiveLength === 1 ? (
          <StatePanel
            title="Введите ещё один символ"
            description="Поиск начинается с двух символов."
          />
        ) : effectiveLength === 0 ? (
          <section aria-labelledby="friend-suggestions-title">
            <h2 id="friend-suggestions-title" className="social-suggestions-title">
              Вам могут быть интересны
            </h2>
            {suggestionsLoading ? (
              <StatePanel title="" loading />
            ) : suggestionsError ? (
              <StatePanel
                title="Не удалось загрузить рекомендации"
                action="Повторить"
                onAction={() => setSuggestionsRevision((value) => value + 1)}
              />
            ) : suggestions.length ? (
              suggestions.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  detail={[person.reason, person.city].filter(Boolean).join(' · ')}
                  onClick={() => navigate('userprofile', person.id)}
                />
              ))
            ) : (
              <StatePanel
                title="Пока нет рекомендаций"
                description="Здесь появятся люди из ваших мероприятий и по общим интересам."
              />
            )}
          </section>
        ) : loading ? (
          <StatePanel title="" loading />
        ) : searchError ? (
          <StatePanel
            title="Не удалось выполнить поиск"
            description="Попробуйте ещё раз чуть позже."
          />
        ) : results.length ? (
          results.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              detail={person.city || person.bio}
              onClick={() => navigate('userprofile', person.id)}
            />
          ))
        ) : (
          <StatePanel
            title="Никого не найдено"
            description="Попробуйте другое имя или имя пользователя."
          />
        )}
      </div>
    </>
  )
}
