import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  createPostComment,
  deleteComment,
  setCommentLike,
  updateComment,
  type Comment,
} from '../api/comments'
import { deleteMedia, uploadCommentPhoto, uploadCommentVideo } from '../api/media'
import { type Post, type PostMedia } from '../api/posts'
import { compareCommentsForViewer, useCommentReveal } from '../comment-experience'
import { mergeComments as addComments, replyIds } from '../data/commentPages'
import { syncPosts } from '../data/postSync'
import { useComments } from '../data/useComments'
import { Header, Icon, StatePanel } from '../ui/components/BasicUI'
import { PostCard } from '../ui/components/ContentCards'
import { type MenuAnchor } from '../ui/components/ContextMenu'
import './comment-experience.css'
import {
  COMMENT_MEDIA_ACCEPT,
  COMMENT_MEDIA_LIMIT,
  CommentMediaGrid,
  CommentThread,
  firstName,
} from './CommentThread'
import { ContentReportSheet } from './ContentReportSheet'
import './details.css'
import { adminAction } from '../api/admin'

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name)
}

export function CommentsScreen({
  postId,
  post,
  postLoading,
  currentUserId,
  isAdmin = false,
  back,
  navigate,
  onLike,
  onShare,
  onMedia,
  confirm,
  onCommentCountChange,
  onChanged,
  onNotice,
  title = 'Публикация',
}: {
  postId: number
  post?: Post
  postLoading?: boolean
  currentUserId: number
  isAdmin?: boolean
  back: () => void
  navigate: (view: string, id?: number, anchor?: MenuAnchor) => void
  onLike: (post: Post) => void
  onShare: (post: Post) => void
  onMedia: (media: PostMedia, items?: PostMedia[]) => void
  confirm: (
    modal: {
      title: string
      description?: string
      confirm: string
      onConfirm: () => void
      destructive?: boolean
    } | null,
  ) => void
  onCommentCountChange: (delta: number) => void
  onChanged: () => void
  onNotice: (message: string) => void
  title?: string
}) {
  const { comments, setComments, nextCursor, loading, loadingMore, error, setError, loadMore, refresh } = useComments(postId)
  const [text, setText] = useState('')
  const [draftMedia, setDraftMedia] = useState<PostMedia[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(() => new Set())
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editMedia, setEditMedia] = useState<PostMedia[]>([])
  const [editUploadingMedia, setEditUploadingMedia] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const draftMediaRef = useRef<PostMedia[]>([])
  const editMediaRef = useRef<PostMedia[]>([])
  const editOriginalMediaIds = useRef<Set<number>>(new Set())
  const [reportingComment, setReportingComment] = useState<Comment | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const commentLikePending = useRef<Set<number>>(new Set())
  const { listRef, revealComment } = useCommentReveal()

  useEffect(() => {
    draftMediaRef.current = draftMedia
  }, [draftMedia])
  useEffect(() => {
    editMediaRef.current = editMedia
  }, [editMedia])
  useEffect(() => {
    setText('')
    setDraftMedia([])
    setReplyTo(null)
    setExpandedReplies(new Set())
    setEditingCommentId(null)
    setEditText('')
    setEditMedia([])
    editOriginalMediaIds.current = new Set()
    setReportingComment(null)
    commentLikePending.current.clear()
    return () => {
      for (const item of draftMediaRef.current) void deleteMedia(item.id).catch(() => { })
      const originals = editOriginalMediaIds.current
      for (const item of editMediaRef.current) {
        if (!originals.has(item.id)) void deleteMedia(item.id).catch(() => { })
      }
    }
  }, [postId])

  const { roots, repliesByParent, rootByCommentId } = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]))
    const roots = comments
      .filter((comment) => !comment.parent_comment_id || !byId.has(comment.parent_comment_id))
      .sort((a, b) => compareCommentsForViewer(a, b, currentUserId))
    const rootByCommentId = new Map<number, number>()
    for (const root of roots) rootByCommentId.set(root.id, root.id)

    let changed = true
    while (changed) {
      changed = false
      for (const comment of comments) {
        if (rootByCommentId.has(comment.id) || !comment.parent_comment_id) continue
        const rootId = rootByCommentId.get(comment.parent_comment_id)
        if (!rootId) continue
        rootByCommentId.set(comment.id, rootId)
        changed = true
      }
    }

    const replies = new Map<number, Comment[]>()
    for (const comment of comments) {
      const rootId = rootByCommentId.get(comment.id)
      if (!rootId || rootId === comment.id) continue
      const list = replies.get(rootId) || []
      list.push(comment)
      replies.set(rootId, list)
    }
    for (const list of replies.values())
      list.sort((a, b) => compareCommentsForViewer(a, b, currentUserId, false))
    return { roots, repliesByParent: replies, rootByCommentId }
  }, [comments, currentUserId])

  function startReply(comment: Comment) {
    setReplyTo(comment)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function cancelReply() {
    setReplyTo(null)
  }

  function hasCommentContent() {
    return Boolean(text.trim() || draftMedia.length)
  }

  async function uploadCommentFile(file: File) {
    return isVideoFile(file) ? uploadCommentVideo(file) : uploadCommentPhoto(file)
  }

  async function addDraftMedia(files?: FileList | null) {
    const selected = Array.from(files || [])
    if (!selected.length || uploadingMedia || saving) return
    const available = COMMENT_MEDIA_LIMIT - draftMedia.length
    if (available <= 0) return
    const overflow = selected.length > available
    setUploadingMedia(true)
    setError(
      overflow ? `К комментарию можно прикрепить не больше ${COMMENT_MEDIA_LIMIT} файлов` : '',
    )
    try {
      for (const file of selected.slice(0, available)) {
        const uploaded = await uploadCommentFile(file)
        setDraftMedia((current) =>
          current.length < COMMENT_MEDIA_LIMIT ? [...current, uploaded] : current,
        )
      }
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

  function cleanupNewEditMedia() {
    const originals = editOriginalMediaIds.current
    for (const item of editMedia) {
      if (!originals.has(item.id)) void deleteMedia(item.id).catch(() => { })
    }
  }

  function cancelEdit() {
    if (savingEdit || editUploadingMedia) return
    cleanupNewEditMedia()
    setEditingCommentId(null)
    setEditText('')
    setEditMedia([])
    editOriginalMediaIds.current = new Set()
  }

  function startEdit(comment: Comment) {
    cleanupNewEditMedia()
    const media = comment.media || []
    editOriginalMediaIds.current = new Set(media.map((item) => item.id))
    setEditingCommentId(comment.id)
    setEditText(comment.body)
    setEditMedia(media)
    setError('')
  }

  async function addEditMedia(files?: FileList | null) {
    const selected = Array.from(files || [])
    if (!selected.length || editUploadingMedia || savingEdit || !editingCommentId) return
    const available = COMMENT_MEDIA_LIMIT - editMedia.length
    if (available <= 0) return
    const overflow = selected.length > available
    setEditUploadingMedia(true)
    setError(
      overflow ? `К комментарию можно прикрепить не больше ${COMMENT_MEDIA_LIMIT} файлов` : '',
    )
    try {
      for (const file of selected.slice(0, available)) {
        const uploaded = await uploadCommentFile(file)
        setEditMedia((current) =>
          current.length < COMMENT_MEDIA_LIMIT ? [...current, uploaded] : current,
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить вложение')
    } finally {
      setEditUploadingMedia(false)
    }
  }

  async function removeEditMedia(item: PostMedia) {
    if (savingEdit || editUploadingMedia) return
    if (editOriginalMediaIds.current.has(item.id)) {
      setEditMedia((current) => current.filter((media) => media.id !== item.id))
      return
    }
    try {
      await deleteMedia(item.id)
      setEditMedia((current) => current.filter((media) => media.id !== item.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось убрать вложение')
    }
  }

  async function saveEdit(comment: Comment) {
    const body = editText.trim()
    if ((!body && !editMedia.length) || savingEdit || editUploadingMedia) return
    const previous = { ...comment, media: [...(comment.media || [])] }
    const media = [...editMedia]
    const nextIds = new Set(media.map((item) => item.id))
    const removedOriginal = (comment.media || []).filter((item) => !nextIds.has(item.id))
    setSavingEdit(true)
    setError('')
    setComments((current) =>
      current.map((item) => (item.id === comment.id ? { ...item, body, media } : item)),
    )
    try {
      await updateComment(
        comment.id,
        body,
        media.map((item) => item.id),
      )
      setEditingCommentId(null)
      setEditText('')
      editMediaRef.current = []
      setEditMedia([])
      editOriginalMediaIds.current = new Set()
      void Promise.allSettled(removedOriginal.map((item) => deleteMedia(item.id)))
      onChanged()
    } catch (cause) {
      setComments((current) => current.map((item) => (item.id === comment.id ? previous : item)))
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить комментарий')
    } finally {
      setSavingEdit(false)
      refresh()
    }
  }

  async function toggleCommentLike(comment: Comment) {
    if (commentLikePending.current.has(comment.id)) return
    const nextLiked = !comment.liked_by_me
    const nextCount = Math.max(0, comment.like_count + (nextLiked ? 1 : -1))
    commentLikePending.current.add(comment.id)
    setComments((current) =>
      current.map((item) =>
        item.id === comment.id ? { ...item, liked_by_me: nextLiked, like_count: nextCount } : item,
      ),
    )
    try {
      await setCommentLike(comment.id, nextLiked)
    } catch (cause) {
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id
            ? {
              ...item,
              liked_by_me: comment.liked_by_me,
              like_count: comment.like_count,
            }
            : item,
        ),
      )
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить лайк комментария')
    } finally {
      commentLikePending.current.delete(comment.id)
      refresh()
    }
  }

  function toggleReplies(commentId: number) {
    setExpandedReplies((current) => {
      const next = new Set(current)
      if (next.has(commentId)) next.delete(commentId)
      else next.add(commentId)
      return next
    })
  }

  async function removeComment(comment: Comment) {
    const branch = replyIds(comments, comment.id)
    const removed = comments.filter((item) => branch.has(item.id))
    if (!removed.length) return
    setError('')
    setComments((current) => current.filter((item) => !branch.has(item.id)))
    if (replyTo && branch.has(replyTo.id)) cancelReply()
    if (editingCommentId && branch.has(editingCommentId)) cancelEdit()
    onCommentCountChange(-removed.length)
    try {
      if (isAdmin && comment.author.id !== currentUserId) await adminAction('comment', comment.id, 'hide', 'Удалено администратором из обсуждения')
      else await deleteComment(comment.id)
      onChanged()
      syncPosts([postId])
      refresh()
    } catch (cause) {
      setComments((current) => addComments(current, removed))
      onCommentCountChange(removed.length)
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить комментарий')
    }
  }

  function askDelete(comment: Comment) {
    const own = comment.author.id === currentUserId
    confirm({
      title: 'Удалить комментарий?',
      description: isAdmin && !own ? 'Комментарий будет удалён из обсуждения. Восстановление доступно в админ-разделе.' : own
        ? 'Комментарий, его вложения и ответы будут удалены.'
        : 'Вы автор публикации, поэтому можете удалить этот комментарий и ответы на него.',
      confirm: 'Удалить',
      destructive: true,
      onConfirm: () => {
        void removeComment(comment)
      },
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!hasCommentContent() || saving || uploadingMedia) return
    setSaving(true)
    setError('')
    onCommentCountChange(1)
    try {
      const comment = await createPostComment(
        postId,
        body,
        replyTo?.id,
        draftMedia.map((item) => item.id),
      )
      setComments((current) => addComments([comment], current))
      revealComment(comment.id)
      if (replyTo) {
        const rootId = rootByCommentId.get(replyTo.id) || replyTo.id
        setExpandedReplies((current) => new Set(current).add(rootId))
      }
      setText('')
      draftMediaRef.current = []
      setDraftMedia([])
      setReplyTo(null)
      onChanged()
    } catch (cause) {
      onCommentCountChange(-1)
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить комментарий')
    } finally {
      setSaving(false)
      syncPosts([postId])
      refresh()
    }
  }

  return (
    <>
      <Header title={title} back={back} />
      <div ref={listRef} className="screen-scroll comments-list">
        {post ? (
          <div className="comments-post">
            <PostCard
              post={post}
              onOpen={() => { }}
              onOpenOriginal={(postId) => navigate('post', postId)}
              onUser={() => navigate('userprofile', post.author.id)}
              onTaggedUser={(userId) =>
                navigate(userId === currentUserId ? 'profile' : 'userprofile', userId)
              }
              onLike={() => onLike(post)}
              onComments={() => inputRef.current?.focus()}
              onLikers={() => navigate('likers', post.id)}
              onShare={() => onShare(post)}
              onMedia={onMedia}
              onEvent={() => post.event_id && navigate('event', post.event_id)}
              onActions={(anchor) => navigate('postactions', post.id, anchor)}
            />
          </div>
        ) : postLoading ? (
          <div className="comments-post-loading">
            <StatePanel title="" loading />
          </div>
        ) : null}
        <h2 className="comments-heading">Комментарии{post ? ' · ' + post.comment_count : ''}</h2>
        {loading ? (
          <StatePanel title="" loading />
        ) : error && !comments.length ? (
          <StatePanel title="Не удалось загрузить" description={error} />
        ) : roots.length ? (
          <div className="comment-tree">
            {roots.map((comment) => (
              <CommentThread
                key={comment.id}
                comment={comment}
                repliesByParent={repliesByParent}
                depth={0}
                expandedReplies={expandedReplies}
                currentUserId={currentUserId}
                postAuthorId={post?.author.id || 0}
                isAdmin={isAdmin}
                editingCommentId={editingCommentId}
                editText={editText}
                editMedia={editMedia}
                savingEdit={savingEdit}
                editUploadingMedia={editUploadingMedia}
                onToggleReplies={toggleReplies}
                onLike={toggleCommentLike}
                onReply={startReply}
                onUser={(userId) => navigate('userprofile', userId)}
                onEditStart={startEdit}
                onEditText={setEditText}
                onEditAddMedia={addEditMedia}
                onEditRemoveMedia={removeEditMedia}
                onEditSave={saveEdit}
                onEditCancel={cancelEdit}
                onDelete={askDelete}
                onReport={(comment) => {
                  setReportingComment(comment)
                  setError('')
                }}
                onMedia={onMedia}
              />
            ))}
            {nextCursor && (
              <button
                className="comments-load-more"
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? 'Загрузка…' : 'Показать более ранние комментарии'}
              </button>
            )}
          </div>
        ) : (
          <StatePanel title="Пока нет комментариев" description="Начните обсуждение." />
        )}
      </div>
      <form className="comment-form" onSubmit={submit}>
        {replyTo && (
          <div className="comment-reply">
            <span>
              Ответ для{' '}
              <button
                className="comment-reply__target"
                type="button"
                onClick={() => navigate('userprofile', replyTo.author.id)}
              >
                {firstName(replyTo.author.display_name)}
              </button>
            </span>
            <button
              className="comment-reply__close"
              type="button"
              aria-label="Отменить ответ"
              onClick={cancelReply}
            >
              ×
            </button>
          </div>
        )}
        {draftMedia.length > 0 && (
          <div className="comment-form__media">
            <CommentMediaGrid
              items={draftMedia}
              onOpen={onMedia}
              onRemove={(item) => void removeDraftMedia(item)}
              removing={saving || uploadingMedia}
            />
          </div>
        )}
        <div className="comment-form__input">
          <label
            className={
              'comment-form__attach' +
              (uploadingMedia || draftMedia.length >= COMMENT_MEDIA_LIMIT ? ' is-disabled' : '')
            }
            aria-label="Прикрепить фото или видео"
            title="Прикрепить фото или видео"
          >
            <Icon name="paperclip" size={22} />
            <input
              type="file"
              multiple
              accept={COMMENT_MEDIA_ACCEPT}
              disabled={saving || uploadingMedia || draftMedia.length >= COMMENT_MEDIA_LIMIT}
              onChange={(event) => {
                void addDraftMedia(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <div className="comment-form__field">
            {replyTo && (
              <button
                className="comment-form__reply-target"
                type="button"
                onClick={() => navigate('userprofile', replyTo.author.id)}
              >
                {firstName(replyTo.author.display_name)},
              </button>
            )}
            <input
              ref={inputRef}
              maxLength={1000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                uploadingMedia
                  ? 'Загружаем вложение…'
                  : replyTo
                    ? 'Написать ответ…'
                    : 'Написать комментарий'
              }
            />
          </div>
          <button
            type="submit"
            disabled={!hasCommentContent() || saving || uploadingMedia}
            aria-label="Отправить"
          >
            <Icon name="send" size={22} />
          </button>
        </div>
        {(uploadingMedia || draftMedia.length > 0) && (
          <div className="comment-form__media-status">
            <span>
              {uploadingMedia
                ? 'Загрузка…'
                : `${draftMedia.length}/${COMMENT_MEDIA_LIMIT} вложений`}
            </span>
            <small>Фото JPEG, PNG, HEIC/HEIF · видео MP4/MOV до 100 МБ</small>
          </div>
        )}
        {error && comments.length > 0 && <span className="error-text">{error}</span>}
      </form>
      {reportingComment && (
        <ContentReportSheet
          key={reportingComment.id}
          targetType="comment"
          targetId={reportingComment.id}
          title="Пожаловаться на комментарий"
          preview={`${reportingComment.author.display_name}: ${reportingComment.body || (reportingComment.media?.length ? 'Медиа-вложение' : '')}`}
          onClose={() => setReportingComment(null)}
          onSent={() => {
            setReportingComment(null)
            onNotice('Жалоба отправлена на проверку')
          }}
        />
      )}
    </>
  )
}

export default CommentsScreen
