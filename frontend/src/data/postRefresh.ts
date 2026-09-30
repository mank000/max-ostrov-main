import { loadPostUpdates } from '../api/posts'
import { onPostSync, publishPosts, watchedPostIds } from './postSync'

export function startPostRefresh() {
  const pending = new Set<number>()
  let timer = 0
  let request: AbortController | null = null
  let stopped = false
  let retryDelay = 1000
  const active = () => !stopped && !document.hidden && navigator.onLine
  const queue = (ids: number[]) => {
    for (const id of ids) pending.add(id)
    if (!timer && !request && active()) timer = window.setTimeout(flush, 150)
  }
  async function flush() {
    timer = 0
    if (!active() || request || !pending.size) return
    const watched = new Set(watchedPostIds())
    const ids = [...pending].filter((id) => watched.has(id)).slice(0, 50)
    for (const id of [...pending]) if (!watched.has(id)) pending.delete(id)
    if (!ids.length) return
    for (const id of ids) pending.delete(id)
    const controller = new AbortController()
    request = controller
    let failed = false
    try {
      const posts = await loadPostUpdates(ids, controller.signal)
      retryDelay = 1000
      if (!controller.signal.aborted && !stopped) {
        const fresh = ids.filter((id) => !pending.has(id))
        publishPosts(posts, fresh)
      }
    } catch {
      failed = true
      if (!stopped) for (const id of ids) pending.add(id)
    } finally {
      request = null
      if (pending.size && active()) {
        timer = window.setTimeout(flush, failed ? retryDelay : 150)
        if (failed) retryDelay = Math.min(retryDelay * 2, 15000)
      }
    }
  }
  const unwatch = onPostSync(queue)
  queue(watchedPostIds())
  return {
    pause() {
      window.clearTimeout(timer)
      timer = 0
      request?.abort()
    },
    stop() {
      stopped = true
      window.clearTimeout(timer)
      request?.abort()
      pending.clear()
      unwatch()
    },
  }
}
