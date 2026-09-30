import { useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Post } from '../api/posts'
import { updatePost, watchPosts } from './postSync'

export function usePostUpdates(posts: Post[], setPosts: Dispatch<SetStateAction<Post[]>>) {
  const setter = useRef(setPosts)
  useLayoutEffect(() => { setter.current = setPosts }, [setPosts])
  const key = [...new Set(posts.flatMap((post) => [post.id, post.repost_of_post_id || 0]))]
    .filter((id) => id > 0).sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (!key) return
    return watchPosts(key.split(',').map(Number), (batch) => {
      setter.current((current) => current.flatMap((post) => {
        const updated = updatePost(post, batch)
        return updated ? [updated] : []
      }))
    })
  }, [key])
}

export function usePostUpdate(post: Post | null, setPost: Dispatch<SetStateAction<Post | null>>) {
  const setter = useRef(setPost)
  useLayoutEffect(() => { setter.current = setPost }, [setPost])
  const id = post?.id
  const originalId = post?.repost_of_post_id
  useEffect(() => {
    if (!id) return
    return watchPosts(originalId ? [id, originalId] : [id], (batch) => {
      setter.current((current) => current ? updatePost(current, batch) : null)
    })
  }, [id, originalId])
}
