import { useRef, type Dispatch, type SetStateAction } from 'react'
import { setPostLike, type Post } from '../api/posts'
import { syncPosts } from '../data/postSync'
import type { HostAdapter } from '../host'
import type { AppDataResult } from '../useAppData'
import type { Modal } from './useFeedback'

export function usePostActions(data: AppDataResult, host: HostAdapter,
  setLinkedPost: Dispatch<SetStateAction<Post | null>>,
  setModal: Dispatch<SetStateAction<Modal | null>>) {
  const pendingLikes = useRef(new Set<number>())
  function setKnownPostLike(postId: number, liked: boolean) {
    const update = (posts: Post[]) =>
      posts.map((item) => {
        if (item.id !== postId || item.liked_by_me === liked) return item
        return {
          ...item,
          liked_by_me: liked,
          like_count: Math.max(0, item.like_count + (liked ? 1 : -1)),
        }
      })
    data.setPosts(update)
    data.setProfilePosts(update)
    setLinkedPost((current) => {
      if (!current || current.id !== postId || current.liked_by_me === liked) return current
      return {
        ...current,
        liked_by_me: liked,
        like_count: Math.max(0, current.like_count + (liked ? 1 : -1)),
      }
    })
  }
  async function like(post: Post): Promise<boolean> {
    if (pendingLikes.current.has(post.id)) return false
    pendingLikes.current.add(post.id)
    const liked = !post.liked_by_me
    setKnownPostLike(post.id, liked)
    host.hapticImpact('light')
    try {
      await setPostLike(post.id, liked)
      return true
    } catch (error) {
      setKnownPostLike(post.id, post.liked_by_me)
      setModal({
        title: 'Не удалось отметить публикацию',
        description: error instanceof Error ? error.message : undefined,
        confirm: 'Понятно',
        onConfirm: () => setModal(null),
      })
      return false
    } finally {
      pendingLikes.current.delete(post.id)
      syncPosts([post.id])
    }
  }
  function changePostCommentCount(postId: number, delta: number) {
    if (!delta) return
    const update = (posts: Post[]) =>
      posts.map((item) =>
        item.id === postId
          ? { ...item, comment_count: Math.max(0, item.comment_count + delta) }
          : item,
      )
    data.setPosts(update)
    data.setProfilePosts(update)
    setLinkedPost((current) =>
      current?.id === postId
        ? {
          ...current,
          comment_count: Math.max(0, current.comment_count + delta),
        }
        : current,
    )
  }
  function refreshPost(postId: number) {
    syncPosts([postId])
  }
  return { like, changePostCommentCount, refreshPost }
}
