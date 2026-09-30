import { useEffect, useState } from 'react'
import { adminAction } from '../api/admin'
import { deletePost, loadPost, type Post } from '../api/posts'
import { publishPosts, syncPosts } from '../data/postSync'
import { reportContent } from '../api/reports'
import {
  loadUserProfile,
  removeFriend,
  resolveFriendRequest,
  type RelationshipState,
} from '../api/users'
import { usePostUpdate } from '../data/usePostUpdates'
import { cancelFriendRequest, sendFriendRequest } from '../participants-api'
import { postIsEditable } from '../post-edit-policy'
import { Button, Field } from '../ui/components/BasicUI'
import { MaxContextMenu, MaxContextMenuItem } from '../ui/components/ContextMenu'
import type { SocialProps } from './FriendPages'
import './social.css'

export function PostActionsScreen({
  id,
  anchor,
  back,
  navigate,
  data,
  confirm,
  onError,
}: SocialProps) {
  const cachedPost = [...data.posts, ...data.profilePosts].find((item) => item.id === id)
  const [loadedPost, setLoadedPost] = useState<Post | null>(cachedPost || null)
  usePostUpdate(loadedPost, setLoadedPost)
  const post = cachedPost || loadedPost
  const own = post?.author.id === data.profile?.id
  const admin = data.profile?.moderation_role === 'administrator'
  const [fallbackRelationship, setFallbackRelationship] = useState<{
    authorId: number
    state: RelationshipState
  } | null>(null)
  const relationshipState =
    post?.author.relationship_state ??
    (fallbackRelationship && fallbackRelationship.authorId === post?.author.id
      ? fallbackRelationship.state
      : null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id || cachedPost) return
    const controller = new AbortController()
    loadPost(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLoadedPost(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [id, cachedPost, onError])

  const postAuthorId = post?.author.id
  const postAuthorRelationship = post?.author.relationship_state
  useEffect(() => {
    if (!postAuthorId || own || postAuthorRelationship) return
    const controller = new AbortController()
    loadUserProfile(postAuthorId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setFallbackRelationship({
            authorId: postAuthorId,
            state: value.relationship_state,
          })
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [postAuthorId, postAuthorRelationship, own, onError])

  function patchRelationship(next: RelationshipState) {
    if (!post) return
    const authorId = post.author.id
    const patch = (items: Post[]) =>
      items.map((item) =>
        item.author.id === authorId
          ? { ...item, author: { ...item.author, relationship_state: next } }
          : item,
      )
    data.setPosts((current) => patch(current))
    data.setProfilePosts((current) => patch(current))
    setFallbackRelationship({ authorId, state: next })
  }

  function syncRelationshipData() {
    data.refresh('friends', 'feed', 'profilePosts', 'inbox')
  }

  function remove() {
    if (!post) return
    back()
    confirm({
      title: 'Удалить публикацию?',
      description: admin && !own ? 'Публикация исчезнет из приложения. Восстановить её можно в админ-разделе.' : 'Это действие нельзя отменить.',
      confirm: 'Удалить',
      destructive: true,
      onConfirm: () => {
        void (admin && !own ? adminAction('post', post.id, 'hide', 'Удалено администратором из меню публикации') : deletePost(post.id))
          .then(() => {
            data.setPosts((current) => current.filter((item) => item.id !== post.id))
            data.setProfilePosts((current) => current.filter((item) => item.id !== post.id))
            publishPosts([], [post.id])
            syncPosts()
            data.refresh('feed', 'profilePosts')
          })
          .catch((error) => onError(String(error)))
      },
    })
  }

  async function updateRelationship() {
    if (
      !post ||
      !relationshipState ||
      busy ||
      relationshipState === 'blocked' ||
      relationshipState === 'self'
    )
      return
    const authorId = post.author.id

    if (relationshipState === 'friend') {
      back()
      confirm({
        title: `Удалить ${post.author.display_name} из друзей?`,
        description:
          'Заявка этого человека появится у вас во входящих. Вы сможете принять или отклонить её.',
        confirm: 'Удалить',
        destructive: true,
        onConfirm: () => {
          void removeFriend(authorId)
            .then(() => {
              patchRelationship('incoming')
              syncRelationshipData()
            })
            .catch((error) => onError(String(error)))
        },
      })
      return
    }

    setBusy(true)
    try {
      let next: RelationshipState
      if (relationshipState === 'stranger') {
        await sendFriendRequest(authorId)
        next = 'outgoing'
      } else if (relationshipState === 'outgoing') {
        await cancelFriendRequest(authorId)
        next = 'stranger'
      } else {
        await resolveFriendRequest(authorId, true)
        next = 'friend'
      }
      patchRelationship(next)
      syncRelationshipData()
      back()
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function report() {
    if (!post || busy) return
    const trimmed = reason.trim()
    if (trimmed.length < 3 || trimmed.length > 450) return
    setBusy(true)
    try {
      await reportContent('post', post.id, trimmed)
      setReporting(false)
      setReason('')
      back()
      confirm({
        title: 'Жалоба отправлена',
        description: 'Она сохранена с привязкой к этой публикации.',
        confirm: 'Готово',
        onConfirm: () => { },
      })
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }

  const relationshipLabel =
    relationshipState === 'friend'
      ? 'Удалить из друзей'
      : relationshipState === 'outgoing'
        ? 'Отменить заявку'
        : relationshipState === 'incoming'
          ? 'Принять заявку'
          : 'Добавить в друзья'

  return (
    <MaxContextMenu anchor={anchor} label="Действия с публикацией" onClose={back}>
      {!post ? (
        <>
          <MaxContextMenuItem label="Действие с публикацией" loading onClick={() => { }} />
          <MaxContextMenuItem label="Действие с публикацией" loading onClick={() => { }} />
        </>
      ) : !reporting ? (
        <>
          {own && postIsEditable(post) && (
            <MaxContextMenuItem
              icon="edit"
              label="Редактировать"
              onClick={() => {
                back()
                navigate('editpost', id)
              }}
            />
          )}
          {(own || admin) && (
            <MaxContextMenuItem
              icon="trash"
              label="Удалить публикацию"
              destructive
              onClick={remove}
            />
          )}
          {!own &&
            relationshipState &&
            relationshipState !== 'blocked' &&
            relationshipState !== 'self' && (
              <MaxContextMenuItem
                icon="users"
                label={relationshipLabel}
                disabled={busy}
                onClick={() => void updateRelationship()}
              />
            )}
          {!own && !relationshipState && (
            <MaxContextMenuItem label="Действие с автором" loading onClick={() => { }} />
          )}
          {!own && (
            <MaxContextMenuItem
              icon="info"
              label="Пожаловаться"
              destructive
              onClick={() => setReporting(true)}
            />
          )}
        </>
      ) : (
        <form
          className="max-context-menu__form"
          onSubmit={(event) => {
            event.preventDefault()
            void report()
          }}
        >
          <h3>Жалоба на публикацию</h3>
          <p>Коротко опишите причину — публикация будет прикреплена к жалобе автоматически.</p>
          <Field
            label="Причина"
            value={reason}
            onChange={(value) => setReason(value.slice(0, 450))}
            placeholder="Что не так?"
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
            <Button
              type="submit"
              disabled={reason.trim().length < 3 || reason.trim().length > 450 || busy}
            >
              {busy ? 'Отправляем…' : 'Отправить'}
            </Button>
          </div>
        </form>
      )}
    </MaxContextMenu>
  )
}
