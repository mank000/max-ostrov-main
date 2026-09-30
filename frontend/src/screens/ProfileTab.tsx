import { profileAvatarMedia } from '../ui/profileAvatarMedia'
import { mediaURL } from '../api/credentials'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadMyTaggedPostsPage, type Post, type PostMedia } from '../api/posts'
import { loadReceivedGifts, loadWallet, type Gift, type Wallet } from '../api/rewards'
import { usePostUpdates } from '../data/usePostUpdates'
import { Button, Header, Icon, IconButton, StatePanel, Tabs } from '../ui/components/BasicUI'
import { PostCard } from '../ui/components/ContentCards'
import {
  ProfileGiftShelf,
  ProfileInfoSheet,
  ProfileShowcase,
  ProfileSocialPreview,
} from '../ui/components/ProfileShowcase'
import type { AppDataResult } from '../useAppData'
import { useDeviceLayout } from '../app/useDeviceLayout'
import './main.css'
import type { Navigate } from './tab-types'


export function ProfileScreen({
  data,
  navigate,
  onLike,
  onShare,
  onMedia,
}: {
  data: AppDataResult
  navigate: Navigate
  onLike: (post: Post) => Promise<boolean>
  onShare: (post: Post) => void
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
}) {
  const desktop = useDeviceLayout()
  const [tab, setTab] = useState('posts')
  const groupCount = data.status.activity.loaded ? data.groupCount : null
  const [gifts, setGifts] = useState<Gift[]>([])
  const [giftStatus, setGiftStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [walletError, setWalletError] = useState(false)
  const [walletRevision, setWalletRevision] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)
  const [taggedPosts, setTaggedPosts] = useState<Post[]>([])
  usePostUpdates(taggedPosts, setTaggedPosts)
  const [taggedLoading, setTaggedLoading] = useState(false)
  const [taggedError, setTaggedError] = useState('')
  const [taggedRevision, setTaggedRevision] = useState(0)
  const currentTaggedRevision = useRef(taggedRevision)
  useLayoutEffect(() => {
    currentTaggedRevision.current = taggedRevision
  }, [taggedRevision])
  const profile = data.profile
  const profileAvatars = profileAvatarMedia(profile)
  const photos = data.profilePosts.flatMap((post) => post.media.map((media) => ({ post, media })))

  useEffect(() => {
    data.refresh('activity')
  }, [data.refresh])

  useEffect(() => {
    let controller: AbortController | null = null
    const refresh = () => {
      if (document.hidden) return
      controller?.abort()
      const next = new AbortController()
      controller = next
      loadWallet(next.signal)
        .then((value) => { if (!next.signal.aborted) { setWallet(value); setWalletError(false) } })
        .catch(() => { if (!next.signal.aborted) setWalletError(true) })
    }
    refresh()
    window.addEventListener('kutezh:wallet-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      controller?.abort()
      window.removeEventListener('kutezh:wallet-updated', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [walletRevision])

  useEffect(() => {
    const controller = new AbortController()
    setGiftStatus('loading')
    loadReceivedGifts(undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setGifts(page.gifts)
        setGiftStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setGiftStatus('error')
      })
    return () => controller.abort()
  }, [])

  function retryGifts() {
    setGiftStatus('loading')
    void loadReceivedGifts()
      .then((page) => {
        setGifts(page.gifts)
        setGiftStatus('ready')
      })
      .catch(() => setGiftStatus('error'))
  }

  useEffect(() => {
    if (tab !== 'tagged') return
    const requestedRevision = taggedRevision
    const controller = new AbortController()
    setTaggedLoading(true)
    setTaggedError('')
    loadMyTaggedPostsPage(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision)
          setTaggedPosts(page.posts)
      })
      .catch((error) => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision)
          setTaggedError(error instanceof Error ? error.message : 'Не удалось загрузить отметки')
      })
      .finally(() => {
        if (!controller.signal.aborted && currentTaggedRevision.current === requestedRevision)
          setTaggedLoading(false)
      })
    return () => controller.abort()
  }, [tab, taggedRevision])

  async function likeTaggedPost(post: Post) {
    const liked = !post.liked_by_me
    const patch = (items: Post[], desired: boolean) =>
      items.map((item) =>
        item.id === post.id && item.liked_by_me !== desired
          ? {
            ...item,
            liked_by_me: desired,
            like_count: Math.max(0, item.like_count + (desired ? 1 : -1)),
          }
          : item,
      )
    setTaggedPosts((current) => patch(current, liked))
    const committed = await onLike(post)
    if (!committed) setTaggedPosts((current) => patch(current, post.liked_by_me))
  }

  return (
    <>
      <Header
        title={profile?.username ? `@${profile.username}` : 'Профиль'}
        centered
        actions={!desktop &&
          <IconButton icon="settings" label="Настройки" onClick={() => navigate('settings')} />
        }
      />
      <div className="screen-scroll">
        {data.status.profile.loading ? (
          <StatePanel title="" loading />
        ) : profile ? (
          <>
            <div className="profile-overview">
            <ProfileShowcase
              name={profile.display_name}
              photoUrl={profile.photo_url}
              avatarSize={desktop ? 132 : 96}
              city={profile.city}
              decorationCode={profile.equipped_decoration_code}
              verificationTier={profile.verification_tier || (profile.face_verified ? 'age' : 'none')}
              presence={{ online: true }}
              onAvatarClick={
                profileAvatars.length ? () => onMedia(profileAvatars[0], profileAvatars) : undefined
              }
              onInfo={() => setInfoOpen(true)}
              actions={[
                {
                  label: 'Опубликовать',
                  icon: 'plus',
                  variant: 'primary',
                  onClick: () => navigate('createpost'),
                },
                {
                  label: 'Изменить',
                  icon: 'edit',
                  onClick: () => navigate('profileedit'),
                },
              ]}
            />
            <div className="profile-overview__details">
            <button className="profile-wallet" type="button" onClick={() => walletError ? setWalletRevision((value) => value + 1) : navigate('rewards')}>
              <Icon name="coins" size={24} />
              <span><strong>Монеты профиля</strong><small>{walletError ? 'Не удалось загрузить · нажмите, чтобы повторить' : 'Общий баланс для игр, подарков и других разделов'}</small></span>
              <b>{wallet?.unlimited ? '∞' : wallet?.balance ?? '…'}</b>
              <Icon name="chevron" size={18} />
            </button>
            <ProfileSocialPreview
              friendCount={data.friendCount}
              friends={data.friends.map((friend) => friend.user)}
              onFriends={() => navigate('friends')}
            />
            <ProfileGiftShelf
              gifts={gifts}
              loading={giftStatus === 'loading'}
              error={giftStatus === 'error'}
              hideDetails
              onOpenAll={() => navigate('gifts')}
              onRetry={retryGifts}
            />
            </div>
            </div>
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
              (data.profilePosts.length ? (
                data.profilePosts.map((post) => (
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
                    onLike={() => onLike(post)}
                    onComments={() => navigate('comments', post.id)}
                    onLikers={() => navigate('likers', post.id)}
                    onShare={() => onShare(post)}
                    onMedia={onMedia}
                    onEvent={() => post.event_id && navigate('event', post.event_id)}
                    onActions={(anchor) => navigate('postactions', post.id, anchor)}
                  />
                ))
              ) : (
                <StatePanel
                  title="Пока нет публикаций"
                />
              ))}
            {tab === 'photos' &&
              (photos.length ? (
                <div className="photo-grid">
                  {photos.map(({ post, media }) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() =>
                        onMedia(
                          media,
                          data.profilePosts.flatMap((item) => item.media),
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
                  ))}
                </div>
              ) : (
                <StatePanel title="Пока нет медиа" />
              ))}
            {(tab === 'posts' || tab === 'photos') && data.profilePostsNextCursor && (
              <div className="page-pad load-more">
                {data.loadMoreProfilePostsError ? (
                  <StatePanel title="Не удалось загрузить ещё публикации"
                    description={data.loadMoreProfilePostsError} action="Повторить"
                    onAction={() => void data.loadMoreProfilePosts()} />
                ) : (
                  <Button variant="secondary" disabled={data.loadingMoreProfilePosts}
                    onClick={() => void data.loadMoreProfilePosts()}>
                    {data.loadingMoreProfilePosts ? 'Загрузка…' : 'Показать ещё'}
                  </Button>
                )}
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
                    onLike={() => void likeTaggedPost(post)}
                    onComments={() => navigate('comments', post.id)}
                    onLikers={() => navigate('likers', post.id)}
                    onShare={() => onShare(post)}
                    onMedia={onMedia}
                    onEvent={() => post.event_id && navigate('event', post.event_id)}
                    onActions={(anchor) => navigate('postactions', post.id, anchor)}
                  />
                ))
              ) : (
                <StatePanel
                  title="Пока нет отметок"
                  description="Здесь появятся публикации, в которых вас отметили."
                />
              ))}
            {infoOpen && (
              <ProfileInfoSheet
                name={profile.display_name}
                username={profile.username}
                city={profile.city}
                birthDate={profile.birth_date}
                age={profile.age}
                verificationTier={profile.verification_tier || (profile.face_verified ? 'age' : 'none')}
                bio={profile.bio}
                actions={[
                  {
                    icon: 'calendar',
                    title: 'Мероприятия',
                    detail: String(data.profileEvents.length),
                    onClick: () => {
                      setInfoOpen(false)
                      navigate('myevents')
                    },
                  },
                  {
                    icon: 'users',
                    title: 'Группы',
                    detail: groupCount === null ? undefined : String(groupCount),
                    onClick: () => {
                      setInfoOpen(false)
                      navigate('groups')
                    },
                  },
                ]}
                onClose={() => setInfoOpen(false)}
                onEdit={() => {
                  setInfoOpen(false)
                  navigate('profileedit')
                }}
              />
            )}
          </>
        ) : (
          <StatePanel
            title="Войдите, чтобы продолжить"
            description={data.status.profile.error || 'Профиль доступен после входа через MAX.'}
          />
        )}
      </div>
    </>
  )
}
