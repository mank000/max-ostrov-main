import { useEffect, useRef, useState } from 'react'
import { type Event } from '../../../api/events'
import { type Post, type PostMedia } from '../../../api/posts'
import { Avatar, Icon, IconButton } from '../BasicUI'
import '../cards.css'
import { menuAnchorFromRect, type MenuAnchor } from '../ContextMenu'
import { eventDate, relativeTime } from './eventFormat'
import { PostMediaCarousel } from './PostMedia'

export function RepostPreviewCard({
  repost,
  onMedia,
  onOpen,
}: {
  repost: NonNullable<Post['repost']>
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
  onOpen: () => void
}) {
  if (repost.unavailable || !repost.author) {
    return (
      <div className="post-card__repost post-card__repost--unavailable">
        <Icon name="info" size={18} />
        <span>Исходная публикация недоступна</span>
      </div>
    )
  }
  return (
    <div className="post-card__repost post-card__repost--interactive">
      <button className="post-card__repost-open" type="button" onClick={onOpen}>
        <span className="post-card__repost-head">
          <Avatar name={repost.author.display_name} url={repost.author.photo_url} size={32} />
          <span className="post-card__repost-copy">
            <strong>{repost.author.display_name}</strong>
            <small>
              {[repost.city, repost.created_at ? relativeTime(repost.created_at) : '']
                .filter(Boolean)
                .join(' · ')}
            </small>
          </span>
        </span>
        {repost.caption && <span className="post-card__repost-caption">{repost.caption}</span>}
      </button>
      {!!repost.media?.length && (
        <PostMediaCarousel items={repost.media} onMedia={onMedia} compact />
      )}
    </div>
  )
}

export function PostCard({
  post,
  event,
  onOpen,
  onOpenOriginal,
  onUser,
  onTaggedUser,
  onLike,
  onComments,
  onLikers,
  onShare,
  onMedia,
  onEvent,
  onActions,
  onCaptionExpandedChange,
  collapseCaption = false,
}: {
  post: Post
  event?: Event
  onOpen: () => void
  onOpenOriginal?: (postId: number) => void
  onUser: () => void
  onTaggedUser?: (userId: number) => void
  onLike: () => void
  onComments: () => void
  onLikers: () => void
  onShare: () => void
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
  onEvent: () => void
  onActions: (anchor: MenuAnchor) => void
  onCaptionExpandedChange?: (postId: number, expanded: boolean) => void
  collapseCaption?: boolean
}) {
  const [expandedTags, setExpandedTags] = useState(false)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [captionCanExpand, setCaptionCanExpand] = useState(false)
  const captionRef = useRef<HTMLSpanElement>(null)
  const tags = post.tagged_participants || []
  const shownTags = expandedTags ? tags : tags.slice(0, 3)

  useEffect(() => {
    setCaptionExpanded(false)
    setCaptionCanExpand(false)
  }, [post.id, post.caption])

  useEffect(() => {
    if (!collapseCaption || captionExpanded || !post.caption) return
    const node = captionRef.current
    if (!node) return
    const measure = () => setCaptionCanExpand(node.scrollHeight > node.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [collapseCaption, captionExpanded, post.caption])

  function toggleCaption() {
    const next = !captionExpanded
    onCaptionExpandedChange?.(post.id, next)
    setCaptionExpanded(next)
  }

  return (
    <article className="post-card">
      <div className="post-card__head">
        <button className="post-card__author-avatar" type="button" onClick={onUser}
          aria-label={`Профиль: ${post.author.display_name}`}>
          <Avatar name={post.author.display_name} url={post.author.photo_url} size={40} />
        </button>
        <button className="post-card__author" type="button" onClick={onUser}>
          <strong>{post.author.display_name}</strong>
          <span>
            {post.city ? `${post.city} · ` : ''}
            {relativeTime(post.created_at)}
          </span>
        </button>
        <IconButton
          icon="more"
          label="Действия с публикацией"
          onClick={(event) =>
            onActions(menuAnchorFromRect(event.currentTarget.getBoundingClientRect()))
          }
        />
      </div>
      {post.caption && (
        <>
          <button
            type="button"
            className={`post-card__caption${collapseCaption && !captionExpanded ? ' is-collapsed' : ''}${captionCanExpand ? ' has-more' : ''}`}
            onClick={onOpen}
          >
            <span ref={captionRef} className="post-card__caption-text">{post.caption}</span>
          </button>
          {collapseCaption && captionCanExpand && (
            <button
              type="button"
              className="post-card__caption-toggle"
              onClick={(event) => {
                event.currentTarget.blur()
                toggleCaption()
              }}
              aria-expanded={captionExpanded}
            >
              {captionExpanded ? 'Свернуть' : 'Показать ещё'}
            </button>
          )}
        </>
      )}
      {tags.length > 0 && (
        <div className="post-card__tags">
          <Icon name="users" size={16} />
          <span>С</span>
          {shownTags.map((person, index) => (
            <span key={person.id} className="post-card__tag">
              {index > 0 ? ', ' : ''}
              <button
                type="button"
                onClick={() => onTaggedUser?.(person.id)}
                disabled={!onTaggedUser}
              >
                {person.display_name}
              </button>
            </span>
          ))}
          {!expandedTags && tags.length > shownTags.length && (
            <button
              className="post-card__tag-more"
              type="button"
              onClick={() => setExpandedTags(true)}
            >
              и ещё {tags.length - shownTags.length}
            </button>
          )}
        </div>
      )}
      {!!post.media.length && <PostMediaCarousel items={post.media} onMedia={onMedia} />}
      {post.repost && (
        <RepostPreviewCard
          repost={post.repost}
          onMedia={onMedia}
          onOpen={() => {
            if (!post.repost?.id) return
            if (onOpenOriginal) onOpenOriginal(post.repost.id)
            else onOpen()
          }}
        />
      )}
      <div className="post-card__actions">
        <button
          type="button"
          className={post.liked_by_me ? 'is-active' : ''}
          onClick={onLike}
          aria-label={post.liked_by_me ? 'Убрать отметку нравится' : 'Нравится'}
        >
          <Icon name="heart" size={22} />
        </button>
        <button type="button" className="post-card__count" onClick={onLikers}
          aria-label={`Отметок «Нравится»: ${post.like_count}`}>
          {post.like_count}
        </button>
        <button type="button" onClick={onComments} aria-label="Комментарии">
          <Icon name="comment" size={22} />
        </button>
        <button type="button" className="post-card__count" onClick={onComments}
          aria-label={`Комментариев: ${post.comment_count}`}>
          {post.comment_count}
        </button>
        <button
          type="button"
          className={`post-card__share${post.reposted_by_me ? ' is-active' : ''}`}
          onClick={onShare}
          aria-label="Поделиться"
          aria-pressed={Boolean(post.reposted_by_me)}
          title={post.reposted_by_me ? 'Уже на вашей стене' : 'Поделиться публикацией'}
        >
          <Icon name="share" size={20} />
        </button>
        {(post.repost_count || 0) > 0 && (
          <button
            type="button"
            className="post-card__share-count"
            onClick={onShare}
            aria-label={`Репостов: ${post.repost_count}`}
          >
            {post.repost_count}
          </button>
        )}
      </div>
      {post.event_id && (
        <button className="post-card__event" type="button" onClick={onEvent}>
          <Icon name="calendar" size={18} />
          <span>
            {event ? `${event.title} · ${eventDate(event.starts_at)}` : 'Связанное мероприятие'}
          </span>
        </button>
      )}
    </article>
  )
}
