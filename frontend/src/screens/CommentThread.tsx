import { mediaURL } from '../api/credentials'
import { PHOTO_INPUT_ACCEPT } from '../api/media'
export const COMMENT_MEDIA_LIMIT = 4

export const COMMENT_MEDIA_ACCEPT = `${PHOTO_INPUT_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { type Comment } from '../api/comments'
import { type PostMedia } from '../api/posts'
import { commentMediaStyle } from '../comment-experience'
import { Avatar, Icon, IconButton } from '../ui/components/BasicUI'
import { relativeTime } from '../ui/components/ContentCards'
import {
  MaxContextMenu,
  MaxContextMenuItem,
  menuAnchorFromRect,
  type MenuAnchor,
} from '../ui/components/ContextMenu'
import './comment-experience.css'
import './details.css'

export function firstName(displayName: string) {
  const normalized = displayName.trim()
  return normalized.split(/\s+/)[0] || normalized
}

export function CommentMediaGrid({
  items,
  onOpen,
  onRemove,
  removing = false,
}: {
  items: PostMedia[]
  onOpen: (media: PostMedia, items?: PostMedia[]) => void
  onRemove?: (media: PostMedia) => void
  removing?: boolean
}) {
  if (!items.length) return null
  return (
    <div
      className={`comment-media-grid comment-media-grid--${Math.min(items.length, COMMENT_MEDIA_LIMIT)}`}
    >
      {items.map((item) => (
        <div
          className="comment-media-grid__item"
          key={item.id}
          style={commentMediaStyle(item, items.length === 1)}
        >
          <button
            className="comment-media-grid__open"
            type="button"
            onClick={() => onOpen(item, items)}
            aria-label={item.mime_type.startsWith('video/') ? 'Открыть видео' : 'Открыть фото'}
          >
            {item.mime_type.startsWith('video/') ? (
              <>
                <video src={mediaURL(item.url)} muted playsInline preload="metadata" />
                <span className="comment-media-grid__video">Видео</span>
              </>
            ) : (
              <img src={mediaURL(item.url)} alt="" loading="lazy" decoding="async" />
            )}
          </button>
          {onRemove && (
            <button
              className="comment-media-grid__remove"
              type="button"
              aria-label="Убрать вложение"
              disabled={removing}
              onClick={() => onRemove(item)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function CommentThread({
  comment,
  repliesByParent,
  depth,
  expandedReplies,
  currentUserId,
  postAuthorId,
  isAdmin = false,
  editingCommentId,
  editText,
  editMedia,
  savingEdit,
  editUploadingMedia,
  onToggleReplies,
  onLike,
  onReply,
  onUser,
  onEditStart,
  onEditText,
  onEditAddMedia,
  onEditRemoveMedia,
  onEditSave,
  onEditCancel,
  onDelete,
  onReport,
  onMedia,
}: {
  comment: Comment
  repliesByParent: Map<number, Comment[]>
  depth: number
  expandedReplies: Set<number>
  currentUserId: number
  postAuthorId: number
  isAdmin?: boolean
  editingCommentId: number | null
  editText: string
  editMedia: PostMedia[]
  savingEdit: boolean
  editUploadingMedia: boolean
  onToggleReplies: (commentId: number) => void
  onLike: (comment: Comment) => void
  onReply: (comment: Comment) => void
  onUser: (userId: number) => void
  onEditStart: (comment: Comment) => void
  onEditText: (value: string) => void
  onEditAddMedia: (files?: FileList | null) => Promise<void>
  onEditRemoveMedia: (media: PostMedia) => Promise<void>
  onEditSave: (comment: Comment) => Promise<void>
  onEditCancel: () => void
  onDelete: (comment: Comment) => void
  onReport: (comment: Comment) => void
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
}) {
  const replies = repliesByParent.get(comment.id) || []
  const expanded = expandedReplies.has(comment.id)
  const visibleReplies = expanded ? replies : replies.slice(0, 3)
  const indent = 16 + Math.min(depth, 3) * 28
  const itemStyle: CSSProperties = { paddingLeft: indent }
  const moreStyle: CSSProperties = { marginLeft: indent + 40 }
  const own = comment.author.id === currentUserId
  const canDelete = isAdmin || own || (postAuthorId > 0 && postAuthorId === currentUserId)
  const editing = editingCommentId === comment.id
  const replyTarget = comment.reply_to
  const media = comment.media || []
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const editInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) editInput.current?.focus()
  }, [editing])

  return (
    <>
      <article
        className="comment-item"
        data-comment-id={comment.id}
        tabIndex={-1}
        style={itemStyle}
      >
        <button
          className="comment-item__avatar"
          type="button"
          onClick={() => onUser(comment.author.id)}
          aria-label={'Открыть профиль: ' + comment.author.display_name}
        >
          <Avatar
            name={comment.author.display_name}
            url={comment.author.photo_url}
            size={depth ? 34 : 40}
          />
        </button>
        <div className="comment-item__copy">
          <div className="comment-item__head">
            <button type="button" onClick={() => onUser(comment.author.id)}>
              {comment.author.display_name}
            </button>
            <span>{relativeTime(comment.created_at)}</span>
            <IconButton
              icon="more"
              size={18}
              label="Действия с комментарием"
              onClick={(event) =>
                setMenuAnchor(menuAnchorFromRect(event.currentTarget.getBoundingClientRect()))
              }
            />
          </div>
          {editing ? (
            <div className="comment-edit">
              <textarea
                ref={editInput}
                maxLength={1000}
                value={editText}
                onChange={(event) => onEditText(event.target.value)}
                placeholder="Текст комментария (необязательно)"
              />
              <CommentMediaGrid
                items={editMedia}
                onOpen={onMedia}
                onRemove={(item) => void onEditRemoveMedia(item)}
                removing={savingEdit || editUploadingMedia}
              />
              <div className="comment-edit__toolbar">
                {editMedia.length < COMMENT_MEDIA_LIMIT && (
                  <label
                    className={'comment-edit__attach' + (editUploadingMedia ? ' is-busy' : '')}
                  >
                    <Icon name="paperclip" size={18} />
                    <span>{editUploadingMedia ? 'Загрузка…' : 'Добавить фото или видео'}</span>
                    <input
                      type="file"
                      multiple
                      accept={COMMENT_MEDIA_ACCEPT}
                      disabled={savingEdit || editUploadingMedia}
                      onChange={(event) => {
                        void onEditAddMedia(event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                )}
                <span>
                  {editMedia.length}/{COMMENT_MEDIA_LIMIT}
                </span>
              </div>
              <div className="comment-edit__actions">
                <button
                  type="button"
                  onClick={onEditCancel}
                  disabled={savingEdit || editUploadingMedia}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void onEditSave(comment)}
                  disabled={
                    (!editText.trim() && !editMedia.length) || savingEdit || editUploadingMedia
                  }
                >
                  {savingEdit ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {(replyTarget || comment.body) && (
                <p>
                  {replyTarget && (
                    <>
                      <button
                        className="comment-item__reply-target"
                        type="button"
                        onClick={() => onUser(replyTarget.id)}
                      >
                        {firstName(replyTarget.display_name)}
                      </button>
                      {comment.body ? ', ' : ''}
                    </>
                  )}
                  {comment.body}
                </p>
              )}
              <CommentMediaGrid items={media} onOpen={onMedia} />
            </>
          )}
          <div className="comment-item__meta">
            <button type="button" onClick={() => onReply(comment)}>
              Ответить
            </button>
            <button
              className={'comment-like' + (comment.liked_by_me ? ' is-liked' : '')}
              type="button"
              aria-label={
                comment.liked_by_me ? 'Убрать лайк с комментария' : 'Лайкнуть комментарий'
              }
              aria-pressed={comment.liked_by_me}
              onClick={() => onLike(comment)}
            >
              <Icon name="heart" size={15} />
              {comment.like_count > 0 && <span>{comment.like_count}</span>}
            </button>
          </div>
        </div>
      </article>
      {menuAnchor && (
        <MaxContextMenu
          anchor={menuAnchor}
          label="Действия с комментарием"
          onClose={() => setMenuAnchor(null)}
        >
          {own && !editing && (
            <MaxContextMenuItem
              icon="edit"
              label="Изменить"
              onClick={() => {
                setMenuAnchor(null)
                onEditStart(comment)
              }}
            />
          )}
          {canDelete && (
            <MaxContextMenuItem
              icon="trash"
              label="Удалить"
              destructive
              onClick={() => {
                setMenuAnchor(null)
                onDelete(comment)
              }}
            />
          )}
          {!own && (
            <MaxContextMenuItem
              icon="info"
              label="Пожаловаться"
              destructive
              onClick={() => {
                setMenuAnchor(null)
                onReport(comment)
              }}
            />
          )}
        </MaxContextMenu>
      )}
      {visibleReplies.map((reply) => (
        <CommentThread
          key={reply.id}
          comment={reply}
          repliesByParent={repliesByParent}
          depth={1}
          expandedReplies={expandedReplies}
          currentUserId={currentUserId}
          postAuthorId={postAuthorId}
          isAdmin={isAdmin}
          editingCommentId={editingCommentId}
          editText={editText}
          editMedia={editMedia}
          savingEdit={savingEdit}
          editUploadingMedia={editUploadingMedia}
          onToggleReplies={onToggleReplies}
          onLike={onLike}
          onReply={onReply}
          onUser={onUser}
          onEditStart={onEditStart}
          onEditText={onEditText}
          onEditAddMedia={onEditAddMedia}
          onEditRemoveMedia={onEditRemoveMedia}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
          onDelete={onDelete}
          onReport={onReport}
          onMedia={onMedia}
        />
      ))}
      {replies.length > 3 && (
        <button
          className="comment-more"
          style={moreStyle}
          type="button"
          onClick={() => onToggleReplies(comment.id)}
        >
          {expanded ? 'Скрыть ответы' : 'Показать ещё ' + (replies.length - 3)}
        </button>
      )}
    </>
  )
}
