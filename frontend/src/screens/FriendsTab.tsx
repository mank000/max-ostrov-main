import { useEffect, useRef, useState } from 'react'
import { reportUser } from '../api/reports'
import {
  loadUserSuggestions,
  removeFriend,
  searchUsers,
  setBlocked,
  type Friend,
  type UserSearchResult,
  type UserSuggestion,
} from '../api/users'
import { PRESENCE_PROFILE_REFRESH_MS } from '../presence'
import {
  Button,
  CountBadge,
  Field,
  Header,
  Icon,
  IconButton,
  SearchField,
  StatePanel,
} from '../ui/components/BasicUI'
import { PersonRow } from '../ui/components/ContentCards'
import {
  MaxContextMenu,
  MaxContextMenuItem,
  menuAnchorFromRect,
  type MenuAnchor,
} from '../ui/components/ContextMenu'
import type { AppDataResult } from '../useAppData'
import { useDeviceLayout } from '../app/useDeviceLayout'
import './main.css'
import type { Confirm, Navigate } from './tab-types'

export function FriendsScreen({
  data,
  navigate,
  onMessage,
  onError,
  confirm,
}: {
  data: AppDataResult
  navigate: Navigate
  onMessage: (userId: number) => void
  onError: (message: string) => void
  confirm: Confirm
}) {
  const desktop = useDeviceLayout()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [suggestionsRevision, setSuggestionsRevision] = useState(0)
  const searchRevision = useRef(0)
  const requests = data.friendRequestCount
  const [actionFriend, setActionFriend] = useState<Friend | null>(null)
  const [friendMenuAnchor, setFriendMenuAnchor] = useState<MenuAnchor | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<number>>(() => new Set())

  const availableFriends = data.friends.filter((friend) => !removedIds.has(friend.user.id))
  const birthdayFriends = data.birthdayFriends.filter((friend) => !removedIds.has(friend.user.id))
  const removedLoadedCount = data.friends.filter((friend) => removedIds.has(friend.user.id)).length
  const visibleFriendCount = Math.max(0, data.friendCount - removedLoadedCount)
  const searchTerm = query.trim().replace(/^@/, '')
  const normalizedSearchTerm = searchTerm.toLocaleLowerCase('ru')
  const hasQuery = searchTerm.length > 0
  const matchingFriends = hasQuery
    ? availableFriends.filter((friend) =>
      `${friend.user.display_name} ${friend.user.username || ''}`
        .toLocaleLowerCase('ru')
        .includes(normalizedSearchTerm),
    )
    : availableFriends
  const friendIds = new Set(availableFriends.map((friend) => friend.user.id))
  const searchedFriends = searchResults.filter(
    (person) => person.friend_request_status === 'friend' && !friendIds.has(person.id) && !removedIds.has(person.id),
  )
  const otherSearchResults = searchResults.filter(
    (person) =>
      person.id !== data.profile?.id &&
      !friendIds.has(person.id) &&
      person.friend_request_status !== 'friend',
  )
  const visibleSuggestions = suggestions.filter(
    (person) =>
      person.id !== data.profile?.id &&
      !friendIds.has(person.id) &&
      person.friend_request_status !== 'friend',
  )

  useEffect(() => {
    const controller = new AbortController()
    setSuggestionsLoading(true)
    setSuggestionsError('')
    loadUserSuggestions(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setSuggestions(items)
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSuggestionsError(
            error instanceof Error ? error.message : 'Не удалось загрузить рекомендации',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setSuggestionsLoading(false)
      })
    return () => controller.abort()
  }, [suggestionsRevision])

  useEffect(() => {
    const revision = ++searchRevision.current
    const controller = new AbortController()
    const value = query.trim().replace(/^@/, '')
    setSearchError('')
    setSearchResults([])

    if (value.length < 2 || value.length > 80) {
      setSearchResults([])
      setSearchLoading(false)
      return () => controller.abort()
    }

    setSearchLoading(true)
    const timer = window.setTimeout(() => {
      searchUsers(value, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted && searchRevision.current === revision)
            setSearchResults(items)
        })
        .catch((error) => {
          if (!controller.signal.aborted && searchRevision.current === revision) {
            setSearchResults([])
            setSearchError(error instanceof Error ? error.message : 'Не удалось выполнить поиск')
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && searchRevision.current === revision)
            setSearchLoading(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    const refreshPresence = () => {
      if (!document.hidden) void data.refreshFriendPresence()
    }
    const timer = window.setInterval(refreshPresence, PRESENCE_PROFILE_REFRESH_MS)
    const onVisible = () => {
      if (!document.hidden) refreshPresence()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [data.refreshFriendPresence])

  function closeActions() {
    if (busy) return
    setActionFriend(null)
    setFriendMenuAnchor(null)
    setReporting(false)
    setReason('')
  }

  function removeSelected(friend: Friend) {
    setActionFriend(null)
    setFriendMenuAnchor(null)
    confirm({
      title: `Удалить ${friend.user.display_name} из друзей?`,
      confirm: 'Удалить',
      destructive: true,
      onConfirm: () => {
        void removeFriend(friend.user.id)
          .then(() => {
            setRemovedIds((current) => new Set(current).add(friend.user.id))
            data.refresh('friends')
            setSuggestionsRevision((value) => value + 1)
          })
          .catch((error) => onError(error instanceof Error ? error.message : String(error)))
      },
    })
  }

  function blockSelected(friend: Friend) {
    setActionFriend(null)
    setFriendMenuAnchor(null)
    confirm({
      title: `Заблокировать ${friend.user.display_name}?`,
      description: 'Пользователь больше не сможет взаимодействовать с вашим профилем.',
      confirm: 'Заблокировать',
      destructive: true,
      onConfirm: () => {
        void setBlocked(friend.user.id, true)
          .then(() => {
            setRemovedIds((current) => new Set(current).add(friend.user.id))
            data.refresh('friends', 'feed', 'profilePosts')
            setSuggestionsRevision((value) => value + 1)
          })
          .catch((error) => onError(error instanceof Error ? error.message : String(error)))
      },
    })
  }

  async function submitReport() {
    const friend = actionFriend
    const reportReason = reason.trim()
    if (!friend || reportReason.length < 3 || busy) return
    setBusy(true)
    try {
      await reportUser(friend.user.id, reportReason)
      setActionFriend(null)
      setFriendMenuAnchor(null)
      setReporting(false)
      setReason('')
      confirm({
        title: 'Жалоба отправлена',
        description: 'Спасибо. Мы получили вашу жалобу.',
        confirm: 'Готово',
        onConfirm: () => { },
      })
    } catch (error) {
      setActionFriend(null)
      setFriendMenuAnchor(null)
      setReporting(false)
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  function friendRow(friend: Friend) {
    return (
      <div className="friend-row" key={friend.user.id}>
        <PersonRow
          person={friend.user}
          detail={friend.user.city}
          showChevron={false}
          presence={{
            online: friend.user.is_online,
            lastSeenAt: friend.user.last_seen_at,
          }}
          onClick={() => navigate('userprofile', friend.user.id)}
        />
        <div className="friend-row__actions">
          <IconButton
            icon="message"
            label={`Написать ${friend.user.display_name}`}
            onClick={() => onMessage(friend.user.id)}
            size={desktop ? 18 : 24}
            active
          />
          <IconButton
            icon="more"
            label={`Действия с ${friend.user.display_name}`}
            onClick={(event) => {
              setActionFriend(friend)
              setFriendMenuAnchor(menuAnchorFromRect(event.currentTarget.getBoundingClientRect()))
              setReporting(false)
              setReason('')
            }}
          />
        </div>
      </div>
    )
  }

  function personDetail(person: UserSearchResult) {
    const status =
      person.friend_request_status === 'outgoing'
        ? 'Заявка отправлена'
        : person.friend_request_status === 'incoming'
          ? 'Есть входящая заявка'
          : ''
    const username = person.username ? `@${person.username.replace(/^@/, '')}` : ''
    return [status, username, person.city].filter(Boolean).join(' · ') || person.bio
  }

  return (
    <>
      <Header title="Друзья" actions={desktop && <button className="friend-requests-action" type="button" onClick={() => navigate('friendrequests')}>
        Заявки{requests > 0 ? ` · ${requests}` : ''}
      </button>} />
      <div className="screen-scroll">
        <div className="friends-search page-pad">
          <SearchField value={query} onChange={setQuery} placeholder="Имя или @username" />
        </div>

        {!desktop && !hasQuery && (
          <button
            className="friend-requests"
            type="button"
            onClick={() => navigate('friendrequests')}
          >
            <Icon name="users" size={24} />
            <span className="friend-requests__copy">
              <strong>Заявки в друзья</strong>
              <small>
                {requests ? `${requests} человек хотят познакомиться` : 'Посмотреть заявки'}
              </small>
            </span>
            {requests > 0 && <CountBadge count={requests} />}
          </button>
        )}

        {!hasQuery ? (
          <>
            {birthdayFriends.length > 0 && (
              <section aria-labelledby="birthday-friends-title">
                <h2 id="birthday-friends-title" className="section-title">Дни рождения сегодня</h2>
                {birthdayFriends.map((friend) => (
                  <PersonRow
                    key={friend.user.id}
                    person={friend.user}
                    detail={[`🎂 Сегодня день рождения`, friend.user.city].filter(Boolean).join(' · ')}
                    presence={{
                      online: friend.user.is_online,
                      lastSeenAt: friend.user.last_seen_at,
                    }}
                    onClick={() => navigate('userprofile', friend.user.id)}
                  />
                ))}
              </section>
            )}
            <h2 className="section-title">Все друзья · {visibleFriendCount}</h2>
            {data.status.friends.loading ? (
              <StatePanel title="" loading />
            ) : data.status.friends.error && !availableFriends.length ? (
              <StatePanel
                title="Не удалось загрузить"
                description={data.status.friends.error}
                action="Повторить"
                onAction={() => data.refresh('friends')}
              />
            ) : availableFriends.length ? (
              availableFriends.map(friendRow)
            ) : (
              <StatePanel
                title="Пока нет друзей"
                description="Найдите человека по имени или @username."
              />
            )}
            {data.friendsNextCursor && !data.status.friends.loading && (
              <div className="page-pad">
                {data.friendsPageError && <p className="error-text" role="alert">{data.friendsPageError}</p>}
                <Button variant="secondary" disabled={data.loadingMoreFriends} onClick={() => void data.loadMoreFriends()}>
                  {data.loadingMoreFriends ? 'Загружаем…' : data.friendsPageError ? 'Повторить загрузку' : 'Показать ещё друзей'}
                </Button>
              </div>
            )}

            {(suggestionsLoading || suggestionsError || visibleSuggestions.length > 0) && <section aria-labelledby="friend-suggestions-title">
              <h2 id="friend-suggestions-title" className="section-title">
                Возможно, вы знакомы
              </h2>
              {suggestionsLoading ? (
                <StatePanel title="" loading />
              ) : suggestionsError ? (
                <StatePanel
                  title="Не удалось загрузить рекомендации"
                  description={suggestionsError}
                  action="Повторить"
                  onAction={() => setSuggestionsRevision((value) => value + 1)}
                />
              ) : visibleSuggestions.length ? (
                visibleSuggestions.map((person) => (
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
                  description="Здесь появятся люди из общих мероприятий, по интересам и вашему городу."
                />
              )}
            </section>}
          </>
        ) : searchTerm.length > 80 ? (
          <StatePanel title="Слишком длинный запрос" description="Введите не больше 80 символов." />
        ) : (
          <>
            {(matchingFriends.length > 0 || searchedFriends.length > 0) && (
              <>
                <h2 className="section-title">Ваши друзья</h2>
                {matchingFriends.map(friendRow)}
                {searchedFriends.map((person) => (
                  <PersonRow key={person.id} person={person} onClick={() => navigate('userprofile', person.id)} />
                ))}
              </>
            )}

            {searchTerm.length === 1 ? (
              <StatePanel
                title={
                  matchingFriends.length
                    ? 'Ищем шире со второго символа'
                    : 'Введите ещё один символ'
                }
                description="После двух символов покажем совпадения среди остальных пользователей."
              />
            ) : (
              <>
                <h2 className="section-title">Другие пользователи</h2>
                {searchLoading ? (
                  <StatePanel title="" loading />
                ) : searchError ? (
                  <StatePanel title="Не удалось выполнить поиск" description={searchError} />
                ) : otherSearchResults.length ? (
                  otherSearchResults.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      detail={personDetail(person)}
                      onClick={() => navigate('userprofile', person.id)}
                    />
                  ))
                ) : (
                  <StatePanel
                    title={
                      matchingFriends.length
                        ? 'Других пользователей не найдено'
                        : 'Никого не найдено'
                    }
                    description="Попробуйте другое имя или @username."
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
      {actionFriend && (
        <MaxContextMenu
          anchor={friendMenuAnchor || undefined}
          label={`Действия с ${actionFriend.user.display_name}`}
          onClose={closeActions}
        >
          {!reporting ? (
            <>
              <MaxContextMenuItem
                icon="gift"
                label="Отправить подарок"
                onClick={() => {
                  const id = actionFriend.user.id
                  closeActions()
                  navigate('sendgift', id)
                }}
              />
              <MaxContextMenuItem
                icon="info"
                label="Пожаловаться"
                destructive
                onClick={() => setReporting(true)}
              />
              <MaxContextMenuItem
                icon="trash"
                label="Удалить из друзей"
                destructive
                onClick={() => removeSelected(actionFriend)}
              />
              <MaxContextMenuItem
                icon="lock"
                label="Заблокировать"
                destructive
                onClick={() => blockSelected(actionFriend)}
              />
            </>
          ) : (
            <form
              className="max-context-menu__form"
              onSubmit={(event) => {
                event.preventDefault()
                void submitReport()
              }}
            >
              <h3>Жалоба на пользователя</h3>
              <p>{actionFriend.user.display_name}</p>
              <Field
                label="Причина"
                value={reason}
                onChange={(value) => setReason(value.slice(0, 500))}
                placeholder="Опишите причину"
                multiline
              />
              <div className="max-context-menu__form-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setReporting(false)
                    setReason('')
                  }}
                  disabled={busy}
                >
                  Назад
                </Button>
                <Button type="submit" disabled={reason.trim().length < 3 || busy}>
                  {busy ? 'Отправляем…' : 'Отправить'}
                </Button>
              </div>
            </form>
          )}
        </MaxContextMenu>
      )}
    </>
  )
}
