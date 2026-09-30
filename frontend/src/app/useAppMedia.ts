import { useState } from 'react'
import type { Post, PostMedia } from '../api/posts'

export function useAppMedia(allPosts: Post[], navigate: (view: string) => void) {
  const [media, setMedia] = useState<{ items: PostMedia[]; index: number }>({
    items: [],
    index: 0,
  })
  function openMedia(value: PostMedia | string, collection?: PostMedia[]) {
    const selected: PostMedia =
      typeof value === 'string'
        ? {
          id: 0,
          url: value,
          width: 1,
          height: 1,
          mime_type: 'image/jpeg',
          duration_ms: 0,
        }
        : value
    const owner = allPosts.find((post) =>
      post.media.some((item) => (selected.id > 0 && item.id === selected.id) || item.url === selected.url),
    )
    const items = collection?.length ? collection : owner?.media.length ? owner.media : [selected]
    const index = Math.max(
      0,
      items.findIndex((item) => (selected.id > 0 && item.id === selected.id) || item.url === selected.url),
    )
    setMedia({ items, index })
    navigate('media')
  }
  return { media, setMedia, openMedia }
}
