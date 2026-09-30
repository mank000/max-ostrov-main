import { useEffect, useMemo, useRef } from 'react'
import { type Post, type PostMedia } from '../api/posts'
import {
  Avatar,
  Button,
  Header,
  Icon,
  IconButton,
  StatePanel,
  Tabs,
} from '../ui/components/BasicUI'
import { PostCard } from '../ui/components/ContentCards'
import type { AppDataResult } from '../useAppData'
import { useDeviceLayout } from '../app/useDeviceLayout'
import './main.css'
import type { Navigate } from './tab-types'

const feedCaptionResume = {
  postId: 0,
  scrollTop: 0,
}

export function FeedScreen({
  data,
  city,
  navigate,
  onLike,
  onShare,
  onMedia,
}: {
  data: AppDataResult
  city: string
  navigate: Navigate
  onLike: (post: Post) => void
  onShare: (post: Post) => void
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
}) {
  const desktop = useDeviceLayout()
  const posts = data.posts
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const eventsById = useMemo(
    () => new Map(data.recommendedEvents.map((event) => [event.id, event])),
    [data.recommendedEvents],
  )
  useEffect(() => {
    if (!posts.length || !data.feedNextCursor || data.loadingMoreFeed || data.loadMoreFeedError) return
    const root = scrollRef.current
    const target = loadMoreRef.current
    if (!root || !target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void data.loadMoreFeed()
    }, { root, rootMargin: '0px 0px 400px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [posts.length, data.feedNextCursor, data.loadingMoreFeed, data.loadMoreFeedError, data.loadMoreFeed])
  function changeScope(value: string) {
    data.setFeedScope(value === 'friends' ? 'friends' : value === 'city' ? 'city' : 'all')
  }
  function restoreFeedPosition(scrollTop: number) {
    requestAnimationFrame(() => {
      const element = scrollRef.current
      if (!element) return
      element.scrollTop = scrollTop
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollTop
      })
    })
  }
  function handleCaptionExpandedChange(postId: number, expanded: boolean) {
    const element = scrollRef.current
    if (!element) return

    if (expanded) {
      feedCaptionResume.postId = postId
      feedCaptionResume.scrollTop = element.scrollTop
      restoreFeedPosition(feedCaptionResume.scrollTop)
      return
    }

    if (feedCaptionResume.postId !== postId) return
    const savedScrollTop = feedCaptionResume.scrollTop
    feedCaptionResume.postId = 0
    restoreFeedPosition(savedScrollTop)
  }
  return (
    <>
      <Header
        title="Лента"
        actions={!desktop &&
          <>
            <IconButton
              icon="bell"
              label="Уведомления"
              badge={data.unreadNotificationCount}
              onClick={() => navigate('notifications')}
            />
          </>
        }
      />
      <div className="screen-scroll" ref={scrollRef}>
        <div className="feed-toolbar">
          <button className="feed-city" type="button" onClick={() => navigate('city')}>
            <Icon name="pin" size={18} />
            <span>{city || 'Выберите город'}</span>
            <small>Ваш город</small>
          </button>
          <Tabs
            items={[
              { id: 'for-you', label: 'Для вас' },
              { id: 'friends', label: 'Друзья' },
              { id: 'city', label: 'В городе' },
            ]}
            value={data.feedScope === 'all' ? 'for-you' : data.feedScope}
            onChange={changeScope}
          />
        </div>
        {posts.length > 0 && data.status.feed.error && !data.loadMoreFeedError && (
          <div className="feed-refresh-error" role="alert">
            <span>Не удалось обновить ленту: {data.status.feed.error}</span>
            <button type="button" onClick={() => data.refresh('feed')}>Повторить</button>
          </div>
        )}
        <button className="compose-prompt" type="button" onClick={() => navigate('createpost')}>
          <Avatar name={data.profile?.display_name || ''} url={data.profile?.photo_url} size={36} />
          <span>Что нового?</span>
          <Icon name="photo" size={22} />
        </button>

        {data.status.feed.loading ? (
          <StatePanel title="" loading />
        ) : data.status.feed.error && !posts.length ? (
          <StatePanel
            title="Не удалось загрузить"
            description={data.status.feed.error}
            action="Повторить"
            onAction={() => data.refresh('feed')}
          />
        ) : posts.length ? (
          <>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                event={eventsById.get(post.event_id || 0)}
                onOpen={() => navigate('post', post.id)}
                onOpenOriginal={(postId) => navigate('post', postId)}
                onUser={() => navigate('userprofile', post.author.id)}
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
                onCaptionExpandedChange={handleCaptionExpandedChange}
                collapseCaption
              />
            ))}
            {data.feedNextCursor && (
              <div className="page-pad load-more" ref={loadMoreRef}>
                {data.loadMoreFeedError ? (
                  <StatePanel title="Не удалось загрузить ещё публикации" description={data.loadMoreFeedError}
                    action="Повторить" onAction={() => void data.loadMoreFeed()} />
                ) : (
                  <Button variant="secondary" onClick={() => void data.loadMoreFeed()}
                    disabled={data.loadingMoreFeed}>
                    {data.loadingMoreFeed ? 'Загрузка…' : 'Показать ещё'}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <StatePanel
            title={data.feedScope === 'city' && !city ? 'Выберите город'
              : data.feedScope === 'friends' ? 'У друзей пока нет публикаций' : 'Пока нет публикаций'}
            description={data.feedScope === 'city' && !city ? 'Укажите город, чтобы увидеть местные публикации.'
              : data.feedScope === 'friends' ? 'Здесь будут публикации ваших друзей.'
                : 'Поделитесь новостями или впечатлениями о встрече.'}
            action={data.feedScope === 'city' && !city ? 'Выбрать город'
              : data.feedScope === 'friends' ? 'Найти друзей' : 'Создать публикацию'}
            onAction={() => navigate(data.feedScope === 'city' && !city ? 'city'
              : data.feedScope === 'friends' ? 'friends' : 'createpost')}
          />
        )}
      </div>
    </>
  )
}
