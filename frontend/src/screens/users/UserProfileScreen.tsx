import { profileAvatarMedia } from '../../ui/profileAvatarMedia'
import { mediaURL } from '../../api/credentials'
import { ApiError } from '../../api/http'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadUserPostsPage, loadUserTaggedPostsPage, type Post } from '../../api/posts'
import { loadUserGifts, type Gift } from '../../api/rewards'
import { loadFriendDirectMessageTarget, loadUserFriends, loadUserProfile, removeFriend, resolveFriendRequest, type Friend, type PublicUserProfile } from '../../api/users'
import { usePostUpdates } from '../../data/usePostUpdates'
import { cancelFriendRequest, sendFriendRequest } from '../../participants-api'
import { PRESENCE_PROFILE_REFRESH_MS } from '../../presence'
import { Button, Header, IconButton, StatePanel, Tabs } from '../../ui/components/BasicUI'
import { PostCard } from '../../ui/components/ContentCards'
import { menuAnchorFromRect } from '../../ui/components/ContextMenu'
import { ProfileGiftShelf, ProfileInfoSheet, ProfileShowcase, ProfileSocialPreview } from '../../ui/components/ProfileShowcase'
import type { SocialProps } from '../FriendPages'
import '../social.css'


export function UserProfileScreen({
  id,
  initialTab = 'posts',
  back,
  navigate,
  data,
  onLike,
  onError,
  confirm,
  host,
  openMedia,
}: SocialProps) {
  const [profile, setProfile] = useState<PublicUserProfile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [postsError, setPostsError] = useState('')
  const [postsNextCursor, setPostsNextCursor] = useState<number | null>(null)
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsLoadingMore, setPostsLoadingMore] = useState(false)
  const postsRequest = useRef<AbortController | null>(null)
  usePostUpdates(posts, setPosts)
  const [profileFriends, setProfileFriends] = useState<Friend[]>([])
  const [taggedPosts, setTaggedPosts] = useState<Post[]>([])
  usePostUpdates(taggedPosts, setTaggedPosts)
  const [taggedLoading, setTaggedLoading] = useState(false)
  const [taggedLoadingMore, setTaggedLoadingMore] = useState(false)
  const [taggedError, setTaggedError] = useState('')
  const [taggedMoreError, setTaggedMoreError] = useState('')
  const [taggedNextCursor, setTaggedNextCursor] = useState<number | null>(null)
  const taggedRequest = useRef<AbortController | null>(null)
  const [taggedRevision, setTaggedRevision] = useState(0)
  const currentTaggedRevision = useRef(taggedRevision)
  useLayoutEffect(() => {
    currentTaggedRevision.current = taggedRevision
  }, [taggedRevision])
  const [gifts, setGifts] = useState<Gift[]>([])
  const [giftsLoading, setGiftsLoading] = useState(true)
  const [giftsError, setGiftsError] = useState(false)
  const [tab, setTab] = useState<string>(initialTab)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [profileNotFound, setProfileNotFound] = useState(false)
  const [profileRevision, setProfileRevision] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (id && data.profile?.id === id) navigate('profile')
  }, [id, data.profile?.id, navigate])

  useEffect(() => {
    if (!id) {
      setProfile(null)
      setLoading(false)
      setProfileNotFound(true)
      return
    }
    if (data.profile?.id === id) return
    const controller = new AbortController()
    postsRequest.current?.abort()
    taggedRequest.current?.abort()
    setLoading(true)
    setProfile(null)
    setProfileError('')
    setProfileNotFound(false)
    setPosts([])
    setPostsError('')
    setPostsNextCursor(null)
    setPostsLoading(false)
    setPostsLoadingMore(false)
    setProfileFriends([])
    setTaggedPosts([])
    setTaggedError('')
    setTaggedMoreError('')
    setTaggedNextCursor(null)
    setTaggedLoadingMore(false)
    setGifts([])
    setGiftsLoading(true)
    setGiftsError(false)
    loadUserProfile(id, controller.signal)
      .then(async (nextProfile) => {
        if (controller.signal.aborted) return
        if (nextProfile.relationship_state === 'self') {
          navigate('profile')
          return
        }
        setProfile(nextProfile)
        if (nextProfile.restricted) {
          setGiftsLoading(false)
          return
        }

        const [postsResult, friendsResult, giftsResult] = await Promise.allSettled([
          loadUserPostsPage(id, controller.signal),
          loadUserFriends(id, controller.signal),
          loadUserGifts(id, undefined, controller.signal),
        ])
        if (controller.signal.aborted) return

        if (postsResult.status === 'fulfilled') {
          setPosts(postsResult.value.posts)
          setPostsNextCursor(postsResult.value.nextCursor)
        } else {
          setPostsError(
            postsResult.reason instanceof Error
              ? postsResult.reason.message
              : 'Не удалось загрузить публикации',
          )
        }
        if (friendsResult.status === 'fulfilled') setProfileFriends(friendsResult.value)
        if (giftsResult.status === 'fulfilled') setGifts(giftsResult.value.gifts)
        else setGiftsError(true)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setProfileNotFound(error instanceof ApiError && error.status === 404)
        setProfileError(
          error instanceof Error ? error.message : 'Не удалось загрузить профиль',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
          setGiftsLoading(false)
        }
      })
    return () => {
      controller.abort()
      postsRequest.current?.abort()
      taggedRequest.current?.abort()
    }
  }, [id, data.profile?.id, navigate, profileRevision])

  async function fetchPosts(beforeId = 0) {
    if (!id || profile?.restricted || postsLoading || postsLoadingMore) return
    const controller = new AbortController()
    postsRequest.current?.abort()
    postsRequest.current = controller
    if (beforeId) setPostsLoadingMore(true)
    else setPostsLoading(true)
    setPostsError('')
    try {
      const page = await loadUserPostsPage(id, controller.signal, beforeId)
      if (controller.signal.aborted) return
      setPosts((current) =>
        beforeId
          ? [
              ...current,
              ...page.posts.filter((post) => !current.some((existing) => existing.id === post.id)),
            ]
          : page.posts,
      )
      setPostsNextCursor(page.nextCursor)
    } catch (error) {
      if (!controller.signal.aborted)
        setPostsError(error instanceof Error ? error.message : 'Не удалось загрузить публикации')
    } finally {
      if (!controller.signal.aborted) {
        setPostsLoading(false)
        setPostsLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (!id || data.profile?.id === id) return
    let disposed = false
    const refreshPresence = () => {
      if (disposed || document.hidden) return
      void loadUserProfile(id)
        .then((next) => {
          if (disposed) return
          setProfile((current) =>
            current
              ? {
                ...current,
                is_online: next.is_online,
                last_seen_at: next.last_seen_at,
              }
              : next,
          )
        })
        .catch(() => { })
    }
    const onVisible = () => {
      if (!document.hidden) refreshPresence()
    }
    const timer = window.setInterval(refreshPresence, PRESENCE_PROFILE_REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, data.profile?.id])

  async function relationship() {
    if (!profile) return
    if (profile.relationship_state === 'friend') {
      confirm({
        title: `Удалить ${profile.display_name} из друзей?`,
        description:
          'Заявка этого человека появится у вас во входящих. Вы сможете принять или отклонить её.',
        confirm: 'Удалить',
        destructive: true,
        onConfirm: () => {
          void removeFriend(profile.id)
            .then(() => {
              setProfile((current) =>
                current ? { ...current, relationship_state: 'incoming' } : current,
              )
              data.refresh('friends', 'inbox', 'feed', 'profilePosts')
              return loadUserProfile(profile.id)
            })
            .then(setProfile)
            .catch((error) => onError(String(error)))
        },
      })
      return
    }
    try {
      if (profile.relationship_state === 'stranger') await sendFriendRequest(profile.id)
      else if (profile.relationship_state === 'outgoing') await cancelFriendRequest(profile.id)
      else if (profile.relationship_state === 'incoming')
        await resolveFriendRequest(profile.id, true)
      const nextProfile = await loadUserProfile(profile.id)
      setProfile(nextProfile)
      data.refresh('friends')
      if (!nextProfile.restricted) setProfileRevision((value) => value + 1)
    } catch (error) {
      onError(String(error))
    }
  }

  async function message() {
    if (!profile) return
    try {
      const target = await loadFriendDirectMessageTarget(profile.id)
      if (!target.max_chat_id || !host.openChat(target.max_chat_id))
        onError('Сообщение недоступно для этого пользователя')
    } catch (error) {
      onError(String(error))
    }
  }

  useEffect(() => {
    if (tab !== 'tagged' || !id || data.profile?.id === id || !profile || profile.restricted) return
    const requestedRevision = taggedRevision
    const controller = new AbortController()
    setTaggedLoading(true)
    setTaggedError('')
    setTaggedMoreError('')
    setTaggedNextCursor(null)
    loadUserTaggedPostsPage(id, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision) {
          setTaggedPosts(page.posts)
          setTaggedNextCursor(page.nextCursor)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision)
          setTaggedError(error instanceof Error ? error.message : 'Не удалось загрузить отметки')
      })
      .finally(() => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision)
          setTaggedLoading(false)
      })
    return () => {
      controller.abort()
      taggedRequest.current?.abort()
    }
  }, [tab, id, data.profile?.id, profile?.restricted, taggedRevision])

  async function loadMoreTaggedPosts() {
    if (!id || profile?.restricted || !taggedNextCursor || taggedLoadingMore) return
    const controller = new AbortController()
    taggedRequest.current?.abort()
    taggedRequest.current = controller
    setTaggedLoadingMore(true)
    setTaggedMoreError('')
    try {
      const page = await loadUserTaggedPostsPage(id, controller.signal, taggedNextCursor)
      if (controller.signal.aborted) return
      setTaggedPosts((current) => [
        ...current,
        ...page.posts.filter((post) => !current.some((existing) => existing.id === post.id)),
      ])
      setTaggedNextCursor(page.nextCursor)
    } catch (error) {
      if (!controller.signal.aborted)
        setTaggedMoreError(error instanceof Error ? error.message : 'Не удалось загрузить отметки')
    } finally {
      if (!controller.signal.aborted) setTaggedLoadingMore(false)
    }
  }

  const profileAvatars = profileAvatarMedia(profile)
  const relationshipLabel =
    profile?.relationship_state === 'outgoing'
      ? 'Заявка отправлена'
      : profile?.relationship_state === 'incoming'
        ? 'Принять заявку'
        : 'Добавить в друзья'

  async function likeProfilePost(post: Post) {
    const liked = !post.liked_by_me
    const patch = (items: Post[], desired: boolean) =>
      items.map((item) => {
        if (item.id !== post.id || item.liked_by_me === desired) return item
        return {
          ...item,
          liked_by_me: desired,
          like_count: Math.max(0, item.like_count + (desired ? 1 : -1)),
        }
      })
    setPosts((current) => patch(current, liked))
    setTaggedPosts((current) => patch(current, liked))
    const committed = await onLike(post)
    if (!committed) {
      setPosts((current) => patch(current, post.liked_by_me))
      setTaggedPosts((current) => patch(current, post.liked_by_me))
    }
  }

  return (
    <>
      <Header
        title={profile?.username ? `@${profile.username}` : 'Профиль'}
        back={back}
        emphasized
        actions={profile && (
          <IconButton
            icon="more"
            label="Действия с профилем"
            onClick={(event) =>
              navigate(
                'usermenu',
                id,
                menuAnchorFromRect(event.currentTarget.getBoundingClientRect()),
              )
            }
          />
        )}
      />
      <div className="screen-scroll">
        {loading ? (
          <StatePanel title="" loading />
        ) : profile ? (
          <>
            <ProfileShowcase
              name={profile.display_name}
              photoUrl={profile.photo_url}
              city={profile.city}
              decorationCode={profile.equipped_decoration_code}
              verificationTier={profile.verification_tier || (profile.face_verified ? 'age' : 'none')}
              presence={{
                online: profile.is_online,
                lastSeenAt: profile.last_seen_at,
              }}
              onAvatarClick={
                !profile.restricted && profileAvatars.length
                  ? () => openMedia(profileAvatars[0], profileAvatars)
                  : undefined
              }
              onInfo={profile.restricted ? undefined : () => setInfoOpen(true)}
              context={[
                ...(profile.common_event_count
                  ? [`Общих мероприятий: ${profile.common_event_count}`]
                  : []),
              ]}
              actions={
                profile.relationship_state === 'friend'
                  ? [
                    {
                      label: 'Сообщение',
                      variant: 'primary',
                      icon: 'message',
                      onClick: () => void message(),
                    },
                    {
                      label: 'Подарок',
                      variant: 'secondary',
                      icon: 'gift',
                      onClick: () => navigate('sendgift', profile.id),
                    },
                    {
                      label: 'В друзьях',
                      variant: 'secondary',
                      icon: 'check',
                      onClick: () => void relationship(),
                    },
                  ]
                  : profile.relationship_state === 'blocked'
                    ? []
                    : [
                      {
                        label: relationshipLabel,
                        variant:
                          profile.relationship_state === 'stranger' ||
                            profile.relationship_state === 'incoming'
                            ? 'primary'
                            : 'secondary',
                        icon: 'users',
                        onClick: () => void relationship(),
                      },
                    ]
              }
            />
            {profile.restricted ? (
              <StatePanel
                title="Профиль закрыт"
                description="Публикации, медиа, друзья, интересы, подарки и мероприятия доступны только друзьям."
              />
            ) : (
              <>
                <ProfileSocialPreview
              friendCount={profile.friend_count}
              friends={profileFriends.map((item) => item.user)}
              onFriends={() => navigate('userfriends', id)}
            />
            <ProfileGiftShelf
              gifts={gifts}
              loading={giftsLoading}
              error={giftsError}
              hideDetails
              onOpenAll={() => navigate('usergifts', profile.id)}
            />
            <Tabs
              items={[
                { id: 'posts', label: 'Публикации' },
                { id: 'photos', label: 'Медиа' },
                { id: 'tagged', label: 'Отметки' },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'posts' &&
              (postsLoading ? (
                <StatePanel title="" loading />
              ) : posts.length ? (
                posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    collapseCaption
                    onOpen={() => navigate('post', post.id)}
                    onOpenOriginal={(postId) => navigate('post', postId)}
                    onUser={() => { }}
                    onTaggedUser={(userId) =>
                      navigate(userId === data.profile?.id ? 'profile' : 'userprofile', userId)
                    }
                    onLike={() => void likeProfilePost(post)}
                    onComments={() => navigate('comments', post.id)}
                    onLikers={() => navigate('likers', post.id)}
                    onShare={() => navigate('share', post.id)}
                    onMedia={openMedia}
                    onEvent={() => post.event_id && navigate('event', post.event_id)}
                    onActions={(anchor) => navigate('postactions', post.id, anchor)}
                  />
                ))
              ) : postsError ? (
                <StatePanel
                  title="Не удалось загрузить публикации"
                  description={postsError}
                  action="Повторить"
                  onAction={() => void fetchPosts()}
                />
              ) : (
                <StatePanel title="Пока нет публикаций" />
              ))}
            {tab === 'photos' &&
              (postsLoading ? (
                <StatePanel title="" loading />
              ) : posts.some((post) => post.media.length) ? (
                <div className="photo-grid">
                  {posts.flatMap((post) =>
                    post.media.map((media) => (
                      <button
                        key={media.id}
                        type="button"
                        onClick={() =>
                          openMedia(
                            media,
                            posts.flatMap((item) => item.media),
                          )
                        }
                      >
                        {media.mime_type.startsWith('video/') ? (
                          <>
                            <video src={mediaURL(media.url)} muted playsInline preload="metadata" />
                            <span className="photo-grid__video">▶</span>
                          </>
                        ) : (
                          <img src={mediaURL(media.url)} alt={post.caption || 'Фото'} />
                        )}
                      </button>
                    )),
                  )}
                </div>
              ) : postsError ? (
                <StatePanel
                  title="Не удалось загрузить медиа"
                  description={postsError}
                  action="Повторить"
                  onAction={() => void fetchPosts()}
                />
              ) : (
                <StatePanel title="Пока нет медиа" />
              ))}
            {(tab === 'posts' || tab === 'photos') && postsError && posts.length > 0 && (
              <StatePanel
                title="Не удалось загрузить следующую страницу"
                description={postsError}
                action="Повторить"
                onAction={() => void fetchPosts(postsNextCursor || 0)}
              />
            )}
            {(tab === 'posts' || tab === 'photos') && postsNextCursor && !postsError && (
              <div className="page-pad load-more">
                <Button
                  variant="secondary"
                  disabled={postsLoadingMore}
                  onClick={() => void fetchPosts(postsNextCursor)}
                >
                  {postsLoadingMore ? 'Загрузка…' : 'Показать ещё'}
                </Button>
              </div>
            )}
            {tab === 'tagged' &&
              (taggedLoading ? (
                <StatePanel title="" loading />
              ) : taggedError ? (
                <StatePanel
                  title="Не удалось загрузить отметки"
                  description={taggedError}
                  action="Повторить"
                  onAction={() => setTaggedRevision((value) => value + 1)}
                />
              ) : taggedPosts.length ? (
                taggedPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    collapseCaption
                    onOpen={() => navigate('post', post.id)}
                    onOpenOriginal={(postId) => navigate('post', postId)}
                    onUser={() =>
                      post.author.id !== profile.id && navigate('userprofile', post.author.id)
                    }
                    onTaggedUser={(userId) =>
                      navigate(userId === data.profile?.id ? 'profile' : 'userprofile', userId)
                    }
                    onLike={() => void likeProfilePost(post)}
                    onComments={() => navigate('comments', post.id)}
                    onLikers={() => navigate('likers', post.id)}
                    onShare={() => navigate('share', post.id)}
                    onMedia={openMedia}
                    onEvent={() => post.event_id && navigate('event', post.event_id)}
                    onActions={(anchor) => navigate('postactions', post.id, anchor)}
                  />
                ))
              ) : (
                <StatePanel
                  title="Пока нет отметок"
                  description="Здесь появятся публикации, в которых отметили этого пользователя."
                />
              ))}
            {tab === 'tagged' && taggedMoreError && (
              <StatePanel
                title="Не удалось загрузить следующую страницу"
                description={taggedMoreError}
                action="Повторить"
                onAction={() => void loadMoreTaggedPosts()}
              />
            )}
            {tab === 'tagged' && taggedNextCursor && !taggedMoreError && !taggedLoading && (
              <div className="page-pad load-more">
                <Button
                  variant="secondary"
                  disabled={taggedLoadingMore}
                  onClick={() => void loadMoreTaggedPosts()}
                >
                  {taggedLoadingMore ? 'Загрузка…' : 'Показать ещё'}
                </Button>
              </div>
            )}
            {infoOpen && (
              <ProfileInfoSheet
                name={profile.display_name}
                username={profile.username}
                city={profile.city}
                birthDate={profile.birth_date}
                age={profile.age}
                verificationTier={profile.verification_tier || (profile.face_verified ? 'age' : 'none')}
                bio={profile.bio}
                context={[
                  ...(profile.common_event_count
                    ? [`Общих мероприятий: ${profile.common_event_count}`]
                    : []),
                ]}
                actions={[
                  {
                    icon: 'calendar',
                    title: 'Мероприятия',
                    detail: String(profile.event_count),
                    onClick: () => {
                      setInfoOpen(false)
                      navigate('userevents', id)
                    },
                  },
                ]}
                onClose={() => setInfoOpen(false)}
              />
            )}
              </>
            )}
          </>
        ) : profileNotFound ? (
          <StatePanel title="Профиль не найден" />
        ) : (
          <StatePanel
            title="Не удалось загрузить профиль"
            description={profileError}
            action="Повторить"
            onAction={() => setProfileRevision((value) => value + 1)}
          />
        )}
      </div>
    </>
  )
}
