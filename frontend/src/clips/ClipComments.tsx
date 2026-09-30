import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  createPostComment,
  deleteComment,
  setCommentLike,
  updateComment,
  type Comment,
} from '../api/comments'
import { mediaURL } from '../api/credentials'
import { deleteMedia, PHOTO_INPUT_ACCEPT, uploadCommentPhoto, uploadCommentVideo } from '../api/media'
import type { PostMedia } from '../api/posts'
import { compareCommentsForViewer } from '../comment-experience'
import { mergeComments, replyIds } from '../data/commentPages'
import { syncPosts } from '../data/postSync'
import { useComments } from '../data/useComments'
import { Avatar, Icon } from '../ui/components/BasicUI'
import { relativeTime } from '../ui/components/ContentCards'
import { ContentReportSheet } from '../screens/ContentReportSheet'
import type { Clip } from '../api/clips'

const COMMENT_MEDIA_LIMIT = 4
const COMMENT_MEDIA_ACCEPT = `${PHOTO_INPUT_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name)
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value
}

export function ClipComments({
  clip,
  currentUserId,
  onClose,
  onProfile,
  onCountChange,
  onNotice,
}: {
  clip: Clip
  currentUserId: number
  onClose: () => void
  onProfile: (userId: number) => void
  onCountChange: (delta: number) => void
  onNotice: (message: string) => void
}) {
  const {
    comments,
    setComments,
    nextCursor,
    loading,
    loadingMore,
    error,
    setError,
    loadMore,
    refresh,
  } = useComments(clip.id)
  const [text, setText] = useState('')
  const [draftMedia, setDraftMedia] = useState<PostMedia[]>([])
  const draftMediaRef = useRef<PostMedia[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [saving, setSaving] = useState(false)
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [expandedRoots, setExpandedRoots] = useState<Set<number>>(
    () => new Set(),
  )
  const [menuId, setMenuId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [reportingComment, setReportingComment] = useState<Comment | null>(null)
  const likePending = useRef(new Set<number>())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    draftMediaRef.current = draftMedia
  }, [draftMedia])

  useEffect(() => () => {
    for (const item of draftMediaRef.current) void deleteMedia(item.id).catch(() => {})
  }, [])

  const { roots, repliesByRoot, rootByCommentId } = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]))
    const roots = comments
      .filter(
        (comment) =>
          !comment.parent_comment_id || !byId.has(comment.parent_comment_id),
      )
      .sort((a, b) => compareCommentsForViewer(a, b, currentUserId))

    const rootByCommentId = new Map<number, number>()
    for (const root of roots) rootByCommentId.set(root.id, root.id)

    let changed = true
    while (changed) {
      changed = false
      for (const comment of comments) {
        if (
          rootByCommentId.has(comment.id) ||
          !comment.parent_comment_id
        )
          continue
        const rootId = rootByCommentId.get(comment.parent_comment_id)
        if (!rootId) continue
        rootByCommentId.set(comment.id, rootId)
        changed = true
      }
    }

    const repliesByRoot = new Map<number, Comment[]>()
    for (const comment of comments) {
      const rootId = rootByCommentId.get(comment.id)
      if (!rootId || rootId === comment.id) continue
      const list = repliesByRoot.get(rootId) || []
      list.push(comment)
      repliesByRoot.set(rootId, list)
    }
    for (const list of repliesByRoot.values())
      list.sort((a, b) =>
        compareCommentsForViewer(a, b, currentUserId, false),
      )

    return { roots, repliesByRoot, rootByCommentId }
  }, [comments, currentUserId])

  function startReply(comment: Comment) {
    setReplyTo(comment)
    setMenuId(null)
    window.requestAnimationFrame(() => input.current?.focus())
  }

  async function addDraftMedia(files?: FileList | null) {
    const selected = Array.from(files || [])
    if (!selected.length || uploadingMedia || saving) return
    const available = COMMENT_MEDIA_LIMIT - draftMedia.length
    if (available <= 0) return
    setUploadingMedia(true)
    setError('')
    try {
      for (const file of selected.slice(0, available)) {
        const uploaded = isVideoFile(file)
          ? await uploadCommentVideo(file)
          : await uploadCommentPhoto(file)
        setDraftMedia((current) =>
          current.length < COMMENT_MEDIA_LIMIT ? [...current, uploaded] : current,
        )
      }
      if (selected.length > available)
        setError(`К комментарию можно прикрепить не больше ${COMMENT_MEDIA_LIMIT} файлов`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить вложение')
    } finally {
      setUploadingMedia(false)
    }
  }

  async function removeDraftMedia(item: PostMedia) {
    if (saving || uploadingMedia) return
    try {
      await deleteMedia(item.id)
      setDraftMedia((current) => current.filter((media) => media.id !== item.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось убрать вложение')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if ((!body && !draftMedia.length) || saving || uploadingMedia) return
    setSaving(true)
    setError('')
    onCountChange(1)
    try {
      const comment = await createPostComment(
        clip.id,
        body,
        replyTo?.id,
        draftMedia.map((item) => item.id),
      )
      setComments((current) => mergeComments([comment], current))
      if (replyTo) {
        const rootId = rootByCommentId.get(replyTo.id) || replyTo.id
        setExpandedRoots((current) => new Set(current).add(rootId))
      }
      setText('')
      draftMediaRef.current = []
      setDraftMedia([])
      setReplyTo(null)
    } catch (cause) {
      onCountChange(-1)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось отправить комментарий',
      )
    } finally {
      setSaving(false)
      syncPosts([clip.id])
      refresh()
    }
  }

  async function toggleLike(comment: Comment) {
    if (likePending.current.has(comment.id)) return
    likePending.current.add(comment.id)
    const liked = !comment.liked_by_me
    const count = Math.max(0, comment.like_count + (liked ? 1 : -1))
    setComments((current) =>
      current.map((item) =>
        item.id === comment.id
          ? { ...item, liked_by_me: liked, like_count: count }
          : item,
      ),
    )
    try {
      await setCommentLike(comment.id, liked)
    } catch (cause) {
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id ? comment : item,
        ),
      )
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось изменить лайк',
      )
    } finally {
      likePending.current.delete(comment.id)
      refresh()
    }
  }

  function startEdit(comment: Comment) {
    setEditingId(comment.id)
    setEditText(comment.body)
    setMenuId(null)
    setDeleteConfirmId(null)
  }

  async function saveEdit(comment: Comment) {
    const body = editText.trim()
    if (!body || savingEdit) return
    const previous = comment.body
    setSavingEdit(true)
    setError('')
    setComments((current) =>
      current.map((item) =>
        item.id === comment.id ? { ...item, body } : item,
      ),
    )
    try {
      await updateComment(
        comment.id,
        body,
        (comment.media || []).map((item) => item.id),
      )
      setEditingId(null)
      setEditText('')
    } catch (cause) {
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id ? { ...item, body: previous } : item,
        ),
      )
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось изменить комментарий',
      )
    } finally {
      setSavingEdit(false)
      refresh()
    }
  }

  async function removeComment(comment: Comment) {
    const branch = replyIds(comments, comment.id)
    const removed = comments.filter((item) => branch.has(item.id))
    if (!removed.length) return
    setDeleteConfirmId(null)
    setMenuId(null)
    setComments((current) =>
      current.filter((item) => !branch.has(item.id)),
    )
    onCountChange(-removed.length)
    try {
      await deleteComment(comment.id)
      if (replyTo && branch.has(replyTo.id)) setReplyTo(null)
      syncPosts([clip.id])
    } catch (cause) {
      setComments((current) => mergeComments(current, removed))
      onCountChange(removed.length)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось удалить комментарий',
      )
    } finally {
      refresh()
    }
  }

  function renderComment(comment: Comment, nested = false) {
    const own = comment.author.id === currentUserId
    const canDelete = own || clip.author.id === currentUserId
    const editing = editingId === comment.id
    const menuOpen = menuId === comment.id
    const confirmDelete = deleteConfirmId === comment.id

    return (
      <article
        key={comment.id}
        className={`clip-comment${nested ? ' is-reply' : ''}`}
      >
        <button
          className="clip-comment-avatar"
          type="button"
          onClick={() => onProfile(comment.author.id)}
          aria-label={`Профиль ${comment.author.display_name}`}
        >
          <Avatar
            name={comment.author.display_name}
            url={comment.author.photo_url}
            size={nested ? 32 : 38}
          />
        </button>

        <div className="clip-comment-main">
          <div className="clip-comment-head">
            <button
              className="clip-comment-name"
              type="button"
              onClick={() => onProfile(comment.author.id)}
            >
              {comment.author.display_name}
            </button>
            <span>{relativeTime(comment.created_at)}</span>
            <button
              className="clip-comment-more"
              type="button"
              aria-label="Действия с комментарием"
              aria-expanded={menuOpen}
              onClick={() =>
                setMenuId((value) =>
                  value === comment.id ? null : comment.id,
                )
              }
            >
              <Icon name="more" size={17} />
            </button>
          </div>

          {menuOpen && (
            <div className="clip-comment-menu">
              {own && (
                <button type="button" onClick={() => startEdit(comment)}>
                  Изменить
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setDeleteConfirmId(comment.id)
                    setMenuId(null)
                  }}
                >
                  Удалить
                </button>
              )}
              {!own && (
                <button
                  type="button"
                  onClick={() => {
                    setReportingComment(comment)
                    setMenuId(null)
                  }}
                >
                  Пожаловаться
                </button>
              )}
            </div>
          )}

          {editing ? (
            <div className="clip-comment-edit">
              <textarea
                maxLength={1000}
                value={editText}
                autoFocus
                onChange={(event) => setEditText(event.target.value)}
              />
              <div>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => {
                    setEditingId(null)
                    setEditText('')
                  }}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={!editText.trim() || savingEdit}
                  onClick={() => void saveEdit(comment)}
                >
                  {savingEdit ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {(comment.reply_to || comment.body) && (
                <p>
                  {comment.reply_to && (
                    <>
                      <button
                        className="clip-comment-reply-target"
                        type="button"
                        onClick={() => onProfile(comment.reply_to!.id)}
                      >
                        {firstName(comment.reply_to.display_name)}
                      </button>
                      {comment.body ? ', ' : ''}
                    </>
                  )}
                  {comment.body}
                </p>
              )}

              {(comment.media || []).length > 0 && (
                <div className="clip-comment-media">
                  {comment.media.map((item) =>
                    item.mime_type.startsWith('video/') ? (
                      <video
                        key={item.id}
                        src={mediaURL(item.url)}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        key={item.id}
                        src={mediaURL(item.url)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ),
                  )}
                </div>
              )}
            </>
          )}

          {confirmDelete && (
            <div className="clip-comment-delete-confirm">
              <span>Удалить комментарий?</span>
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
              >
                Нет
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => void removeComment(comment)}
              >
                Да
              </button>
            </div>
          )}

          {!editing && (
            <div className="clip-comment-actions-row">
              <button type="button" onClick={() => startReply(comment)}>
                Ответить
              </button>
              <button
                type="button"
                className={comment.liked_by_me ? 'is-liked' : ''}
                aria-pressed={comment.liked_by_me}
                onClick={() => void toggleLike(comment)}
              >
                <Icon name="heart" size={15} />
                {comment.like_count > 0 && <span>{comment.like_count}</span>}
              </button>
            </div>
          )}
        </div>
      </article>
    )
  }

  return (
    <div
      className="clip-comments-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="clip-comments-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Комментарии"
      >
        <header className="clip-comments-header">
          <span className="clip-comments-handle" aria-hidden="true" />
          <strong>
            Комментарии
            {clip.comment_count > 0 ? ` · ${clip.comment_count}` : ''}
          </strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="clip-comments-list">
          {loading && comments.length === 0 ? (
            <div className="clip-comments-state">Загружаем комментарии…</div>
          ) : roots.length === 0 ? (
            <div className="clip-comments-state">
              <Icon name="comment" size={30} />
              <strong>Пока тихо</strong>
              <span>Будьте первым, кто оставит комментарий.</span>
            </div>
          ) : (
            roots.map((root) => {
              const replies = repliesByRoot.get(root.id) || []
              const expanded = expandedRoots.has(root.id)
              const visible = expanded ? replies : replies.slice(0, 2)
              return (
                <div className="clip-comment-thread" key={root.id}>
                  {renderComment(root)}
                  {visible.map((reply) => renderComment(reply, true))}
                  {replies.length > 2 && (
                    <button
                      className="clip-comment-show-replies"
                      type="button"
                      onClick={() =>
                        setExpandedRoots((current) => {
                          const next = new Set(current)
                          if (next.has(root.id)) next.delete(root.id)
                          else next.add(root.id)
                          return next
                        })
                      }
                    >
                      {expanded
                        ? 'Скрыть ответы'
                        : `Показать ответы · ${replies.length}`}
                    </button>
                  )}
                </div>
              )
            })
          )}

          {nextCursor && (
            <button
              className="clip-comments-load-more"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </div>

        <form className="clip-comment-composer" onSubmit={submit}>
          {replyTo && (
            <div className="clip-comment-replying">
              <span>
                Ответ для {firstName(replyTo.author.display_name)}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Отменить ответ"
              >
                ×
              </button>
            </div>
          )}

          {draftMedia.length > 0 && (
            <div className="clip-comment-draft-media">
              {draftMedia.map((item) => (
                <div key={item.id} className="clip-comment-draft-item">
                  {item.mime_type.startsWith('video/') ? (
                    <video src={mediaURL(item.url)} muted playsInline preload="metadata" />
                  ) : (
                    <img src={mediaURL(item.url)} alt="" />
                  )}
                  <button
                    type="button"
                    aria-label="Убрать вложение"
                    disabled={saving || uploadingMedia}
                    onClick={() => void removeDraftMedia(item)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="clip-comment-input-row">
            <label
              className={`clip-comment-attach${uploadingMedia || draftMedia.length >= COMMENT_MEDIA_LIMIT ? ' is-disabled' : ''}`}
              aria-label="Прикрепить фото или видео"
            >
              <Icon name="paperclip" size={20} />
              <input
                type="file"
                multiple
                hidden
                accept={COMMENT_MEDIA_ACCEPT}
                disabled={saving || uploadingMedia || draftMedia.length >= COMMENT_MEDIA_LIMIT}
                onChange={(event) => {
                  void addDraftMedia(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <input
              ref={input}
              maxLength={1000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={replyTo ? 'Написать ответ…' : 'Комментарий…'}
            />
            <button
              type="submit"
              disabled={(!text.trim() && !draftMedia.length) || saving || uploadingMedia}
              aria-label="Отправить комментарий"
            >
              <Icon name="send" size={21} />
            </button>
          </div>

          {error && <div className="clip-comment-error">{error}</div>}
        </form>

        {reportingComment && (
          <ContentReportSheet
            key={reportingComment.id}
            targetType="comment"
            targetId={reportingComment.id}
            title="Пожаловаться на комментарий"
            preview={`${reportingComment.author.display_name}: ${reportingComment.body}`}
            onClose={() => setReportingComment(null)}
            onSent={() => {
              setReportingComment(null)
              onNotice('Жалоба отправлена на проверку')
            }}
          />
        )}
      </section>
    </div>
  )
}
