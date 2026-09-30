import { getHost } from './host'
import { eventIdInURL, eventInStart } from './ui-utils'

export type Route = { view: string; id?: number; key: string }
export const mainViews = new Set(['feed', 'events', 'map', 'friends', 'profile'])
export const ROOT_FEED_ROUTE: Route = { view: 'feed', key: 'root:feed' }

export function startRoute(): Route {
  const params = new URLSearchParams(window.location.search)
  const launchStart =
    window.WebApp?.initDataUnsafe?.start_param ||
    new URLSearchParams(getHost().initData).get('start_param') ||
    params.get('WebAppStartParam') ||
    params.get('startapp')
  const start = eventInStart(launchStart)
  if (start)
    return {
      view: start.target,
      id: start.id,
      key: 'initial:' + start.target + ':' + start.id,
    }
  const eventId = eventIdInURL(window.location.search)
  if (eventId) return { view: 'event', id: eventId, key: 'initial:event:' + eventId }
  const postId = params.get('postId')
  return postId && /^[1-9]\d*$/.test(postId) && Number.isSafeInteger(Number(postId))
    ? { view: 'post', id: Number(postId), key: 'initial:post:' + postId }
    : { view: 'feed', key: 'initial:feed' }
}
