import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { operationKey } from '../api/http'
import { createPost, type Post } from '../api/posts'
import { syncPosts } from '../data/postSync'
import { loadFriendDirectMessageTarget } from '../api/users'
import type { HostAdapter } from '../host'
import { maxLink } from '../ui-utils'
import type { AppDataResult } from '../useAppData'
import type { Modal } from './useFeedback'

export function useSharing(data: AppDataResult, host: HostAdapter, cityName: string, maxBotName: string,
  setModal: Dispatch<SetStateAction<Modal | null>>, setToast: Dispatch<SetStateAction<string>>, showError: (message: string) => void) {
  const [sharePost, setSharePost] = useState<Post | null>(null)
  const sending = useRef(false)
  function postURL(post: Post) {
    const payload = `post_${post.id}`
    if (host.provider === 'max')
      return maxLink(maxBotName, payload) || `${window.location.origin}/?postId=${post.id}`
    return `${window.location.origin}/?postId=${post.id}`
  }
  function share(post: Post) {
    host.hapticSelection()
    setSharePost(post)
  }
  async function copyPostLink(post: Post) {
    try {
      if (!navigator.clipboard) throw new Error('Буфер обмена недоступен')
      await navigator.clipboard.writeText(postURL(post))
      setSharePost(null)
      setModal({
        title: 'Ссылка скопирована',
        description: 'Можно вставить её в любой чат.',
        confirm: 'Готово',
        onConfirm: () => setModal(null),
      })
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось скопировать ссылку')
    }
  }
  async function shareNative(post: Post) {
    const url = postURL(post)
    try {
      const shared = await host.share({ link: url })
      if (!shared) {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(url)
          setModal({
            title: 'Ссылка скопирована',
            confirm: 'Готово',
            onConfirm: () => setModal(null),
          })
        } else throw new Error('Системный шеринг недоступен')
      }
      setSharePost(null)
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось поделиться')
    }
  }
  async function repost(post: Post) {
    if (sending.current) return
    if (post.reposted_by_me) {
      setSharePost(null)
      setToast('Этот пост уже есть на вашей стене')
      return
    }
    sending.current = true
    const sourceVisibility = post.repost?.visibility || post.visibility
    const sourceEventID = post.repost?.event_id || post.event_id
    let visibility: Post['visibility'] = 'city'
    if (sourceVisibility === 'friends') visibility = 'friends'
    if (sourceVisibility === 'event' && sourceEventID) visibility = 'event'
    try {
      const created = await createPost(
        {
          ...(visibility === 'event' && sourceEventID ? { event_id: sourceEventID } : {}),
          visibility,
          city: post.city,
          caption: '',
          media_ids: [],
          tagged_user_ids: [],
          repost_of_post_id: post.id,
        },
        operationKey(),
      )
      setSharePost(null)
      const rootID = created.repost_of_post_id || post.id
      const markReposted = (item: Post): Post => (item.repost_of_post_id || item.id) === rootID
        ? { ...item, reposted_by_me: true, repost_count: created.repost_count }
        : item
      data.setPosts((current) => current.map(markReposted))
      data.setProfilePosts((current) => [
        created,
        ...current.filter((item) => item.id !== created.id).map(markReposted),
      ])
      const sameCity =
        created.city.trim().toLocaleLowerCase('ru') ===
        (cityName || created.city).trim().toLocaleLowerCase('ru')
      if (created.visibility === 'city' && data.feedScope === 'city' && sameCity) {
        data.setPosts((current) => [created, ...current.filter((item) => item.id !== created.id)])
      }
      data.refresh('feed', 'profilePosts')
      syncPosts()
      setToast('Репост опубликован')
    } catch (error) {
      setSharePost(null)
      showError(error instanceof Error ? error.message : 'Не удалось сделать репост')
    } finally {
      sending.current = false
    }
  }
  async function shareToFriend(post: Post, userId: number) {
    const url = postURL(post)
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(url).catch(() => { })
      const target = await loadFriendDirectMessageTarget(userId)
      if (!target.max_user_id || !(await host.share({ link: url })))
        throw new Error('Не удалось открыть отправку в MAX')
      setSharePost(null)
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось открыть чат')
    }
  }
  async function messageFriend(userId: number) {
    try {
      const cached = data.friends.find(item => item.user.id === userId)?.user
      const target = cached?.max_chat_id ? cached : await loadFriendDirectMessageTarget(userId)
      if (target.max_chat_id && host.openChat(target.max_chat_id)) return
      throw new Error('Для этого друга нет доступного перехода в чат')
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось открыть чат')
    }
  }
  const currentSharePost = sharePost
    ? data.posts.find((item) => item.id === sharePost.id) || data.profilePosts.find((item) => item.id === sharePost.id) || sharePost
    : null
  return { sharePost: currentSharePost, setSharePost, share, copyPostLink, shareNative, repost, shareToFriend, messageFriend }
}
