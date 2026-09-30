import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export function compareCommentsForViewer(
  a: { id: number; author: { id: number }; rank_position?: number },
  b: { id: number; author: { id: number }; rank_position?: number },
  viewerId: number,
  newestFirst = true,
) {
  const ownership = Number(b.author.id === viewerId) - Number(a.author.id === viewerId)
  if (ownership) return ownership
  if (a.rank_position !== undefined && b.rank_position !== undefined)
    return a.rank_position - b.rank_position
  return newestFirst ? b.id - a.id : a.id - b.id
}

export function commentMediaStyle(
  item: { width: number; height: number },
  single: boolean,
): CSSProperties {
  if (!single) return {}
  const ratio =
    Number.isFinite(item.width) && Number.isFinite(item.height) && item.width > 0 && item.height > 0
      ? item.width / item.height
      : 4 / 3
  return { aspectRatio: String(Math.max(0.75, Math.min(2.4, ratio))) }
}

export function useCommentReveal() {
  const listRef = useRef<HTMLDivElement>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || pendingId === null) return
    let revealed: HTMLElement | null = null
    let timer: number | undefined
    let frame = 0
    const route = list.closest<HTMLElement>('.route-layer')
    const reveal = () => {
      if (revealed || list.closest('[inert]')) return
      const item = list.querySelector<HTMLElement>(`[data-comment-id="${pendingId}"]`)
      if (!item) return
      revealed = item
      const top =
        item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 12
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      list.scrollTo({
        top: Math.max(0, top),
        behavior: reduced ? 'auto' : 'smooth',
      })
      item.focus({ preventScroll: true })
      item.dataset.justSubmitted = 'true'
      timer = window.setTimeout(() => setPendingId(null), 1800)
    }
    frame = window.requestAnimationFrame(reveal)
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(reveal)
    })
    if (route)
      observer.observe(route, {
        attributes: true,
        attributeFilter: ['inert', 'data-layer-role'],
      })
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
      if (revealed) delete revealed.dataset.justSubmitted
    }
  }, [pendingId])
  return { listRef, revealComment: setPendingId }
}
